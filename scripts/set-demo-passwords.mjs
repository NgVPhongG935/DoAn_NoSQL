import cassandra from "cassandra-driver";

const keyspace = process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe";
if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(keyspace)) throw new Error("CASSANDRA_KEYSPACE không hợp lệ.");

const passwordHash = "scrypt$f9e282eaebaa6106c022f3aa16eab0c1$ef9ea05a3b034fafc22fa66e1059237ad98cfc67926953052a730e4ee2a4837fd89f0311e0e9d7a47d62c022cb552306f5cbc388b96e05aba96192e17b9fc423";
const client = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || "127.0.0.1").split(",").map((item) => item.trim()).filter(Boolean),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || "datacenter1",
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) },
  keyspace,
  queryOptions: { consistency: cassandra.types.consistencies.localOne },
});

try {
  await client.connect();
  const columns = await client.execute(
    "SELECT column_name FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
    [keyspace, "drivers"], { prepare: true },
  );
  if (!columns.rows.some((row) => row.column_name === "password")) {
    await client.execute(`ALTER TABLE ${keyspace}.drivers ADD password text`);
  }

  const [customers, drivers] = await Promise.all([
    client.execute("SELECT customer_id FROM customers"),
    client.execute("SELECT driver_id FROM drivers"),
  ]);
  for (const row of customers.rows) {
    await client.execute("UPDATE customers SET password = ? WHERE customer_id = ?", [passwordHash, row.customer_id], { prepare: true });
  }
  for (const row of drivers.rows) {
    await client.execute("UPDATE drivers SET password = ? WHERE driver_id = ?", [passwordHash, row.driver_id], { prepare: true });
  }
  console.log(`Đã đặt mật khẩu demo cho ${customers.rowLength} khách hàng và ${drivers.rowLength} tài xế.`);
} finally {
  await client.shutdown();
}
