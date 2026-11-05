import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { calls, tables, resetTables, setPageSize, setFault, writes } from "./support/cassandra.mjs";
import { withCookies } from "./support/cookies.mjs";
import { createSession, getSession } from "../src/lib/auth.ts";
import { authenticateDemoUser } from "../src/lib/demo-auth.ts";
import { registerCustomer } from "../src/services/registration.ts";
import { demoMutation } from "../src/lib/demo-mutation.ts";

const id = (n) => `81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const c=id(1), c2=id(2), d=id(11), trip=id(31);
const password="MockOnly@123", salt=randomBytes(16).toString("hex");
const hash=`scrypt$${salt}$${scryptSync(password,salt,64).toString("hex")}`;
const admin={userId:"admin-demo",role:"ADMIN",name:"Admin",email:"admin@test.invalid"};
const customer={userId:c,role:"CUSTOMER",name:"Customer",email:"customer@test.invalid"};
const driver={userId:d,role:"DRIVER",name:"Driver",email:"driver@test.invalid"};
const newAccount={fullName:"New account",phone:"0999999999",email:"new@test.invalid",password};
const created="2026-10-01T00:00:00.000Z";
const tmpRoot=path.resolve(".tmp");
await mkdir(tmpRoot,{recursive:true});
const avatarDirectory=await mkdtemp(path.join(tmpRoot,"admin-avatar-test-"));
process.env.RIDEFLOW_AVATAR_DIR=avatarDirectory;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=","base64");

beforeEach(()=>{
  process.env.JWT_SECRET=randomBytes(48).toString("base64url");
  process.env.ADMIN_EMAIL=admin.email;process.env.ADMIN_PASSWORD_HASH=hash;
  process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
  resetTables({
    customers:[customer,{...customer,userId:c2,email:"second@test.invalid"}].map((u)=>({customer_id:u.userId,full_name:u.name,email:u.email,phone:"0901234567",password:hash,status:"ACTIVE",created_at:created})),
    drivers:[{driver_id:d,full_name:driver.name,email:driver.email,phone:"0901234567",password:hash,account_status:"ACTIVE",driver_status:"OFFLINE",license_number:"LICENSE-TEST",rating:4.5,created_at:created}],
  });
});
async function token(actor){
  return actor ? withCookies(undefined,async(store)=>{await createSession(actor);return store.get("rideflow_session").value;}) : undefined;
}
async function invoke(file,method,actor=admin,params={},body){
  const route=await import(`../src/app/api/${file}/route.ts`);
  const auth=await token(actor);
  const options={method};
  if(body instanceof FormData) options.body=body;
  else if(body!==undefined){options.body=JSON.stringify(body);options.headers={"Content-Type":"application/json"};}
  return withCookies(auth,()=>route[method](new Request("http://localhost/api/test",options),{params:Promise.resolve(params)}));
}
const collection=(method,resource,body,actor=admin)=>invoke("admin/[resource]",method,actor,{resource},body);
const account=(method,resource,id,body,actor=admin)=>invoke("admin/[resource]/[id]",method,actor,{resource,id},body);
function imageForm(bytes=png,type="image/png"){
  const form=new FormData();form.set("avatar",new File([bytes],"avatar.png",{type}));return form;
}

for(const resource of ["customers","drivers"]){
  test(`Admin creates ${resource} with a fresh salted hash and a usable login`,async()=>{
    const input={...newAccount,...(resource==="drivers"?{licenseNumber:"LICENSE-NEW"}:{})};
    const response=await collection("POST",resource,input);
    assert.equal(response.status,201);const data=(await response.json()).data;
    assert.equal(data.password,undefined);assert.equal(data.email,input.email);
    const stored=tables.get(resource).at(-1);assert.notEqual(stored.password,hash);assert.notEqual(stored.password,password);
    const [,salt,digest]=stored.password.split("$");assert.equal(scryptSync(password,salt,64).toString("hex"),digest);
    assert.equal((await authenticateDemoUser(input.email,password)).role,resource==="customers"?"CUSTOMER":"DRIVER");
    if(resource==="drivers"){assert.equal(stored.driver_status,"OFFLINE");assert.equal(stored.rating,0);assert.equal(stored.account_status,"ACTIVE");}
    assert.equal(writes().length,1);assert.ok(!calls.some(({cql})=>/CREATE|ALTER|TRUNCATE|DROP/.test(cql)));
  });
  test(`Admin edits ${resource} without changing existing passwords, IDs or statistics`,async()=>{
    const target=resource==="customers"?c:d, key=resource==="customers"?"customer_id":"driver_id";
    const before=structuredClone(tables.get(resource)[0]);
    const input={fullName:"Edited name",phone:"0912345678",email:"edited@test.invalid",...(resource==="drivers"?{licenseNumber:"UPDATED-LICENSE"}:{})};
    const response=await account("PATCH",resource,target,input);assert.equal(response.status,200);
    const stored=tables.get(resource)[0];assert.equal(stored.full_name,input.fullName);assert.equal(stored.email,input.email);
    for(const field of [key,"password","created_at",...(resource==="drivers"?["rating","driver_status","account_status"]:["status"])]) assert.deepEqual(stored[field],before[field]);
    assert.equal((await response.json()).data.password,undefined);
  });
  test(`Admin deletes only an unreferenced ${resource} account, including safe retries`,async()=>{
    const target=resource==="customers"?c:d;
    assert.equal((await account("DELETE",resource,target)).status,200);
    assert.equal(tables.get(resource).length,resource==="customers"?1:0);
    assert.equal((await account("DELETE",resource,target)).status,200);
    assert.equal(writes().length,1);
  });
  test(`Other roles cannot create, edit or delete ${resource}`,async()=>{
    for(const actor of [customer,driver]){
      assert.equal((await collection("POST",resource,newAccount,actor)).status,403);
      assert.equal((await account("PATCH",resource,c,{fullName:"Attack"},actor)).status,403);
      assert.equal((await account("DELETE",resource,c,undefined,actor)).status,403);
    }
    assert.equal(writes().length,0);
  });
}

test("Email uniqueness spans both roles, pagination and concurrent registration",async()=>{
  setPageSize(1);
  for(const email of ["SECOND@test.invalid",driver.email,admin.email]) assert.equal((await collection("POST","customers",{...newAccount,email})).status,409);
  assert.equal((await account("PATCH","drivers",d,{email:customer.email})).status,409);
  const results=await Promise.allSettled([registerCustomer(newAccount),collection("POST","drivers",{...newAccount,licenseNumber:"LICENSE-NEW"})]);
  assert.equal(results[0].status,"fulfilled");assert.equal(results[1].value.status,409);
  assert.equal(writes().length,1);
});

test("Invalid input and attempts to edit passwords, availability, IDs or roles cannot write",async()=>{
  for(const input of [{...newAccount,password:"weak"},{...newAccount,role:"ADMIN"},{...newAccount,phone:"123"}]) assert.equal((await collection("POST","customers",input)).status,400);
  assert.equal((await collection("POST","drivers",newAccount)).status,400);
  for(const body of [{password},{driver_status:"AVAILABLE"},{customer_id:c2},{role:"ADMIN"},{}]) assert.equal((await account("PATCH","customers",c,body)).status,400);
  assert.equal((await account("DELETE","customers","bad-id")).status,400);
  assert.equal(writes().length,0);
});

test("Changing an email invalidates old sessions and preserves the existing login password",async()=>{
  const old=await token(customer);
  assert.equal((await account("PATCH","customers",c,{email:"changed@test.invalid"})).status,200);
  assert.equal(await withCookies(old,getSession),null);
  assert.equal(await authenticateDemoUser(customer.email,password),null);
  assert.equal((await authenticateDemoUser("changed@test.invalid",password)).user.id,c);
});

test("Profile edits can return to an earlier value without stale retry-cache results",async()=>{
  for(const fullName of ["Name A","Name B","Name A"]){
    assert.equal((await account("PATCH","customers",c,{fullName})).status,200);
    assert.equal(tables.get("customers")[0].full_name,fullName);
  }
});

test("Locking an account with an active trip is refused; ordinary locking revokes sessions",async()=>{
  tables.set("trips_by_id",[{trip_id:trip,customer_id:c,driver_id:d,status:"BOOKED"}]);
  assert.equal((await account("PATCH","customers",c,{status:"BLOCKED"})).status,409);
  assert.equal((await account("PATCH","drivers",d,{accountStatus:"BLOCKED"})).status,409);
  assert.equal(writes().length,0);
  tables.set("trips_by_id",[]);const old=await token(customer);
  assert.equal((await account("PATCH","customers",c,{status:"BLOCKED"})).status,200);
  assert.equal(await withCookies(old,getSession),null);
});

const refs={
  customers:["trips_by_id","trips_by_customer","trips_by_driver","trips_by_status","payments_by_trip","payments_by_customer","reviews_by_trip","reviews_by_driver","customer_vouchers","complaints_by_customer","notifications_by_user","customer_spending_by_month"],
  drivers:["vehicles","trips_by_id","trips_by_customer","trips_by_driver","trips_by_status","reviews_by_trip","reviews_by_driver","notifications_by_user","driver_revenue_by_month"],
};
for(const [resource,names] of Object.entries(refs)) for(const table of names){
  test(`Deletion preserves ${resource} referenced by ${table}, including orphan projections`,async()=>{
    const target=resource==="customers"?c:d,column=table==="notifications_by_user"?"user_id":resource==="customers"?"customer_id":"driver_id";
    tables.set(table,[{[column]:id(999)},{[column]:target}]);setPageSize(1);
    const response=await account("DELETE",resource,target);assert.equal(response.status,409);
    assert.equal(writes().length,0);
  });
}

test("Account writes can retry ambiguous Cassandra responses without duplicate accounts or password changes",async()=>{
  const original=console.error;console.error=()=>{};
  try{
    setFault({match:({cql})=>cql.startsWith("UPDATE customers"),remaining:1,when:"after"});
    assert.equal((await account("PATCH","customers",c,{fullName:"Retried name"})).status,503);
    assert.equal((await account("PATCH","customers",c,{fullName:"Retried name"})).status,200);
    assert.equal(tables.get("customers")[0].password,hash);
    setFault({match:({cql})=>cql.startsWith("DELETE FROM customers"),remaining:1,when:"after"});
    assert.equal((await account("DELETE","customers",c)).status,503);
    assert.equal((await account("DELETE","customers",c)).status,200);
    assert.equal(tables.get("customers").length,1);
  }finally{console.error=original;}
});

test("Deletion waits for the existing trip mutation queue and sees the newly created reference",async()=>{
  let release,started;
  const ready=new Promise((r)=>{started=r;});const wait=new Promise((r)=>{release=r;});
  const booking=demoMutation("mock-booking-race",{},async()=>{
    started();await wait;
    return {statements:[{query:"INSERT INTO trips_by_customer (customer_id, booked_at, trip_id) VALUES (?, ?, ?)",params:[c,new Date(),trip]}],result:{tripId:trip}};
  });
  await ready;const deletion=account("DELETE","customers",c);release();await booking;
  assert.equal((await deletion).status,409);assert.ok(!writes().some(({cql})=>cql.startsWith("DELETE")));
});

for(const [role,userId,actor] of [["CUSTOMER",c,customer],["DRIVER",d,driver],["ADMIN",admin.userId,admin]]){
  test(`${role} can persist, replace, read and remove their avatar without any Cassandra writes`,async()=>{
    const file="avatars/[role]/[id]",params={role,id:userId};
    assert.equal((await invoke(file,"PUT",actor,params,imageForm())).status,200);
    let response=await invoke(file,"GET",actor,params);assert.equal(response.status,200);
    assert.equal(response.headers.get("content-type"),"image/png");assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    assert.equal((await invoke(file,"PUT",actor,params,imageForm())).status,200);
    const {readAvatar}=await import("../src/lib/account-avatars.ts");assert.deepEqual((await readAvatar(role,userId)).bytes,png);
    assert.equal((await invoke(file,"DELETE",actor,params)).status,200);
    assert.equal((await invoke(file,"GET",actor,params)).status,404);
    assert.equal(writes().length,0);
  });
}

test("Avatar ownership, Admin access, invalid files and size limits are enforced",async()=>{
  const file="avatars/[role]/[id]",params={role:"CUSTOMER",id:c};
  for(const method of ["GET","PUT","DELETE"]){
    assert.equal((await invoke(file,method,null,params)).status,401);
    assert.equal((await invoke(file,method,driver,params,method==="PUT"?imageForm():undefined)).status,403);
  }
  for(const form of [imageForm(Buffer.from("<svg></svg>")),imageForm(png,"image/jpeg"),imageForm(Buffer.alloc(2*1024*1024+1)),new FormData()]) assert.equal((await invoke(file,"PUT",customer,params,form)).status,400);
  assert.equal((await invoke(file,"PUT",admin,params,imageForm())).status,200);
  assert.equal((await invoke(file,"GET",customer,params)).status,200);
  assert.equal((await invoke(file,"PUT",admin,{role:"CUSTOMER",id:id(999)},imageForm())).status,404);
  assert.equal((await invoke(file,"PUT",admin,{role:"ADMIN",id:"../escape"},imageForm())).status,404);
  assert.equal(writes().length,0);
});

test("Deleting a new account also removes its local avatar",async()=>{
  assert.equal((await invoke("avatars/[role]/[id]","PUT",admin,{role:"DRIVER",id:d},imageForm())).status,200);
  assert.equal((await account("DELETE","drivers",d)).status,200);
  assert.ok(!(await readdir(avatarDirectory)).includes(`driver-${d}.json`));
});

after(async()=>{
  assert.equal(path.dirname(avatarDirectory),tmpRoot);
  await rm(avatarDirectory,{recursive:true,force:true});
});
