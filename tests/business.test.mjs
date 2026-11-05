import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { calls, resetTables, tables, businessWrites, setFault, setExecutionHook, setUnavailable, setPageSize } from "./support/cassandra.mjs";
import { bookTrip, changeTripStatus, reassignTripAfterDriverCancellation } from "../src/services/trips.ts";
import { recoverPendingOperation, businessRead, withBusinessRead } from "../src/lib/business-journal.ts";
import { createAdminResource, updateAdminResource, setDriverAvailability, reviewTripDurably, voucherSchema } from "../src/services/business-resources.ts";
import { adminResourceKey, currentReportMonth, finiteMoney, displayMoney, tripFare } from "../src/lib/business-values.ts";
import { mutationHeaders, completeMutation } from "../src/lib/mutation-request.ts";
import { getAdminDashboard, getCustomerDashboard, getDriverDashboard } from "../src/services/dashboard.ts";
import { getRecentAdminTrips } from "../src/repositories/ride-data.ts";
import { createSession } from "../src/lib/auth.ts";
import { withCookies } from "./support/cookies.mjs";

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C1 = id(1), C2 = id(2), D1 = id(11), D2 = id(12), V1 = id(21), V2 = id(22), S1 = id(31);
const customer = { userId: C1, role: "CUSTOMER", name: "Test customer", email: "customer@test.invalid" };
const driver = { userId: D1, role: "DRIVER", name: "Test driver", email: "driver@test.invalid" };
const input = { customerId: C1, serviceId: S1, pickup: { label: "Test pickup", lat: 10.7, lng: 106.7 }, destination: { label: "Test destination", lat: 10.8, lng: 106.8 }, paymentMethod: "CASH" };
const expectedError = (status) => (error) => error.status === status;
const originalError = console.error;

function seed({ twoDrivers = false, quantity = 1, withVoucher = false } = {}) {
  resetTables({
    customers: [C1, C2].map((customer_id, i) => ({ customer_id, full_name: "Test customer", email: i ? "other@test.invalid" : customer.email, phone: "0901234567", status: "ACTIVE" })),
    drivers: [D1, D2].map((driver_id, i) => ({ driver_id, full_name: "Test driver", email: i ? "otherdriver@test.invalid" : driver.email, phone: "0901234567", account_status: "ACTIVE", driver_status: !i || twoDrivers ? "AVAILABLE" : "OFFLINE" })),
    vehicles: [V1, V2].map((vehicle_id, i) => ({ vehicle_id, driver_id: i ? D2 : D1, status: "ACTIVE", vehicle_type: "BIKE", brand: "Test", model: "Bike", license_plate: `TEST-${i}`, seat_count: 2 })),
    service_types: [{ service_id: S1, service_name: "BIKE", base_fare: "10000", price_per_km: "1000", status: "ACTIVE" }],
    vouchers: withVoucher ? [{ voucher_code: "TEST", voucher_name: "Test voucher", discount_type: "PERCENT", discount_value: "100", max_discount: "50000", min_trip_amount: "0", quantity, start_date: "2020-01-01T00:00:00.000Z", end_date: "2099-01-01T00:00:00.000Z", status: "ACTIVE" }] : [],
    customer_vouchers: withVoucher ? [C1, C2].map((customer_id) => ({ customer_id, voucher_code: "TEST", status: "AVAILABLE", used_at: null })) : [],
  });
}
beforeEach(() => {
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED = "true";
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  console.error = originalError;
  seed();
});

async function booking(overrides = {}, key = randomUUID()) { return bookTrip({ ...input, ...overrides }, key); }
async function change(tripId, status, actor = driver, key = randomUUID()) { return changeTripStatus(tripId, status, undefined, actor, key); }
async function startedTrip() {
  const trip = await booking();
  await change(trip.tripId, "ACCEPTED"); await change(trip.tripId, "ARRIVING"); await change(trip.tripId, "IN_PROGRESS");
  return trip;
}
function assertProjections(tripId, status) {
  for (const table of ["trips_by_id", "trips_by_customer", "trips_by_driver", "trips_by_status"]) {
    const rows = tables.get(table).filter((row) => row.trip_id === tripId);
    assert.equal(rows.length, 1, `${table} must have one current projection`);
    assert.equal(rows[0].status, status);
    assert.equal(String(rows[0].final_fare), String(tables.get("trips_by_id").find((row) => row.trip_id === tripId).final_fare));
  }
}
function prepared() { return (tables.get("rideflow_business_journal") ?? []).filter((row) => row.state === "PREPARED"); }

