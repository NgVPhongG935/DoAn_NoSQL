import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { resetTables, tables, setFault, businessWrites, calls } from "./support/cassandra.mjs";
import { withCookies } from "./support/cookies.mjs";
import { createSession } from "../src/lib/auth.ts";
import { bookTrip, changeTripStatus } from "../src/services/trips.ts";
import { paymentMethodLabel, paymentStatusLabel } from "../src/lib/payment-values.ts";
import { getCustomerDashboard } from "../src/services/dashboard.ts";

const id=n=>`83000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const c=id(1),c2=id(2),d=id(11),d2=id(12),v=id(21),s=id(31);
const customer={userId:c,role:"CUSTOMER",name:"Payment Customer",email:"customer@test.invalid"};
const outsider={userId:c2,role:"CUSTOMER",name:"Other",email:"other@test.invalid"};
const driver={userId:d,role:"DRIVER",name:"Payment Driver",email:"driver@test.invalid"};
const otherDriver={userId:d2,role:"DRIVER",name:"Other Driver",email:"other-driver@test.invalid"};
const admin={userId:"admin-demo",role:"ADMIN",name:"Admin",email:"admin@test.invalid"};
const hash=`scrypt$${"a".repeat(32)}$${scryptSync("MockOnly@123","a".repeat(32),64).toString("hex")}`;
const input={customerId:c,serviceId:s,pickup:{label:"Test pickup",lat:10.7,lng:106.7},destination:{label:"Test destination",lat:10.8,lng:106.8},paymentMethod:"BANK_TRANSFER"};
beforeEach(()=>{
  process.env.JWT_SECRET=randomBytes(48).toString("base64url");process.env.ADMIN_EMAIL=admin.email;process.env.ADMIN_PASSWORD_HASH=hash;process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
  resetTables({customers:[customer,outsider].map(u=>({customer_id:u.userId,full_name:u.name,email:u.email,status:"ACTIVE"})),drivers:[{driver_id:d,full_name:driver.name,email:driver.email,account_status:"ACTIVE",driver_status:"AVAILABLE",rating:0},{driver_id:d2,full_name:otherDriver.name,email:otherDriver.email,account_status:"ACTIVE",driver_status:"AVAILABLE",rating:0}],vehicles:[{vehicle_id:v,driver_id:d,status:"ACTIVE",vehicle_type:"BIKE",brand:"Test",model:"Bike",license_plate:"TEST",seat_count:2}],service_types:[{service_id:s,service_name:"BIKE",base_fare:"10000",price_per_km:"1000",status:"ACTIVE"}]});
});
async function invoke(file,method,tripId,actor,body){
  const route=await import(`../src/app/api/${file}/route.ts`);
  const auth=actor?await withCookies(undefined,async store=>{await createSession(actor);return store.get("rideflow_session").value;}):undefined;
  return withCookies(auth,()=>route[method](new Request("http://localhost/api/test",{method,...(body===undefined||method==="GET"?{}:{headers:{"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(body)})}),{params:Promise.resolve({id:tripId})}));
}
const payment=(method,tripId,actor=customer,body)=>invoke("trips/[id]/payment",method,tripId,actor,body);
const review=(tripId,body,actor=customer)=>invoke("trips/[id]/review","POST",tripId,actor,body);
async function complete(method="BANK_TRANSFER"){
  const trip=await bookTrip({...input,paymentMethod:method},randomUUID());
  for(const status of ["ACCEPTED","ARRIVING","IN_PROGRESS","COMPLETED"])await changeTripStatus(trip.tripId,status,undefined,driver,randomUUID());
  return trip.tripId;
}
function synchronized(status){
  const canonical=tables.get("payments_by_trip")[0],mirrors=tables.get("payments_by_customer");
  assert.equal(mirrors.length,1);assert.equal(canonical.payment_status,status);assert.equal(mirrors[0].payment_status,status);
  assert.equal(canonical.payment_id,mirrors[0].payment_id);assert.equal(String(canonical.amount),String(mirrors[0].amount));assert.equal(new Date(canonical.paid_at).valueOf(),new Date(mirrors[0].paid_at).valueOf());
}

for(const journal of [false,true]){
  test(`Bank completion stays pending, no income/spending is invented (journal=${journal})`,async()=>{
    process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);const tripId=await complete();
    synchronized("PENDING");assert.equal(tables.get("drivers")[0].driver_status,"AVAILABLE");
    assert.equal(tables.get("driver_revenue_by_month")?.length||0,0);assert.equal(tables.get("customer_spending_by_month")?.length||0,0);
    const response=await payment("GET",tripId);assert.equal(response.status,200);assert.equal((await response.json()).data.bankTransfer,undefined);
    const dashboard=await getCustomerDashboard(c,new Date().toISOString().slice(0,7));assert.equal(dashboard.stats.totalSpent,0);
  });
  test(`Customer reports transfer and assigned Driver confirms receipt (journal=${journal})`,async()=>{
    process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);const tripId=await complete();
    assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);synchronized("PENDING_CONFIRMATION");
    assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);synchronized("PENDING_CONFIRMATION");
    for(const actor of [customer,outsider,otherDriver,admin]) assert.equal((await payment("POST",tripId,actor,{action:"CONFIRM_TRANSFER"})).status,403);
    assert.equal((await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"})).status,200);synchronized("PAID_DEMO");
    const detail=await payment("GET",tripId,customer);assert.equal(detail.status,200);assert.equal((await detail.json()).data.payments[0].payment_status,"PAID_DEMO");
    const history=await invoke("customers/[id]/payments","GET",c,customer);assert.equal(history.status,200);
    const historyRows=(await history.json()).data;assert.ok(historyRows.some(row=>row.trip_id===tripId&&row.payment_status==="PAID_DEMO"&&row.payment_method==="BANK_TRANSFER"));
    const stamp=tables.get("payments_by_trip")[0].paid_at;
    await changeTripStatus(tripId,"COMPLETED",undefined,driver,randomUUID());
    assert.equal((await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"})).status,200);
    synchronized("PAID_DEMO");assert.deepEqual(tables.get("payments_by_trip")[0].paid_at,stamp);
    for(const table of ["driver_revenue_by_month","customer_spending_by_month"])assert.equal(tables.get(table).length,1);
  });
  test(`Pending clustering keys move to the confirmation time across months (journal=${journal})`,async()=>{
    process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);const tripId=await complete();
    assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);
    for(const table of ["payments_by_trip","payments_by_customer"]) tables.get(table)[0].paid_at="2025-01-31T23:59:00.000Z";
    assert.equal((await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"})).status,200);
    synchronized("PAID_DEMO");assert.equal(tables.get("driver_revenue_by_month")[0].year_month,new Date().toISOString().slice(0,7));
    assert.ok(businessWrites().some(({cql})=>cql.startsWith("DELETE FROM payments_by_customer")));
  });
}

test("Admin rejection is limited to pending requests and Customer can send a new request afterward",async()=>{
  const tripId=await complete();
  assert.equal((await payment("POST",tripId,admin,{action:"REJECT_TRANSFER"})).status,409);
  assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);synchronized("PENDING_CONFIRMATION");
  assert.equal((await payment("POST",tripId,customer,{action:"REJECT_TRANSFER"})).status,403);
  assert.equal((await payment("POST",tripId,admin,{action:"REJECT_TRANSFER"})).status,200);synchronized("FAILED");
  assert.equal(paymentStatusLabel("FAILED"),"Bị từ chối");
  assert.equal(tables.get("driver_revenue_by_month")?.length||0,0);
  assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);synchronized("PENDING_CONFIRMATION");
  assert.equal((await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"})).status,200);synchronized("PAID_DEMO");
});
test("Transfer requests require no bank credentials and create one Cassandra payment record",async()=>{
  const tripId=await complete();
  const before=businessWrites().length;
  assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);
  assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);
  synchronized("PENDING_CONFIRMATION");
  assert.equal(tables.get("payments_by_trip").length,1);assert.equal(tables.get("payments_by_customer").length,1);
  assert.ok(businessWrites().length > before);
});
test("Assigned Driver can confirm received transfer directly from the pending payment state",async()=>{
  const tripId=await complete();
  synchronized("PENDING");
  assert.equal((await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"})).status,200);
  synchronized("PAID_DEMO");
});
test("Cash completion persists actual cash method and paid state; new bookings reject old simulated methods",async()=>{
  await complete("CASH");synchronized("PAID");assert.equal(tables.get("payments_by_trip")[0].payment_method,"CASH");
  await assert.rejects(bookTrip({...input,paymentMethod:"CARD"},randomUUID()),{status:400});
  assert.equal(paymentMethodLabel("CASH"),"Tiền mặt");assert.equal(paymentMethodLabel("BANK_TRANSFER"),"Chuyển khoản");assert.equal(paymentStatusLabel("PAID_DEMO"),"Đã thanh toán");
});
test("Cash completion API requires an explicit cash-received acknowledgement",async()=>{
  const trip=await bookTrip({...input,paymentMethod:"CASH"},randomUUID());
  for(const status of ["ACCEPTED","ARRIVING","IN_PROGRESS"])await changeTripStatus(trip.tripId,status,undefined,driver,randomUUID());
  assert.equal((await invoke("trips/[id]/status","PATCH",trip.tripId,driver,{status:"COMPLETED"})).status,400);
  assert.equal((await invoke("trips/[id]/status","PATCH",trip.tripId,driver,{status:"COMPLETED",cashReceived:true})).status,200);
  synchronized("PAID");
});
test("Payment endpoints reject unauthenticated/foreign users and incomplete trips without writing",async()=>{
  const trip=await bookTrip(input,randomUUID());
  for(const method of ["GET","POST"]){
    assert.equal((await payment(method,trip.tripId,null,{action:"CONFIRM_TRANSFER"})).status,401);
    assert.equal((await payment(method,trip.tripId,outsider,{action:"CONFIRM_TRANSFER"})).status,403);
  }
  assert.equal((await payment("POST",trip.tripId,driver,{action:"CONFIRM_TRANSFER"})).status,409);
});

for(const stage of ["before","after"])for(let step=1;step<=5;step++){
  test(`Bank confirmation repairs partial writes ${stage} step ${step}, including cache loss`,async()=>{
    const tripId=await complete();
    assert.equal((await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"})).status,200);
    setFault({match:({cql})=>!cql.startsWith("SELECT"),remaining:step,when:stage});
    // Normal confirmation has five statements when the provisional key changes.
    await new Promise(resolve=>setTimeout(resolve,2));
    const first=await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"});assert.equal(first.status,503);
    globalThis.rideflowDemoWrites.entries.clear();globalThis.rideflowDemoWrites.pending=undefined;
    assert.equal((await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"})).status,200);synchronized("PAID_DEMO");
    for(const table of ["driver_revenue_by_month","customer_spending_by_month"])assert.equal(tables.get(table).length,1);
  });
}

test("Completed-trip review is persisted once in both projections and visible to Customer, Driver and Admin",async()=>{
  const tripId=await complete("CASH");
  assert.equal((await review(tripId,{rating:4,comment:"Good trip"})).status,201);
  for(const actor of [customer,driver,admin]){
    const response=await invoke("trips/[id]","GET",tripId,actor);assert.equal(response.status,200);
    const data=(await response.json()).data;assert.equal(data.review.rating,4);assert.equal(data.reviewSynced,true);
  }
  assert.equal((await review(tripId,{rating:4,comment:"Good trip"})).status,201);
  assert.equal((await review(tripId,{rating:1,comment:"Changed"})).status,409);
  assert.equal(tables.get("reviews_by_trip").length,1);assert.equal(tables.get("reviews_by_driver").length,1);assert.equal(tables.get("drivers")[0].rating,4);
});
test("Review ownership, trip state and the 1–5 integer bounds are enforced",async()=>{
  const trip=await bookTrip(input,randomUUID());
  assert.equal((await review(trip.tripId,{rating:5})).status,409);
  for(const status of ["ACCEPTED","ARRIVING","IN_PROGRESS","COMPLETED"])await changeTripStatus(trip.tripId,status,undefined,driver,randomUUID());
  for(const rating of [0,6,2.5,"5"])assert.equal((await review(trip.tripId,{rating})).status,400);
  assert.equal((await review(trip.tripId,{rating:5},outsider)).status,403);
  for(const actor of [driver,admin])assert.equal((await review(trip.tripId,{rating:5},actor)).status,401);
});
test("A partially written review exposes a real repair action and recovers the driver average",async()=>{
  const tripId=await complete("CASH");
  setFault({match:({cql})=>cql.startsWith("UPDATE drivers SET rating"),remaining:1,when:"before"});
  assert.equal((await review(tripId,{rating:3,comment:"Review recovery"})).status,503);
  let data=(await (await invoke("trips/[id]","GET",tripId,customer)).json()).data;assert.equal(data.reviewSynced,false);
  assert.equal((await review(tripId,{rating:3,comment:"Review recovery"})).status,201);
  data=(await (await invoke("trips/[id]","GET",tripId,customer)).json()).data;assert.equal(data.reviewSynced,true);assert.equal(tables.get("reviews_by_driver").length,1);
});
test("No schema changes or journal enabling is part of the payment and review flow",async()=>{
  const tripId=await complete();await payment("POST",tripId,customer,{action:"REPORT_TRANSFER"});await payment("POST",tripId,driver,{action:"CONFIRM_TRANSFER"});
  assert.ok(calls.every(({cql})=>!/CREATE|ALTER|TRUNCATE|DROP/.test(cql)));
});
