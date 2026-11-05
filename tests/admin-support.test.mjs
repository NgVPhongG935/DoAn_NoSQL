import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createSession } from "../src/lib/auth.ts";
import { withCookies } from "./support/cookies.mjs";
import { tables, resetTables, setPageSize, writes, calls, setFault, setUnavailable } from "./support/cassandra.mjs";

const id=n=>`82000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const c=id(1),d=id(11),notification=id(21),complaint=id(31),trip=id(41),createdAt="2026-10-24T00:00:00.000Z";
const admin={userId:"admin-demo",role:"ADMIN",name:"Admin",email:"admin@test.invalid"};
const customer={userId:c,role:"CUSTOMER",name:"Customer",email:"customer@test.invalid"};
const driver={userId:d,role:"DRIVER",name:"Driver",email:"driver@test.invalid"};
const hash=`scrypt$${"a".repeat(32)}$${scryptSync("MockOnly@123","a".repeat(32),64).toString("hex")}`;
beforeEach(()=>{
  process.env.JWT_SECRET=randomBytes(48).toString("base64url");process.env.ADMIN_EMAIL=admin.email;process.env.ADMIN_PASSWORD_HASH=hash;process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
  resetTables({
    customers:[{customer_id:c,full_name:customer.name,email:customer.email,status:"ACTIVE",password:hash}],
    drivers:[{driver_id:d,full_name:driver.name,email:driver.email,account_status:"ACTIVE",password:hash}],
    complaints_by_customer:[{customer_id:c,created_at:createdAt,complaint_id:complaint,trip_id:trip,subject:"Test complaint",content:"Full complaint content",status:"OPEN",resolved_at:null}],
    notifications_by_user:[{user_id:c,created_at:createdAt,notification_id:notification,title:"Test notification",content:"Notification content",is_read:false,notification_type:"SYSTEM"}],
  });
});
async function invoke(file,method,params,body,actor=admin,query=""){
  const route=await import(`../src/app/api/${file}/route.ts`);
  const token=actor?await withCookies(undefined,async(store)=>{await createSession(actor);return store.get("rideflow_session").value;}):undefined;
  return withCookies(token,()=>route[method](new Request(`http://localhost/api/test${query}`,{method,...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})}),{params:Promise.resolve(params)}));
}
const list=(resource,query="")=>invoke("admin/[resource]","GET",{resource},undefined,admin,query);
const notificationParams={userId:c,createdAt:encodeURIComponent(createdAt),notificationId:notification};
const complaintParams={customerId:c,createdAt:encodeURIComponent(createdAt),complaintId:complaint};

test("Empty complaint table returns a real empty list and never creates demo data",async()=>{
  tables.set("complaints_by_customer",[]);const response=await list("complaints");
  assert.equal(response.status,200);assert.deepEqual((await response.json()).data,[]);assert.equal(writes().length,0);
});

for(const resource of ["complaints","notifications"]){
  test(`${resource} returns complete records, users and every Cassandra page`,async()=>{
    const table=resource==="complaints"?"complaints_by_customer":"notifications_by_user";
    const owner=resource==="complaints"?"customer_id":"user_id",key=resource==="complaints"?"complaint_id":"notification_id";
    const sample=tables.get(table)[0];
    tables.set(table,Array.from({length:205},(_,i)=>({...sample,[key]:id(100+i),[owner]:i===204?id(999):c})));
    // Exercise records belonging to an account outside the old first-100 window.
    tables.get("customers").push(...Array.from({length:110},(_,i)=>({customer_id:id(1000+i),full_name:`Customer ${i}`})));
    const late=id(1109);tables.get(table)[203][owner]=late;
    setPageSize(2);const response=await list(resource);assert.equal(response.status,200);
    const data=(await response.json()).data;assert.equal(data.length,205);
    assert.ok(data.some(row=>row[owner]===id(999)&&row.user_role==="UNKNOWN"));
    assert.ok(data.some(row=>row[owner]===late&&row.user_name==="Customer 109"));
    assert.ok(data.every(row=>row.content===sample.content));assert.equal(data[0].password,undefined);
    assert.ok(!calls.some(({cql})=>cql.includes("ALLOW FILTERING")||cql.includes("LIMIT")));
    assert.equal(writes().length,0);
  });
  test(`${resource} is Admin-only, including when an account claims a role in the query`,async()=>{
    for(const actor of [null,customer,driver]){
      const response=await invoke("admin/[resource]","GET",{resource},undefined,actor,"?role=ADMIN");
      assert.equal(response.status,actor?403:401);
    }
    assert.equal(writes().length,0);
  });
}

test("Recipient list includes Customer and Driver accounts without notifications and is independent of the notification table",async()=>{
  tables.set("notifications_by_user",[]);
  const response=await list("notifications","?recipients=true");assert.equal(response.status,200);
  const data=(await response.json()).data;assert.deepEqual(new Set(data.map(row=>row.user_id)),new Set([c,d]));
  assert.equal(writes().length,0);
});

