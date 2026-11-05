import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { tables, calls, resetTables, setFault, writes } from "./support/cassandra.mjs";
import { withCookies } from "./support/cookies.mjs";
import { createSession } from "../src/lib/auth.ts";
import { authenticateDemoUser } from "../src/lib/demo-auth.ts";
import { bookTrip, changeTripStatus, reassignTripAfterDriverCancellation } from "../src/services/trips.ts";

const id = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const c = id(1), c2 = id(2), d = id(11), d2 = id(12), v = id(21), v2 = id(22), s = id(31);
const password = "MockOnly@123", salt = randomBytes(16).toString("hex");
const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const customer = { userId: c, role: "CUSTOMER", name: "Test customer", email: "customer@test.invalid" };
const driver = { userId: d, role: "DRIVER", name: "Test driver", email: "driver@test.invalid" };
const admin = { userId: "admin-demo", role: "ADMIN", name: "Admin", email: "admin@test.invalid" };
const input = { customerId: c, serviceId: s, pickup: { label: "Mock pickup", lat: 10.7, lng: 106.7 }, destination: { label: "Mock destination", lat: 10.8, lng: 106.8 }, paymentMethod: "CASH" };

function seed() {
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED = "false";
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  process.env.ADMIN_EMAIL = admin.email; process.env.ADMIN_PASSWORD_HASH = hash;
  resetTables({
    customers: [customer, { ...customer, userId: c2, email: "second@test.invalid" }].map((u) => ({ customer_id: u.userId, full_name: u.name, email: u.email, password: hash, status: "ACTIVE", phone: "0901234567" })),
    drivers: [d, d2].map((driver_id, index) => ({ driver_id, full_name: "Test driver", email: index ? "second-driver@test.invalid" : driver.email, password: hash, account_status: "ACTIVE", driver_status: index ? "OFFLINE" : "AVAILABLE", rating: 0 })),
    vehicles: [v, v2].map((vehicle_id, index) => ({ vehicle_id, driver_id: index ? d2 : d, vehicle_type: "BIKE", seat_count: 2, status: "ACTIVE", brand: "Test", model: "Bike", license_plate: "TEST-123" })),
    service_types: [{ service_id: s, service_name: "BIKE", base_fare: "10000", price_per_km: "1000", status: "ACTIVE" }],
    vouchers: [{ voucher_code: "LAST", voucher_name: "Last use", status: "ACTIVE", quantity: 1, start_date: "2020-01-01", end_date: "2030-01-01", min_trip_amount: "0", discount_type: "PERCENT", discount_value: "100", max_discount: "50000" }],
    customer_vouchers: [c, c2].map((customer_id) => ({ customer_id, voucher_code: "LAST", status: "AVAILABLE" })),
  });
}
beforeEach(seed);
function row(table) { return tables.get(table)?.[0]; }
async function invoke(file, method, actor, body, params = {}, key = randomUUID(), query = "") {
  const route = await import(`../src/app/api/${file}/route.ts`);
  const token = actor ? await withCookies(undefined, async (store) => { await createSession(actor); return store.get("rideflow_session").value; }) : undefined;
  return withCookies(token, () => route[method](new Request(`http://localhost/api/test${query}`, { method,
    ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }) }), { params: Promise.resolve(params) }));
}
async function booked(voucher = false) { return bookTrip({ ...input, ...(voucher ? { voucherCode: "LAST" } : {}) }, "booking-memory-key-1"); }
async function progress(tripId) { for (const status of ["ACCEPTED", "ARRIVING", "IN_PROGRESS"]) await changeTripStatus(tripId, status); }
function synchronized(tripId, status) {
  for (const table of ["trips_by_id", "trips_by_customer", "trips_by_driver", "trips_by_status"]) {
    const copies = tables.get(table).filter((r) => r.trip_id === tripId);
    assert.equal(copies.length, 1, table); assert.equal(copies[0].status, status, table);
  }
}

test("Demo booking returns the car-specific reference range based on the server route", async () => {
  tables.get("service_types")[0].service_name = "CAR_4";
  tables.get("vehicles")[0].vehicle_type = "CAR_4";
  tables.get("vehicles")[0].seat_count = 4;
  const trip = await booked();
  assert.equal(trip.distanceKm, 2);
  assert.deepEqual(trip.travelTimeEstimate, { minMinutes: 20, maxMinutes: 30, minMinutesPerKm: 10, maxMinutesPerKm: 15 });
});

test("journal-off booking: one driver, same request retry, full projections", async () => {
  const results = await Promise.allSettled([booked(), booked(), bookTrip({ ...input, customerId: c2 }, "other-booking-key")]);
  assert.equal(results[0].status, "fulfilled"); assert.deepEqual(results[0], results[1]); assert.equal(results[2].status, "rejected");
  synchronized(results[0].value.tripId, "BOOKED"); assert.equal(row("drivers").driver_status, "BUSY");
});

