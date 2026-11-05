import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile, readdir, readFile, cp, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import cassandra from 'cassandra-driver';

const root = fileURLToPath(new URL('../', import.meta.url));
createRequire(import.meta.url)('@next/env').loadEnvConfig(root, true, { info() {}, error() {} });
const source = process.env.CASSANDRA_KEYSPACE || 'dat_xe_cong_nghe';
if (!/^[a-z][a-z0-9_]{0,47}$/.test(source)) throw new Error('Unexpected source keyspace');
const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
const stamp = localTime.replace(/[^0-9]/g, '');
const suffix = randomBytes(3).toString('hex');
const name = `Backup_du_lieu_RideFlow_${stamp}_${suffix}`;
const output = path.resolve(root, '../Bai9', name);
const snapshotTag = `rideflow_nop_bai_${stamp}_${suffix}`;
const verificationKeyspace = `rf_backup_check_${Date.now()}_${randomBytes(4).toString('hex')}`;
const client = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1').split(',').map(s => s.trim()).filter(Boolean),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || 'datacenter1',
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) },
});
const q = name => `"${name.replaceAll('"', '""')}"`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
function normalize(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    if (['Uuid','TimeUuid','BigDecimal','LocalDate','LocalTime','Long'].includes(value.constructor?.name)) return value.toString();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  return value;
}
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = rows => sha(JSON.stringify(rows.map(normalize).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
async function all(cql, values = []) {
  const rows=[]; let pageState;
  do {
    const result=await client.execute(cql,values,{prepare:true,pageState,fetchSize:250,consistency:cassandra.types.consistencies.localOne});
    rows.push(...result.rows); pageState=result.pageState;
  } while(pageState);
  return rows;
}
function valueCql(value, type) {
  if (value === null || value === undefined) return 'null';
  if (['text','varchar','ascii','timestamp','date'].includes(type)) return literal(value);
  if (type === 'uuid' || type === 'timeuuid') {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value))) throw new Error('Invalid UUID');
    return String(value);
  }
  if (type === 'boolean') { if (typeof value !== 'boolean') throw new Error('Invalid boolean'); return String(value); }
  if (['int','bigint','smallint','tinyint','decimal','double','float','varint'].includes(type)) {
    const number=String(value);
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(number)) throw new Error(`Unsupported numeric value for ${type}`);
    return number;
  }
  throw new Error(`Unsupported CQL type: ${type}`);
}
function tableDdl(table, target) {
  const partition=table.columns.filter(c=>c.kind==='partition_key').sort((a,b)=>a.position-b.position);
  const clustering=table.columns.filter(c=>c.kind==='clustering').sort((a,b)=>a.position-b.position);
  const first=partition.length===1?q(partition[0].column_name):`(${partition.map(c=>q(c.column_name)).join(', ')})`;
  const primary=`PRIMARY KEY (${[first,...clustering.map(c=>q(c.column_name))].join(', ')})`;
  const order=clustering.length?`CLUSTERING ORDER BY (${clustering.map(c=>`${q(c.column_name)} ${c.clustering_order.toUpperCase()}`).join(', ')}) AND `:'';
  return `CREATE TABLE IF NOT EXISTS ${q(target)}.${q(table.name)} (\n  ${table.columns.map(c=>`${q(c.column_name)} ${c.type}`).join(',\n  ')},\n  ${primary}\n) WITH ${order}default_time_to_live = ${table.defaultTtl} AND gc_grace_seconds = ${table.gcGrace}`;
}
function inserts(table,target) {
  return table.rows.map(row=>`INSERT INTO ${q(target)}.${q(table.name)} (${table.columns.map(c=>q(c.column_name)).join(', ')}) VALUES (${table.columns.map(c=>valueCql(row[c.column_name],c.type)).join(', ')})`);
}
const createKeyspace = (target, guard=true) => `CREATE KEYSPACE ${guard?'IF NOT EXISTS ':''}${q(target)} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '1'} AND durable_writes = true`;
let temporaryCreated=false;
try {
  await mkdir(output);
  const keyspace=(await all('SELECT durable_writes, replication FROM system_schema.keyspaces WHERE keyspace_name = ?',[source]))[0];
  if (!keyspace) throw new Error('Source keyspace missing');
  const metadata=await all('SELECT table_name, id, default_time_to_live, gc_grace_seconds FROM system_schema.tables WHERE keyspace_name = ?',[source]);
  const columns=await all('SELECT table_name, column_name, type, kind, position, clustering_order FROM system_schema.columns WHERE keyspace_name = ?',[source]);
  if (metadata.length!==19) throw new Error(`Expected 19 project tables, found ${metadata.length}; inspect before exporting`);
  for (const systemTable of ['indexes','views','types','functions','aggregates']) {
    if ((await all(`SELECT * FROM system_schema.${systemTable} WHERE keyspace_name = ?`,[source])).length) throw new Error(`Additional schema objects found in ${systemTable}; include them before making a full backup`);
  }
  const tables=[];
  for (const row of metadata.sort((a,b)=>a.table_name.localeCompare(b.table_name))) {
    if (row.default_time_to_live!==0) throw new Error('TTL requires additional export handling');
    const table={name:row.table_name,id:String(row.id),defaultTtl:row.default_time_to_live,gcGrace:row.gc_grace_seconds,
      columns:columns.filter(c=>c.table_name===row.table_name).map(normalize).sort((a,b)=>a.column_name.localeCompare(b.column_name))};
    table.rows=(await all(`SELECT * FROM ${q(source)}.${q(table.name)}`)).map(normalize);
    table.rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    table.sha256=digest(table.rows); tables.push(table);
  }
  console.log(`Read ${tables.length} tables / ${tables.reduce((n,t)=>n+t.rows.length,0)} rows.`);
  const snapshot=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/create-assignment-snapshot.ps1'),'-Keyspace',source,'-Tag',snapshotTag],{windowsHide:true,encoding:'utf8'});
  if (snapshot.status!==0) throw new Error('Native snapshot failed: '+snapshot.stderr);
  for (const table of tables) {
    if (digest(await all(`SELECT * FROM ${q(source)}.${q(table.name)}`))!==table.sha256) throw new Error('Live data changed during export. Retry to capture a consistent backup.');
    const nativeSource=path.join('C:/apache-cassandra-3.11.17/data/data',source,`${table.name}-${table.id.replaceAll('-','')}`,'snapshots',snapshotTag);
    if (!(await stat(nativeSource)).isDirectory()) throw new Error(`Snapshot missing: ${table.name}`);
    await cp(nativeSource,path.join(output,'snapshot',source,`${table.name}-${table.id.replaceAll('-','')}`),{recursive:true,errorOnExist:true,force:false});
  }
  const header=`-- RideFlow: backup ${localTime} (Asia/Ho_Chi_Minh)\n-- Generated from the running database; UTF-8.\n-- Restore on a fresh database. Portable schema uses replication_factor=1.\n`;
  const schema=[createKeyspace(source),...tables.map(table=>tableDdl(table,source))].join(';\n\n')+';\n';
  const data=tables.flatMap(table=>inserts(table,source)).join(';\n')+';\n';
  await writeFile(path.join(output,'01_schema.cql'),header+schema,'utf8');
  await writeFile(path.join(output,'02_du_lieu.cql'),header+data,'utf8');
  await writeFile(path.join(output,'Khoi_phuc_day_du.cql'),header+schema+'\n'+data,'utf8');
  await writeFile(path.join(output,'du_lieu_day_du.json'),JSON.stringify({keyspace:source,tables},null,2),'utf8');
  const manifest={createdAt:new Date().toISOString(),createdAtVietnam:localTime,timeZone:'Asia/Ho_Chi_Minh',keyspace:source,
    originalKeyspaceOptions:normalize(keyspace),portableRestoreReplicationFactor:1,snapshotTag,
    tableCount:tables.length,totalRows:tables.reduce((n,t)=>n+t.rows.length,0),tables:tables.map(t=>({name:t.name,id:t.id,rows:t.rows.length,sha256:t.sha256,columns:t.columns})),
    verification:{temporaryKeyspace:verificationKeyspace,status:'pending'}};
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  await client.execute(createKeyspace(verificationKeyspace,false)); temporaryCreated=true;
  for (const table of tables) {
    await client.execute(tableDdl(table,verificationKeyspace));
    for (const statement of inserts(table,verificationKeyspace)) await client.execute(statement,[],{consistency:cassandra.types.consistencies.localOne,isIdempotent:true});
    const restored=await all(`SELECT * FROM ${q(verificationKeyspace)}.${q(table.name)}`);
    if (restored.length!==table.rows.length || digest(restored)!==table.sha256) throw new Error(`Restore data verification failed: ${table.name}`);
  }
  const restoredSchema=await all('SELECT table_name, column_name, type, kind, position, clustering_order FROM system_schema.columns WHERE keyspace_name = ?',[verificationKeyspace]);
  if (digest(restoredSchema)!==digest(columns)) throw new Error('Restored columns/keys/clustering order differ from the source');
  if (!/^rf_backup_check_\d+_[a-f0-9]{8}$/.test(verificationKeyspace) || verificationKeyspace===source) throw new Error('Unsafe temporary keyspace cleanup target');
  await client.execute(`DROP KEYSPACE ${q(verificationKeyspace)}`);temporaryCreated=false;
  manifest.verification={status:'passed',restoredTables:tables.length,restoredRows:manifest.totalRows,allRowHashesMatch:true,columnsAndKeysMatch:true,temporaryKeyspaceRemoved:true};
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  await writeFile(path.join(output,'HUONG_DAN_KHOI_PHUC.txt'),`BẢN SAO LƯU DỮ LIỆU RIDEFLOW\nThời điểm: ${localTime} (giờ Việt Nam)\nKeyspace: ${source}\nGồm ${tables.length} bảng, ${manifest.totalRows} bản ghi; có cột password_version mới.\n\nCÁCH KHÔI PHỤC ĐƠN GIẢN\n1. Giải nén file ZIP. Chuẩn bị Cassandra đang chạy trên máy khôi phục.\n2. Chỉ khôi phục vào môi trường trống. File dùng đúng tên keyspace ${source}; các INSERT có thể ghi đè bản ghi cùng khóa nếu môi trường đó đã có dữ liệu.\n3. Tại thư mục đã giải nén, chạy:\n   cqlsh 127.0.0.1 9042 --encoding=utf8 -f Khoi_phuc_day_du.cql\n   Hoặc dùng Query Editor có hỗ trợ chạy script CQL để chạy lần lượt 01_schema.cql rồi 02_du_lieu.cql.\n4. Ứng dụng trỏ CASSANDRA_KEYSPACE=${source}. Cấu trúc phục hồi gọn dùng replication_factor=1, phù hợp một node. Cấu hình gốc được ghi trong manifest.json.\n\nNỘI DUNG\n- Khoi_phuc_day_du.cql: một file chứa cấu trúc và toàn bộ INSERT dữ liệu thực tế.\n- 01_schema.cql / 02_du_lieu.cql: tách riêng cấu trúc và dữ liệu.\n- du_lieu_day_du.json: dữ liệu và metadata kiểu cột để đối chiếu.\n- snapshot/: bản sao SSTable gốc cùng schema.cql/manifest của từng bảng từ nodetool snapshot trên Cassandra 3.11.17; giữ nguyên cấu trúc thư mục. Phục hồi vật lý cần quy trình SSTable phù hợp phiên bản, vì vậy ưu tiên file CQL cho bài nộp và demo trên máy khác.\n- manifest.json: số dòng và SHA-256 theo từng bảng, kết quả thử phục hồi.\n- SHA256SUMS.txt: mã kiểm tra các file trong gói.\n\nĐÃ KIỂM TRA\nĐã chạy CREATE TABLE và các INSERT xuất ra trong một keyspace kiểm tra riêng, so sánh toàn bộ dòng dữ liệu bằng SHA-256, đối chiếu cột/khóa/thứ tự sắp xếp. Kết quả: ${tables.length}/${tables.length} bảng, ${manifest.totalRows}/${manifest.totalRows} bản ghi khớp; keyspace kiểm tra đã được xóa. Dữ liệu nguồn không bị cập nhật/xóa trong quá trình sao lưu.\n\nBản sao giữ mật khẩu tài khoản ở dạng băm như CSDL nguồn; không chứa .env.local, mật khẩu quản trị dạng rõ hoặc khóa JWT. Ảnh đại diện nằm ngoài Cassandra, thuộc phần mã nguồn/tệp ứng dụng, không thuộc gói backup dữ liệu này.\n`,'utf8');
  const checksums=[];
  async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else checksums.push(`${sha(await readFile(file))}  ${path.relative(output,file).replaceAll('\\','/')}`)}}
  await walk(output);
  await writeFile(path.join(output,'SHA256SUMS.txt'),checksums.sort().join('\n')+'\n','utf8');
  await writeFile(path.join(root,'.tmp/assignment-backup-result.json'),JSON.stringify({directory:output,name,...manifest,checksumFiles:checksums.length},null,2),'utf8');
  console.log(JSON.stringify({output,tables:manifest.tableCount,rows:manifest.totalRows,verification:manifest.verification,checksumFiles:checksums.length}));
} catch(error) { console.error(error.message);process.exitCode=1; }
finally {
  if(temporaryCreated && /^rf_backup_check_\d+_[a-f0-9]{8}$/.test(verificationKeyspace) && verificationKeyspace!==source){
    try{await client.execute(`DROP KEYSPACE ${q(verificationKeyspace)}`)}catch{console.error('Temporary restore keyspace retained for inspection: '+verificationKeyspace)}
  }
  await client.shutdown();
}
