import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();
export function withCookies(token, callback) {
  const entries = new Map(token ? [["rideflow_session", { value: token }]] : []);
  const store = {
    get: (name) => entries.get(name),
    set: (name, value, options) => entries.set(name, { value, options }),
    delete: (name) => entries.delete(name),
  };
  return context.run(store, () => callback(store));
}
export async function cookies() {
  const store = context.getStore();
  if (!store) throw new Error("Test request cookie context is missing");
  return store;
}
