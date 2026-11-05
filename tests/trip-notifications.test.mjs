import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { tables, calls, resetTables, setFault, writes, setPageSize } from "./support/cassandra.mjs";
import { withCookies } from "./support/cookies.mjs";
import { createSession } from "../src/lib/auth.ts";
import { bookTrip, reassignTripAfterDriverCancellation } from "../src/services/trips.ts";
import { driverAssignmentNotification } from "../src/lib/trip-notifications.ts";

const id=n=>`85000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const c=id(1),c2=id(2),d=id(11),d2=id(12),v=id(21),v2=id(22),s=id(31);
const customer={userId:c,role:"CUSTOMER",name:"Customer",email:"customer@test.invalid"};
const driver={userId:d,role:"DRIVER",name:"Driver",email:"driver@test.invalid"};
const otherDriver={userId:d2,role:"DRIVER",name:"Other driver",email:"other-driver@test.invalid"};
const input={customerId:c,serviceId:s,pickup:{label:"Test pickup",lat:10.7,lng:106.7},destination:{label:"Test destination",lat:10.8,lng:106.8},paymentMethod:"CASH"};
beforeEach(()=>{
 process.env.JWT_SECRET=randomBytes(48).toString("base64url");process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
 resetTables({customers:[{customer_id:c,full_name:customer.name,email:customer.email,status:"ACTIVE"},{customer_id:c2,status:"ACTIVE"}],drivers:[driver,otherDriver].map((u,i)=>({driver_id:u.userId,full_name:u.name,email:u.email,account_status:"ACTIVE",driver_status:i?"OFFLINE":"AVAILABLE"})),vehicles:[v,v2].map((vehicle_id,i)=>({vehicle_id,driver_id:i?d2:d,vehicle_type:"BIKE",seat_count:2,status:"ACTIVE",brand:"Test",model:"Bike",license_plate:"TEST"})),service_types:[{service_id:s,service_name:"BIKE",base_fare:"10000",price_per_km:"1000",status:"ACTIVE"}]});
});
function assigned(){return (tables.get("notifications_by_user")||[]).filter(row=>row.notification_type==="TRIP_ASSIGNED");}
async function invoke(file,method,actor,params,body){
 const route=await import(`../src/app/api/${file}/route.ts`);
 const token=actor?await withCookies(undefined,async store=>{await createSession(actor);return store.get("rideflow_session").value;}):undefined;
 return withCookies(token,()=>route[method](new Request("http://localhost/api/test",{method,...(body===undefined?{}:{headers:{"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(body)})}),{params:Promise.resolve(params)}));
}

for(const journal of [false,true]){
 test(`Booking persists one unread assignment only for its actual driver and retries without duplicates (journal=${journal})`,async()=>{
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);const key=randomUUID();const trip=await bookTrip(input,key);
  const notice=assigned()[0];assert.equal(assigned().length,1);assert.equal(notice.user_id,trip.driverId);assert.equal(notice.is_read,false);
  assert.ok(notice.content.includes(input.pickup.label)&&notice.content.includes(input.destination.label)&&notice.content.includes(trip.tripId));
  assert.equal((await bookTrip(input,key)).tripId,trip.tripId);assert.equal(assigned().length,1);
  const own=await invoke("users/[id]/notifications","GET",driver,{id:d});assert.equal(own.status,200);assert.equal((await own.json()).data.length,1);
  const other=await invoke("users/[id]/notifications","GET",otherDriver,{id:d2});assert.deepEqual((await other.json()).data,[]);
  assert.equal((await invoke("users/[id]/notifications","GET",otherDriver,{id:d})).status,401);
 });
 test(`Unassignable booking creates no fake notification (journal=${journal})`,async()=>{
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);tables.get("drivers")[0].driver_status="OFFLINE";
  await assert.rejects(bookTrip(input,randomUUID()),{status:409});assert.equal(assigned().length,0);assert.equal(writes().length,0);
 });
 for(const when of ["before","after"]){
  test(`Assignment notification failure ${when} write retries together with its booking (journal=${journal})`,async()=>{
   process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);const key=randomUUID();
   setFault({match:({cql})=>cql.startsWith("INSERT INTO notifications_by_user"),remaining:1,when});
   await assert.rejects(bookTrip(input,key),{status:503});const trip=await bookTrip(input,key);
   assert.equal(assigned().length,1);assert.equal(assigned()[0].user_id,trip.driverId);assert.equal(tables.get("trips_by_id").length,1);
  });
 }
 test(`Replacement driver gets a new assignment while the customer keeps the existing incident notice (journal=${journal})`,async()=>{
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED=String(journal);const trip=await bookTrip(input,randomUUID());tables.get("drivers")[1].driver_status="AVAILABLE";
  const key=randomUUID();setFault({match:({cql,values})=>cql.startsWith("INSERT INTO notifications_by_user")&&values.includes(d2),remaining:1,when:"after"});
  await assert.rejects(reassignTripAfterDriverCancellation(trip.tripId,d,undefined,driver,key),{status:503});
  const result=await reassignTripAfterDriverCancellation(trip.tripId,d,undefined,driver,key);assert.equal(result.newDriverId,d2);
  assert.equal(assigned().filter(row=>row.user_id===d).length,1);assert.equal(assigned().filter(row=>row.user_id===d2).length,1);
  assert.equal(tables.get("notifications_by_user").filter(row=>row.user_id===c).length,1);
 });
}
test("Only one winning booking for a busy driver produces an assignment notification",async()=>{
 const result=await Promise.allSettled([bookTrip(input,randomUUID()),bookTrip({...input,customerId:c2},randomUUID())]);
 assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(assigned().length,1);
});
test("Notification payload has a stable UUID/time, no schema change and truthful trip details",()=>{
 const at=new Date(),tripId=id(55),data={tripId,driverId:d,pickup:"Real pickup",destination:"Real destination",fare:0,at};
 const notice=driverAssignmentNotification(data);assert.deepEqual(notice,driverAssignmentNotification(data));assert.ok(notice.content.includes("0 ₫"));
 assert.match(notice.notification_id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.ok(calls.every(({cql})=>!/CREATE|ALTER|DROP|TRUNCATE/.test(cql)));
});
test("Unread/mark-read uses the driver's exact composite key, rejects missing records and follows Cassandra pages",async()=>{
 const trip=await bookTrip(input,randomUUID());const notice=assigned()[0];setPageSize(1);
 const params={id:d,createdAt:new Date(notice.created_at).toISOString(),notificationId:notice.notification_id};
 assert.equal((await invoke("users/[id]/notifications/[createdAt]/[notificationId]","PATCH",otherDriver,params)).status,401);
 assert.equal((await invoke("users/[id]/notifications/[createdAt]/[notificationId]","PATCH",driver,{...params,notificationId:id(999)})).status,404);
 assert.equal((await invoke("users/[id]/notifications/[createdAt]/[notificationId]","PATCH",driver,params)).status,200);
 assert.equal(assigned()[0].is_read,true);assert.equal(tables.get("trips_by_id")[0].trip_id,trip.tripId);
 const rows=(await (await invoke("users/[id]/notifications","GET",driver,{id:d})).json()).data;assert.equal(rows.length,1);
});
