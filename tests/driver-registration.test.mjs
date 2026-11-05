import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { calls, resetTables, tables, writes } from "./support/cassandra.mjs";
import { withCookies } from "./support/cookies.mjs";
import { createSession, getSession } from "../src/lib/auth.ts";
import { register } from "../src/instrumentation.ts";

const driverId = "81000000-0000-4000-8000-000000000011";
const admin = { userId: "admin-demo", role: "ADMIN", name: "Admin", email: "admin@test.invalid" };
const customer = { customer_id: "81000000-0000-4000-8000-000000000001", full_name: "Existing customer", phone: "0900000001", email: "customer@test.invalid", password: "" , status: "ACTIVE" };
const password = "RideFlow!Test2026";
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const input = {
  role: "DRIVER", fullName: "New Driver", phone: "0900000002", email: "new-driver@test.invalid",
  password, confirmPassword: password, licenseNumber: "GPLX-TEST-2026", vehicleType: "CAR_4",
  licensePlate: "51A-123.45", brand: "Toyota", model: "Vios", color: "Trắng", seatCount: 4,
};

beforeEach(async () => {
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  process.env.ADMIN_EMAIL = admin.email;
  process.env.ADMIN_PASSWORD_HASH = passwordHash;
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED = "false";
  resetTables({
    customers: [{ ...customer, password: passwordHash }],
    drivers: [], vehicles: [{ vehicle_id: "81000000-0000-4000-8000-000000000031", driver_id: driverId,
      license_plate: "59X1-222.22", vehicle_type: "BIKE", brand: "Existing", model: "Bike", color: "Black", seat_count: 2, status: "ACTIVE" }],
  });
  await register();
});

async function postRegister(body) {
  const route = await import("../src/app/api/auth/register/route.ts");
  return route.POST(new Request("http://localhost/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

async function requestAs(actor, file, method, params, body) {
  const route = await import(`../src/app/api/${file}`);
  const token = await withCookies(undefined, async (store) => {
    await createSession(actor);
    return store.get("rideflow_session").value;
  });
  const request = new Request("http://localhost/api/test", {
    method, headers: { "Content-Type": "application/json", "Idempotency-Key": "driver-registration-test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return withCookies(token, () => route[method](request, { params: Promise.resolve(params) }));
}

test("Driver registration stores a scrypt password and linked pending vehicle in Cassandra", async () => {
  const response = await postRegister(input);
  assert.equal(response.status, 201);
  const drivers = tables.get("drivers");
  const vehicles = tables.get("vehicles");
  const created = drivers.find((row) => row.email === input.email);
  const vehicle = vehicles.find((row) => row.driver_id === created.driver_id);
  assert.equal(created.account_status, "PENDING");
  assert.equal(created.driver_status, "OFFLINE");
  assert.equal(created.license_number, input.licenseNumber);
  assert.equal(created.password.startsWith("scrypt$"), true);
  const [, storedSalt, storedHash] = created.password.split("$");
  assert.equal(scryptSync(password, storedSalt, 64).toString("hex"), storedHash);
  assert.equal(vehicle.license_plate, input.licensePlate);
  assert.equal(vehicle.vehicle_type, input.vehicleType);
  assert.equal(vehicle.brand, input.brand);
  assert.equal(vehicle.model, input.model);
  assert.equal(vehicle.color, input.color);
  assert.equal(vehicle.seat_count, input.seatCount);
  assert.equal(vehicle.status, "ACTIVE");
  assert.ok(calls.some((call) => call.options.logged && call.options.prepare));
});

test("A pending driver may log in but cannot access or enable driver operations", async () => {
  await postRegister(input);
  const login = await import("../src/app/api/auth/login/route.ts");
  const token = await withCookies(undefined, async (store) => {
    const response = await login.POST(new Request("http://localhost/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: input.email, password }),
    }));
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.accountStatus, "PENDING");
    assert.equal(data.redirectTo, "/driver/dashboard");
    return store.get("rideflow_session").value;
  });
  assert.equal((await withCookies(token, getSession)).accountStatus, "PENDING");
  const driver = tables.get("drivers").find((row) => row.email === input.email);
  const statusRoute = await import("../src/app/api/drivers/[id]/status/route.ts");
  const response = await withCookies(token, () => statusRoute.PATCH(new Request("http://localhost/api/drivers/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": "pending-status-test" },
    body: JSON.stringify({ status: "AVAILABLE" }),
  }), { params: Promise.resolve({ id: driver.driver_id }) }));
  assert.equal(response.status, 403);
  assert.equal(driver.driver_status, "OFFLINE");
  assert.equal(writes().some((call) => call.cql.startsWith("UPDATE drivers")), false);
});

test("Admin approval activates the account without changing offline availability", async () => {
  await postRegister(input);
  const driver = tables.get("drivers").find((row) => row.email === input.email);
  const response = await requestAs(admin, "admin/[resource]/[id]/route.ts", "PATCH",
    { resource: "drivers", id: driver.driver_id }, { accountStatus: "ACTIVE" });
  assert.equal(response.status, 200);
  assert.equal(driver.account_status, "ACTIVE");
  assert.equal(driver.driver_status, "OFFLINE");
  const statusRoute = await import("../src/app/api/drivers/[id]/status/route.ts");
  const token = await withCookies(undefined, async (store) => {
    await createSession({ userId: driver.driver_id, role: "DRIVER", name: input.fullName, email: input.email });
    return store.get("rideflow_session").value;
  });
  const statusResponse = await withCookies(token, () => statusRoute.PATCH(new Request("http://localhost/api/drivers/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": "approved-status-test" },
    body: JSON.stringify({ status: "AVAILABLE" }),
  }), { params: Promise.resolve({ id: driver.driver_id }) }));
  assert.equal(statusResponse.status, 200);
  assert.equal(driver.account_status, "ACTIVE");
  assert.equal(driver.driver_status, "AVAILABLE");
});

