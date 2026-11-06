import { ApiError } from "@/lib/http";

export const BACKUP_TABLES = ["customers", "drivers", "vehicles", "service_types", "trips_by_id", "trips_by_customer", "trips_by_driver", "trips_by_status", "trip_status_history", "payments_by_trip", "payments_by_customer", "reviews_by_trip", "reviews_by_driver", "vouchers", "customer_vouchers", "notifications_by_user", "complaints_by_customer", "driver_revenue_by_month", "customer_spending_by_month"] as const;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export type BackupRow = Record<string, unknown>;
export type BackupColumn = { column_name: string; type: string; kind: string; position: number; clustering_order?: string };
export type BackupTable = { name: string; columns: BackupColumn[]; rows: BackupRow[]; sha256?: string; rowCount?: number };
export type DatabaseBackup = { format: "rideflow-cassandra-json"; version: 1; keyspace: string; createdAt: string; tableCount: number; totalRows: number; tables: BackupTable[] };
export type RestorePlan = { tables: BackupTable[]; totalRows: number; ignoredStatements: number };
const identifier = '(?:"[a-z][a-z0-9_]*"|[a-z][a-z0-9_]*)';
const qualified = `${identifier}(?:\\s*\\.\\s*${identifier})?`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const numeric = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function invalid(message: string): never { throw new ApiError(message); }

// Split only outside quoted literals; a customer's text may contain ; , -- or ''.
export function splitCql(source: string, separator = ";", comments = true) {
  const parts: string[] = []; let current = "", quote = "", line = false, block = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (line) { if (char === "\n") { line = false; current += " "; } continue; }
    if (block) { if (char === "*" && next === "/") { block = false; index++; current += " "; } continue; }
    if (quote) {
      current += char;
      if (char === quote) { if (next === quote) { current += next; index++; } else quote = ""; }
      continue;
    }
    if (comments && ((char === "-" && next === "-") || (char === "/" && next === "/"))) { line = true; index++; continue; }
    if (comments && char === "/" && next === "*") { block = true; index++; continue; }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === separator) { if (current.trim()) parts.push(current.trim()); current = ""; }
    else current += char;
  }
  if (quote || block) invalid("File CQL có chuỗi hoặc chú thích chưa đóng.");
  if (current.trim()) parts.push(current.trim());
  if (parts.length > 100000) invalid("File có quá nhiều câu lệnh.");
  return parts;
}
function target(value: string, keyspace: string, allowUnknown = false) {
  const names = value.split(/\s*\.\s*/).map(name => name.replaceAll('"', ""));
  if (names.length === 2 && names[0] !== keyspace) invalid("File trỏ đến keyspace khác với ứng dụng.");
  const name = names.at(-1)!;
  if (!allowUnknown && !(BACKUP_TABLES as readonly string[]).includes(name)) invalid(`Bảng không được phép khôi phục: ${name}.`);
  return name;
}
function literal(value: string): unknown {
  if (/^null$/i.test(value)) return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  if (numeric.test(value) || uuid.test(value)) return value;
  return invalid("CQL chỉ nhận giá trị cụ thể; không hỗ trợ hàm, batch, TTL hoặc biểu thức.");
}
function valueValid(value: unknown, type: string) {
  if (value === null) return true;
  if (["text", "varchar", "ascii"].includes(type)) return typeof value === "string";
  if (["uuid", "timeuuid"].includes(type)) return typeof value === "string" && uuid.test(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "timestamp") return typeof value === "string" && /^\d{4}-\d\d-\d\d(?:[ T]|$)/.test(value) && Number.isFinite(Date.parse(value));
  if (type === "date") return typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (["int", "smallint", "tinyint"].includes(type)) {
    const number = Number(value), maximum = type === "int" ? 2147483647 : type === "smallint" ? 32767 : 127;
    return (typeof value === "number" || typeof value === "string" && /^-?\d+$/.test(value)) && Number.isInteger(number) && number >= -maximum - 1 && number <= maximum;
  }
  if (["decimal", "double", "float", "bigint", "varint"].includes(type)) return ["number", "string"].includes(typeof value) && numeric.test(String(value)) && Number.isFinite(Number(value));
  return false;
}

