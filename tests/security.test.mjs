import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { SignJWT, jwtVerify } from "jose";
import { withCookies } from "./support/cookies.mjs";
import { businessWrites, calls, resetTables, setUnavailable, tables, writes } from "./support/cassandra.mjs";
import { createSession, getSession } from "../src/lib/auth.ts";
import { getJwtSecret, getAdminAccount } from "../src/lib/security-config.ts";
import { register } from "../src/instrumentation.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C1 = id(1), C2 = id(2), D1 = id(11), D2 = id(12), T1 = id(21), T2 = id(22), V1 = id(31), V2 = id(32), S1 = id(41);
const password = randomBytes(24).toString("base64url") + "aA1!";
const salt = randomBytes(16).toString("hex");
const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const customer = { userId: C1, role: "CUSTOMER", name: "Customer one", email: "c1@test.invalid" };
const otherCustomer = { userId: C2, role: "CUSTOMER", name: "Customer two", email: "c2@test.invalid" };
const driver = { userId: D1, role: "DRIVER", name: "Driver one", email: "d1@test.invalid" };
const otherDriver = { userId: D2, role: "DRIVER", name: "Driver two", email: "d2@test.invalid" };
const admin = { userId: "admin-demo", role: "ADMIN", name: "Admin", email: "admin@test.invalid" };
const sessions = { customer, otherCustomer, driver, otherDriver, admin };
const createdAt = "2026-10-10T00:00:00.000Z";
const covered = new Set();
const routeFiles = readdirSync(new URL("../src/app/api/", import.meta.url), { recursive: true })
  .filter((file) => file.endsWith("route.ts")).map((file) => file.replaceAll("\\", "/"));
const methods = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const publicRoutes = new Set(["auth/login/route.ts", "auth/register/route.ts", "auth/logout/route.ts", "auth/demo/route.ts", "health/route.ts"]);
const defaultParams = { id: C1, resource: "customers", month: "2026-10", createdAt, notificationId: id(51), customerId: C1, complaintId: id(61) };

beforeEach(() => {
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED = process.env.RIDEFLOW_TEST_JOURNAL === "true" ? "true" : "false";
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  process.env.ADMIN_EMAIL = admin.email;
  process.env.ADMIN_PASSWORD_HASH = hash;
  process.env.ADMIN_PERMISSIONS = "";
  const customers = [customer, otherCustomer].map((s) => ({ customer_id: s.userId, full_name: s.name, email: s.email, phone: "0901234567", password: hash, status: "ACTIVE" }));
  const drivers = [driver, otherDriver].map((s) => ({ driver_id: s.userId, full_name: s.name, email: s.email, phone: "0901234567", password: hash, license_number: "PRIVATE-LICENSE", account_status: "ACTIVE", driver_status: s === driver ? "BUSY" : "AVAILABLE", rating: 4.8 }));
  const trips = [
    { trip_id: T1, customer_id: C1, driver_id: D1, vehicle_id: V1, service_id: S1, status: "BOOKED", booked_at: createdAt, trip_date: "2026-10-10", final_fare: "12000", estimated_fare: "12000", payment_method: "CASH" },
    { trip_id: T2, customer_id: C2, driver_id: D2, vehicle_id: V2, service_id: S1, status: "COMPLETED", booked_at: createdAt, trip_date: "2026-10-10", final_fare: "15000", estimated_fare: "15000", payment_method: "CASH" },
  ];
  resetTables({
    customers, drivers, trips_by_id: trips, trips_by_customer: trips, trips_by_driver: trips, trips_by_status: trips,
    vehicles: [V1, V2].map((vehicle_id, i) => ({ vehicle_id, driver_id: i ? D2 : D1, vehicle_type: "BIKE", seat_count: 2, status: "ACTIVE", brand: "Test", model: "Bike", license_plate: "TEST-123" })),
    service_types: [{ service_id: S1, service_name: "BIKE", status: "ACTIVE", base_fare: "10000", price_per_km: "1000" }],
    vouchers: [{ voucher_code: "EXISTING", voucher_name: "Existing", status: "ACTIVE", quantity: 1 }],
    payments_by_customer: [{ customer_id: C2, trip_id: T2, amount: "15000" }],
    payments_by_trip: [{ customer_id: C2, trip_id: T2, amount: "15000" }],
    reviews_by_trip: [{ trip_id: T2, customer_id: C2, driver_id: D2, rating: 5 }],
    reviews_by_driver: [{ trip_id: T2, customer_id: C2, driver_id: D2, rating: 5 }],
    driver_revenue_by_month: [{ driver_id: D2, year_month: "2026-10", trip_id: T2, fare: "15000" }],
    notifications_by_user: [{ user_id: C1, notification_id: id(51), created_at: createdAt, is_read: false }],
    complaints_by_customer: [{ customer_id: C1, complaint_id: id(61), created_at: createdAt, status: "OPEN" }],
  });
});

