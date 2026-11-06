import { readFileSync } from "node:fs";

// Use the documented project schema for the in-memory Cassandra transport.
export function backupSchemaRows(keyspace = "dat_xe_cong_nghe") {
  let table = "";
  const rows = [];
  for (const line of readFileSync(new URL("../../docs/CASSANDRA_SCHEMA.md", import.meta.url), "utf8").split(/\r?\n/)) {
    const heading = line.match(/^## `([^`]+)`/);
    if (heading) table = heading[1];
    const column = line.match(/^\| `([^`]+)` \| `([^`]+)` \| (\w+) \| ([^|]+) \|/);
    if (column) rows.push({ keyspace_name: keyspace, table_name: table, column_name: column[1], type: column[2], kind: column[3], position: Number.parseInt(column[4]) || 0, clustering_order: column[4].includes("desc") ? "desc" : "asc" });
  }
  if (!rows.some(row => row.table_name === "customers" && row.column_name === "password_version")) rows.push({ keyspace_name: keyspace, table_name: "customers", column_name: "password_version", type: "text", kind: "regular", position: -1, clustering_order: "none" });
  return rows;
}
