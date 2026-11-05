import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSession } from "../src/lib/auth.ts";
import { GET } from "../src/app/api/admin/[resource]/route.ts";
import { withCookies } from "./support/cookies.mjs";
import { calls, resetTables, setPageSize, setUnavailable, tables, writes } from "./support/cassandra.mjs";

const id = n => `86000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const admin = { userId: "admin-demo", role: "ADMIN", name: "Admin", email: "admin@test.invalid" };
const customer = { userId: id(1), role: "CUSTOMER", name: "Khách hàng", email: "customer@test.invalid" };
const trip = { trip_id: id(10), customer_id: customer.userId, driver_id: id(2), status: "COMPLETED", booked_at: "2026-09-15T02:00:00.000Z", final_fare: "0" };
beforeEach(() => {
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  process.env.ADMIN_EMAIL = admin.email;
  process.env.ADMIN_PASSWORD_HASH = `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED = "false";
  resetTables({ customers: [{ customer_id: customer.userId, full_name: customer.name, email: customer.email, status: "ACTIVE", password: "never-return" }], drivers: [{ driver_id: id(2), full_name: "Tài xế", password: "never-return" }], trips_by_id: [{...trip}] });
});
async function request(query = "", actor = admin) {
  const token = actor ? await withCookies(undefined, async store => { await createSession(actor); return store.get("rideflow_session").value; }) : undefined;
  return withCookies(token, () => GET(new Request(`http://localhost/api/admin/trips${query}`), { params: Promise.resolve({ resource: "trips" }) }));
}
test("Admin trips defaults to all history and works without the status projection", async () => {
  const response = await request(); assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.length, 1); assert.equal(data[0].final_fare, "0"); assert.equal(data[0].customer_name, customer.name); assert.equal(data[0].driver_name, "Tài xế");
  assert.equal(data[0].password, undefined); assert.ok(!calls.some(({cql}) => cql.includes("trips_by_status"))); assert.equal(writes().length, 0);
});
test("All trip statuses and every page remain visible, including missing accounts and unassigned drivers", async () => {
  const statuses = ["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  tables.set("trips_by_id", Array.from({length: 121}, (_,i) => ({...trip, trip_id: id(100+i), customer_id: i === 120 ? id(999) : customer.userId, driver_id: i === 120 ? null : trip.driver_id, status: statuses[i % 6]})));
  setPageSize(2); const data = (await (await request("?month=ALL")).json()).data;
  assert.equal(data.length, 121); assert.deepEqual(new Set(data.map(row => row.status)), new Set(statuses));
  assert.ok(data.some(row => row.customer_id === id(999) && row.driver_name === "Chưa phân công"));
  assert.ok(!calls.some(({cql}) => cql.includes("LIMIT") || cql.includes("ALLOW FILTERING"))); assert.equal(writes().length, 0);
});
test("Trip month filters booking time in Vietnam and does not erase historical data", async () => {
  tables.set("trips_by_id", [{...trip, booked_at: "2026-09-30T17:30:00.000Z"}]);
  assert.equal((await (await request("?month=2026-10")).json()).data.length, 1);
  assert.deepEqual((await (await request("?month=2026-09")).json()).data, []);
  assert.equal(tables.get("trips_by_id").length, 1); assert.equal(writes().length, 0);
});
test("Invalid months are rejected; an empty trip table returns an honest empty list", async () => {
  assert.equal((await request("?month=2026-13")).status, 400);
  tables.set("trips_by_id", []); assert.deepEqual((await (await request()).json()).data, []); assert.equal(writes().length, 0);
});
test("Global trip history is accessible only to Admin", async () => {
  assert.equal((await request("", null)).status, 401); assert.equal((await request("?role=ADMIN", customer)).status, 403);
});
test("Cassandra failures return an error instead of a successful empty trip list", async () => {
  const log = console.error; console.error = () => {};
  try { setUnavailable(true); assert.equal((await request()).status, 503); }
  finally { setUnavailable(false); console.error = log; }
});