async function tokenFor(session) {
  if (!session) return undefined;
  return withCookies(undefined, async (store) => {
    await createSession(session);
    return store.get("rideflow_session").value;
  });
}

async function invoke(file, method = "GET", session, params = {}, body, query = "", rawToken) {
  const route = await import(new URL(`../src/app/api/${file}`, import.meta.url));
  assert.equal(typeof route[method], "function", `${method} ${file} must exist`);
  covered.add(`${method} ${file}`);
  const token = rawToken ?? await tokenFor(session);
  const request = new Request(`http://localhost/api/test${query}`, {
    method, ...(method !== "GET" ? { body: JSON.stringify(body ?? {}), headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() } } : {}),
  });
  return withCookies(token, () => route[method](request, { params: Promise.resolve({ ...defaultParams, ...params }) }));
}

function assertDenied(response) { assert.ok([401, 403].includes(response.status), `Expected 401/403, got ${response.status}`); }
function assertNoWrites() { assert.deepEqual(writes(), [], "Denied request must not write business data"); }

test("startup rejects missing, old, weak and placeholder secrets even when AUTH_SECRET exists", async () => {
  process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
  for (const key of [undefined, "", "short", "a".repeat(64), "replace-with-a-long-random-secret", "local-demo-only-change-this-secret-rideflow"]) {
    if (key === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = key;
    assert.throws(getJwtSecret, /JWT_SECRET/);
    await assert.rejects(register, /JWT_SECRET/);
  }
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  await register();
  assertNoWrites();
});

test("Admin credentials stay in environment; ADMIN role needs no grants", async () => {
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.equal(getAdminAccount(), null);
  assert.equal(await withCookies(await tokenFor(admin), getSession), null);
  const response = await invoke("auth/login/route.ts", "POST", null, {}, { email: "admin@rideflow.vn", password: "RideFlow@123", role: "ADMIN" });
  assert.equal(response.status, 401);
  process.env.ADMIN_PASSWORD_HASH = hash;
  delete process.env.ADMIN_PERMISSIONS;
  const denied = await invoke("admin/[resource]/route.ts", "GET", admin);
  assert.equal(denied.status, 200);
  process.env.ADMIN_PERMISSIONS = "*";
  assert.equal(getAdminAccount().email, admin.email);
});

test("Admin password helper emits a valid salted hash and escapes dotenv dollars", () => {
  for (const dotenv of [false, true]) {
    const result = spawnSync(process.execPath, ["scripts/hash-admin-password.mjs", ...(dotenv ? ["--dotenv"] : [])], {
      input: password + "\r\n", encoding: "utf8", windowsHide: true,
    });
    assert.equal(result.status, 0);
    const output = result.stdout.trim();
    if (dotenv) assert.match(output, /^ADMIN_PASSWORD_HASH=scrypt\\\$/);
    const encoded = output.replace(/^ADMIN_PASSWORD_HASH=/, "").replaceAll("\\$", "$");
    const [algorithm, generatedSalt, digest] = encoded.split("$");
    assert.equal(algorithm, "scrypt");
    assert.equal(scryptSync(password, generatedSalt, 64).toString("hex"), digest);
    assert.notEqual(generatedSalt, salt);
  }
  const invalid = spawnSync(process.execPath, ["scripts/hash-admin-password.mjs"], { input: "weak", encoding: "utf8", windowsHide: true });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, "");
});

