import { randomUUID } from "node:crypto";

export const tables = new Map();
export const calls = [];
const controlRows = new Map();
const clocks = new Map();
const tombstones = new Map();
let fault = null;
let executionHook = null;
let forcedPageSize;
let lastAutoTimestamp = 0;
export function setPageSize(value) { forcedPageSize = value; }
export function setFault(value) { fault = value; }
export function setExecutionHook(value) { executionHook = value; }
export let unavailable = false;
export function setUnavailable(value) { unavailable = value; }
export function resetTables(seed = {}) {
  tables.clear();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, structuredClone(rows));
  calls.length = 0;
  const demo = globalThis.rideflowDemoWrites;
  if (demo) { demo.entries.clear(); demo.pending = undefined; demo.tail = Promise.resolve(); }
  unavailable = false;
  controlRows.clear(); clocks.clear(); tombstones.clear(); fault = null; executionHook = null; forcedPageSize = undefined;
  lastAutoTimestamp = 0;
}
const comparable = (value) => value instanceof Date ? value.toISOString() : String(value);
export function writes() { return calls.filter(({ cql }) => !cql.startsWith("SELECT ")); }
export function businessWrites() { return writes().filter(({ cql }) => !cql.includes("rideflow_business_journal")); }

const primaryKeys = {
  customers: ["customer_id"], drivers: ["driver_id"], vehicles: ["vehicle_id"], service_types: ["service_id"], vouchers: ["voucher_code"],
  customer_vouchers: ["customer_id", "voucher_code"], trips_by_id: ["trip_id"], trips_by_customer: ["customer_id", "booked_at", "trip_id"],
  trips_by_driver: ["driver_id", "booked_at", "trip_id"], trips_by_status: ["status", "trip_date", "booked_at", "trip_id"],
  trip_status_history: ["trip_id", "changed_at"], payments_by_trip: ["trip_id", "payment_id"], payments_by_customer: ["customer_id", "paid_at", "payment_id"],
  reviews_by_trip: ["trip_id"], reviews_by_driver: ["driver_id", "created_at", "review_id"],
  driver_revenue_by_month: ["driver_id", "year_month", "trip_date", "trip_id"], customer_spending_by_month: ["customer_id", "year_month", "trip_date", "trip_id"],
  notifications_by_user: ["user_id", "created_at", "notification_id"], complaints_by_customer: ["customer_id", "created_at", "complaint_id"],
  rideflow_business_journal: ["scope", "operation_id"],
};
const rowKey = (table, row) => `${table}:${JSON.stringify(primaryKeys[table].map((key) => comparable(row[key])))}`;
function upsert(table, record, stamp) {
  const rows = tables.get(table) ?? [];
  tables.set(table, rows);
  const key = rowKey(table, record);
  if ((tombstones.get(key) ?? -1) >= stamp) return;
  let target = rows.find((row) => rowKey(table, row) === key);
  if (!target) { target = {}; rows.push(target); }
  const time = clocks.get(key) ?? new Map(); clocks.set(key, time);
  for (const [column, value] of Object.entries(record)) {
    if ((time.get(column) ?? -1) <= stamp) { target[column] = structuredClone(value); time.set(column, stamp); }
  }
}

function journalBatch(values) {
  const name = "rideflow_business_journal";
  const rows = tables.get(name) ?? [];
  tables.set(name, rows);
  if (values.length === 12) {
    const [id, stamp, scope, previous, , , hash, kind, plan, result, state, created] = values;
    const control = controlRows.get(scope) ?? { active_operation: null, last_timestamp: null };
    if (control.active_operation !== null || control.last_timestamp !== previous || rows.some((row) => row.scope === scope && row.operation_id === id)) return { rows: [{ "[applied]": false }] };
    controlRows.set(scope, { active_operation: id, last_timestamp: stamp });
    rows.push({ scope, operation_id: id, request_hash: hash, kind, plan_json: plan, result_json: result, state, created_at: created });
  } else if (values.length === 6) {
    const [next, scope, id, previous, , active] = values;
    const row = rows.find((row) => row.scope === scope && row.operation_id === id);
    if (row?.state !== previous || controlRows.get(scope)?.active_operation !== active) return { rows: [{ "[applied]": false }] };
    row.state = next;
    controlRows.get(scope).active_operation = null;
  } else throw new Error("Unsupported journal batch");
  return { rows: [{ "[applied]": true }] };
}

function failure() { const error = new Error("Injected Cassandra test transport failure"); error.name = "WriteTimeoutError"; return error; }

