import { createHash } from "node:crypto";
import type { Session } from "@/lib/auth";
import { requireTripAccess } from "@/lib/authorization";
import {
  businessRead, dateValue, deleteStatement, insertStatement, runBusinessOperation,
  timestampValue, updateStatement, type OperationContext, type Plan, type Statement, type Value,
} from "@/lib/business-journal";
import { finiteMoney, MAX_FARE } from "@/lib/business-values";
import { estimateTravelTime } from "@/lib/travel-time";
import { ApiError } from "@/lib/http";
import type { MapPoint } from "@/lib/map-types";
import { getDrivingRoute } from "@/services/maps";
import { preparePaymentWrites, durablePaymentStatements } from "@/services/payments";
import { driverAssignmentNotification } from "@/lib/trip-notifications";

type Row = Record<string, unknown>;
export type BookingInput = { customerId: string; serviceId: string; pickup: MapPoint; destination: MapPoint; paymentMethod: string; voucherCode?: string };
export const ACTIVE_STATUSES = new Set(["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"]);
const transitions: Record<string, string[]> = { BOOKED: ["ACCEPTED", "CANCELLED"], ACCEPTED: ["ARRIVING", "CANCELLED"], ARRIVING: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED"] };

export function stableUuid(key: string) {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function businessEntity(table: string, column: string, id: string): Promise<Row | undefined> {
  const pairs: Record<string, string> = { customers: "customer_id", drivers: "driver_id", vehicles: "vehicle_id", service_types: "service_id", vouchers: "voucher_code", trips_by_id: "trip_id", reviews_by_trip: "trip_id" };
  if (!Object.hasOwn(pairs, table) || pairs[table] !== column) throw new Error("Unsupported entity lookup");
  return (await businessRead(`SELECT * FROM ${table} WHERE ${column} = ?`, [id]))[0];
}

function amount(value: unknown, label: string) {
  const result = finiteMoney(value);
  if (result === null) throw new ApiError(`${label} không hợp lệ.`, 409);
  return result;
}
function supportsService(vehicle: Row, service: string) {
  if (vehicle.status !== "ACTIVE" || !vehicle.driver_id || !vehicle.license_plate || !vehicle.brand || !vehicle.model) return false;
  const type = String(vehicle.vehicle_type), seats = Number(vehicle.seat_count);
  if (service === "BIKE") return type === "BIKE";
  if (service === "CAR_4" || service === "PREMIUM") return ["CAR", "CAR_4", "CAR_7"].includes(type) && seats >= 4;
  if (service === "CAR_7") return ["CAR", "CAR_7"].includes(type) && seats >= 7;
  return false;
}

async function selectDriver(service: string, trips: Row[], exclude?: string) {
  const [drivers, vehicles] = await Promise.all([businessRead("SELECT * FROM drivers"), businessRead("SELECT * FROM vehicles")]);
  for (const driver of drivers) {
    const id = String(driver.driver_id);
    if (id === exclude || driver.account_status !== "ACTIVE" || driver.driver_status !== "AVAILABLE"
      || trips.some((trip) => trip.driver_id === id && ACTIVE_STATUSES.has(String(trip.status)))) continue;
    const vehicle = vehicles.find((item) => item.driver_id === id && supportsService(item, service));
    if (vehicle) return { driver, vehicle };
  }
  return null;
}

// Full canonical scan is deliberate at the project's small scale: a 50-row
// projection LIMIT must never hide an older active trip during assignment.
export async function allCanonicalTrips() { return businessRead("SELECT * FROM trips_by_id"); }

function tripProjectionStatements(trip: Row, previous: Row | null, context: OperationContext): Statement[] {
  const stamp = context.timestamp;
  const id = String(trip.trip_id), customerId = String(trip.customer_id), driverId = String(trip.driver_id);
  const bookedAt = timestampValue(String(trip.booked_at)), tripDate = dateValue(String(trip.booked_at));
  const address = { pickup_address: String(trip.pickup_address ?? ""), destination_address: String(trip.destination_address ?? "") };
  const shared = { trip_id: id, ...address, final_fare: String(amount(trip.final_fare, "Giá chuyến")), status: String(trip.status) };
  const statements: Statement[] = [];
  // Old projection tombstones precede the new projection logically, but all
  // mutations retain fixed per-operation timestamps for safe replay.
  if (previous && previous.status !== trip.status) statements.push(deleteStatement("trips_by_status", {
    status: String(previous.status), trip_date: tripDate, booked_at: bookedAt, trip_id: id,
  }, stamp));
  if (previous && previous.driver_id !== trip.driver_id) statements.push(deleteStatement("trips_by_driver", {
    driver_id: String(previous.driver_id), booked_at: bookedAt, trip_id: id,
  }, stamp));
  const canonical: Record<string, Value> = {
    trip_id: id, customer_id: customerId, driver_id: driverId, vehicle_id: String(trip.vehicle_id), service_id: String(trip.service_id),
    ...address, distance_km: Number(trip.distance_km ?? 0), estimated_fare: String(amount(trip.estimated_fare ?? trip.final_fare, "Giá dự kiến")),
    final_fare: shared.final_fare, booked_at: bookedAt, status: shared.status, payment_method: String(trip.payment_method),
    started_at: trip.started_at ? timestampValue(String(trip.started_at)) : null,
    completed_at: trip.completed_at ? timestampValue(String(trip.completed_at)) : null,
  };
  statements.push(
    insertStatement("trips_by_id", canonical, stamp),
    insertStatement("trips_by_customer", { customer_id: customerId, booked_at: bookedAt, ...shared, driver_id: driverId }, stamp),
    insertStatement("trips_by_driver", { driver_id: driverId, booked_at: bookedAt, ...shared, customer_id: customerId }, stamp),
    insertStatement("trips_by_status", { status: shared.status, trip_date: tripDate, booked_at: bookedAt, trip_id: id, customer_id: customerId, driver_id: driverId, ...address, final_fare: shared.final_fare }, stamp),
  );
  return statements;
}

function historyStatement(tripId: string, status: string, note: string, context: OperationContext) {
  return insertStatement("trip_status_history", { trip_id: tripId, changed_at: timestampValue(context.at), status, note }, context.timestamp);
}

async function voucherForBooking(input: BookingInput, estimate: number, now: string) {
  if (!input.voucherCode) return { discount: 0, quantity: 0 };
  const [voucher, assignments] = await Promise.all([
    businessEntity("vouchers", "voucher_code", input.voucherCode),
    businessRead("SELECT * FROM customer_vouchers WHERE customer_id = ? AND voucher_code = ?", [input.customerId, input.voucherCode]),
  ]);
  const quantity = Number(voucher?.quantity);
  const start = Date.parse(String(voucher?.start_date)), end = Date.parse(String(voucher?.end_date)), at = Date.parse(now);
  if (!voucher || voucher.status !== "ACTIVE" || !Number.isSafeInteger(quantity) || quantity <= 0
    || !Number.isFinite(start) || !Number.isFinite(end) || start > end || at < start || at > end
    || assignments[0]?.status !== "AVAILABLE") throw new ApiError("Voucher hết hạn, hết lượt hoặc không còn khả dụng.", 409);
  const minimum = amount(voucher.min_trip_amount, "Đơn tối thiểu"), maximum = amount(voucher.max_discount, "Giảm tối đa"), value = amount(voucher.discount_value, "Giá trị voucher");
  if (estimate < minimum || value <= 0 || !["FIXED", "PERCENT"].includes(String(voucher.discount_type))
    || (voucher.discount_type === "PERCENT" && value > 100)) throw new ApiError("Voucher không đủ điều kiện sử dụng.", 409);
  const raw = voucher.discount_type === "PERCENT" ? Math.round(estimate * value / 100) : value;
  return { discount: Math.min(estimate, raw, maximum), quantity };
}

export async function bookTripDurably(input: BookingInput, requestKey: string) {
  return runBusinessOperation("booking", `booking:${input.customerId}:${requestKey}`, input, async (context) => {
    const [customer, service, route, trips] = await Promise.all([
      businessEntity("customers", "customer_id", input.customerId), businessEntity("service_types", "service_id", input.serviceId),
      getDrivingRoute(input.pickup, input.destination), allCanonicalTrips(),
    ]);
    if (!customer || customer.status !== "ACTIVE") throw new ApiError("Tài khoản khách hàng không khả dụng.", 403);
    if (!service || service.status !== "ACTIVE") throw new ApiError("Dịch vụ đã ngừng hoạt động.", 409);
    if (!Number.isFinite(route.distanceKm) || route.distanceKm < 0.1 || route.distanceKm > 250
      || !Number.isFinite(route.durationMinutes) || route.durationMinutes <= 0) throw new ApiError("Tuyến đường không hợp lệ.");
    const base = amount(service.base_fare, "Giá cơ bản"), perKm = amount(service.price_per_km, "Giá mỗi km");
    if (perKm <= 0) throw new ApiError("Giá mỗi km phải lớn hơn 0.", 409);
    const estimate = Math.round(base + route.distanceKm * perKm);
    if (!Number.isSafeInteger(estimate) || estimate > MAX_FARE) throw new ApiError("Giá chuyến vượt giới hạn xử lý.", 409);
    const promotion = await voucherForBooking(input, estimate, context.at);
    const assignment = await selectDriver(String(service.service_name), trips);
    if (!assignment) throw new ApiError("Hiện chưa có tài xế phù hợp đang rảnh. Vui lòng thử lại sau ít phút.", 409);
    const { driver, vehicle } = assignment;
    const tripId = stableUuid(context.operationId), fare = estimate - promotion.discount;
    const trip = {
      trip_id: tripId, customer_id: input.customerId, driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, service_id: input.serviceId,
      pickup_address: input.pickup.label, destination_address: input.destination.label, distance_km: route.distanceKm,
      estimated_fare: estimate, final_fare: fare, booked_at: context.at, status: "BOOKED", payment_method: input.paymentMethod,
    };
    const statements = [updateStatement("drivers", { driver_status: "BUSY" }, { driver_id: String(driver.driver_id) }, context.timestamp)];
    if (input.voucherCode) statements.push(
      updateStatement("vouchers", { quantity: promotion.quantity - 1 }, { voucher_code: input.voucherCode }, context.timestamp),
      updateStatement("customer_vouchers", { status: "USED", used_at: timestampValue(context.at) }, { customer_id: input.customerId, voucher_code: input.voucherCode }, context.timestamp),
    );
    statements.push(...tripProjectionStatements(trip, null, context), historyStatement(tripId, "BOOKED", "RideFlow đã phân công tài xế cho chuyến.", context));
    statements.push(insertStatement("notifications_by_user", { ...driverAssignmentNotification({ tripId, driverId: String(driver.driver_id), pickup: input.pickup.label, destination: input.destination.label, fare, at: new Date(context.at) }), created_at: timestampValue(context.at) }, context.timestamp));
    return { statements, result: {
      tripId, status: "BOOKED", bookedAt: context.at, distanceKm: route.distanceKm, durationMinutes: route.durationMinutes,
      travelTimeEstimate: estimateTravelTime(route.distanceKm, service.service_name),
      estimatedFare: estimate, discountAmount: promotion.discount, finalFare: fare,
      driverId: driver.driver_id, driverName: driver.full_name, vehicleId: vehicle.vehicle_id,
      voucherCode: input.voucherCode ?? null,
    } };
  });
}

async function findBooking(tripId: string) {
  // Journal is one bounded, project-scale partition. No filtering query or
  // mutation of the old trip schema is needed to recover the voucher relation.
  const rows = await businessRead("SELECT kind, result_json, state FROM rideflow_business_journal WHERE scope = ?", ["rideflow-business-v1"]);
  for (const row of rows) {
    if (row.kind === "booking" && row.state === "COMMITTED") {
      const result = JSON.parse(String(row.result_json));
      if (result.tripId === tripId) return result as { voucherCode: string | null; bookedAt: string };
    }
  }
  return null;
}

async function refundVoucher(trip: Row, context: OperationContext): Promise<Statement[]> {
  const booking = await findBooking(String(trip.trip_id));
  if (!booking?.voucherCode) return [];
  const code = booking.voucherCode, customerId = String(trip.customer_id);
  const [voucher, owned] = await Promise.all([
    businessEntity("vouchers", "voucher_code", code),
    businessRead("SELECT * FROM customer_vouchers WHERE customer_id = ? AND voucher_code = ?", [customerId, code]),
  ]);
  // The exact assignment must still be the reservation made by this booking.
  // Legacy trips without a journal relation are never guessed/refunded.
  if (!voucher || owned[0]?.status !== "USED" || String(owned[0]?.used_at) !== booking.bookedAt) {
    throw new ApiError("Không thể xác minh voucher của chuyến; cần đối soát trước khi hủy.", 409);
  }
  const quantity = Number(voucher.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity >= 2_147_483_647) throw new ApiError("Số lượt voucher không hợp lệ.", 409);
  return [
    updateStatement("vouchers", { quantity: quantity + 1 }, { voucher_code: code }, context.timestamp),
    updateStatement("customer_vouchers", { status: "AVAILABLE", used_at: null }, { customer_id: customerId, voucher_code: code }, context.timestamp),
  ];
}

async function paymentsForCompletedTrip(trip: Row, context: OperationContext): Promise<Statement[]> {
  return durablePaymentStatements(await preparePaymentWrites(trip, "COMPLETE", new Date(context.at)), context.timestamp);
}

export async function changeTripStatusDurably(tripId: string, status: string, note: string | undefined, actor: Session, key: string) {
  return runBusinessOperation("trip-status", `trip-status:${tripId}:${actor.userId}:${key}`, { tripId, status, note: note ?? "", actor: { id: actor.userId, role: actor.role } }, async (context): Promise<Plan<Row>> => {
    const trip = await businessEntity("trips_by_id", "trip_id", tripId);
    if (!trip) throw new ApiError("Không tìm thấy chuyến.", 404);
    requireTripAccess(actor, trip, true);
    if (actor.role === "CUSTOMER" && status !== "CANCELLED") throw new ApiError("Khách hàng chỉ được hủy chuyến.", 403);
    const same = trip.status === status;
    if (!same && !transitions[String(trip.status)]?.includes(status)) throw new ApiError(`Không thể chuyển chuyến từ ${trip.status} sang ${status}.`, 409);
    const driver = await businessEntity("drivers", "driver_id", String(trip.driver_id));
    const allTrips = await allCanonicalTrips();
    const otherActive = allTrips.filter((item) => item.driver_id === trip.driver_id && item.trip_id !== tripId && ACTIVE_STATUSES.has(String(item.status)));
    if (!same && status !== "CANCELLED") {
      if (!driver || driver.account_status !== "ACTIVE" || !["AVAILABLE", "BUSY"].includes(String(driver.driver_status)) || otherActive.length) {
        throw new ApiError("Tài xế không khả dụng hoặc đang có chuyến hoạt động khác.", 409);
      }
      const vehicle = await businessEntity("vehicles", "vehicle_id", String(trip.vehicle_id));
      if (!vehicle || vehicle.driver_id !== trip.driver_id || vehicle.status !== "ACTIVE") throw new ApiError("Phương tiện không còn hợp lệ cho tài xế.", 409);
    }
    const next: Row = { ...trip, status,
      started_at: status === "IN_PROGRESS" && !same ? context.at : trip.started_at ?? null,
      completed_at: status === "COMPLETED" && !same ? context.at : trip.completed_at ?? null,
    };
    const statements: Statement[] = [];
    if (!same) {
      if (status === "CANCELLED") statements.push(...await refundVoucher(trip, context));
      statements.push(...tripProjectionStatements(next, trip, context), historyStatement(tripId, status, note || `Cập nhật trạng thái: ${status}`, context));
    }
    if (status === "COMPLETED") statements.push(...await paymentsForCompletedTrip(next, context));
    if (!same && driver && ["COMPLETED", "CANCELLED"].includes(status) && !otherActive.length && driver.driver_status === "BUSY") {
      statements.push(updateStatement("drivers", { driver_status: driver.account_status === "ACTIVE" ? "AVAILABLE" : "OFFLINE" }, { driver_id: String(trip.driver_id) }, context.timestamp));
    }
    if (!same && ACTIVE_STATUSES.has(status) && driver?.driver_status === "AVAILABLE") statements.push(updateStatement("drivers", { driver_status: "BUSY" }, { driver_id: String(trip.driver_id) }, context.timestamp));
    return { statements, result: next };
  });
}

export async function reassignTripDurably(tripId: string, actor: Session, note: string | undefined, key: string) {
  return runBusinessOperation("trip-incident", `trip-incident:${tripId}:${actor.userId}:${key}`, { tripId, driverId: actor.userId, note: note ?? "" }, async (context): Promise<Plan<Row>> => {
    const trip = await businessEntity("trips_by_id", "trip_id", tripId);
    if (!trip) throw new ApiError("Không tìm thấy chuyến.", 404);
    requireTripAccess(actor, trip, true);
    if (actor.role !== "DRIVER" || actor.userId !== trip.driver_id) throw new ApiError("Bạn không được phân công chuyến này.", 403);
    if (!["BOOKED", "ACCEPTED", "ARRIVING"].includes(String(trip.status))) throw new ApiError("Không thể đổi tài xế sau khi bắt đầu hoặc kết thúc chuyến.", 409);
    const service = await businessEntity("service_types", "service_id", String(trip.service_id));
    if (!service || service.status !== "ACTIVE") throw new ApiError("Dịch vụ không còn hoạt động.", 409);
    const assignment = await selectDriver(String(service.service_name), await allCanonicalTrips(), actor.userId);
    const next: Row = assignment ? { ...trip, driver_id: assignment.driver.driver_id, vehicle_id: assignment.vehicle.vehicle_id, status: "BOOKED" } : { ...trip, status: "CANCELLED" };
    const statements: Statement[] = assignment ? [updateStatement("drivers", { driver_status: "BUSY" }, { driver_id: String(assignment.driver.driver_id) }, context.timestamp)] : await refundVoucher(trip, context);
    statements.push(
      ...tripProjectionStatements(next, trip, context),
      historyStatement(tripId, String(next.status), note || (assignment ? "Đã đổi tài xế sau sự cố." : "Không có tài xế thay thế; chuyến đã hủy."), context),
      updateStatement("drivers", { driver_status: "OFFLINE" }, { driver_id: actor.userId }, context.timestamp),
      insertStatement("notifications_by_user", { user_id: String(trip.customer_id), created_at: timestampValue(context.at), notification_id: stableUuid(`notification:${context.operationId}`), title: assignment ? "RideFlow đã đổi tài xế" : "Chuyến đã hủy vì chưa có tài xế thay thế", content: assignment ? `Tài xế ${String(assignment.driver.full_name)} đã được phân công thay thế.` : "Bạn có thể đặt lại chuyến khi thuận tiện.", notification_type: "TRIP", is_read: false }, context.timestamp),
    );
    if (assignment) statements.push(insertStatement("notifications_by_user", { ...driverAssignmentNotification({ tripId, driverId: String(assignment.driver.driver_id), pickup: String(next.pickup_address), destination: String(next.destination_address), fare: next.final_fare, at: new Date(context.at) }), created_at: timestampValue(context.at) }, context.timestamp));
    return { statements, result: { ...next, reassigned: !!assignment, newDriverId: assignment?.driver.driver_id ?? null, newDriverName: assignment?.driver.full_name ?? null } };
  });
}