test("cookie settings and JWT identity/algorithm/lifetime are enforced", async () => {
  await withCookies(undefined, async (store) => {
    await createSession(customer, true);
    const cookie = store.get("rideflow_session");
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, "lax");
    assert.equal(cookie.options.maxAge, 30 * 86400);
    const { payload, protectedHeader } = await jwtVerify(cookie.value, getJwtSecret());
    assert.equal(protectedHeader.alg, "HS256");
    assert.equal(payload.sub, C1);
    assert.equal(payload.iss, "rideflow");
    assert.equal(payload.aud, "rideflow-session");
    assert.equal(payload.exp - payload.iat, 30 * 86400);
  });
});

test("forged old-key, expired, modified and malformed JWTs are refused before database access", async () => {
  const signed = async (key, options = {}) => {
    const jwt = new SignJWT({ ...admin, ...options.payload }).setProtectedHeader({ alg: options.alg ?? "HS256" });
    if (!options.missing) jwt.setIssuer(options.issuer ?? "rideflow").setAudience(options.audience ?? "rideflow-session").setSubject(options.subject ?? admin.userId).setIssuedAt().setExpirationTime(options.exp ?? "1h");
    return jwt.sign(new TextEncoder().encode(key));
  };
  const old = await signed("local-demo-only-change-this-secret-rideflow");
  const valid = await tokenFor(admin);
  const parts = valid.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], "base64url")), userId: "forged" })).toString("base64url");
  for (const token of [old, parts.join("."), "broken", await signed(process.env.JWT_SECRET, { exp: "-1s" }),
    await signed(process.env.JWT_SECRET, { alg: "HS384" }), await signed(process.env.JWT_SECRET, { missing: true }),
    await signed(process.env.JWT_SECRET, { audience: "other" }), await signed(process.env.JWT_SECRET, { issuer: "other" }),
    await signed(process.env.JWT_SECRET, { subject: "other" }), await signed(process.env.JWT_SECRET, { payload: { role: "SUPERADMIN" } })]) {
    calls.length = 0;
    const response = await invoke("admin/[resource]/route.ts", "GET", null, {}, undefined, "", token);
    assert.equal(response.status, 401);
    assert.deepEqual(calls, []);
  }
});

test("rotating JWT_SECRET invalidates previously issued sessions", async () => {
  const token = await tokenFor(customer);
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  assert.equal((await invoke("auth/me/route.ts", "GET", null, {}, undefined, "", token)).status, 401);
});

test("signed payload must identify the configured Admin or a real account in its claimed role", async () => {
  for (const session of [
    { ...admin, userId: "invented-admin" }, { ...admin, email: "wrong@test.invalid" },
    { ...customer, role: "DRIVER" }, { ...driver, role: "CUSTOMER" },
    { ...customer, userId: id(999) },
  ]) {
    assert.equal((await invoke("auth/me/route.ts", "GET", session)).status, 401);
  }
  assertNoWrites();
});

test("Admin role can view driver vehicles without grants", async () => {
  process.env.ADMIN_PERMISSIONS = "drivers:read";
  const restricted = await invoke("drivers/[id]/route.ts", "GET", admin, { id: D1 });
  assert.equal((await restricted.json()).data.vehicles.length, 1);
  process.env.ADMIN_PERMISSIONS = "drivers:read,vehicles:read";
  const allowed = await invoke("drivers/[id]/route.ts", "GET", admin, { id: D1 });
  assert.equal((await allowed.json()).data.vehicles.length, 1);
});

