import cassandra from "cassandra-driver";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const keyspace = process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe";
const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || "127.0.0.1")
  .split(",")
  .map((point) => point.trim())
  .filter(Boolean);
const client = new cassandra.Client({
  contactPoints,
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || "datacenter1",
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) },
});

try {
  await client.connect();
  const result = await client.execute(
    "SELECT table_name, column_name, kind, position, type, clustering_order FROM system_schema.columns WHERE keyspace_name = ?",
    [keyspace],
    { prepare: true },
  );

  if (result.rowLength === 0) {
    throw new Error(`Keyspace '${keyspace}' was not found or has no visible tables.`);
  }

  const tables = new Map();
  for (const row of result.rows) {
    const table = tables.get(row.table_name) || [];
    table.push({
      column: row.column_name,
      type: row.type,
      kind: row.kind,
      position: row.position,
      clusteringOrder: row.clustering_order,
    });
    tables.set(row.table_name, table);
  }

  const lines = [
    `# Cassandra schema: ${keyspace}`,
    "",
    `Đọc trực tiếp từ system_schema.columns vào ${new Date().toISOString()}. Đây là metadata của Cassandra đang chạy, không chỉ là suy luận từ CQL.`,
    "",
    `Số bảng được phát hiện: **${tables.size}**. Không có thao tác DDL hoặc thay đổi dữ liệu.`,
    "",
  ];

  for (const [tableName, columns] of [...tables].sort(([left], [right]) => left.localeCompare(right))) {
    const partitionKeys = columns
      .filter((column) => column.kind === "partition_key")
      .sort((left, right) => left.position - right.position);
    const clusteringKeys = columns
      .filter((column) => column.kind === "clustering")
      .sort((left, right) => left.position - right.position);
    const partition = partitionKeys.map((column) => `\`${column.column}\``);
    const clustering = clusteringKeys.map((column) => `\`${column.column}\``);
    const primaryKey = clustering.length
      ? `PRIMARY KEY (${partition.length > 1 ? `(${partition.join(", ")})` : partition[0]}, ${clustering.join(", ")})`
      : `PRIMARY KEY (${partition[0]})`;

    lines.push(`## \`${tableName}\``, "", `**${primaryKey}**`, "", "| Column | Type | Role | Position / order |", "|---|---|---|---|");
    for (const column of columns.sort((left, right) => {
      const roleOrder = { partition_key: 0, clustering: 1, regular: 2, static: 3 };
      return roleOrder[left.kind] - roleOrder[right.kind]
        || left.position - right.position
        || left.column.localeCompare(right.column);
    })) {
      const detail = column.kind === "clustering"
        ? `${column.position} / ${column.clusteringOrder}`
        : column.kind === "regular"
          ? "-"
          : String(column.position);
      lines.push(`| \`${column.column}\` | \`${column.type}\` | ${column.kind} | ${detail} |`);
    }
    lines.push("");
  }

  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const docsDirectory = `${projectRoot}docs`;
  await mkdir(docsDirectory, { recursive: true });
  await writeFile(`${docsDirectory}/CASSANDRA_SCHEMA.md`, `${lines.join("\n")}\n`, "utf8");
  console.log(`Read ${tables.size} tables from ${keyspace}; wrote docs/CASSANDRA_SCHEMA.md.`);
} finally {
  await client.shutdown();
}