import "./ui-transport.mjs";
import { tables } from "./support/cassandra.mjs";
import { backupSchemaRows } from "./support/backup-schema.mjs";

const schema = backupSchemaRows(process.env.CASSANDRA_KEYSPACE);
tables.set("system_schema.columns", schema);
// Mirror SELECT * from real Cassandra: projections expose only schema columns.
for (const table of new Set(schema.map(column => column.table_name))) {
  const names = new Set(schema.filter(column => column.table_name === table).map(column => column.column_name));
  tables.set(table, (tables.get(table) || []).map(row => Object.fromEntries(Object.entries(row).filter(([name]) => names.has(name)))));
}