test("unknown Admin resources fail closed without querying a table", async () => {
  for (const resource of ["not-a-resource", "constructor", "__proto__", "customers:read"]) {
    const response = await invoke("admin/[resource]/route.ts", "GET", admin, { resource });
    assert.equal(response.status, 404);
    assert.deepEqual(calls, []);
  }
});

test("blocked, deleted and mismatched accounts cannot reuse an issued session", async () => {
  for (const [session, table, status] of [[customer, "customers", "status"], [driver, "drivers", "account_status"]]) {
    const token = await tokenFor(session);
    const account = tables.get(table)[0];
    account[status] = "BLOCKED";
    assert.equal((await invoke("auth/me/route.ts", "GET", null, {}, undefined, "", token)).status, 401);
    account[status] = "ACTIVE";
    account.email = "changed@test.invalid";
    assert.equal((await invoke("auth/me/route.ts", "GET", null, {}, undefined, "", token)).status, 401);
    tables.set(table, []);
    assert.equal((await invoke("auth/me/route.ts", "GET", null, {}, undefined, "", token)).status, 401);
  }
  assertNoWrites();
});

test("database outage fails closed instead of accepting a stale session", async () => {
  const token = await tokenFor(customer);
  setUnavailable(true);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await invoke("customers/[id]/payments/route.ts", "GET", null, {}, undefined, "", token)).status, 503);
  } finally { console.error = original; setUnavailable(false); }
  assertNoWrites();
});

for (const file of routeFiles.filter((file) => !publicRoutes.has(file))) {
  const route = await import(new URL(`../src/app/api/${file}`, import.meta.url));
  for (const method of methods.filter((method) => typeof route[method] === "function")) {
    test(`anonymous denied: ${method} ${file}`, async () => {
      assert.equal((await invoke(file, method)).status, 401);
      assert.deepEqual(calls, [], "Anonymous request must be rejected before Cassandra");
    });
  }
}

const owners = [
  ["customers/[id]/route.ts", "CUSTOMER", "customers:read"],
  ...["trips", "payments", "reviews", "vouchers", "complaints"].map((resource) => [`customers/[id]/${resource}/route.ts`, "CUSTOMER", `${resource}:read`]),
  ["drivers/[id]/route.ts", "DRIVER", "drivers:read"],
  ...[["trips", "trips"], ["reviews", "reviews"], ["vehicle", "vehicles"], ["revenue/[month]", "reports"]]
    .map(([route, permission]) => [`drivers/[id]/${route}/route.ts`, "DRIVER", `${permission}:read`]),
];
for (const [file, role, permission] of owners) {
  for (const [label, session] of Object.entries(sessions)) {
    test(`ownership matrix: ${label} GET ${file}`, async () => {
      const response = await invoke(file, "GET", session, { id: role === "CUSTOMER" ? C1 : D1 });
      const allowed = label === "admin" || (role === "CUSTOMER" ? label === "customer" : label === "driver");
      if (allowed) assert.equal(response.status, 200); else assert.equal(response.status, 403);
      assertNoWrites();
    });
  }
  test(`Admin role needs no grants: ${file}`, async () => {
    process.env.ADMIN_PERMISSIONS = "services:read";
    assert.equal((await invoke(file, "GET", admin, { id: role === "CUSTOMER" ? C1 : D1 })).status, 200);
    process.env.ADMIN_PERMISSIONS = permission;
    assert.equal((await invoke(file, "GET", admin, { id: role === "CUSTOMER" ? C1 : D1 })).status, 200);
  });
}

test("a driver UUID matching a customer UUID still cannot read or edit the customer", async () => {
  const collision = { ...driver, userId: C1, email: "collision@test.invalid" };
  tables.get("drivers").push({ driver_id: C1, full_name: "Collision", email: collision.email, account_status: "ACTIVE" });
  assert.equal((await invoke("customers/[id]/route.ts", "GET", collision)).status, 403);
  assert.equal((await invoke("customers/[id]/route.ts", "PATCH", collision, {}, { fullName: "Changed", phone: "0901234567" })).status, 403);
  assertNoWrites();
});

