import { createHash } from "node:crypto";
import cassandra from "cassandra-driver";
import { cassandraClient, jsonSafe } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";

const TABLE = "rideflow_business_journal";
const SCOPE = "rideflow-business-v1";
export type Value = string | number | boolean | null | { timestamp: string } | { date: string };
export type Statement = { cql: string; values: Value[] };
export type Plan<T = unknown> = { statements: Statement[]; result: T };
export type OperationContext = { operationId: string; at: string; timestamp: number };
type JournalRow = Record<string, unknown> & { operation_id: string; request_hash: string; state: string; plan_json: string; result_json: string };
const quorum = cassandra.types.consistencies.quorum;
const serial = cassandra.types.consistencies.serial;

export function businessJournalEnabled() { return process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED === "true"; }
export function requestHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function operationId(key: string): string { return requestHash(key); }
export function timestampValue(iso: string): Value { return { timestamp: iso }; }
export function dateValue(iso: string): Value { return { date: iso.slice(0, 10) }; }

function decode(value: Value) {
  if (value && typeof value === "object") {
    if ("timestamp" in value) return new Date(value.timestamp);
    return cassandra.types.LocalDate.fromString(value.date);
  }
  return value;
}

// A serial read finishes any ambiguous Paxos proposal before returning state.
async function journalQuery(cql: string, values: unknown[] = [], conditional = false) {
  const result = await cassandraClient.execute(cql, values, {
    prepare: true, consistency: conditional ? quorum : serial,
    serialConsistency: serial, isIdempotent: true,
  });
  return jsonSafe(result.rows) as Record<string, unknown>[];
}

export async function businessRead(cql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  let pageState: string | undefined;
  const rows: Record<string, unknown>[] = [];
  do {
    const result = await cassandraClient.execute(cql, values, { prepare: true, consistency: quorum, pageState, fetchSize: 500, isIdempotent: true });
    rows.push(...jsonSafe(result.rows) as Record<string, unknown>[]);
    pageState = result.pageState;
  } while (pageState);
  return rows;
}

async function readOperation(id: string) {
  return (await journalQuery(`SELECT * FROM ${TABLE} WHERE scope = ? AND operation_id = ?`, [SCOPE, id]))[0] as JournalRow | undefined;
}
async function control() {
  return (await journalQuery(`SELECT active_operation, last_timestamp FROM ${TABLE} WHERE scope = ? LIMIT 1`, [SCOPE]))[0];
}

export async function applyPreparedOperation(row: JournalRow): Promise<unknown> {
  if (row.state === "COMMITTED") return JSON.parse(row.result_json);
  if (row.state !== "PREPARED") throw new ApiError("Yêu cầu đang chờ kiểm tra dữ liệu. Vui lòng thử lại sau.", 503);
  const plan = JSON.parse(row.plan_json) as Plan;
  for (const statement of plan.statements) {
    // A second worker may already have finished this operation. Never replay a
    // committed operation, even when its client lost the original response.
    const current = await readOperation(row.operation_id);
    if (current?.state === "COMMITTED") return JSON.parse(current.result_json);
    if (current?.state !== "PREPARED" || (await control())?.active_operation !== row.operation_id) {
      throw new ApiError("Không thể xác minh yêu cầu đang xử lý. Vui lòng thử lại.", 503);
    }
    await cassandraClient.execute(statement.cql, statement.values.map(decode), {
      prepare: true, consistency: quorum, isIdempotent: true,
    });
  }
  // Conditional batch stays within ONE journal partition. Business projections
  // were written separately and are not an isolated multi-partition transaction.
  await journalQuery(`BEGIN BATCH
    UPDATE ${TABLE} SET state = ? WHERE scope = ? AND operation_id = ? IF state = ?;
    UPDATE ${TABLE} SET active_operation = null WHERE scope = ? IF active_operation = ?;
    APPLY BATCH`, ["COMMITTED", SCOPE, row.operation_id, "PREPARED", SCOPE, row.operation_id], true);
  const completed = await readOperation(row.operation_id);
  if (completed?.state !== "COMMITTED") throw new ApiError("Yêu cầu đã ghi dữ liệu và đang chờ xác nhận. Hãy thử lại cùng yêu cầu.", 503);
  return JSON.parse(completed.result_json);
}

export async function recoverPendingOperation() {
  const state = await control();
  if (!state?.active_operation) return false;
  const row = await readOperation(String(state.active_operation));
  if (!row) throw new ApiError("Nhật ký nghiệp vụ cần được kiểm tra trước khi tiếp tục.", 503);
  await applyPreparedOperation(row);
  return true;
}

export async function withBusinessRead<T>(read: () => Promise<T>): Promise<T> {
  if (!businessJournalEnabled()) return read();
  const before = await control();
  if (before?.active_operation) throw new ApiError("Dữ liệu đang được cập nhật. Vui lòng thử lại sau ít giây.", 503);
  const result = await read();
  const after = await control();
  if (after?.active_operation || String(before?.last_timestamp ?? "") !== String(after?.last_timestamp ?? "")) {
    throw new ApiError("Dữ liệu vừa thay đổi. Vui lòng thử tải lại.", 503);
  }
  return result;
}