class Client {
  // Deliberately allow faults between statements: this is stricter than normal
  // logged-batch delivery and exercises uncertain outcomes and safe retries.
  async batch(statements, options = {}) {
    if (!options.logged || !options.prepare) throw new Error("Expected prepared logged batch");
    for (const statement of statements) await this.execute(statement.query, statement.params, options);
    return { rows: [] };
  }
  async execute(raw, values = [], options = {}) {
    if (unavailable) {
      const error = new Error("Cassandra test transport unavailable");
      error.name = "NoHostAvailableError";
      throw error;
    }
    const original = raw.replace(/\s+/g, " ").trim();
    const call = { cql: original, values: [...values], options };
    calls.push(call);
    if (executionHook) await executionHook(call);
    let fail = false;
    if (fault && fault.match(call) && --fault.remaining === 0) { fail = fault.when; fault = null; }
    if (fail === "before") throw failure();
    let cql = original;
    if (cql.startsWith("BEGIN BATCH")) {
      const result = journalBatch(values);
      if (fail === "after") throw failure();
      return result;
    }
    // The real driver's default timestamp generator is monotonic in microseconds.
    let stamp = lastAutoTimestamp = Math.max(Date.now() * 1000, lastAutoTimestamp + 1);
    if (cql.includes(" USING TIMESTAMP ?")) {
      values = [...values];
      stamp = cql.startsWith("INSERT") ? values.pop() : values.shift();
      cql = cql.replace(" USING TIMESTAMP ?", "");
    }
    const name = cql.match(/(?:FROM|INTO|UPDATE) (\w+(?:\.\w+)?)/)?.[1];
    if (!name) throw new Error(`Unsupported test CQL: ${cql}`);
    if (name === "system.local") return { rows: [{ release_version: "test" }] };
    const rows = tables.get(name) ?? [];
    tables.set(name, rows);
    const where = cql.split(" WHERE ")[1]?.split(" LIMIT ")[0];
    const conditions = where ? where.split(" AND ").map((part) => {
      const match = part.match(/^(\w+) (=|>=|<) \?$/);
      if (!match) throw new Error(`Unsupported test WHERE: ${part}`);
      return { key: match[1], operator: match[2] };
    }) : [];
    if (cql.startsWith("SELECT ")) {
      if (name === "rideflow_business_journal" && cql.startsWith("SELECT active_operation")) {
        const control = controlRows.get(values[0]);
        return { rows: control ? [structuredClone(control)] : [] };
      }
      const matches = rows.filter((row) => conditions.every(({ key, operator }, index) => operator === "="
        ? comparable(row[key]) === comparable(values[index]) : operator === ">="
          ? comparable(row[key]) >= comparable(values[index]) : comparable(row[key]) < comparable(values[index])));
      const limit = cql.includes(" LIMIT ?") ? values.at(-1) : matches.length;
      const limited = matches.slice(0, limit);
      const offset = Number(options.pageState ?? 0), size = forcedPageSize ?? limited.length;
      const end = offset + size;
      return { rows: structuredClone(limited.slice(offset, end)), pageState: end < limited.length ? String(end) : undefined };
    }
    if (cql.startsWith("INSERT ")) {
      const columns = cql.match(/\(([^)]+)\) VALUES/)?.[1].split(", ");
      if (!columns || columns.length !== values.length) throw new Error(`Unsupported test INSERT: ${cql}`);
      upsert(name, Object.fromEntries(columns.map((column, index) => [column, values[index]])), stamp);
    } else if (cql.startsWith("UPDATE ")) {
      const assignments = cql.split(" SET ")[1].split(" WHERE ")[0].split(", ");
      let offset = 0;
      const changes = Object.fromEntries(assignments.map((part) => {
        const [key, expression] = part.split(" = ");
        if (expression !== "?" && expression !== "true") throw new Error(`Unsupported test SET: ${part}`);
        return [key, expression === "?" ? values[offset++] : true];
      }));
      const keys = Object.fromEntries(conditions.map(({ key }, index) => [key, values[offset + index]]));
      upsert(name, { ...keys, ...changes }, stamp);
    } else if (cql.startsWith("DELETE ")) {
      const removed = rows.filter((row) => conditions.every(({ key }, index) => comparable(row[key]) === comparable(values[index])));
      const keys = Object.fromEntries(conditions.map(({ key }, index) => [key, values[index]]));
      for (const row of [...removed, keys]) {
        const key = rowKey(name, row);
        tombstones.set(key, Math.max(stamp, tombstones.get(key) ?? -1));
      }
      tables.set(name, rows.filter((row) => !removed.includes(row) || [...(clocks.get(rowKey(name, row))?.values() ?? [0])].some((time) => time > stamp)));
    } else {
      throw new Error(`Unexpected test CQL: ${cql}`);
    }
    if (fail === "after") throw failure();
    return { rows: [] };
  }
}
export default {
  Client,
  types: {
    consistencies: { localQuorum: 6, localOne: 10, quorum: 4, serial: 8 },
    Uuid: { random: randomUUID },
    LocalDate: { fromDate: (date) => date.toISOString().slice(0, 10), fromString: (date) => date },
  },
};