for (const file of ["customers/[id]/route.ts", "drivers/[id]/route.ts", "drivers/[id]/status/route.ts"]) {
  test(`write ownership and Admin role: ${file}`, async () => {
    const isCustomer = file.startsWith("customers/");
    const params = { id: isCustomer ? C1 : D1 };
    const body = file.includes("/status/") ? { status: "OFFLINE" } : { fullName: "Updated name", phone: "0901234567", role: "ADMIN", customer_id: C2, driver_id: D2, password: "attacker", account_status: "BLOCKED" };
    for (const session of [isCustomer ? otherCustomer : otherDriver, isCustomer ? driver : customer]) {
      assert.equal((await invoke(file, "PATCH", session, params, body)).status, 403);
      assertNoWrites();
    }
    process.env.ADMIN_PERMISSIONS = `${isCustomer ? "customers" : "drivers"}:read`;
    assertNoWrites();
    tables.get("drivers")[0].driver_status = "AVAILABLE";
    if (file.includes("/status/")) tables.get("trips_by_id")[0].status = "CANCELLED";
    assert.equal((await invoke(file, "PATCH", isCustomer ? customer : driver, params, body)).status, 200);
    assert.equal(tables.get(isCustomer ? "customers" : "drivers")[0].password, hash);
  });
}

for (const resource of ["customers", "drivers", "vehicles", "services", "vouchers", "trips", "payments", "reviews", "complaints", "notifications", "reports"]) {
  test(`Admin resource read permission: ${resource}`, async () => {
    for (const session of [customer, driver]) assert.equal((await invoke("admin/[resource]/route.ts", "GET", session, { resource })).status, 403);
    process.env.ADMIN_PERMISSIONS = "";
    assert.equal((await invoke("admin/[resource]/route.ts", "GET", admin, { resource })).status, 200);
    process.env.ADMIN_PERMISSIONS = `${resource}:read`;
    assert.equal((await invoke("admin/[resource]/route.ts", "GET", admin, { resource })).status, 200);
    assertNoWrites();
  });
}

for (const [method, resource, body] of [
  ["POST", "services", { serviceName: "Test", description: "test", baseFare: 10000, pricePerKm: 1000 }],
  ["POST", "vouchers", { voucherCode: "TEST", voucherName: "Test", discountType: "FIXED", discountValue: 1000, maxDiscount: 1000, minTripAmount: 10000, quantity: 1, startDate: "2026-10-01", endDate: "2026-11-01" }],
  ["POST", "notifications", { userId: C1, title: "Test", content: "Test message" }],
  ["PATCH", "customers", { status: "BLOCKED" }],
  ["PATCH", "drivers", { accountStatus: "BLOCKED" }],
  ["PATCH", "vehicles", { status: "INACTIVE" }],
  ["PATCH", "services", { status: "INACTIVE" }],
  ["PATCH", "vouchers", { status: "INACTIVE" }],
]) {
  const file = method === "POST" ? "admin/[resource]/route.ts" : "admin/[resource]/[id]/route.ts";
  test(`Admin writes require ADMIN role: ${method} ${resource}`, async () => {
    for (const session of [customer, driver]) assert.equal((await invoke(file, method, session, { resource }, body)).status, 403);
    process.env.ADMIN_PERMISSIONS = `${resource}:read`;
    assertNoWrites();
    process.env.ADMIN_PERMISSIONS = `${resource}:write`;
    const resourceIds = { customers: C1, drivers: D1, vehicles: V2, services: S1, vouchers: "EXISTING" };
    // This matrix tests role authorization; active-trip blocking is tested separately.
    if (resource === "customers" || resource === "drivers") {
      tables.get("trips_by_id")[0].status = "CANCELLED";
      tables.get("drivers")[0].driver_status = "AVAILABLE";
    }
    assert.equal((await invoke(file, method, admin, { resource, id: resourceIds[resource] }, body)).status, method === "POST" ? 201 : 200);
    assert.equal(businessWrites().length, 1);
  });
}

