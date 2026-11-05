import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cassandra from "cassandra-driver";
import { hasEncodingDamage, repairKnownVietnameseText } from "./lib/vietnamese-repairs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
createRequire(import.meta.url)("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });
const apply = process.argv.includes("--apply");
const keyspace = process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe";
const client = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || "127.0.0.1").split(",").map(value => value.trim()).filter(Boolean),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || "datacenter1",
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) }, keyspace,
});
const tables = new Set([
  "customers", "drivers", "vehicles", "service_types", "trips_by_id", "trips_by_customer", "trips_by_driver", "trips_by_status",
  "trip_status_history", "payments_by_trip", "payments_by_customer", "reviews_by_trip", "reviews_by_driver", "vouchers",
  "customer_vouchers", "complaints_by_customer", "notifications_by_user", "driver_revenue_by_month", "customer_spending_by_month",
]);
function plain(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    if (["Uuid", "TimeUuid", "BigDecimal", "LocalDate", "LocalTime", "Long"].includes(value.constructor?.name)) return value.toString();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, plain(value[key])]));
  }
  return value;
}
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

try {
  const settings = await client.execute("SELECT durable_writes FROM system_schema.keyspaces WHERE keyspace_name = ?", [keyspace], { prepare: true });
  const durableWrites = settings.rows[0]?.durable_writes === true;
  if (apply && !durableWrites) throw new Error("Enable durable_writes for this keyspace before applying text repairs so they survive a restart.");
  const schema = await client.execute("SELECT table_name, column_name, kind, position, type FROM system_schema.columns WHERE keyspace_name = ?", [keyspace], { prepare: true });
  const plans = [], unknown = [], snapshots = [], counts = {};
  for (const table of tables) {
    const columns = schema.rows.filter(row => row.table_name === table);
    if (!columns.length) throw new Error(`Missing expected table: ${table}`);
    const keys = columns.filter(row => ["partition_key", "clustering"].includes(row.kind)).sort((a, b) => (a.kind === "partition_key" ? 0 : 1) - (b.kind === "partition_key" ? 0 : 1) || a.position - b.position).map(row => row.column_name);
    const textColumns = columns.filter(row => ["text", "varchar", "ascii"].includes(row.type) && row.column_name !== "password").map(row => row.column_name);
    counts[table] = 0;
    for await (const row of client.stream(`SELECT * FROM ${table}`)) {
      counts[table]++;
      const expected = { ...row };
      for (const column of textColumns) {
        const before = row[column];
        if (!hasEncodingDamage(before)) continue;
        const after = repairKnownVietnameseText(before);
        if (after === before) { unknown.push({ table, keys: plain(Object.fromEntries(keys.map(key => [key, row[key]]))), column }); continue; }
        // Repairs may only touch the audited address/history text columns.
        if (!(["trips_by_id", "trips_by_customer", "trips_by_driver", "trips_by_status"].includes(table) && ["pickup_address", "destination_address"].includes(column)) && !(table === "trip_status_history" && column === "note")) {
          throw new Error(`Unexpected repair column: ${table}.${column}`);
        }
        expected[column] = after;
        plans.push({ table, column, keys, keyValues: keys.map(key => row[key]), before, after });
      }
      snapshots.push({ table, keys, keyValues: keys.map(key => row[key]), expectedHash: hash(plain(expected)) });
    }
  }
  if (unknown.length) throw new Error(`Unrecognized damaged text requires inspection: ${JSON.stringify(unknown)}`);
  const summary = { keyspace, durableWrites, scannedTables: tables.size, scannedRows: Object.values(counts).reduce((a, b) => a + b, 0), repairFields: plans.length,
    byTable: Object.fromEntries([...new Set(plans.map(plan => plan.table))].map(table => [table, plans.filter(plan => plan.table === table).length])) };
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...summary }));
  if (!apply || !plans.length) process.exitCode = 0;
  else {
    const backupDirectory = path.join(root, ".backups");
    await mkdir(backupDirectory, { recursive: true });
    const backup = path.join(backupDirectory, `vietnamese-text-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(backup, JSON.stringify({ createdAt: new Date().toISOString(), ...summary, changes: plans.map(plan => ({
      table: plan.table, column: plan.column, keys: plain(Object.fromEntries(plan.keys.map((key, index) => [key, plan.keyValues[index]]))), before: plan.before, after: plan.after,
    })) }, null, 2), { encoding: "utf8", flag: "wx" });
    console.log(`Backup: ${backup}`);
    for (const plan of plans) {
      const where = plan.keys.map(key => `${key} = ?`).join(" AND ");
      const current = await client.execute(`SELECT * FROM ${plan.table} WHERE ${where}`, plan.keyValues,
        { prepare: true, consistency: cassandra.types.consistencies.localOne });
      if (current.rows.length !== 1 || current.rows[0][plan.column] !== plan.before) {
        throw new Error(`Concurrent data change: ${plan.table}.${plan.column}. Backup retained; inspect before retrying.`);
      }
      // This is the existing one-node demo. Do not change its replication
      // settings just to perform maintenance. Write only this audited text
      // field, then verify all row contents against the pre-repair snapshot.
      await client.execute(`UPDATE ${plan.table} SET ${plan.column} = ? WHERE ${where}`,
        [plan.after, ...plan.keyValues], { prepare: true, consistency: cassandra.types.consistencies.localOne, isIdempotent: true });
    }
    // Verify every field of every scanned row, including unchanged business data.
    for (const snapshot of snapshots) {
      const result = await client.execute(`SELECT * FROM ${snapshot.table} WHERE ${snapshot.keys.map(key => `${key} = ?`).join(" AND ")}`, snapshot.keyValues, { prepare: true });
      if (result.rows.length !== 1 || hash(plain(result.rows[0])) !== snapshot.expectedHash) throw new Error(`Post-repair verification failed: ${snapshot.table}`);
    }
    for (const [table, count] of Object.entries(counts)) {
      let current = 0; for await (const _row of client.stream(`SELECT * FROM ${table}`)) current++;
      if (current !== count) throw new Error(`Row count changed during repair: ${table}`);
    }
    console.log(`Verified ${snapshots.length} rows: only ${plans.length} audited text fields changed; all row counts preserved.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await client.shutdown(); }