test("Durable booking returns the car-specific reference range based on the server route", async () => {
  tables.get("service_types")[0].service_name = "CAR_4";
  tables.get("vehicles")[0].vehicle_type = "CAR_4";
  tables.get("vehicles")[0].seat_count = 4;
  const trip = await booking();
  assert.equal(trip.distanceKm, 2);
  assert.deepEqual(trip.travelTimeEstimate, { minMinutes: 20, maxMinutes: 30, minMinutesPerKm: 10, maxMinutesPerKm: 15 });
});

test("two customers racing for one driver produce exactly one active trip", async () => {
  const results = await Promise.allSettled([booking(), booking({ customerId: C2 })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  const trips = tables.get("trips_by_id");
  assert.equal(trips.length, 1); assert.equal(trips[0].driver_id, D1);
  assert.equal(tables.get("drivers")[0].driver_status, "BUSY");
  assertProjections(trips[0].trip_id, "BOOKED");
});

test("two concurrent accept requests are idempotent and append one history entry", async () => {
  const trip = await booking();
  const results = await Promise.all([change(trip.tripId, "ACCEPTED"), change(trip.tripId, "ACCEPTED")]);
  assert.ok(results.every((result) => result.status === "ACCEPTED"));
  assert.equal(tables.get("trip_status_history").filter((row) => row.status === "ACCEPTED").length, 1);
  assertProjections(trip.tripId, "ACCEPTED");
});

test("same booking request key replays one result, including concurrent retries", async () => {
  const key = randomUUID();
  const [first, second] = await Promise.all([booking({}, key), booking({}, key)]);
  assert.deepEqual(second, first);
  const count = businessWrites().length;
  assert.deepEqual(await booking({}, key), first);
  assert.equal(businessWrites().length, count);
  assert.equal(tables.get("trips_by_id").length, 1);
  await assert.rejects(booking({ paymentMethod: "BANK_TRANSFER" }, key), expectedError(409));
});

test("a busy, offline, blocked driver or mismatched vehicle cannot be assigned", async () => {
  for (const configure of [
    () => { tables.get("drivers")[0].driver_status = "BUSY"; },
    () => { tables.get("drivers")[0].driver_status = "OFFLINE"; },
    () => { tables.get("drivers")[0].account_status = "BLOCKED"; },
    () => { tables.get("vehicles")[0].driver_id = id(999); },
    () => { tables.get("vehicles")[0].status = "INACTIVE"; },
  ]) {
    seed(); configure();
    await assert.rejects(booking(), expectedError(409));
    assert.equal(businessWrites().length, 0);
  }
});

test("older active canonical trip is detected even when absent from the 50-row driver projection", async () => {
  const history = Array.from({ length: 75 }, (_, n) => ({ trip_id: id(100 + n), driver_id: D1, customer_id: C1, status: "COMPLETED" }));
  tables.set("trips_by_driver", history);
  tables.set("trips_by_id", [...history, { trip_id: id(999), driver_id: D1, customer_id: C1, status: "ACCEPTED" }]);
  await assert.rejects(booking(), expectedError(409));
  await assert.rejects(setDriverAvailability(D1, "AVAILABLE", randomUUID()), expectedError(409));
  assert.equal(businessWrites().length, 0);
});

test("legacy driver with two active trips cannot accept or start another one", async () => {
  const trip = await booking();
  tables.get("trips_by_id").push({ ...tables.get("trips_by_id")[0], trip_id: id(999) });
  await assert.rejects(change(trip.tripId, "ACCEPTED"), expectedError(409));
  assert.equal(tables.get("trip_status_history").length, 1);
});

test("invalid transitions and cancellation after starting do not change projections", async () => {
  const trip = await booking();
  await assert.rejects(change(trip.tripId, "COMPLETED"), expectedError(409));
  await change(trip.tripId, "ACCEPTED"); await change(trip.tripId, "ARRIVING"); await change(trip.tripId, "IN_PROGRESS");
  await assert.rejects(change(trip.tripId, "CANCELLED", customer), expectedError(409));
  await assert.rejects(reassignTripAfterDriverCancellation(trip.tripId, D1, undefined, driver, randomUUID()), expectedError(409));
  assertProjections(trip.tripId, "IN_PROGRESS");
});

test("changing account or vehicle state before acceptance blocks the action", async () => {
  for (const configure of [
    () => { tables.get("drivers")[0].account_status = "BLOCKED"; },
    () => { tables.get("drivers")[0].driver_status = "OFFLINE"; },
    () => { tables.get("vehicles")[0].driver_id = D2; },
  ]) {
    seed(); const trip = await booking(); configure();
    await assert.rejects(change(trip.tripId, "ACCEPTED"), expectedError(409));
    assertProjections(trip.tripId, "BOOKED");
  }
});

for (const when of ["before", "after"]) {
  for (let step = 1; step <= 8; step++) {
    test(`booking resumes after ${when}-write failure at business step ${step}`, async () => {
      seed({ withVoucher: true });
      const key = randomUUID(); console.error = () => {};
      setFault({ match: ({ cql }) => !cql.startsWith("SELECT ") && !cql.includes("rideflow_business_journal"), remaining: step, when });
      await assert.rejects(booking({ voucherCode: "TEST" }, key), expectedError(503));
      assert.equal(prepared().length, 1);
      const trip = await booking({ voucherCode: "TEST" }, key);
      assertProjections(trip.tripId, "BOOKED");
      assert.equal(tables.get("trip_status_history").length, 1);
      assert.equal(tables.get("vouchers")[0].quantity, 0);
      assert.equal(tables.get("customer_vouchers")[0].status, "USED");
      assert.equal(prepared().length, 0);
    });
  }
}

for (const phase of ["acquisition", "commit"]) {
  test(`ambiguous ${phase} timeout is recovered using the persisted operation`, async () => {
    const key = randomUUID(); console.error = () => {};
    setFault({ match: ({ cql }) => cql.startsWith("BEGIN BATCH") && (phase === "acquisition" ? cql.includes("INSERT INTO") : !cql.includes("INSERT INTO")), remaining: 1, when: "after" });
    await assert.rejects(booking({}, key), expectedError(503));
    const trip = await booking({}, key);
    assert.equal(tables.get("trips_by_id").length, 1);
    assertProjections(trip.tripId, "BOOKED");
    assert.equal(prepared().length, 0);
  });
}

test("another request rolls forward a pending operation before allocating a driver", async () => {
  console.error = () => {};
  setFault({ match: ({ cql }) => cql.startsWith("INSERT INTO trips_by_customer"), remaining: 1, when: "after" });
  await assert.rejects(booking(), expectedError(503));
  await assert.rejects(booking({ customerId: C2 }), expectedError(409));
  assert.equal(tables.get("trips_by_id").length, 1);
  assert.equal(prepared().length, 0);
  assertProjections(tables.get("trips_by_id")[0].trip_id, "BOOKED");
});

test("read APIs refuse partial projections and do not perform recovery writes on GET", async () => {
  console.error = () => {};
  setFault({ match: ({ cql }) => cql.startsWith("INSERT INTO trips_by_customer"), remaining: 1, when: "before" });
  await assert.rejects(booking(), expectedError(503));
  const count = businessWrites().length;
  const { GET } = await import("../src/app/api/customers/[id]/trips/route.ts");
  const response = await withCookies(undefined, async () => {
    await createSession(customer);
    return GET(new Request("http://localhost/api/customer/trips"), { params: Promise.resolve({ id: C1 }) });
  });
  assert.equal(response.status, 503);
  assert.equal(businessWrites().length, count);
  await recoverPendingOperation();
  const rows = await withBusinessRead(() => businessRead("SELECT * FROM trips_by_customer WHERE customer_id = ?", [C1]));
  assert.equal(rows.length, 1);
});

test("a read spanning a committed mutation is rejected instead of returning mixed snapshots", async () => {
  const trip = await booking();
  await assert.rejects(withBusinessRead(async () => {
    const old = await businessRead("SELECT * FROM trips_by_id WHERE trip_id = ?", [trip.tripId]);
    await change(trip.tripId, "ACCEPTED");
    return old;
  }), expectedError(503));
});

test("a paused old executor cannot overwrite newer trip, driver or status projection state", async () => {
  let release, observed;
  const paused = new Promise((resolve) => { observed = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  setExecutionHook(async ({ cql }) => {
    if (!held && cql.startsWith("INSERT INTO trips_by_status")) { held = true; observed(); await gate; }
  });
  const first = booking();
  await paused;
  await recoverPendingOperation();
  const tripId = tables.get("trips_by_id")[0].trip_id;
  await change(tripId, "CANCELLED", customer);
  release(); await first;
  assertProjections(tripId, "CANCELLED");
  assert.equal(tables.get("drivers")[0].driver_status, "AVAILABLE");
});

test("completion retries and concurrent completion create one payment and one revenue/spending record", async () => {
  const trip = await startedTrip();
  await Promise.all([change(trip.tripId, "COMPLETED"), change(trip.tripId, "COMPLETED")]);
  await change(trip.tripId, "COMPLETED");
  for (const table of ["payments_by_trip", "payments_by_customer", "driver_revenue_by_month", "customer_spending_by_month"]) assert.equal(tables.get(table).length, 1, table);
  assert.equal(tables.get("trip_status_history").filter((row) => row.status === "COMPLETED").length, 1);
  assert.equal(tables.get("payments_by_trip")[0].payment_id, tables.get("payments_by_customer")[0].payment_id);
  assert.equal(tables.get("drivers")[0].driver_status, "AVAILABLE");
  assertProjections(trip.tripId, "COMPLETED");
});

for (const when of ["before", "after"]) {
  for (let step = 1; step <= 11; step++) {
    test(`completion resumes after ${when}-write failure at business step ${step}`, async () => {
      const trip = await startedTrip();
      const key = randomUUID(); console.error = () => {};
      setFault({ match: ({ cql }) => !cql.startsWith("SELECT ") && !cql.includes("rideflow_business_journal"), remaining: step, when });
      await assert.rejects(change(trip.tripId, "COMPLETED", driver, key), expectedError(503));
      await change(trip.tripId, "COMPLETED", driver, key);
      for (const table of ["payments_by_trip", "payments_by_customer", "driver_revenue_by_month", "customer_spending_by_month"]) assert.equal(tables.get(table).length, 1, table);
      assertProjections(trip.tripId, "COMPLETED");
      assert.equal(prepared().length, 0);
    });
  }
}

test("two users cannot consume the final voucher concurrently", async () => {
  seed({ twoDrivers: true, withVoucher: true });
  const results = await Promise.allSettled([booking({ voucherCode: "TEST" }), booking({ customerId: C2, voucherCode: "TEST" })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
  assert.equal(tables.get("vouchers")[0].quantity, 0);
  assert.equal(tables.get("customer_vouchers").filter((row) => row.status === "USED").length, 1);
});

test("cancellation before departure refunds the exact voucher once and permits reuse", async () => {
  seed({ withVoucher: true });
  const trip = await booking({ voucherCode: "TEST" });
  await Promise.all([change(trip.tripId, "CANCELLED", customer), change(trip.tripId, "CANCELLED", customer)]);
  assert.equal(tables.get("vouchers")[0].quantity, 1);
  assert.equal(tables.get("customer_vouchers")[0].status, "AVAILABLE");
  assert.equal(tables.get("customer_vouchers")[0].used_at, null);
  assert.equal(tables.get("trip_status_history").filter((row) => row.status === "CANCELLED").length, 1);
  assertProjections(trip.tripId, "CANCELLED");
  assert.equal(tables.get("payments_by_trip")?.length ?? 0, 0);
  const next = await booking({ voucherCode: "TEST" });
  assert.notEqual(next.tripId, trip.tripId);
  assert.equal(tables.get("vouchers")[0].quantity, 0);
});

for (const when of ["before", "after"]) {
  for (let step = 1; step <= 9; step++) {
    test(`voucher cancellation resumes after ${when}-write failure at step ${step}`, async () => {
      seed({ withVoucher: true }); const trip = await booking({ voucherCode: "TEST" });
      const key = randomUUID(); console.error = () => {};
      setFault({ match: ({ cql }) => !cql.startsWith("SELECT ") && !cql.includes("rideflow_business_journal"), remaining: step, when });
      await assert.rejects(change(trip.tripId, "CANCELLED", customer, key), expectedError(503));
      await change(trip.tripId, "CANCELLED", customer, key);
      assert.equal(tables.get("vouchers")[0].quantity, 1);
      assert.equal(tables.get("customer_vouchers")[0].status, "AVAILABLE");
      assertProjections(trip.tripId, "CANCELLED");
    });
  }
}

test("expired, malformed, unavailable or over-100-percent vouchers are refused without writes", async () => {
  for (const fields of [{ end_date: "2020-01-02" }, { start_date: "2100-01-01" }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.2 }, { discount_value: "101" }, { discount_type: "INVALID" }, { max_discount: "NaN" }]) {
    seed({ withVoucher: true }); Object.assign(tables.get("vouchers")[0], fields);
    await assert.rejects(booking({ voucherCode: "TEST" }), expectedError(409));
    assert.equal(businessWrites().length, 0);
  }
});

test("free trips retain fare zero in trip, payment, revenue and display", async () => {
  seed({ withVoucher: true }); const trip = await booking({ voucherCode: "TEST", paymentMethod: "CASH" });
  assert.equal(trip.finalFare, 0);
  await change(trip.tripId, "ACCEPTED"); await change(trip.tripId, "ARRIVING"); await change(trip.tripId, "IN_PROGRESS"); await change(trip.tripId, "COMPLETED");
  assert.equal(tables.get("payments_by_trip")[0].amount, "0");
  assert.equal(tables.get("driver_revenue_by_month")[0].fare, "0");
  assert.equal(displayMoney(tripFare({ final_fare: 0, estimated_fare: 12000 })), "0 ₫");
  assert.equal(tables.get("payments_by_trip")[0].payment_method, "CASH");
});

test("invalid service prices never reach driver or trip writes", async () => {
  for (const fields of [{ base_fare: "NaN" }, { base_fare: "-1" }, { price_per_km: "0" }, { price_per_km: "Infinity" }, { base_fare: "999999999999999" }]) {
    seed(); Object.assign(tables.get("service_types")[0], fields);
    await assert.rejects(booking(), expectedError(409));
    assert.equal(businessWrites().length, 0);
  }
});

test("driver incident reassigns once and synchronizes all projections", async () => {
  seed({ twoDrivers: true }); const trip = await booking();
  const key = randomUUID();
  const result = await reassignTripAfterDriverCancellation(trip.tripId, D1, undefined, driver, key);
  assert.equal(result.reassigned, true); assert.equal(result.driver_id, D2);
  assertProjections(trip.tripId, "BOOKED");
  assert.equal(tables.get("drivers")[0].driver_status, "OFFLINE");
  assert.equal(tables.get("drivers")[1].driver_status, "BUSY");
  assert.deepEqual(await reassignTripAfterDriverCancellation(trip.tripId, D1, undefined, driver, key), result);
  assert.equal(tables.get("notifications_by_user").filter((row) => row.user_id === C1).length, 1);
});

test("incident without replacement cancels and refunds voucher", async () => {
  seed({ withVoucher: true }); const trip = await booking({ voucherCode: "TEST" });
  const result = await reassignTripAfterDriverCancellation(trip.tripId, D1, undefined, driver, randomUUID());
  assert.equal(result.reassigned, false); assertProjections(trip.tripId, "CANCELLED");
  assert.equal(tables.get("vouchers")[0].quantity, 1);
  assert.equal(tables.get("drivers")[0].driver_status, "OFFLINE");
});

for (const when of ["before", "after"]) {
  for (let step = 1; step <= 10; step++) {
    test(`reassignment resumes after ${when}-write failure at step ${step}`, async () => {
      seed({ twoDrivers: true }); const trip = await booking(); await change(trip.tripId, "ACCEPTED");
      const key = randomUUID(); console.error = () => {};
      setFault({ match: ({ cql }) => !cql.startsWith("SELECT ") && !cql.includes("rideflow_business_journal"), remaining: step, when });
      await assert.rejects(reassignTripAfterDriverCancellation(trip.tripId, D1, undefined, driver, key), expectedError(503));
      const result = await reassignTripAfterDriverCancellation(trip.tripId, D1, undefined, driver, key);
      assert.equal(result.driver_id, D2);
      assertProjections(trip.tripId, "BOOKED");
      assert.equal(tables.get("notifications_by_user").filter((row) => row.user_id === C1).length, 1);
      assert.equal(tables.get("drivers")[0].driver_status, "OFFLINE");
      assert.equal(tables.get("drivers")[1].driver_status, "BUSY");
    });
  }
}

test("legacy duplicate payment records are detected and never silently deleted or multiplied", async () => {
  const trip = await startedTrip();
  tables.set("payments_by_trip", [1, 2].map((n) => ({ trip_id: trip.tripId, payment_id: id(100 + n), customer_id: C1, amount: "12000", payment_method: "CASH", payment_status: "PAID", paid_at: new Date().toISOString() })));
  const count = businessWrites().length;
  await assert.rejects(change(trip.tripId, "COMPLETED"), expectedError(409));
  assert.equal(tables.get("payments_by_trip").length, 2);
  assert.equal(businessWrites().length, count);
  assertProjections(trip.tripId, "IN_PROGRESS");
});

test("paginated canonical reads do not miss an active driver trip on the second page", async () => {
  setPageSize(1);
  tables.set("trips_by_id", [{ trip_id: id(100), driver_id: D2, status: "COMPLETED" }, { trip_id: id(101), driver_id: D1, status: "BOOKED" }]);
  await assert.rejects(booking(), expectedError(409));
  assert.ok(calls.some(({ options }) => options.pageState === "1"));
});

test("Customer and Driver dashboard month filters use partition time ranges", async () => {
  const trips = ["2026-09-15", "2026-10-15"].map((date, n) => ({ trip_id: id(200 + n), customer_id: C1, driver_id: D1, booked_at: `${date}T00:00:00.000Z`, status: "COMPLETED", final_fare: "10000" }));
  tables.set("trips_by_customer", trips); tables.set("trips_by_driver", trips);
  tables.set("payments_by_customer", trips.map((trip) => ({ customer_id: C1, trip_id: trip.trip_id, paid_at: trip.booked_at, amount: "10000" })));
  const september = await getCustomerDashboard(C1, "2026-09");
  const october = await getDriverDashboard(D1, "2026-10");
  assert.equal(september.trips.length, 1); assert.equal(september.payments.length, 1);
  assert.equal(september.trips[0].trip_id, id(200)); assert.equal(october.trips[0].trip_id, id(201));
});

test("Admin month report reads all pages beyond the former 100-trip cutoff", async () => {
  const rows = Array.from({ length: 125 }, (_, n) => ({ trip_id: id(300 + n), customer_id: C1, driver_id: D1, status: "COMPLETED", trip_date: "2026-10-10", booked_at: "2026-10-10T00:00:00.000Z", final_fare: "10000" }));
  tables.set("trips_by_status", rows); setPageSize(30);
  const result = await getRecentAdminTrips("2026-10");
  assert.equal(result.length, 125);
  assert.equal(new Set(result.map((trip) => trip.trip_id)).size, 125);
});

test("Admin vehicle update uses vehicle_id and refuses driver_id or nonexistent rows", async () => {
  assert.equal(adminResourceKey("vehicles", { driver_id: D1, vehicle_id: V1 }), V1);
  await assert.rejects(updateAdminResource("vehicles", D1, { status: "INACTIVE" }, randomUUID()), expectedError(404));
  await assert.rejects(updateAdminResource("vehicles", V1, { status: "INACTIVE" }, randomUUID(), D2), expectedError(409));
  assert.equal(businessWrites().length, 0);
  await updateAdminResource("vehicles", V1, { status: "INACTIVE" }, randomUUID(), D1);
  assert.equal(tables.get("vehicles").length, 2);
  assert.equal(tables.get("vehicles")[0].status, "INACTIVE");
  assert.ok(tables.get("vehicles").every((vehicle) => vehicle.brand && vehicle.model && vehicle.driver_id));
});

test("Admin cannot deactivate the vehicle of an active trip", async () => {
  await booking();
  await assert.rejects(updateAdminResource("vehicles", V1, { status: "INACTIVE" }, randomUUID()), expectedError(409));
  assert.equal(tables.get("vehicles")[0].status, "ACTIVE");
});

test("voucher validation rejects invalid date/percentage, and duplicate creation does not overwrite", async () => {
  const voucher = { voucherCode: "TEST", voucherName: "Test", discountType: "PERCENT", discountValue: 101, maxDiscount: 1000, minTripAmount: 0, quantity: 1, startDate: "2026-11-01", endDate: "2026-10-01" };
  assert.equal(voucherSchema.safeParse(voucher).success, false);
  seed({ withVoucher: true });
  await assert.rejects(createAdminResource("vouchers", { voucher_code: "TEST", quantity: 100 }, randomUUID()), expectedError(409));
  assert.equal(tables.get("vouchers")[0].quantity, 1);
});

for (let step = 1; step <= 3; step++) {
  test(`review recovers its two projections and rating after write failure ${step}`, async () => {
    const trip = await startedTrip(); await change(trip.tripId, "COMPLETED");
    console.error = () => {};
    setFault({ match: ({ cql }) => !cql.startsWith("SELECT ") && !cql.includes("rideflow_business_journal"), remaining: step, when: "after" });
    await assert.rejects(reviewTripDurably(trip.tripId, 5, "Test review", customer), expectedError(503));
    await reviewTripDurably(trip.tripId, 5, "Test review", customer);
    assert.equal(tables.get("reviews_by_trip").length, 1);
    assert.equal(tables.get("reviews_by_driver").length, 1);
    assert.equal(tables.get("drivers")[0].rating, 5);
    await assert.rejects(reviewTripDurably(trip.tripId, 1, "Changed", customer), expectedError(409));
  });
}

test("invalid money values are distinguished from zero and missing final fare", () => {
  for (const value of [-1, Infinity, NaN, "NaN", null, undefined, "", true]) assert.equal(finiteMoney(value), null);
  assert.equal(tripFare({ final_fare: 0, estimated_fare: 12000 }), 0);
  assert.equal(tripFare({ final_fare: null, estimated_fare: 12000 }), 12000);
  assert.equal(displayMoney(-1), "—");
});

test("report month follows Vietnam boundary and rejects malformed input", async () => {
  assert.equal(currentReportMonth(new Date("2026-09-30T18:00:00Z")), "2026-10");
  await assert.rejects(getAdminDashboard("2026-13"), expectedError(400));
  await assert.rejects(getAdminDashboard(""), expectedError(400));
});

test("client retains uncertain request keys, rotates on success or changed body", () => {
  globalThis.sessionStorage = (() => { const values = new Map(); return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; })();
  const first = mutationHeaders("test-customer-booking", input)["Idempotency-Key"];
  assert.equal(mutationHeaders("test-customer-booking", input)["Idempotency-Key"], first);
  assert.notEqual(mutationHeaders("test-customer-booking", { ...input, paymentMethod: "CARD" })["Idempotency-Key"], first);
  completeMutation("test-customer-booking");
  assert.notEqual(mutationHeaders("test-customer-booking", input)["Idempotency-Key"], first);
  delete globalThis.sessionStorage;
});

test("booking API requires a valid idempotency key when durable mode is enabled", async () => {
  const { POST } = await import("../src/app/api/trips/route.ts");
  const { customerId: _customerId, ...body } = input;
  const response = await withCookies(undefined, async () => {
    await createSession(customer);
    return POST(new Request("http://localhost/api/trips", { method: "POST", body: JSON.stringify(body) }));
  });
  assert.equal(response.status, 400);
  assert.equal(businessWrites().length, 0);
});

test("durable operations insist on quorum/serial consistency and fail closed on unavailable data", async () => {
  await booking();
  assert.ok(calls.filter(({ cql }) => cql.startsWith("BEGIN BATCH")).every(({ options }) => options.consistency === 4 && options.serialConsistency === 8));
  assert.ok(businessWrites().every(({ options }) => options.consistency === 4 && options.isIdempotent));
  setUnavailable(true); console.error = () => {};
  await assert.rejects(booking({ customerId: C2 }), expectedError(503));
});