test("Admin complaint mutation requires ADMIN role", async () => {
  const file = "admin/complaints/[customerId]/[createdAt]/[complaintId]/route.ts";
  for (const session of [customer, driver]) assert.equal((await invoke(file, "PATCH", session, {}, { status: "PROCESSING" })).status, 403);
  process.env.ADMIN_PERMISSIONS = "complaints:read";
  assertNoWrites();
  process.env.ADMIN_PERMISSIONS = "complaints:write";
  assert.equal((await invoke(file, "PATCH", admin, {}, { status: "PROCESSING" })).status, 200);
});

test("driver directory is restricted and grants cannot be supplied in query/body", async () => {
  for (const session of [customer, driver]) assert.equal((await invoke("drivers/route.ts", "GET", session, {}, undefined, "?role=ADMIN&driver_id=" + D1)).status, 403);
  process.env.ADMIN_PERMISSIONS = "";
  assert.equal((await invoke("drivers/route.ts", "GET", admin)).status, 200);
  process.env.ADMIN_PERMISSIONS = "drivers:read";
  assert.equal((await invoke("drivers/route.ts", "GET", admin)).status, 200);
});

test("trip detail permits only owner/assigned driver and minimizes driver identity", async () => {
  for (const session of [otherCustomer, otherDriver]) assert.equal((await invoke("trips/[id]/route.ts", "GET", session, { id: T1 })).status, 403);
  for (const session of [customer, driver]) {
    const response = await invoke("trips/[id]/route.ts", "GET", session, { id: T1 });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.driver.full_name, driver.name);
    for (const field of ["email", "license_number", "password", "account_status"]) assert.equal(data.driver[field], undefined);
  }
  assertNoWrites();
});

test("Admin role can view trip payments and reviews without grants", async () => {
  process.env.ADMIN_PERMISSIONS = "payments:read";
  assert.equal((await invoke("trips/[id]/route.ts", "GET", admin, { id: T2 })).status, 200);
  process.env.ADMIN_PERMISSIONS = "trips:read";
  const restricted = (await (await invoke("trips/[id]/route.ts", "GET", admin, { id: T2 })).json()).data;
  assert.equal(restricted.payments.length, 1);
  assert.equal(restricted.review.rating, 5);
  process.env.ADMIN_PERMISSIONS = "trips:read,payments:read,reviews:read";
  const full = (await (await invoke("trips/[id]/route.ts", "GET", admin, { id: T2 })).json()).data;
  assert.equal(full.payments.length, 1);
  assert.equal(full.review.rating, 5);
});

test("trip status cannot be changed by outsiders or escalated through a supplied role", async () => {
  for (const session of [otherCustomer, otherDriver]) {
    assert.equal((await invoke("trips/[id]/status/route.ts", "PATCH", session, { id: T1 }, { status: "CANCELLED", role: "ADMIN", customer_id: C1, driver_id: D1 })).status, 403);
  }
  assertDenied(await invoke("trips/[id]/status/route.ts", "PATCH", customer, { id: T1 }, { status: "COMPLETED", role: "ADMIN" }));
  process.env.ADMIN_PERMISSIONS = "trips:read";
  assertNoWrites();
  assert.equal((await invoke("trips/[id]/status/route.ts", "PATCH", driver, { id: T1 }, { status: "ACCEPTED", driver_id: D2 })).status, 200);
  assert.equal(tables.get("trips_by_id")[0].driver_id, D1);
});

test("owner cancellation and authorized Admin status update remain functional", async () => {
  process.env.ADMIN_PERMISSIONS = "trips:write";
  assert.equal((await invoke("trips/[id]/status/route.ts", "PATCH", admin, { id: T1 }, { status: "ACCEPTED" })).status, 200);
  assert.equal((await invoke("trips/[id]/status/route.ts", "PATCH", customer, { id: T1 }, { status: "CANCELLED" })).status, 200);
});