test("journal-off booking retries every partial/ambiguous batch without new IDs", async () => {
  await booked(); const count = writes().length;
  for (const when of ["before", "after"]) for (let step = 1; step <= count; step++) {
    seed(); setFault({ match: ({ cql }) => !cql.startsWith("SELECT"), remaining: step, when });
    await assert.rejects(booked()); const result = await booked();
    synchronized(result.tripId, "BOOKED"); assert.equal(tables.get("trips_by_id").length, 1);
    assert.equal(tables.get("trip_status_history").length, 1);
  }
});

test("journal-off completion repairs every interrupted statement and duplicate retry", async () => {
  const sample = await booked(); await progress(sample.tripId); calls.length = 0;
  await changeTripStatus(sample.tripId, "COMPLETED"); const count = writes().length;
  for (const when of ["before", "after"]) for (let step = 1; step <= count; step++) {
    seed(); const result = await booked(); await progress(result.tripId);
    setFault({ match: ({ cql }) => !cql.startsWith("SELECT"), remaining: step, when });
    await assert.rejects(changeTripStatus(result.tripId, "COMPLETED"));
    await changeTripStatus(result.tripId, "COMPLETED"); await changeTripStatus(result.tripId, "COMPLETED");
    synchronized(result.tripId, "COMPLETED"); assert.equal(row("drivers").driver_status, "AVAILABLE");
    for (const table of ["payments_by_trip", "payments_by_customer", "driver_revenue_by_month", "customer_spending_by_month"]) assert.equal(tables.get(table).length, 1, table);
  }
});

test("completion can repair an older COMPLETED trip without payment after process-cache loss", async () => {
  const result = await booked(); await progress(result.tripId); await changeTripStatus(result.tripId, "COMPLETED");
  globalThis.rideflowDemoWrites.entries.clear();
  for (const table of ["payments_by_trip", "payments_by_customer", "driver_revenue_by_month", "customer_spending_by_month"]) tables.set(table, []);
  row("drivers").driver_status = "BUSY"; tables.set("trips_by_customer", []);
  await changeTripStatus(result.tripId, "COMPLETED"); synchronized(result.tripId, "COMPLETED");
  assert.equal(row("drivers").driver_status, "AVAILABLE"); assert.equal(tables.get("payments_by_trip").length, 1);
});

test("voucher final use is serialized, zero fare stays zero, cancellation refunds exactly once", async () => {
  tables.get("drivers")[1].driver_status = "AVAILABLE";
  const result = await booked(true);
  await assert.rejects(bookTrip({ ...input, customerId: c2, voucherCode: "LAST" }, "different-request-key"));
  assert.equal(result.finalFare, 0); assert.equal(row("vouchers").quantity, 0);
  await changeTripStatus(result.tripId, "CANCELLED"); await changeTripStatus(result.tripId, "CANCELLED");
  assert.equal(row("vouchers").quantity, 1); assert.equal(row("customer_vouchers").status, "AVAILABLE");
  const second = await bookTrip({ ...input, voucherCode: "LAST" }, "new-booking-key"); await progress(second.tripId); await changeTripStatus(second.tripId, "COMPLETED");
  for (const [table, field] of [["payments_by_trip", "amount"], ["driver_revenue_by_month", "fare"], ["customer_spending_by_month", "amount"]]) assert.equal(Number(row(table)[field]), 0);
});

test("voucher cancellation retries partial writes without double refunds", async () => {
  const sample = await booked(true); calls.length = 0; await changeTripStatus(sample.tripId, "CANCELLED"); const count = writes().length;
  for (const when of ["before", "after"]) for (let step = 1; step <= count; step++) {
    seed(); const result = await booked(true);
    setFault({ match: ({ cql }) => !cql.startsWith("SELECT"), remaining: step, when });
    await assert.rejects(changeTripStatus(result.tripId, "CANCELLED")); await changeTripStatus(result.tripId, "CANCELLED");
    assert.equal(row("vouchers").quantity, 1); assert.equal(row("customer_vouchers").status, "AVAILABLE");
  }
});

test("old trips never guess a voucher; cancellation after departure is refused", async () => {
  const result = await booked(); await changeTripStatus(result.tripId, "CANCELLED"); assert.equal(row("vouchers").quantity, 1);
  seed(); const next = await booked(); await progress(next.tripId); const before = writes().length;
  await assert.rejects(changeTripStatus(next.tripId, "CANCELLED"), { status: 409 }); assert.equal(writes().length, before);
});

