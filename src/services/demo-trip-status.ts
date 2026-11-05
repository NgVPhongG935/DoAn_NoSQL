import { localDate, queryAll } from "@/lib/cassandra";
import type { DemoPlan, DemoStatement } from "@/lib/demo-mutation";
import { ApiError } from "@/lib/http";
import { preparePaymentWrites, demoPaymentStatements } from "@/services/payments";
import { getDriver, getVehicle } from "@/repositories/accounts";
import { getTrip, getTripHistory, getVoucher, getCustomerVoucher } from "@/repositories/ride-data";

type Row = Record<string, unknown>;
const active = new Set(["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"]);
const transitions: Record<string, string[]> = { BOOKED: ["ACCEPTED", "CANCELLED"], ACCEPTED: ["ARRIVING", "CANCELLED"], ARRIVING: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED"] };
export function demoInsert(table: string, row: Row): DemoStatement {
  const columns = Object.keys(row);
  return { query: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, params: Object.values(row) };
}
export function tripProjections(trip: Row): DemoStatement[] {
  const bookedAt = trip.booked_at instanceof Date ? new Date(trip.booked_at.getTime()) : new Date(String(trip.booked_at));
  const common = { booked_at: bookedAt, trip_id: trip.trip_id, pickup_address: trip.pickup_address, destination_address: trip.destination_address, final_fare: String(trip.final_fare) };
  const statements = [
    demoInsert("trips_by_customer", { customer_id: trip.customer_id, ...common, driver_id: trip.driver_id, status: trip.status }),
    demoInsert("trips_by_driver", { driver_id: trip.driver_id, ...common, customer_id: trip.customer_id, status: trip.status }),
    demoInsert("trips_by_status", { status: trip.status, trip_date: localDate(bookedAt), ...common, customer_id: trip.customer_id, driver_id: trip.driver_id }),
  ];
  for (const status of [...active, "COMPLETED", "CANCELLED"]) {
    if (status !== trip.status) statements.push({ query: "DELETE FROM trips_by_status WHERE status = ? AND trip_date = ? AND booked_at = ? AND trip_id = ?", params: [status, localDate(bookedAt), bookedAt, trip.trip_id] });
  }
  return statements;
}
export async function refundTripVoucher(trip: Row): Promise<DemoStatement[]> {
  // Only new bookings carry an explicit server-written association in history.
  // Do not infer a voucher from fare differences or refund an unrelated old trip.
  const history = await getTripHistory(String(trip.trip_id));
  const prefix = "RideFlow áp dụng voucher: ";
  const marker = history.find((row) => row.status === "BOOKED" && String(row.note).startsWith(prefix));
  if (!marker) return [];
  const code = String(marker.note).slice(prefix.length);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new ApiError("Liên kết voucher không hợp lệ.", 409);
  const [voucher, owned] = await Promise.all([getVoucher(code), getCustomerVoucher(String(trip.customer_id), code)]);
  if (!voucher || !owned || owned.status !== "USED" || new Date(String(owned.used_at)).getTime() !== new Date(String(trip.booked_at)).getTime()
    || !Number.isSafeInteger(Number(voucher.quantity)) || Number(voucher.quantity) < 0 || Number(voucher.quantity) >= 2147483647) throw new ApiError("Voucher của chuyến cần được đối chiếu.", 409);
  return [
    { query: "UPDATE vouchers SET quantity = ? WHERE voucher_code = ?", params: [Number(voucher.quantity) + 1, code] },
    { query: "UPDATE customer_vouchers SET status = ?, used_at = ? WHERE customer_id = ? AND voucher_code = ?", params: ["AVAILABLE", null, trip.customer_id, code] },
  ];
}

export async function prepareDemoStatus(tripId: string, status: string, note?: string): Promise<DemoPlan<Row>> {
  const trip = await getTrip(tripId) as Row | null;
  if (!trip) throw new ApiError("Không tìm thấy chuyến đi.", 404);
  const old = String(trip.status);
  if (old !== status && !transitions[old]?.includes(status)) throw new ApiError(`Không thể chuyển chuyến từ ${old} sang ${status}.`, 409);
  const history = await getTripHistory(tripId);
  const previous = history.find((row) => row.status === status);
  const at = new Date(status === "COMPLETED" && trip.completed_at ? String(trip.completed_at) : previous?.changed_at ? String(previous.changed_at)
    : Math.max(Date.now(), ...history.map((row) => new Date(String(row.changed_at)).getTime() + 1)));
  const trips = await queryAll("SELECT * FROM trips_by_id");
  const driver = await getDriver(String(trip.driver_id));
  if (active.has(status)) {
    const vehicle = await getVehicle(String(trip.vehicle_id));
    if (!driver || driver.account_status !== "ACTIVE" || driver.driver_status === "OFFLINE" || !vehicle || vehicle.status !== "ACTIVE" || vehicle.driver_id !== trip.driver_id
      || trips.some((item) => item.driver_id === trip.driver_id && item.trip_id !== tripId && active.has(String(item.status)))) throw new ApiError("Tài xế hoặc phương tiện không khả dụng.", 409);
  }
  const updated = { ...trip, status, booked_at: new Date(String(trip.booked_at)),
    started_at: trip.started_at ? new Date(String(trip.started_at)) : status === "IN_PROGRESS" ? at : null,
    completed_at: trip.completed_at ? new Date(String(trip.completed_at)) : status === "COMPLETED" ? at : null };
  const statements = [demoInsert("trips_by_id", updated), ...tripProjections(updated)];
  if (!previous) statements.push(demoInsert("trip_status_history", { trip_id: tripId, changed_at: at, status, note: note || `Cập nhật trạng thái: ${status}` }));
  if (status === "COMPLETED") statements.push(...demoPaymentStatements(await preparePaymentWrites(updated, "COMPLETE", at)));
  if (status === "CANCELLED" && old !== "CANCELLED") statements.push(...await refundTripVoucher(trip));
  if (["COMPLETED", "CANCELLED"].includes(status) && driver?.driver_status === "BUSY"
    && !trips.some((item) => item.driver_id === trip.driver_id && item.trip_id !== tripId && active.has(String(item.status)))) {
    statements.push({ query: "UPDATE drivers SET driver_status = ? WHERE driver_id = ?", params: ["AVAILABLE", trip.driver_id] });
  }
  return { statements, result: { ...updated, history } };
}