test("review ownership rejects foreign trips and ignores frontend identity", async () => {
  assertDenied(await invoke("trips/[id]/review/route.ts", "POST", customer, { id: T2 }, { rating: 5, customer_id: C2, role: "ADMIN" }));
  for (const session of [driver, admin]) assertDenied(await invoke("trips/[id]/review/route.ts", "POST", session, { id: T1 }, { rating: 5 }));
  assertNoWrites();
  tables.get("trips_by_id")[0].status = "COMPLETED";
  assert.equal((await invoke("trips/[id]/review/route.ts", "POST", customer, { id: T1 }, { rating: 4, customer_id: C2, driver_id: D2, role: "ADMIN" })).status, 201);
  const review = tables.get("reviews_by_trip").find((row) => row.trip_id === T1);
  assert.equal(review.customer_id, C1);
  assert.equal(review.driver_id, D1);
});

test("complaint must belong to both the authenticated account and its trip", async () => {
  const file = "customers/[id]/complaints/route.ts";
  const body = { subject: "Test complaint", content: "Test complaint details", tripId: T2, customer_id: C2, role: "ADMIN" };
  for (const session of [otherCustomer, driver, admin]) assertDenied(await invoke(file, "POST", session, {}, body));
  assert.equal((await invoke(file, "POST", customer, {}, body)).status, 403);
  assertNoWrites();
  assert.equal((await invoke(file, "POST", customer, {}, { ...body, tripId: T1 })).status, 201);
  assert.equal(tables.get("complaints_by_customer").at(-1).customer_id, C1);
});

test("booking ignores client customer/driver IDs, role and fare", async () => {
  const body = { serviceId: S1, pickup: { label: "Pickup", lat: 10.7, lng: 106.7 }, destination: { label: "Destination", lat: 10.8, lng: 106.8 }, paymentMethod: "CASH", customerId: C2, customer_id: C2, driverId: D1, driver_id: D1, role: "ADMIN", final_fare: 1 };
  for (const session of [driver, admin]) assertDenied(await invoke("trips/route.ts", "POST", session, {}, body));
  assertNoWrites();
  const response = await invoke("trips/route.ts", "POST", customer, {}, body);
  assert.equal(response.status, 201);
  const trip = tables.get("trips_by_id").at(-1);
  assert.equal(trip.customer_id, C1);
  assert.equal(trip.driver_id, D2);
  assert.equal(trip.final_fare, "12000");
});

test("notifications may only be read/marked by their recipient", async () => {
  const file = "users/[id]/notifications/route.ts";
  const patch = "users/[id]/notifications/[createdAt]/[notificationId]/route.ts";
  for (const session of [otherCustomer, driver, admin]) {
    assertDenied(await invoke(file, "GET", session));
    assertDenied(await invoke(patch, "PATCH", session));
  }
  assertNoWrites();
  assert.equal((await invoke(file, "GET", customer)).status, 200);
  assert.equal((await invoke(patch, "PATCH", customer)).status, 200);
  assert.equal(tables.get("notifications_by_user")[0].is_read, true);
});

test("dashboard scope is derived from the session", async () => {
  for (const session of [customer, driver]) {
    const response = await invoke("dashboard/route.ts", "GET", session, {}, undefined, `?month=2026-10&customer_id=${C2}&driver_id=${D2}&role=ADMIN`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.role, session.role);
    assert.ok(data.trips.every((trip) => trip[session.role === "CUSTOMER" ? "customer_id" : "driver_id"] === session.userId));
  }
  process.env.ADMIN_PERMISSIONS = "trips:read";
  assert.equal((await invoke("dashboard/route.ts", "GET", admin)).status, 200);
  process.env.ADMIN_PERMISSIONS = "reports:read";
  assert.equal((await invoke("dashboard/route.ts", "GET", admin)).status, 200);
});