export function parseBackup(text: string, format: "json" | "cql", schema: BackupTable[], keyspace: string): RestorePlan {
  const source = text.replace(/^\uFEFF/, "");
  const selected = new Map<string, BackupRow[]>(); let ignoredStatements = 0, sourceRows = 0;
  const add = (name: string, rows: BackupRow[]) => {
    sourceRows += rows.length;
    if (sourceRows > 100000) invalid("Mỗi lần khôi phục tối đa 100.000 bản ghi.");
    const existing = selected.get(name) || []; existing.push(...rows); selected.set(name, existing);
  };
  if (format === "json") {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(source); } catch { return invalid("File JSON không hợp lệ."); }
    if (!parsed || parsed.keyspace !== keyspace || !Array.isArray(parsed.tables) || parsed.version !== undefined && parsed.version !== 1) invalid("File JSON phải là backup RideFlow và đúng keyspace hiện tại.");
    for (const item of parsed.tables as Record<string, unknown>[]) {
      if (!item || typeof item.name !== "string" || !Array.isArray(item.rows)) invalid("Cấu trúc bảng trong backup không hợp lệ.");
      const name = target(String(item.name), keyspace);
      if (selected.has(name)) invalid(`Bảng ${name} xuất hiện nhiều lần trong JSON.`);
      if (item.rowCount !== undefined && item.rowCount !== item.rows.length) invalid(`Số bản ghi của bảng ${name} không khớp.`);
      add(name, item.rows as BackupRow[]);
    }
  } else {
    for (const statement of splitCql(source)) {
      const use = statement.match(new RegExp(`^USE\\s+(${identifier})$`, "i"));
      if (use) { if (use[1].replaceAll('"', "") !== keyspace) invalid("File USE một keyspace khác với ứng dụng."); ignoredStatements++; continue; }
      const createKeyspace = statement.match(new RegExp(`^CREATE\\s+KEYSPACE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${identifier})\\s+WITH\\s`, "i"));
      if (createKeyspace) { if (createKeyspace[1].replaceAll('"', "") !== keyspace) invalid("File tạo một keyspace khác với ứng dụng."); ignoredStatements++; continue; }
      const createTable = statement.match(new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${qualified})\\s*\\(`, "i"));
      if (createTable) { const name = target(createTable[1], keyspace, true); if ((BACKUP_TABLES as readonly string[]).includes(name) && !selected.has(name)) add(name, []); ignoredStatements++; continue; }
      const select = statement.match(new RegExp(`^SELECT\\s+[\\s\\S]+?\\s+FROM\\s+(${qualified})(?:\\s|$)`, "i"));
      if (select) { target(select[1], keyspace, true); ignoredStatements++; continue; }
      const insert = statement.match(new RegExp(`^INSERT\\s+INTO\\s+(${qualified})\\s*\\(([^)]+)\\)\\s*VALUES\\s*\\(([\\s\\S]*)\\)$`, "i"));
      if (!insert) invalid("CQL chỉ hỗ trợ CREATE/USE, INSERT ... VALUES và SELECT. Không nhận DROP, TRUNCATE, UPDATE hoặc lệnh tùy ý.");
      const name = target(insert[1], keyspace);
      const columns = splitCql(insert[2], ",", false).map(column => column.replaceAll('"', ""));
      const values = splitCql(insert[3], ",", false).map(literal);
      if (new Set(columns).size !== columns.length || columns.length !== values.length || columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column))) invalid(`Danh sách cột/giá trị của ${name} không hợp lệ.`);
      add(name, [Object.fromEntries(columns.map((column, index) => [column, values[index]]))]);
    }
  }
  if (!selected.size) invalid("File không có bảng dữ liệu để khôi phục.");
  const tables: BackupTable[] = []; let totalRows = 0;
  for (const [name, rows] of selected) {
    const table = schema.find(item => item.name === name);
    if (!table) invalid(`Bảng ${name} chưa tồn tại trong ứng dụng. Hãy tạo schema trước.`);
    const keys = table.columns.filter(column => ["partition_key", "clustering"].includes(column.kind));
    if (!keys.length) invalid(`Không đọc được khóa chính của bảng ${name}.`);
    const unique = new Map<string, BackupRow>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) invalid(`Dòng dữ liệu của ${name} không hợp lệ.`);
      for (const [columnName, value] of Object.entries(row)) {
        const column = table.columns.find(item => item.column_name === columnName);
        if (!column || !valueValid(value, column.type)) invalid(`Giá trị hoặc kiểu cột ${name}.${columnName} không hợp lệ.`);
      }
      if (keys.some(key => row[key.column_name] === null || row[key.column_name] === undefined)) invalid(`Thiếu khóa chính của bảng ${name}.`);
      const key = JSON.stringify(keys.map(column => row[column.column_name]));
      unique.set(key, { ...unique.get(key), ...row });
    }
    totalRows += unique.size;
    if (totalRows > 100000) invalid("Mỗi lần khôi phục tối đa 100.000 bản ghi.");
    tables.push({ name, columns: table.columns, rows: [...unique.values()] });
  }
  return { tables, totalRows, ignoredStatements };
}

export function backupCql(backup: DatabaseBackup) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const encode = (value: unknown, type: string): string => {
    if (value === null || value === undefined) return "null";
    return ["text", "varchar", "ascii", "date", "timestamp"].includes(type) ? `'${String(value).replaceAll("'", "''")}'` : String(value);
  };
  const statements = [`-- RideFlow backup ${backup.createdAt}\n-- UTF-8; ${backup.tableCount} tables, ${backup.totalRows} rows.`, `CREATE KEYSPACE IF NOT EXISTS ${quote(backup.keyspace)} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '1'};`, `USE ${quote(backup.keyspace)};`];
  for (const table of backup.tables) {
    const partition = table.columns.filter(column => column.kind === "partition_key").sort((a, b) => a.position - b.position);
    const clustering = table.columns.filter(column => column.kind === "clustering").sort((a, b) => a.position - b.position);
    const partitionKey = partition.length === 1 ? quote(partition[0].column_name) : `(${partition.map(column => quote(column.column_name)).join(", ")})`;
    const order = clustering.length ? ` WITH CLUSTERING ORDER BY (${clustering.map(column => `${quote(column.column_name)} ${column.clustering_order === "desc" ? "DESC" : "ASC"}`).join(", ")})` : "";
    statements.push(`CREATE TABLE IF NOT EXISTS ${quote(table.name)} (${table.columns.map(column => `${quote(column.column_name)} ${column.type}`).join(", ")}, PRIMARY KEY (${[partitionKey, ...clustering.map(column => quote(column.column_name))].join(", ")}))${order};`);
    for (const row of table.rows) {
      const columns = table.columns.filter(column => Object.hasOwn(row, column.column_name));
      statements.push(`INSERT INTO ${quote(table.name)} (${columns.map(column => quote(column.column_name)).join(", ")}) VALUES (${columns.map(column => encode(row[column.column_name], column.type)).join(", ")});`);
    }
  }
  return statements.join("\n\n") + "\n";
}