export async function runBusinessOperation<T>(
  kind: string, key: string, request: unknown, prepare: (context: OperationContext) => Promise<Plan<T>>,
): Promise<T> {
  if (!businessJournalEnabled()) throw new ApiError("Chức năng đang chờ cấu hình lưu trữ nghiệp vụ. Vui lòng thử lại sau.", 503);
  const id = operationId(key);
  const hash = requestHash({ kind, request });
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      const previous = await readOperation(id);
      if (previous) {
        if (previous.request_hash !== hash) throw new ApiError("Mã yêu cầu đã được sử dụng với nội dung khác.", 409);
        return await applyPreparedOperation(previous) as T;
      }
      const state = await control();
      if (state?.active_operation) { await recoverPendingOperation(); continue; }
      const previousTimestamp = state?.last_timestamp == null ? null : Number(state.last_timestamp);
      const stamp = Math.max(Date.now() * 1000, (previousTimestamp ?? 0) + 1000);
      const context = { operationId: id, timestamp: stamp, at: new Date(Math.floor(stamp / 1000)).toISOString() };
      let plan: Plan<T>;
      try { plan = await prepare(context); }
      catch (error) {
        // A validation based on a snapshot raced another operation. Re-read it;
        // never report a stale conflict as the result of this request.
        const after = await control();
        if (after?.active_operation || Number(after?.last_timestamp ?? 0) !== Number(previousTimestamp ?? 0)) continue;
        throw error;
      }
      const resultJson = JSON.stringify(plan.result);
      const planJson = JSON.stringify(plan);
      if (Buffer.byteLength(planJson) > 512_000) throw new ApiError("Yêu cầu vượt giới hạn xử lý an toàn.", 413);
      const applied = await journalQuery(`BEGIN BATCH
        UPDATE ${TABLE} SET active_operation = ?, last_timestamp = ? WHERE scope = ? IF active_operation = null AND last_timestamp = ?;
        INSERT INTO ${TABLE} (scope, operation_id, request_hash, kind, plan_json, result_json, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS;
        APPLY BATCH`, [id, stamp, SCOPE, previousTimestamp, SCOPE, id, hash, kind, planJson, resultJson, "PREPARED", new Date(context.at)], true);
      if (applied[0]?.["[applied]"]) {
        const stored = await readOperation(id);
        if (!stored) throw new Error("Journal operation missing after acquisition");
        return await applyPreparedOperation(stored) as T;
      }
    }
    throw new ApiError("Hệ thống đang xử lý yêu cầu khác. Hãy thử lại cùng mã yêu cầu.", 503);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("RideFlow business journal unavailable:", error);
    // Applied-but-timed-out writes retain their plan. Never release a driver or
    // decrement/refund a voucher outside the durable replay sequence.
    throw new ApiError("Chưa thể xác nhận hoàn tất. Vui lòng thử lại cùng yêu cầu; hệ thống sẽ tiếp tục xử lý mà không tạo bản ghi trùng.", 503);
  }
}

const BUSINESS_TABLES = new Set([
  "drivers", "vehicles", "customers", "service_types", "vouchers", "customer_vouchers", "trips_by_id", "trips_by_customer", "trips_by_driver",
  "trips_by_status", "trip_status_history", "payments_by_trip", "payments_by_customer", "driver_revenue_by_month", "customer_spending_by_month",
  "reviews_by_trip", "reviews_by_driver", "notifications_by_user",
]);
function tableName(table: string) {
  if (!BUSINESS_TABLES.has(table)) throw new Error("Unsupported business table");
  return table;
}
function columns(record: Record<string, Value>) {
  const names = Object.keys(record);
  if (names.some((name) => !/^[a-z_]+$/.test(name))) throw new Error("Unsupported business column");
  return names;
}
export function insertStatement(table: string, record: Record<string, Value>, timestamp: number): Statement {
  const names = columns(record);
  return { cql: `INSERT INTO ${tableName(table)} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) USING TIMESTAMP ?`, values: [...Object.values(record), timestamp] };
}
export function updateStatement(table: string, fields: Record<string, Value>, keys: Record<string, Value>, timestamp: number): Statement {
  return { cql: `UPDATE ${tableName(table)} USING TIMESTAMP ? SET ${columns(fields).map((name) => `${name} = ?`).join(", ")} WHERE ${columns(keys).map((name) => `${name} = ?`).join(" AND ")}`, values: [timestamp, ...Object.values(fields), ...Object.values(keys)] };
}
export function deleteStatement(table: string, keys: Record<string, Value>, timestamp: number): Statement {
  return { cql: `DELETE FROM ${tableName(table)} USING TIMESTAMP ? WHERE ${columns(keys).map((name) => `${name} = ?`).join(" AND ")}`, values: [timestamp, ...Object.values(keys)] };
}