test("shared services and maps remain available to authenticated roles", async () => {
  for (const session of [customer, driver, admin]) {
    for (const [file, method, query, body] of [
      ["services/route.ts", "GET", ""],
      ["maps/geocode/route.ts", "GET", "?q=Test"],
      ["maps/reverse-geocode/route.ts", "GET", "?lat=10.7&lng=106.7"],
      ["maps/route/route.ts", "POST", "", { pickup: { label: "Pickup", lat: 10.7, lng: 106.7 }, destination: { label: "Destination", lat: 10.8, lng: 106.8 } }],
    ]) assert.equal((await invoke(file, method, session, {}, body, query)).status, 200);
  }
});

test("login derives role from server credentials and cannot be escalated", async () => {
  for (const session of [customer, driver, admin]) {
    const response = await invoke("auth/login/route.ts", "POST", null, {}, { email: session.email, password, role: session.role === "ADMIN" ? "CUSTOMER" : "ADMIN", customer_id: C2, driver_id: D2 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.role, session.role);
  }
  tables.get("customers")[0].status = "BLOCKED";
  assert.equal((await invoke("auth/login/route.ts", "POST", null, {}, { email: customer.email, password })).status, 403);
});

test("all roles reject wrong passwords without writing data", async () => {
  for (const session of [customer, driver, admin]) {
    const response = await invoke("auth/login/route.ts", "POST", null, {}, { email: session.email, password: password + "wrong", role: "ADMIN" });
    assert.equal(response.status, 401);
  }
  assertNoWrites();
});

test("public registration cannot create an Admin or honor a frontend ID", async () => {
  const response = await invoke("auth/register/route.ts", "POST", null, {}, { fullName: "New Customer", phone: "0999999998", email: "new@test.invalid", password, confirmPassword: password, role: "ADMIN", customer_id: C2, driver_id: D2 });
  assert.equal(response.status, 201);
  const account = tables.get("customers").at(-1);
  assert.notEqual(account.customer_id, C2);
  assert.equal(account.role, undefined);
  assert.equal(tables.get("drivers").length, 2);
});

test("Customer password reset is Admin-only and cannot change another resource through supplied fields", async () => {
  const file = "admin/customers/[id]/password/route.ts";
  for (const session of [null, customer, driver]) {
    assertDenied(await invoke(file, "POST", session, { id: C1 }, { password, confirmPassword: password, role: "ADMIN" }));
  }
  assertNoWrites();
  assert.equal((await invoke(file, "POST", admin, { id: C1 }, { password, confirmPassword: password })).status, 200);
});

test("public endpoints expose only their intended behavior", async () => {
  const health = await invoke("health/route.ts");
  assert.deepEqual(await health.json(), { success: true, data: { status: "ok" } });
  assert.equal((await invoke("auth/demo/route.ts", "POST")).status, 410);
  assert.equal((await invoke("auth/register/route.ts", "POST")).status, 400);
  assert.equal((await invoke("auth/login/route.ts", "POST")).status, 400);
  assert.equal((await invoke("auth/logout/route.ts", "POST")).status, 200);
  await withCookies(await tokenFor(customer), async (store) => {
    const { POST } = await import("../src/app/api/auth/logout/route.ts");
    await POST();
    assert.equal(store.get("rideflow_session"), undefined);
  });
});

after(async () => {
  const missing = [];
  let count = 0;
  for (const file of routeFiles) {
    const route = await import(new URL(`../src/app/api/${file}`, import.meta.url));
    for (const method of methods.filter((method) => typeof route[method] === "function")) {
      count++;
      if (!covered.has(`${method} ${file}`)) missing.push(`${method} ${file}`);
    }
  }
  assert.deepEqual(missing, [], "Every API method must be exercised by the security suite");
  console.log(`Security inventory: ${routeFiles.length} route files, ${count} API methods exercised. Cassandra transport is in-memory; no live database is contacted.`);
});
