import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { POST as resetPassword } from "../src/app/api/admin/customers/[id]/password/route.ts";
import { POST as login } from "../src/app/api/auth/login/route.ts";
import { createSession, getSession } from "../src/lib/auth.ts";
import { authenticateDemoUser } from "../src/lib/demo-auth.ts";
import { getCustomer } from "../src/repositories/accounts.ts";
import { withCookies } from "./support/cookies.mjs";
import { tables, resetTables, writes, setFault, setExecutionHook } from "./support/cassandra.mjs";

const id=n=>`87000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const c=id(1),other=id(2),d=id(11),oldPassword="OldPassword@123",newPassword="NewPassword@456";
const salt=randomBytes(16).toString("hex"),hash=`scrypt$${salt}$${scryptSync(oldPassword,salt,64).toString("hex")}`;
const admin={userId:"admin-demo",role:"ADMIN",name:"Admin",email:"admin@test.invalid"};
const customer={userId:c,role:"CUSTOMER",name:"Khách kiểm thử",email:"customer@test.invalid"};
const driver={userId:d,role:"DRIVER",name:"Driver",email:"driver@test.invalid"};
const data={password:newPassword,confirmPassword:newPassword};
beforeEach(()=>{
  process.env.JWT_SECRET=randomBytes(48).toString("base64url");process.env.ADMIN_EMAIL=admin.email;process.env.ADMIN_PASSWORD_HASH=hash;process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
  resetTables({customers:[{customer_id:c,full_name:customer.name,email:customer.email,phone:"0901234567",status:"ACTIVE",password:hash,created_at:"2026-09-01T00:00:00Z"},{customer_id:other,full_name:"Other",email:"other@test.invalid",status:"ACTIVE",password:hash}],drivers:[{driver_id:d,full_name:driver.name,email:driver.email,account_status:"ACTIVE",password:hash}],trips_by_id:[{trip_id:id(21),customer_id:c,status:"COMPLETED",final_fare:"58350"}],payments_by_customer:[{customer_id:c,payment_id:id(31),paid_at:"2026-09-01T01:00:00Z",amount:"58350"}]});
});
const token=actor=>actor?withCookies(undefined,async store=>{await createSession(actor);return store.get("rideflow_session").value}):undefined;
async function reset(body=data,actor=admin,target=c){
  return withCookies(await token(actor),()=>resetPassword(new Request("http://localhost/api/admin/customers/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({id:target})}));
}
async function signIn(password=newPassword){
  return withCookies(undefined,async store=>{
    const response=await login(new Request("http://localhost/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:customer.email,password})}));
    return {response,token:store.get("rideflow_session")?.value};
  });
}

test("Admin resets only the selected customer's credentials with a fresh salted hash",async()=>{
  const before=structuredClone(Object.fromEntries(tables));const response=await reset();assert.equal(response.status,200);
  assert.equal(response.headers.get("Cache-Control"),"no-store");assert.deepEqual((await response.json()).data,{customerId:c,passwordReset:true});
  const row=tables.get("customers")[0];assert.notEqual(row.password,newPassword);assert.notEqual(row.password,hash);assert.match(row.password_version,/^[a-f0-9-]{36}$/);
  const [algorithm,newSalt,digest]=row.password.split("$");assert.equal(algorithm,"scrypt");assert.notEqual(newSalt,salt);assert.equal(scryptSync(newPassword,newSalt,64).toString("hex"),digest);
  const {password:ignored,password_version:version,...rest}=row;const {password:old,...original}=before.customers[0];assert.deepEqual(rest,original);
  assert.deepEqual(tables.get("customers")[1],before.customers[1]);for(const table of ["drivers","trips_by_id","payments_by_customer"])assert.deepEqual(tables.get(table),before[table]);
  assert.equal((await authenticateDemoUser(customer.email,oldPassword)),null);assert.equal((await authenticateDemoUser(customer.email,newPassword)).user.id,c);
  const profile=await getCustomer(c);assert.equal(profile.password,undefined);assert.equal(profile.password_version,undefined);assert.equal(writes().length,1);
});
test("Reset invalidates old sessions, preserves other customers and enables login with the new password",async()=>{
  const legacy=await token(customer),unrelated=await token({...customer,userId:other,email:"other@test.invalid"});
  assert.equal((await withCookies(legacy,getSession)).userId,c);await reset();
  assert.equal(await withCookies(legacy,getSession),null);assert.equal((await withCookies(unrelated,getSession)).userId,other);
  assert.equal((await signIn(oldPassword)).response.status,401);
  const signed=await signIn();assert.equal(signed.response.status,200);assert.equal((await withCookies(signed.token,getSession)).userId,c);
  assert.equal((await withCookies(signed.token,getSession)).credentialVersion,undefined);
  await reset({password:"AnotherPassword@789",confirmPassword:"AnotherPassword@789"});assert.equal(await withCookies(signed.token,getSession),null);
  assert.equal((await signIn("AnotherPassword@789")).response.status,200);
});
test("Anonymous users, Customers and Drivers cannot reset credentials or claim Admin in the request",async()=>{
  for(const actor of [null,customer,driver])assert.equal((await reset({...data,role:"ADMIN",customerId:other},actor)).status,actor?403:401);
  assert.equal(writes().length,0);assert.equal(tables.get("customers")[0].password,hash);
});
test("Mismatched, weak, oversized or unknown fields are rejected by the server",async()=>{
  for(const body of [{...data,confirmPassword:"DifferentPassword@123"},{password:"weak",confirmPassword:"weak"},{password:"NoNumber!",confirmPassword:"NoNumber!"},{password:"a".repeat(129),confirmPassword:"a".repeat(129)},{...data,status:"ACTIVE"},{password:newPassword}])assert.equal((await reset(body)).status,400);
  assert.equal(writes().length,0);
});
test("Missing or invalid customer IDs do not create partial accounts; blocked accounts stay blocked",async()=>{
  assert.equal((await reset(data,admin,"invalid")).status,400);assert.equal((await reset(data,admin,id(999))).status,404);assert.equal(writes().length,0);
  tables.get("customers")[0].status="BLOCKED";assert.equal((await reset()).status,200);assert.equal(tables.get("customers")[0].status,"BLOCKED");assert.equal((await signIn()).response.status,403);
});
test("A reset racing an old-password login cannot issue a valid new-version session",async()=>{
  let injected=false;
  setExecutionHook(({cql})=>{
    if(!injected && cql.startsWith("SELECT full_name, email, status, password_version")){
      injected=true;tables.get("customers")[0].password_version="changed-during-login";
    }
  });
  const result=await signIn(oldPassword);assert.equal(result.response.status,401);assert.equal(result.token,undefined);assert.equal(writes().length,0);
});
test("A failed credential write returns an error and can be retried without altering account identity",async()=>{
  const original=console.error;console.error=()=>{};
  try{
    setFault({match:({cql})=>cql.startsWith("UPDATE customers SET password"),remaining:1,when:"before"});assert.equal((await reset()).status,500);assert.equal(tables.get("customers")[0].password,hash);
    assert.equal((await reset()).status,200);assert.equal(tables.get("customers").length,2);assert.equal((await signIn()).response.status,200);
  }finally{console.error=original}
});
