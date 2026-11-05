import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSession } from "../src/lib/auth.ts";
import { withCookies } from "./support/cookies.mjs";
import { resetTables, tables, calls, writes, setPageSize, setUnavailable } from "./support/cassandra.mjs";
import { paymentMethodLabel, paymentStatusLabel } from "../src/lib/payment-values.ts";
import { GET } from "../src/app/api/customers/[id]/payments/route.ts";

const c="84000000-0000-4000-8000-000000000001",other="84000000-0000-4000-8000-000000000002";
const actor={userId:c,role:"CUSTOMER",name:"Legacy payment test",email:"legacy@test.invalid"};
const legacy={customer_id:c,trip_id:"2be76152-0000-4000-8000-000000000001",payment_id:"84000000-0000-4000-8000-000000000021",amount:"58350",payment_method:"CASH",payment_status:"PAID",paid_at:"2026-09-01T01:02:03.000Z"};
beforeEach(()=>{
  process.env.JWT_SECRET=randomBytes(48).toString("base64url");process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
  resetTables({customers:[{customer_id:c,email:actor.email,full_name:actor.name,status:"ACTIVE"},{customer_id:other,email:"other@test.invalid",full_name:"Other",status:"ACTIVE"}],payments_by_customer:[{...legacy}],payments_by_trip:[{...legacy}]});
});
async function request(owner=c,session=actor){
  const token=await withCookies(undefined,async store=>{await createSession(session);return store.get("rideflow_session").value;});
  return withCookies(token,()=>GET(new Request("http://localhost/api/customer/payments?month=2099-01&payment_method=BANK_TRANSFER"),{params:Promise.resolve({id:owner})}));
}
test("Legacy CASH/PAID 58,350 payment is returned unchanged for its actual owner, regardless of current month or new method",async()=>{
  const response=await request();assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.success,true);assert.ok(Array.isArray(body.data));assert.deepEqual(body.data,[legacy]);
  assert.equal(paymentMethodLabel(body.data[0].payment_method),"Tiền mặt");assert.equal(paymentStatusLabel(body.data[0].payment_status),"Đã thanh toán");
  assert.equal(writes().length,0);assert.ok(calls.some(({cql,values})=>cql==="SELECT * FROM payments_by_customer WHERE customer_id = ?"&&values[0]===c));
});
test("Payment history includes every page and does not cut off an older transaction at 50 records",async()=>{
  tables.set("payments_by_customer",[...Array.from({length:55},(_,i)=>({...legacy,payment_id:`84000000-0000-4000-8000-${String(i+100).padStart(12,"0")}`,amount:"10000",payment_method:i%2?"BANK_TRANSFER":"CASH",payment_status:i%2?"PENDING":"PAID"})),legacy]);
  setPageSize(2);const response=await request();const body=await response.json();
  assert.equal(body.data.length,56);assert.ok(body.data.some(row=>row.payment_id===legacy.payment_id));assert.equal(writes().length,0);
});
test("Historical CARD/WALLET and pending bank records remain visible and are not validated as new booking input",async()=>{
  tables.set("payments_by_customer",["CASH","CARD","WALLET","BANK_TRANSFER"].map((method,i)=>({...legacy,payment_id:`84000000-0000-4000-8000-${String(i+200).padStart(12,"0")}`,payment_method:method,payment_status:i===3?"PENDING":"PAID"})));
  assert.deepEqual((await (await request()).json()).data.map(row=>row.payment_method),["CASH","CARD","WALLET","BANK_TRANSFER"]);
});
test("The historical payment is never borrowed from another customer's partition",async()=>{
  assert.equal((await request(other)).status,403);
  const otherActor={...actor,userId:other,email:"other@test.invalid"};
  assert.deepEqual((await (await request(other,otherActor)).json()).data,[]);assert.equal(writes().length,0);
});
test("An empty customer projection is reported honestly and never rebuilt by a read request",async()=>{
  tables.set("payments_by_customer",[]);
  assert.deepEqual((await (await request()).json()).data,[]);assert.equal(tables.get("payments_by_trip").length,1);assert.equal(writes().length,0);
});
test("A transport error returns an error rather than a successful empty list",async()=>{
  const original=console.error;console.error=()=>{};
  try{setUnavailable(true);assert.equal((await request()).status,503);}
  finally{setUnavailable(false);console.error=original;}
});
