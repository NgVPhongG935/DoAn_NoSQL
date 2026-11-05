import cassandra from "cassandra-driver";

const globalCassandra = globalThis as typeof globalThis & {
  rideflowCassandra?: cassandra.Client;
};
const consistency = process.env.CASSANDRA_CONSISTENCY === "localQuorum"
  ? cassandra.types.consistencies.localQuorum
  : cassandra.types.consistencies.localOne;

export const cassandraClient = globalCassandra.rideflowCassandra ?? new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || "127.0.0.1")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || "datacenter1",
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) },
  keyspace: process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe",
  queryOptions: { consistency },
});

if (process.env.NODE_ENV !== "production") {
  globalCassandra.rideflowCassandra = cassandraClient;
}

export async function query<T extends Record<string, unknown>>(
  cql: string,
  values: unknown[] = [],
) {
  const result = await cassandraClient.execute(cql, values, {
    prepare: true,
    consistency: process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED === "true" ? cassandra.types.consistencies.quorum : consistency,
  });
  return result.rows as unknown as T[];
}

export async function queryAll(cql: string, values: unknown[] = []) {
  const rows: Record<string, unknown>[] = [];
  let pageState: string | undefined;
  do {
    const result = await cassandraClient.execute(cql, values, {
      prepare: true, pageState, fetchSize: 500,
      consistency: process.env.RIDEFLOW_BUSINESS_JOURNAL_ENABLED === "true" ? cassandra.types.consistencies.quorum : consistency,
    });
    rows.push(...result.rows as unknown as Record<string, unknown>[]);
    pageState = result.pageState;
  } while (pageState);
  return jsonSafe(rows);
}

export function jsonSafe<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map(jsonSafe) as T;
  if (typeof value === "object") {
    const typeName = Object.getPrototypeOf(value)?.constructor?.name;
    if (["Uuid", "TimeUuid", "BigDecimal", "LocalDate", "LocalTime", "Long"].includes(typeName)) {
      return value.toString() as T;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]),
    ) as T;
  }
  return value;
}

export function uuid(): string {
  return cassandra.types.Uuid.random().toString();
}

export function localDate(date: Date): cassandra.types.LocalDate {
  return cassandra.types.LocalDate.fromDate(date);
}
