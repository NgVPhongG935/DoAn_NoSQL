import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import cassandra from "cassandra-driver";

const root = fileURLToPath(new URL("../", import.meta.url));
createRequire(import.meta.url)("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });
const keyspace = process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe";
const client = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || "127.0.0.1").split(",").map(value => value.trim()).filter(Boolean),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || "datacenter1",
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) }, keyspace,
});
try {
  const result = await client.execute("SELECT column_name, type FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?", [keyspace, "customers"], { prepare: true });
  const existing = result.rows.find(row => row.column_name === "password_version");
  if (existing && existing.type !== "text") throw new Error("customers.password_version exists with an unexpected type.");
  if (!existing) {
    await client.execute("ALTER TABLE customers ADD password_version text");
    console.log("Added customers.password_version (text). No customer passwords or records changed.");
  } else console.log("customers.password_version already exists. No changes required.");
} finally { await client.shutdown(); }
