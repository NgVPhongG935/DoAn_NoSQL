import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSession } from "../src/lib/auth.ts";
import { GET } from "../src/app/api/admin/[resource]/route.ts";
import { withCookies } from "./support/cookies.mjs";
import { calls, resetTables, setPageSize, setUnavailable, tables, writes } from "./support/cassandra.mjs";

const id = n => `85000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const admin = { userId: "admin-demo", role: "ADMIN", name: "Admin", email: "admin@test.invalid" };
const customer = { userId: id(1), role: "CUSTOMER", name: "Khách hàng", email: "customer@test.invalid" };
const payment = { trip_id: id(10), payment_id: id(20), customer_id: customer.userId, amount: "58350", payment_method: "CASH", payment_status: "PAID", paid_at: "2026-09-15T02:00:00.000Z" };
beforeEach(() => {
  process.env.JWT_SECRET = randomBytes(48).toString("base64url");
  process.env.ADMIN_EMAIL = admin.email;
  process.env.ADMIN_PASSWORD_HASH = `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED = "false";
  resetTables({ customers: [{ customer_id: customer.userId, full_name: customer.name, email: customer.email, status: "ACTIVE" }], payments_by_trip: [{...payment}] });
});
async function request(query = "", actor = admin) {
  const token = actor ? await withCookies(undefined, async store => { await createSession(actor); return store.get("rideflow_session").value; }) : undefined;
  return withCookies(token, () => GET(new Request(`http://localhost/api/admin/payments${query}`), { params: Promise.resolve({ resource: "payments" }) }));
}
test("Admin defaults to all history and includes payments without a trip status projection", async () => {
  const response = await request(); assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.length, 1); assert.equal(data[0].amount, "58350"); assert.equal(data[0].customer_name, customer.name);
  assert.ok(!calls.some(({cql}) => cql.includes("trips_by_status"))); assert.equal(writes().length, 0);
});
test("Admin history reads every page, keeps unknown owners and pending/legacy methods", async () => {
  tables.set("payments_by_trip", Array.from({length: 121}, (_,i) => ({...payment, payment_id: id(100+i), customer_id: i === 120 ? id(999) : customer.userId, payment_method: i % 2 ? "BANK_TRANSFER" : "CARD", payment_status: i % 2 ? "PENDING_CONFIRMATION" : "PAID"})));
  setPageSize(2); const data = (await (await request("?month=ALL")).json()).data;
  assert.equal(data.length, 121); assert.ok(data.some(row => row.customer_id === id(999))); assert.ok(data.some(row => row.payment_status === "PENDING_CONFIRMATION"));
  assert.ok(!calls.some(({cql}) => cql.includes("LIMIT") || cql.includes("ALLOW FILTERING"))); assert.equal(writes().length, 0);
});
test("Month filters payment time in Vietnam, independently of the trip booking month", async () => {
  tables.set("payments_by_trip", [{...payment, paid_at: "2026-09-30T17:30:00.000Z"}]);
  assert.equal((await (await request("?month=2026-10")).json()).data.length, 1);
  assert.deepEqual((await (await request("?month=2026-09")).json()).data, []);
  assert.equal(writes().length, 0);
});
test("Invalid months are rejected and empty payment data does not create transactions", async () => {
  assert.equal((await request("?month=2026-13")).status, 400);
  tables.set("payments_by_trip", []);
  assert.deepEqual((await (await request()).json()).data, []); assert.equal(writes().length, 0);
});
test("Global payment history is accessible only to Admin", async () => {
  assert.equal((await request("", null)).status, 401); assert.equal((await request("?role=ADMIN", customer)).status, 403);
});
test("Cassandra failures return an error, not an empty success", async () => {
  const log = console.error; console.error = () => {};
  try { setUnavailable(true); assert.equal((await request()).status, 503); }
  finally { setUnavailable(false); console.error = log; }
});
