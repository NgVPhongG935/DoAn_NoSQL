import { createHash } from "node:crypto";
import type { Session } from "@/lib/auth";
import { requireTripAccess } from "@/lib/authorization";
import { finiteMoney } from "@/lib/business-values";
import { businessJournalEnabled, deleteStatement, insertStatement, runBusinessOperation, timestampValue, dateValue, type Value } from "@/lib/business-journal";
import { localDate, queryAll } from "@/lib/cassandra";
import { demoMutation, type DemoStatement } from "@/lib/demo-mutation";
import { ApiError } from "@/lib/http";
import { isPaymentSettled } from "@/lib/payment-values";
import { getPaymentsForTrip, getTrip } from "@/repositories/ride-data";

type Row = Record<string, unknown>;
type Write = { table: string; record: Row; remove?: boolean };
type Action = "COMPLETE" | "REPORT_TRANSFER" | "CONFIRM_TRANSFER" | "REJECT_TRANSFER";
function stablePaymentId(id: string) {
  const h = createHash("sha256").update(`rideflow-payment:${id}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export async function preparePaymentWrites(trip: Row, action: Action, now = new Date()): Promise<Write[]> {
  const id = String(trip.trip_id), customerId = String(trip.customer_id), method = String(trip.payment_method);
  const fare = finiteMoney(trip.final_fare);
  if (fare === null) throw new ApiError("Giá thanh toán không hợp lệ.", 409);
  const payments = await getPaymentsForTrip(id), old = payments[0];
  if (payments.length > 1 || old && (Number(old.amount) !== fare || old.customer_id !== customerId || old.payment_method !== method
    || !["PAID", "PAID_DEMO", "PENDING", "PENDING_CONFIRMATION", "FAILED"].includes(String(old.payment_status)))) throw new ApiError("Thanh toán cũ cần được đối chiếu, không tự ghi đè.", 409);
  const settled = isPaymentSettled(old?.payment_status);
  const status = settled ? String(old.payment_status) : action === "CONFIRM_TRANSFER" ? "PAID_DEMO"
    : action === "REPORT_TRANSFER" ? "PENDING_CONFIRMATION"
      : action === "REJECT_TRANSFER" ? "FAILED"
        : String(old?.payment_status || (method === "BANK_TRANSFER" ? "PENDING" : "PAID"));
  // paid_at is a mandatory clustering key in payments_by_customer. While pending,
  // use the completion timestamp as a provisional key, never display it as paid.
  // On confirmation, move that row to the real confirmation timestamp.
  const paidAt = new Date(action === "CONFIRM_TRANSFER" && !settled ? now : old?.paid_at ? String(old.paid_at) : String(trip.completed_at || now.toISOString()));
  if (!Number.isFinite(paidAt.valueOf())) throw new ApiError("Thời điểm thanh toán không hợp lệ.", 409);
  const paymentId = String(old?.payment_id || stablePaymentId(id));
  const customerPayments = await queryAll("SELECT * FROM payments_by_customer WHERE customer_id = ?", [customerId]);
  if (customerPayments.some((row) => row.trip_id === id && (row.payment_id !== paymentId || !old && isPaymentSettled(row.payment_status)))) {
    throw new ApiError("Lịch sử thanh toán không khớp bản ghi theo chuyến; cần đối chiếu.", 409);
  }
  const writes: Write[] = customerPayments.filter((row) => row.payment_id === paymentId && row.trip_id === id && new Date(String(row.paid_at)).valueOf() !== paidAt.valueOf())
    .map((row) => ({ table: "payments_by_customer", remove: true, record: { customer_id: customerId, paid_at: new Date(String(row.paid_at)), payment_id: paymentId } }));
  const common = { payment_id: paymentId, amount: String(fare), payment_method: method, payment_status: status };
  writes.push(
    { table: "payments_by_trip", record: { trip_id: id, customer_id: customerId, ...common, paid_at: paidAt } },
    { table: "payments_by_customer", record: { customer_id: customerId, paid_at: paidAt, ...common, trip_id: id } },
  );
  if (isPaymentSettled(status)) {
    const stats = { year_month: paidAt.toISOString().slice(0,7), trip_date: localDate(paidAt), trip_id: id };
    writes.push(
      { table: "driver_revenue_by_month", record: { driver_id: trip.driver_id, ...stats, fare: String(fare) } },
      { table: "customer_spending_by_month", record: { customer_id: customerId, ...stats, amount: String(fare) } },
    );
  }
  return writes;
}

export function demoPaymentStatements(writes: Write[]): DemoStatement[] {
  return writes.map(({ table, record, remove }) => {
    const columns = Object.keys(record);
    return { query: remove ? `DELETE FROM ${table} WHERE ${columns.map((key) => `${key} = ?`).join(" AND ")}`
      : `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, params: Object.values(record) };
  });
}
export function durablePaymentStatements(writes: Write[], timestamp: number) {
  return writes.map(({ table, record, remove }) => {
    const values = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Date ? timestampValue(value.toISOString())
      : key === "trip_date" ? dateValue(String(value)) : value as Value]));
    return remove ? deleteStatement(table, values, timestamp) : insertStatement(table, values, timestamp);
  });
}

export async function changeTransferPayment(tripId: string, action: Exclude<Action,"COMPLETE">, actor: Session, key: string) {
  const prepare = async () => {
    const trip = await getTrip(tripId);
    if (!trip) throw new ApiError("Không tìm thấy chuyến.", 404);
    requireTripAccess(actor, trip, true);
    if (trip.status !== "COMPLETED" || trip.payment_method !== "BANK_TRANSFER") throw new ApiError("Chỉ xử lý chuyển khoản cho chuyến đã hoàn thành.", 409);
    if (action === "CONFIRM_TRANSFER") {
      if (actor.role !== "DRIVER") throw new ApiError("Chỉ tài xế của chuyến được xác nhận đã nhận tiền.", 403);
      const old = (await getPaymentsForTrip(tripId))[0];
      if (!["PENDING", "PENDING_CONFIRMATION", "PAID_DEMO"].includes(String(old?.payment_status))) throw new ApiError("Chỉ khoản thanh toán đang chờ mới được xác nhận.", 409);
    } else if (action === "REJECT_TRANSFER") {
      if (actor.role !== "ADMIN") throw new ApiError("Chỉ Admin được từ chối yêu cầu thanh toán.", 403);
      const old = (await getPaymentsForTrip(tripId))[0];
      if (old?.payment_status !== "PENDING_CONFIRMATION") throw new ApiError("Chỉ yêu cầu đang chờ xác nhận mới được từ chối.", 409);
    } else {
      if (actor.role !== "CUSTOMER") throw new ApiError("Chỉ khách hàng của chuyến được báo đã chuyển khoản.", 403);
      const old = (await getPaymentsForTrip(tripId))[0];
      if (isPaymentSettled(old?.payment_status)) throw new ApiError("Thanh toán này đã được xác nhận.", 409);
    }
    return preparePaymentWrites(trip, action);
  };
  const body = { tripId, action, actor: actor.userId, role: actor.role };
  if (businessJournalEnabled()) return runBusinessOperation("trip-payment", `trip-payment:${tripId}:${actor.userId}:${action}:${key}`, body, async (context) => ({
    statements: durablePaymentStatements(await prepare(), context.timestamp), result: { tripId, action },
  }));
  // Share completion/review's queue; keep failed plans for a safe identical retry.
  return demoMutation(`trip-payment:${tripId}:${actor.userId}:${action}`, body, async () => ({ statements: demoPaymentStatements(await prepare()), result: { tripId, action } }), false);
}
