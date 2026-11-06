import { cassandraClient } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";
import cassandra from "cassandra-driver";

export type DemoStatement = { query: string; params: unknown[] };
export type DemoPlan<T> = { statements: DemoStatement[]; result: T };
type Entry = { body: string; plan: DemoPlan<unknown>; done: boolean };
const shared = globalThis as typeof globalThis & {
  rideflowDemoWrites?: { tail: Promise<void>; entries: Map<string, Entry>; pending?: string };
};
const state: NonNullable<typeof shared.rideflowDemoWrites> = shared.rideflowDemoWrites ??= { tail: Promise.resolve(), entries: new Map() };

// Backup/restore shares the single-server business-write queue. Never overtake
// a batch whose outcome is still uncertain, or replay cached results after restore.
export async function withDemoMaintenance<T>(work: () => Promise<T>, reset = false): Promise<T> {
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    if (state.pending) throw new ApiError("Có thao tác chuyến chưa xác nhận xong. Hãy hoàn tất thao tác đó trước khi sao lưu/khôi phục.", 409);
    const result = await work();
    if (reset) state.entries.clear();
    return result;
  } finally { release(); }
}

// A small single-server retry cache, NOT a persistent journal or a distributed lock.
// Keep an ambiguous batch intact until the same request retries it. Never release
// its driver or let a newer trip operation overwrite its pending statements.
export async function demoMutation<T>(key: string, body: unknown, prepare: () => Promise<DemoPlan<T>>, remember = true): Promise<T> {
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const fingerprint = JSON.stringify(body);
    let entry = state.entries.get(key);
    if (entry && entry.body !== fingerprint) throw new ApiError("Mã yêu cầu đã được dùng cho thao tác khác.", 409);
    if (entry?.done) return entry.plan.result as T;
    if (state.pending && state.pending !== key) {
      throw new ApiError("Có thao tác chuyến chưa xác nhận xong. Hãy thử lại thao tác trước đó trước khi tiếp tục.", 503);
    }
    if (!entry) {
      entry = { body: fingerprint, plan: await prepare(), done: false };
      state.entries.set(key, entry);
    }
    state.pending = key;
    try {
      await cassandraClient.batch(entry.plan.statements, {
        prepare: true, logged: true,
        consistency: process.env.CASSANDRA_CONSISTENCY === "localQuorum" ? cassandra.types.consistencies.localQuorum : cassandra.types.consistencies.localOne,
      });
    } catch {
      throw new ApiError("Kết quả chưa được xác nhận. Giữ nguyên nội dung và bấm lại thao tác vừa thực hiện để thử lại.", 503);
    }
    entry.done = true;
    state.pending = undefined;
    if (!remember) state.entries.delete(key);
    // Completed requests are bounded; an uncertain request is never evicted.
    if (state.entries.size > 1000) {
      for (const [oldKey, old] of state.entries) {
        if (old.done && oldKey !== key) { state.entries.delete(oldKey); break; }
      }
    }
    return entry.plan.result as T;
  } finally { release(); }
}
