import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { GET, POST } from "../src/app/api/admin/backup/route.ts";
import { createSession } from "../src/lib/auth.ts";
import { withCookies } from "./support/cookies.mjs";
import { resetTables, tables, writes, setFault } from "./support/cassandra.mjs";
import { backupSchemaRows } from "./support/backup-schema.mjs";
import { BACKUP_TABLES, backupCql, parseBackup, splitCql, MAX_BACKUP_BYTES } from "../src/lib/backup-format.ts";
import { backupHash, backupSchema } from "../src/services/admin-backup.ts";

const keyspace="dat_xe_cong_nghe", c="91000000-0000-4000-8000-000000000001", c2="91000000-0000-4000-8000-000000000002";
const admin={userId:"admin-demo",role:"ADMIN",name:"Admin",email:"backup-admin@test.invalid"};
const customer={userId:c,role:"CUSTOMER",name:"Khách",email:"backup-customer@test.invalid"};
const original={customer_id:c,full_name:"Tên gốc",email:customer.email,status:"ACTIVE",created_at:"2026-11-06T00:00:00.000Z"};
beforeEach(async()=>{
  process.env.JWT_SECRET=randomBytes(48).toString("base64url");process.env.ADMIN_EMAIL=admin.email;process.env.ADMIN_PASSWORD_HASH=`scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
  process.env.CASSANDRA_KEYSPACE=keyspace;process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED="false";
  process.env.RIDEFLOW_BACKUP_DIR=await mkdtemp(path.resolve(".tmp","backup-unit-"));
  resetTables(Object.fromEntries(BACKUP_TABLES.map(table=>[table,[]])));
  tables.set("system_schema.columns",backupSchemaRows(keyspace));
  tables.set("customers",[{...original},{...original,customer_id:c2,email:"other@test.invalid",full_name:"Giữ lại"}]);
});
async function invoke(method="GET",query="",text="",actor=admin,headers={}){
  const token=actor?await withCookies(undefined,async store=>{await createSession(actor);return store.get("rideflow_session").value;}):undefined;
  const request=new Request(`http://localhost/api/admin/backup${query}`,{method,...(method==="POST"?{body:text,headers:{"Content-Type":"text/plain",...headers}}:{})});
  return withCookies(token,()=>method==="GET"?GET(request):POST(request));
}
const json=rows=>JSON.stringify({keyspace,tables:[{name:"customers",rows}]});
const restoreHeaders=text=>({"X-Restore-Confirm":"RESTORE","X-Backup-Hash":backupHash(text),"Idempotency-Key":randomUUID()});

test("Backup downloads all 19 tables as JSON/CQL with private attachment headers",async()=>{
  const response=await invoke();assert.equal(response.status,200);assert.match(response.headers.get("Content-Disposition"),/attachment.*\.json/);assert.match(response.headers.get("Cache-Control"),/no-store/);
  const backup=await response.json();assert.equal(backup.tableCount,19);assert.equal(backup.totalRows,2);assert.equal(backup.tables.find(table=>table.name==="customers").rows[0].full_name,"Tên gốc");
  const cql=await (await invoke("GET","?format=cql")).text();assert.match(cql,/CREATE KEYSPACE/);assert.match(cql,/CREATE TABLE/);assert.match(cql,/INSERT INTO "customers"/);
  const plan=parseBackup(cql,"cql",await backupSchema(),keyspace);assert.equal(plan.totalRows,2);assert.equal(plan.tables.length,19);assert.equal(writes().length,0);
});
test("JSON preview is read-only, compatible with older backups, and reports actual table sizes",async()=>{
  const text=json([{...original,full_name:"Tên mới"}]);const response=await invoke("POST","?action=preview",text);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.data.totalRows,1);assert.deepEqual(body.data.tables,[{name:"customers",rows:1,currentRows:2}]);assert.equal(body.data.hash,backupHash(text));assert.equal(writes().length,0);
});
test("CQL round-trip preserves Vietnamese, quotes, commas, semicolons and comment markers in values",async()=>{
  const schema=await backupSchema(),row={...original,full_name:"Nguyễn O'Brien; -- /* x */ , Đà Nẵng"};
  const backup={format:"rideflow-cassandra-json",version:1,keyspace,createdAt:new Date().toISOString(),tableCount:1,totalRows:1,tables:[{name:"customers",columns:schema.find(t=>t.name==="customers").columns,rows:[row]}]};
  const text=backupCql(backup),plan=parseBackup(text,"cql",schema,keyspace);assert.deepEqual(plan.tables[0].rows,[row]);assert.equal(splitCql("-- comment\nSELECT 'a;b'; /* tail */").length,1);
  const response=await invoke("POST","?action=restore&format=cql&mode=merge",text,admin,restoreHeaders(text));assert.equal(response.status,200);assert.equal(tables.get("customers")[0].full_name,row.full_name);
});
test("A restore writes a readable safety backup, merges selected rows and is idempotent",async()=>{
  const text=json([{...original,full_name:"Đã khôi phục"}]),headers=restoreHeaders(text);
  const response=await invoke("POST","?action=restore&mode=merge",text,admin,headers);assert.equal(response.status,200);
  const result=(await response.json()).data;assert.equal(result.verified,true);assert.equal(tables.get("customers").length,2);assert.equal(tables.get("customers")[0].full_name,"Đã khôi phục");
  const safety=await (await invoke("GET",`?safety=${result.safetyBackup}`)).json();assert.equal(safety.tables.find(t=>t.name==="customers").rows[0].full_name,"Tên gốc");
  const writeCount=writes().length;assert.equal((await invoke("POST","?action=restore&mode=merge",text,admin,headers)).status,200);assert.equal(writes().length,writeCount);
  assert.equal(JSON.parse(await readFile(path.join(process.env.RIDEFLOW_BACKUP_DIR,result.safetyBackup),"utf8")).tableCount,19);
});
test("Replace clears only tables selected in the file and supports empty-table backups",async()=>{
  tables.set("vouchers",[{voucher_code:"KEEP",voucher_name:"Unrelated"}]);
  const text=json([]);const response=await invoke("POST","?action=restore&mode=replace",text,admin,restoreHeaders(text));assert.equal(response.status,200);
  assert.deepEqual(tables.get("customers"),[]);assert.equal(tables.get("vouchers").length,1);
});
for(const when of ["before","after"]){
  test(`Restore rolls back and verifies the original data after an ${when}-write failure`,async()=>{
    const text=json([{...original,full_name:"Chưa xác nhận"}]);
    setFault({match:({cql})=>cql.startsWith("INSERT INTO customers"),remaining:1,when});
    const response=await invoke("POST","?action=restore&mode=replace",text,admin,restoreHeaders(text));assert.equal(response.status,503);
    const body=await response.json();assert.ok(body.safetyBackup);assert.match(body.message,/Đã hoàn tác/);assert.equal(tables.get("customers").length,2);assert.equal(tables.get("customers")[0].full_name,"Tên gốc");
  });
}
test("All upload rows are validated before any database write",async()=>{
  const cases=[json([{...original,customer_id:"bad"}]),json([{full_name:"Missing key"}]),json([{...original,unknown_column:"x"}]),json([{...original,created_at:"not a date"}]),JSON.stringify({keyspace:"system",tables:[]}),JSON.stringify({keyspace,tables:[{name:"customers",rows:[original],sha256:"bad"}]}),"not json"];
  for(const text of cases){assert.equal((await invoke("POST","?action=restore&mode=replace",text,admin,restoreHeaders(text))).status,400);assert.equal(writes().length,0);}
});
test("CQL cannot inject commands, access other keyspaces or call functions",async()=>{
  for(const text of ["DROP KEYSPACE dat_xe_cong_nghe;","TRUNCATE customers;","USE system;","INSERT INTO system.local (key) VALUES ('x');",`INSERT INTO customers (customer_id, full_name) VALUES (${c}, uuid());`,`INSERT INTO customers (customer_id, full_name) VALUES (${c}, 'ok'); DROP TABLE drivers;`]){
    const response=await invoke("POST","?action=restore&format=cql&mode=merge",text,admin,restoreHeaders(text));assert.equal(response.status,400);assert.equal(writes().length,0);
  }
});
test("Restore requires preview hash, confirmation, correct origin and Admin access",async()=>{
  const text=json([original]);assert.equal((await invoke("POST","?action=restore&mode=merge",text)).status,400);
  assert.equal((await invoke("POST","?action=restore&mode=merge",text,admin,{...restoreHeaders(text),Origin:"https://other.invalid"})).status,403);
  for(const actor of [null,customer]){for(const method of ["GET","POST"]){assert.equal((await invoke(method,"?action=preview",text,actor)).status,actor?403:401);}}
  assert.equal(writes().length,0);
});
test("Oversized uploads and traversal filenames are rejected without writes",async()=>{
  assert.equal((await invoke("POST","?action=preview","{}",admin,{"Content-Length":String(MAX_BACKUP_BYTES+1)})).status,413);
  assert.equal((await invoke("GET","?safety=../../.env.local")).status,400);assert.equal(writes().length,0);
});
test("Preview accepts the actual request Host when Next normalizes the internal URL",async()=>{
  const response=await invoke("POST","?action=preview",json([original]),admin,{Host:"127.0.0.1",Origin:"http://127.0.0.1"});
  assert.equal(response.status,200);assert.equal(writes().length,0);
});
test("The current complete project CQL file validates without executing its schema or queries",async()=>{
  const text=await readFile(new URL("../DULIEU/NoSQL_DOAN.cql",import.meta.url),"utf8");
  const response=await invoke("POST","?action=preview&format=cql",text);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const body=await response.json();assert.equal(body.data.tableCount,19);assert.ok(body.data.totalRows>500);assert.equal(writes().length,0);
});
