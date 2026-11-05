export const MAX_FARE = 1_000_000_000;

export function finiteMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= MAX_FARE ? number : null;
}

export function displayMoney(value: unknown): string {
  const amount = finiteMoney(value);
  return amount === null ? "—" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)} ₫`;
}

export function tripFare(trip: Record<string, unknown>) {
  return finiteMoney(trip.final_fare ?? trip.estimated_fare);
}

export function currentReportMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

export function isReportMonth(month: string) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(month); }

export function adminResourceKey(resource: string, row: Record<string, unknown>): string | null {
  const keys: Record<string, string> = { customers: "customer_id", drivers: "driver_id", vehicles: "vehicle_id", services: "service_id", vouchers: "voucher_code" };
  const field = Object.hasOwn(keys, resource) ? keys[resource] : undefined;
  return field && typeof row[field] === "string" && row[field] ? row[field] as string : null;
}