test("Admin driver list exposes the complete submitted profile and linked vehicle without passwords", async () => {
  await postRegister(input);
  const token = await withCookies(undefined, async (store) => {
    await createSession(admin);
    return store.get("rideflow_session").value;
  });
  const route = await import("../src/app/api/admin/[resource]/route.ts");
  const response = await withCookies(token, () => route.GET(new Request("http://localhost/api/admin/drivers"), {
    params: Promise.resolve({ resource: "drivers" }),
  }));
  assert.equal(response.status, 200);
  const row = (await response.json()).data.find((driver) => driver.email === input.email);
  assert.equal(row.full_name, input.fullName);
  assert.equal(row.phone, input.phone);
  assert.equal(row.license_number, input.licenseNumber);
  assert.equal(row.license_plate, input.licensePlate);
  assert.equal(row.vehicle_type, input.vehicleType);
  assert.equal(row.vehicle_brand, input.brand);
  assert.equal(row.vehicle_model, input.model);
  assert.equal(row.vehicle_color, input.color);
  assert.equal(row.vehicle_seat_count, input.seatCount);
  assert.equal(row.password, undefined);
});

test("Driver registration rejects duplicate identity, invalid required fields and mismatched passwords", async () => {
  for (const body of [
    { ...input, email: customer.email },
    { ...input, phone: customer.phone },
    { ...input, licensePlate: "59x1 222.22" },
  ]) assert.equal((await postRegister(body)).status, 409);
  for (const body of [
    { ...input, brand: "" },
    { ...input, fullName: "" },
    { ...input, licenseNumber: "" },
    { ...input, licensePlate: "not-a-plate" },
    { ...input, confirmPassword: "NotTheSame!123" },
    { ...input, vehicleType: "" },
  ]) assert.equal((await postRegister(body)).status, 400);
  assert.equal(tables.get("drivers").length, 0);
});