test("Admin read marking uses the recipient UUID and the full timestamp/notification key, never admin-demo",async()=>{
  const file="admin/notifications/[userId]/[createdAt]/[notificationId]";
  assert.equal((await invoke(file,"PATCH",notificationParams)).status,200);
  assert.equal(tables.get("notifications_by_user")[0].is_read,true);
  const write=writes()[0];assert.match(write.cql,/WHERE user_id = \? AND created_at = \? AND notification_id = \?/);
  assert.equal(write.values[0],c);assert.ok(write.values[1] instanceof Date);assert.equal(write.values[2],notification);
  assert.ok(!write.values.includes("admin-demo"));
  assert.equal((await invoke(file,"PATCH",notificationParams)).status,200);assert.equal(writes().length,1);
});

test("Admin can mark a Driver notification as read and only the exact composite key is changed",async()=>{
  const later="2026-10-24T01:00:00.000Z";
  tables.get("notifications_by_user").push({user_id:d,created_at:later,notification_id:notification,is_read:false});
  const response=await invoke("admin/notifications/[userId]/[createdAt]/[notificationId]","PATCH",{userId:d,createdAt:later,notificationId:notification});
  assert.equal(response.status,200);assert.equal(tables.get("notifications_by_user")[0].is_read,false);assert.equal(tables.get("notifications_by_user")[1].is_read,true);
});

test("Malformed/missing notification keys return 400/404 without upserting ghost records",async()=>{
  const file="admin/notifications/[userId]/[createdAt]/[notificationId]";
  for(const changes of [{userId:"admin-demo"},{createdAt:"%invalid"},{createdAt:"bad-date"},{notificationId:"bad-id"}]) assert.equal((await invoke(file,"PATCH",{...notificationParams,...changes})).status,400);
  assert.equal((await invoke(file,"PATCH",{...notificationParams,notificationId:id(999)})).status,404);
  for(const actor of [null,customer,driver]) assert.equal((await invoke(file,"PATCH",notificationParams,undefined,actor)).status,actor?403:401);
  assert.equal(writes().length,0);
});

test("Complaint transitions support OPEN, PROCESSING and RESOLVED, with stable retries and full keys",async()=>{
  const file="admin/complaints/[customerId]/[createdAt]/[complaintId]";
  for(const status of ["PROCESSING","PROCESSING","RESOLVED","RESOLVED"]){
    const response=await invoke(file,"PATCH",complaintParams,{status});assert.equal(response.status,200);
    assert.equal(tables.get("complaints_by_customer")[0].status,status);
  }
  assert.equal(writes().length,2);
  assert.ok(tables.get("complaints_by_customer")[0].resolved_at instanceof Date);
  assert.equal((await invoke(file,"PATCH",complaintParams,{status:"PROCESSING"})).status,409);
  const response=await list("complaints");const row=(await response.json()).data[0];
  assert.equal(row.customer_id,c);assert.equal(row.trip_id,trip);assert.equal(row.complaint_id,complaint);assert.ok(row.resolved_at);
});

test("Complaint malformed keys and missing records fail before writing",async()=>{
  const file="admin/complaints/[customerId]/[createdAt]/[complaintId]";
  for(const changes of [{customerId:"bad-id"},{createdAt:"%invalid"},{complaintId:"bad-id"}]) assert.equal((await invoke(file,"PATCH",{...complaintParams,...changes},{status:"PROCESSING"})).status,400);
  assert.equal((await invoke(file,"PATCH",{...complaintParams,complaintId:id(999)},{status:"PROCESSING"})).status,404);
  assert.equal(writes().length,0);
});

test("An ambiguous complaint update can retry the same transition without a false 409",async()=>{
  const file="admin/complaints/[customerId]/[createdAt]/[complaintId]",original=console.error;console.error=()=>{};
  try{
    setFault({match:({cql})=>cql.startsWith("UPDATE complaints_by_customer"),remaining:1,when:"after"});
    assert.equal((await invoke(file,"PATCH",complaintParams,{status:"RESOLVED"})).status,500);
    const first=tables.get("complaints_by_customer")[0].resolved_at;
    assert.equal((await invoke(file,"PATCH",complaintParams,{status:"RESOLVED"})).status,200);
    assert.deepEqual(tables.get("complaints_by_customer")[0].resolved_at,first);
  }finally{console.error=original;}
});

test("Cassandra unavailable returns 503 rather than a fabricated empty result",async()=>{
  const original=console.error;console.error=()=>{};
  try{setUnavailable(true);assert.equal((await list("notifications")).status,503);assert.equal((await list("complaints")).status,503);}
  finally{setUnavailable(false);console.error=original;}
});
