import { queryAll } from "@/lib/cassandra";

// This small demo has no global payment index. Read all pages of the payment
// table, rather than deriving payments from a trip's booking month/status.
// Reads must never create or repair payment records.
export async function listAdminPayments(month?: string) {
  const [payments, customers] = await Promise.all([
    queryAll("SELECT trip_id, payment_id, customer_id, amount, payment_method, payment_status, paid_at FROM payments_by_trip"),
    queryAll("SELECT customer_id, full_name FROM customers"),
  ]);
  const names = new Map(customers.map((row) => [String(row.customer_id), String(row.full_name || "Khách hàng")]));
  const monthOf = (value: unknown) => {
    const date = value ? new Date(String(value)) : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(date);
    return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  };
  return payments
    .filter((row) => !month || monthOf(row.paid_at) === month)
    .map((row): Record<string, unknown> => ({ ...row, customer_name: names.get(String(row.customer_id)) || "Khách hàng không còn trong danh sách" }))
    .sort((a, b) => String(b.paid_at || "").localeCompare(String(a.paid_at || "")) || String(a.payment_id).localeCompare(String(b.payment_id)));
}