test("driver incident retries through API even after driver_id has changed", async () => {
  const result = await booked(); tables.get("drivers")[1].driver_status = "AVAILABLE";
  setFault({ match: ({ cql }) => cql.startsWith("INSERT INTO notifications_by_user"), remaining: 1, when: "after" });
  const key = randomUUID();
  const first = await invoke("trips/[id]/status", "PATCH", driver, { status: "CANCELLED" }, { id: result.tripId }, key);
  assert.equal(first.status, 503);
  const retry = await invoke("trips/[id]/status", "PATCH", driver, { status: "CANCELLED" }, { id: result.tripId }, key);
  assert.equal(retry.status, 200); synchronized(result.tripId, "BOOKED");
  assert.equal(row("trips_by_id").driver_id, d2); assert.equal(row("drivers").driver_status, "OFFLINE");
  assert.equal(tables.get("notifications_by_user").filter((row) => row.user_id === c).length, 1);
});

test("incident without another driver cancels and refunds the linked voucher", async () => {
  const result = await booked(true); await reassignTripAfterDriverCancellation(result.tripId, d, "Test incident");
  synchronized(result.tripId, "CANCELLED"); assert.equal(row("drivers").driver_status, "OFFLINE"); assert.equal(row("vouchers").quantity, 1);
});

test("review API retries partial writes and does not double-count rating", async () => {
  const result = await booked(); await progress(result.tripId); await changeTripStatus(result.tripId, "COMPLETED");
  setFault({ match: ({ cql }) => cql.startsWith("INSERT INTO reviews_by_driver"), remaining: 1, when: "after" });
  assert.equal((await invoke("trips/[id]/review", "POST", customer, { rating: 4, comment: "Test" }, { id: result.tripId })).status, 503);
  assert.equal((await invoke("trips/[id]/review", "POST", customer, { rating: 4, comment: "Test" }, { id: result.tripId })).status, 201);
  assert.equal(tables.get("reviews_by_trip").length, 1); assert.equal(tables.get("reviews_by_driver").length, 1); assert.equal(row("drivers").rating, 4);
});

test("Admin can list and notify recipients who have never received notifications", async () => {
  const response = await invoke("admin/[resource]", "GET", admin, undefined, { resource: "notifications" }, undefined, "?recipients=true");
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.data.length, 4);
  assert.ok(body.data.some((u) => u.user_id === c2)); assert.ok(body.data.some((u) => u.user_id === d2));
  for (const userId of [c2, d2]) assert.equal((await invoke("admin/[resource]", "POST", admin, { userId, title: "Test title", content: "Test message" }, { resource: "notifications" })).status, 201);
  assert.equal((await invoke("admin/[resource]", "GET", customer, undefined, { resource: "notifications" }, undefined, "?recipients=true")).status, 403);
});

test("all roles login/logout using mock hashes and cookies; malformed hashes fail closed", async () => {
  for (const actor of [customer, driver, admin]) {
    assert.equal((await invoke("auth/login", "POST", undefined, { email: actor.email, password })).status, 200);
    assert.equal((await invoke("auth/logout", "POST", actor, {})).status, 200);
  }
  for (const malformed of ["plaintext", "scrypt$x$", "scrypt$aa$gg", `scrypt$${salt}$${"00".repeat(64)}$extra`]) {
    row("customers").password = malformed; assert.equal(await authenticateDemoUser(customer.email, password), null);
  }
});

test("mock registration hashes the password, normalizes email, blocks duplicates and logs in", async () => {
  const body = { fullName: "New mock customer", phone: "0900000099", email: " NEW@test.invalid ", password, confirmPassword: password, role: "ADMIN" };
  const response = await invoke("auth/register", "POST", undefined, body);
  assert.equal(response.status, 201);
  const created = tables.get("customers").find((u) => u.email === "new@test.invalid");
  assert.match(created.password, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/); assert.notEqual(created.password, password);
  assert.equal((await invoke("auth/register", "POST", undefined, body)).status, 409);
  const login = await invoke("auth/login", "POST", undefined, { email: body.email, password });
  assert.equal(login.status, 200); assert.equal((await login.json()).data.role, "CUSTOMER");
});

test("mock complaint create/process/resolve and three role dashboards", async () => {
  const trip = await booked();
  const response = await invoke("customers/[id]/complaints", "POST", customer, { subject: "Mock support", content: "Mock complaint content", tripId: trip.tripId }, { id: c });
  assert.equal(response.status, 201);
  const complaint = (await response.json()).data;
  for (const status of ["PROCESSING", "RESOLVED"]) {
    assert.equal((await invoke("admin/complaints/[customerId]/[createdAt]/[complaintId]", "PATCH", admin, { status }, {
      customerId: c, createdAt: encodeURIComponent(complaint.createdAt), complaintId: complaint.complaintId,
    })).status, 200);
  }
  assert.equal(row("complaints_by_customer").status, "RESOLVED"); assert.ok(row("complaints_by_customer").resolved_at);
  for (const actor of [customer, driver, admin]) assert.equal((await invoke("dashboard", "GET", actor, undefined, {}, undefined, "?month=2026-10")).status, 200);
});
