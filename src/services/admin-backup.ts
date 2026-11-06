import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cassandra from "cassandra-driver";
import { cassandraClient, jsonSafe, queryAll } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";
import { businessJournalEnabled, withBusinessRead } from "@/lib/business-journal";
import { withDemoMaintenance } from "@/lib/demo-mutation";
import { BACKUP_TABLES, backupCql, parseBackup, type BackupRow, type BackupColumn, type BackupTable, type DatabaseBackup, type RestorePlan } from "@/lib/backup-format";

const allowed = new Set<string>(BACKUP_TABLES);
const supportedTypes = new Set(["uuid", "timeuuid", "text", "varchar", "ascii", "timestamp", "date", "decimal", "double", "float", "int", "smallint", "tinyint", "boolean"]);
export const backupHash = (text: string) => createHash("sha256").update(text).digest("hex");
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const digest = (rows: BackupRow[]) => backupHash(JSON.stringify(rows.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
const directory = () => path.resolve(process.env.RIDEFLOW_BACKUP_DIR || path.join(process.cwd(), ".backups"));
function keyspace() {
  const value = process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe";
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(value)) throw new ApiError("Tên keyspace không hợp lệ.", 500);
  return value;
}
export async function backupSchema(): Promise<BackupTable[]> {
  const columns = await queryAll("SELECT * FROM system_schema.columns WHERE keyspace_name = ?", [keyspace()]);
  const tables = BACKUP_TABLES.filter(name => columns.some(column => column.table_name === name)).map(name => ({
    name, rows: [], columns: columns.filter(column => column.table_name === name).map(column => ({ column_name: String(column.column_name), type: String(column.type), kind: String(column.kind), position: Number(column.position), clustering_order: String(column.clustering_order || "asc") })).sort((a, b) => a.column_name.localeCompare(b.column_name)),
  }));
  if (tables.length !== BACKUP_TABLES.length) throw new ApiError("Cấu trúc Cassandra chưa đủ 19 bảng của ứng dụng.", 409);
  if (tables.some(table => table.columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column.column_name) || !supportedTypes.has(column.type)) || !table.columns.some(column => column.kind === "partition_key"))) throw new ApiError("Schema có kiểu cột chưa được hỗ trợ sao lưu/khôi phục.", 409);
  return tables;
}
async function snapshot(): Promise<DatabaseBackup> {
  const tables = await backupSchema();
  for (const table of tables) {
    table.rows = await queryAll(`SELECT * FROM ${table.name}`);
    table.sha256 = digest(table.rows); table.rowCount = table.rows.length;
  }
  for (const table of tables) {
    if (digest(await queryAll(`SELECT * FROM ${table.name}`)) !== table.sha256) throw new ApiError("Dữ liệu vừa thay đổi trong lúc sao lưu. Vui lòng thử lại.", 409);
  }
  return { format: "rideflow-cassandra-json", version: 1, keyspace: keyspace(), createdAt: new Date().toISOString(), tableCount: tables.length, totalRows: tables.reduce((sum, table) => sum + table.rows.length, 0), tables };
}
export async function exportBackup(format: "json" | "cql") {
  const backup = await withDemoMaintenance(() => withBusinessRead(snapshot));
  return { text: format === "cql" ? backupCql(backup) : JSON.stringify(backup, null, 2), filename: `RideFlow_${backup.createdAt.replace(/[:.]/g, "-")}.${format}` };
}
export async function prepareRestore(text: string, format: "json" | "cql") {
  if (businessJournalEnabled()) throw new ApiError("Khôi phục trên web chưa hỗ trợ chế độ nhật ký nghiệp vụ. Hãy dùng môi trường khôi phục riêng.", 409);
  const schema = await backupSchema();
  const plan = parseBackup(text, format, schema, keyspace());
  if (format === "json") {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    for (const table of parsed.tables) if (table.sha256 && table.sha256 !== digest(table.rows)) throw new ApiError(`Dữ liệu bảng ${table.name} không khớp mã kiểm tra SHA-256.`);
  }
  return plan;
}
export async function previewRestore(text: string, format: "json" | "cql") {
  const plan = await prepareRestore(text, format);
  const tables = await Promise.all(plan.tables.map(async table => ({ name: table.name, rows: table.rows.length, currentRows: (await queryAll(`SELECT * FROM ${table.name}`)).length })));
  return { hash: backupHash(text), keyspace: keyspace(), tableCount: tables.length, totalRows: plan.totalRows, ignoredStatements: plan.ignoredStatements, tables };
}
export class RestoreFailure extends ApiError {
  constructor(message: string, readonly safetyBackup: string) { super(message, 503); }
}
function decoded(value: unknown, type: string) {
  if (value === null) return null;
  if (type === "timestamp") {
    const input = String(value);
    return new Date(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(input) ? input.replace(" ", "T") + "Z" : input);
  }
  if (type === "date") return cassandra.types.LocalDate.fromString(String(value));
  if (["int", "smallint", "tinyint", "double", "float"].includes(type)) return Number(value);
  return value;
}
async function writeTables(tables: BackupTable[], replace: boolean) {
  for (const table of tables) {
    if (!allowed.has(table.name)) throw new ApiError("Bảng khôi phục không hợp lệ.");
    if (replace) await cassandraClient.execute(`TRUNCATE ${table.name}`);
    for (const row of table.rows) {
      const columns = table.columns.filter(column => Object.hasOwn(row, column.column_name));
      await cassandraClient.execute(`INSERT INTO ${table.name} (${columns.map(column => column.column_name).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map(column => decoded(row[column.column_name], column.type)), { prepare: true, isIdempotent: true });
    }
  }
}
function sameValue(a: unknown, b: unknown, column: BackupColumn) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  const left = jsonSafe(decoded(a, column.type)), right = jsonSafe(decoded(b, column.type));
  if (String(left) === String(right)) return true;
  return column.type === "decimal" && cassandra.types.BigDecimal.fromString(String(left)).equals(cassandra.types.BigDecimal.fromString(String(right)));
}
async function verify(plan: RestorePlan, replace: boolean) {
  for (const table of plan.tables) {
    const rows = await queryAll(`SELECT * FROM ${table.name}`);
    if (replace && rows.length !== table.rows.length) throw new Error("Restore row count mismatch");
    const keys = table.columns.filter(column => ["partition_key", "clustering"].includes(column.kind));
    for (const wanted of table.rows) {
      const actual = rows.find(row => keys.every(column => sameValue(row[column.column_name], wanted[column.column_name], column)));
      if (!actual || table.columns.some(column => Object.hasOwn(wanted, column.column_name) && !sameValue(actual[column.column_name], wanted[column.column_name], column))) throw new Error("Restore row verification failed");
    }
  }
}
type Result = { tableCount: number; totalRows: number; safetyBackup: string; mode: "merge" | "replace"; verified: boolean };
const shared = globalThis as typeof globalThis & { rideflowRestoreResults?: Map<string, { fingerprint: string; result: Result }> };
const completed = shared.rideflowRestoreResults ??= new Map();
export async function restoreBackup(text: string, format: "json" | "cql", mode: "merge" | "replace", requestKey: string) {
  const fingerprint = backupHash(`${mode}:${format}:${text}`);
  // Validate the entire upload before taking the write queue or touching data.
  const plan = await prepareRestore(text, format);
  return withDemoMaintenance(async () => {
    const previous = completed.get(requestKey);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new ApiError("Mã yêu cầu khôi phục đã được dùng cho file khác.", 409); return previous.result; }
    const before = await snapshot();
    const safetyBackup = `before_restore_${Date.now()}_${randomBytes(6).toString("hex")}.json`;
    await mkdir(directory(), { recursive: true });
    await writeFile(path.join(directory(), safetyBackup), JSON.stringify(before, null, 2), { encoding: "utf8", flag: "wx" });
    try {
      await writeTables(plan.tables, mode === "replace");
      await verify(plan, mode === "replace");
    } catch {
      try {
        const rollback = before.tables.filter(table => plan.tables.some(selected => selected.name === table.name));
        await writeTables(rollback, true);
        await verify({ tables: rollback, totalRows: rollback.reduce((sum, table) => sum + table.rows.length, 0), ignoredStatements: 0 }, true);
      } catch { throw new RestoreFailure("Khôi phục bị gián đoạn, chưa thể hoàn tác đầy đủ. Tải bản sao trước khôi phục và kiểm tra Cassandra trước khi tiếp tục.", safetyBackup); }
      throw new RestoreFailure("Khôi phục chưa thành công. Đã hoàn tác và kiểm tra lại dữ liệu ban đầu; bạn có thể thử lại.", safetyBackup);
    }
    const result: Result = { tableCount: plan.tables.length, totalRows: plan.totalRows, safetyBackup, mode, verified: true };
    completed.set(requestKey, { fingerprint, result });
    if (completed.size > 30) completed.delete(completed.keys().next().value!);
    return result;
  }, true);
}
export async function readSafetyBackup(name: string) {
  if (!/^before_restore_\d+_[a-f0-9]{12}\.json$/.test(name)) throw new ApiError("Tên bản sao không hợp lệ.");
  try { return await readFile(path.join(directory(), name), "utf8"); }
  catch { throw new ApiError("Không tìm thấy bản sao trước khôi phục.", 404); }
}
