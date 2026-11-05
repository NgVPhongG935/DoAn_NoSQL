// Retain an uncertain request's key across rerenders/reloads. A successful
// response clears it, so a later deliberate booking can use the same route.
const memory = new Map<string, { body: string; key: string }>();
export function mutationHeaders(scope: string, payload: unknown) {
  const body = JSON.stringify(payload), storageKey = `rideflow.pending.${scope}`;
  let pending = memory.get(storageKey);
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) pending = JSON.parse(stored);
  } catch { /* Browser storage can be disabled; the in-memory key still works. */ }
  if (!pending || pending.body !== body || !/^[A-Za-z0-9_-]{16,100}$/.test(pending.key)) pending = { body, key: crypto.randomUUID() };
  memory.set(storageKey, pending);
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* Same fallback. */ }
  return { "Content-Type": "application/json", "Idempotency-Key": pending.key };
}
export function completeMutation(scope: string) {
  const storageKey = `rideflow.pending.${scope}`;
  memory.delete(storageKey);
  try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
}

export async function mutationFetch(url: string, options: RequestInit = {}) {
  if (!options.method || !["POST", "PATCH", "PUT"].includes(options.method)) return fetch(url, options);
  const scope = `${options.method}:${url}`;
  const headers = mutationHeaders(scope, options.body);
  const response = await fetch(url, { ...options, headers: { ...options.headers, ...headers } });
  if (response.ok) completeMutation(scope);
  return response;
}
