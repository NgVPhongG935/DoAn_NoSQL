import { randomInt } from "node:crypto";
import { localDate, queryAll, uuid } from "@/lib/cassandra";
import { withDriverAssignmentLock } from "@/lib/driver-assignment-lock";
import { ApiError } from "@/lib/http";
import { listDrivers, listVehicles } from "@/repositories/accounts";
import { getCustomerVoucher, getTrip, getTripHistory, getVoucher } from "@/repositories/ride-data";
import { getServiceById } from "@/repositories/ride-data";
import type { MapPoint } from "@/lib/map-types";
import { getDrivingRoute } from "@/services/maps";
import type { Session } from "@/lib/auth";
import { businessJournalEnabled } from "@/lib/business-journal";
import { bookTripDurably, changeTripStatusDurably, reassignTripDurably } from "@/services/trip-plans";
import { finiteMoney } from "@/lib/business-values";
import { estimateTravelTime } from "@/lib/travel-time";
import { demoMutation, type DemoStatement } from "@/lib/demo-mutation";
import { prepareDemoStatus, tripProjections, demoInsert } from "@/services/demo-trip-status";
import { driverAssignmentNotification } from "@/lib/trip-notifications";

const activeTripStatuses = new Set(["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"]);

export async function bookTrip(input: {
  customerId: string;
  serviceId: string;
  pickup: MapPoint;
  destination: MapPoint;
  paymentMethod: string;
  voucherCode?: string;
}, requestKey?: string) {
  if (!["CASH", "BANK_TRANSFER"].includes(input.paymentMethod)) throw new ApiError("Phương thức thanh toán không được hỗ trợ.");
  if (businessJournalEnabled()) {
    if (!requestKey) throw new ApiError("Thiếu mã yêu cầu đặt chuyến.");
    return bookTripDurably(input, requestKey);
  }
  return demoMutation(`booking:${input.customerId}:${requestKey || uuid()}`, input, async () => {
    const statements: DemoStatement[] = [];
    const write = (query: string, params: unknown[]) => statements.push({ query, params });
    const [service, route] = await Promise.all([
      getServiceById(input.serviceId),
      getDrivingRoute(input.pickup, input.destination),
    ]);
    if (!service || service.status !== "ACTIVE") throw new ApiError("Dịch vụ đã ngừng hoạt động.");
    const serviceName = String(service.service_name);
    const bookedAt = new Date();
    const tripId = uuid();
    if (!Number.isFinite(route.distanceKm) || route.distanceKm < 0.1 || route.distanceKm > 250) throw new ApiError("Tuyến đường phải nằm trong phạm vi 250 km.");
    const estimatedFare = Math.round(Number(service.base_fare) + route.distanceKm * Number(service.price_per_km));
    if (finiteMoney(service.base_fare) === null || finiteMoney(service.price_per_km) === null
      || Number(service.price_per_km) <= 0 || finiteMoney(estimatedFare) === null) throw new ApiError("Giá dịch vụ không hợp lệ.", 409);
    let discountAmount = 0;
    if (input.voucherCode) {
      const [voucher, customerVoucher] = await Promise.all([
        getVoucher(input.voucherCode),
        getCustomerVoucher(input.customerId, input.voucherCode),
      ]);
      const now = bookedAt.getTime();
      if (!voucher || voucher.status !== "ACTIVE" || !Number.isSafeInteger(Number(voucher.quantity)) || Number(voucher.quantity) <= 0) {
        throw new ApiError("Voucher không còn hoạt động hoặc đã hết lượt.");
      }
      if (!customerVoucher || customerVoucher.status !== "AVAILABLE") {
        throw new ApiError("Voucher này chưa được cấp cho tài khoản hoặc đã sử dụng.");
      }
      if (!Number.isFinite(new Date(String(voucher.start_date)).getTime()) || !Number.isFinite(new Date(String(voucher.end_date)).getTime()) || now < new Date(String(voucher.start_date)).getTime() || now > new Date(String(voucher.end_date)).getTime()) {
        throw new ApiError("Voucher chưa đến hạn hoặc đã hết hạn.");
      }
      if (estimatedFare < Number(voucher.min_trip_amount)) {
        throw new ApiError(`Chuyến đi cần đạt tối thiểu ${Number(voucher.min_trip_amount).toLocaleString("vi-VN")} ₫ để dùng voucher.`);
      }
      if (!["FIXED", "PERCENT"].includes(String(voucher.discount_type)) || finiteMoney(voucher.discount_value) === null || Number(voucher.discount_value) <= 0
        || finiteMoney(voucher.max_discount) === null || finiteMoney(voucher.min_trip_amount) === null
        || voucher.discount_type === "PERCENT" && Number(voucher.discount_value) > 100) throw new ApiError("Voucher không hợp lệ.", 409);
      write("UPDATE vouchers SET quantity = ? WHERE voucher_code = ?", [Number(voucher.quantity) - 1, input.voucherCode]);
      const rawDiscount = voucher.discount_type === "PERCENT"
        ? Math.round(estimatedFare * Number(voucher.discount_value) / 100)
        : Number(voucher.discount_value);
      discountAmount = Math.min(estimatedFare, rawDiscount, Number(voucher.max_discount));
    }
    const fare = estimatedFare - discountAmount;
    const tripDate = localDate(bookedAt);
    const status = "BOOKED";

    const { driver, vehicle } = await claimAvailableDriver(serviceName, tripId);
    write("UPDATE drivers SET driver_status = ? WHERE driver_id = ?", ["BUSY", driver.driver_id]);
    {
      write(
        `INSERT INTO trips_by_id (trip_id, customer_id, driver_id, vehicle_id, service_id, pickup_address, destination_address, distance_km, estimated_fare, final_fare, booked_at, status, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tripId, input.customerId, driver.driver_id, vehicle.vehicle_id, input.serviceId, input.pickup.label, input.destination.label,
          route.distanceKm, String(estimatedFare), String(fare), bookedAt, status, input.paymentMethod],
      );
      write(
        `INSERT INTO trips_by_customer (customer_id, booked_at, trip_id, driver_id, pickup_address, destination_address, final_fare, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.customerId, bookedAt, tripId, driver.driver_id, input.pickup.label, input.destination.label, String(fare), status],
      );
      write(
        `INSERT INTO trips_by_driver (driver_id, booked_at, trip_id, customer_id, pickup_address, destination_address, final_fare, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [driver.driver_id, bookedAt, tripId, input.customerId, input.pickup.label, input.destination.label, String(fare), status],
      );
      write(
        `INSERT INTO trips_by_status (status, trip_date, booked_at, trip_id, customer_id, driver_id, pickup_address, destination_address, final_fare)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [status, tripDate, bookedAt, tripId, input.customerId, driver.driver_id, input.pickup.label,
          input.destination.label, String(fare)],
      );
      write(
        "INSERT INTO trip_status_history (trip_id, changed_at, status, note) VALUES (?, ?, ?, ?)",
        [tripId, bookedAt, status, input.voucherCode ? `RideFlow áp dụng voucher: ${input.voucherCode}` : `RideFlow tự động phân chuyến cho tài xế ${String(driver.full_name || "phù hợp")}`],
      );
      if (input.voucherCode) {
        write(
          "UPDATE customer_vouchers SET status = ?, used_at = ? WHERE customer_id = ? AND voucher_code = ?",
          ["USED", bookedAt, input.customerId, input.voucherCode],
        );
      }
    }
    statements.push(demoInsert("notifications_by_user", driverAssignmentNotification({ tripId, driverId: String(driver.driver_id), pickup: input.pickup.label, destination: input.destination.label, fare, at: bookedAt })));
    return { statements, result: {
      tripId,
      status,
      bookedAt: bookedAt.toISOString(),
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      travelTimeEstimate: estimateTravelTime(route.distanceKm, service.service_name),
      estimatedFare,
      discountAmount,
      finalFare: fare,
      driverId: driver.driver_id,
      driverName: driver.full_name,
      vehicleId: vehicle.vehicle_id,
    } };
  });
}

function supportsService(vehicle: Record<string, unknown>, serviceName: string) {
  if (vehicle.status !== "ACTIVE") return false;
  const type = String(vehicle.vehicle_type);
  const seats = Number(vehicle.seat_count || 0);
  if (serviceName === "BIKE") return type === "BIKE";
  if (serviceName === "CAR_4") return ["CAR", "CAR_4"].includes(type) && seats >= 4;
  if (serviceName === "CAR_7") return ["CAR", "CAR_7"].includes(type) && seats >= 7;
  if (serviceName === "PREMIUM") return ["CAR", "CAR_4", "CAR_7"].includes(type) && seats >= 4;
  return false;
}

async function claimAvailableDriver(serviceName: string, tripId: string, excludedDriverIds = new Set<string>()) {
  return withDriverAssignmentLock(async () => {
    const [drivers, vehicles] = await Promise.all([listDrivers(100), listVehicles(100)]);
    const vehicleByDriver = new Map(
      vehicles.filter((vehicle) => supportsService(vehicle, serviceName))
        .map((vehicle) => [String(vehicle.driver_id), vehicle]),
    );
    const compatibleCandidates = drivers.filter((driver) =>
      driver.account_status === "ACTIVE"
      && driver.driver_status === "AVAILABLE"
      && !excludedDriverIds.has(String(driver.driver_id))
      && vehicleByDriver.has(String(driver.driver_id)),
    );
    const candidates = [] as typeof compatibleCandidates;
    for (const driver of compatibleCandidates) {
      const trips = (await queryAll("SELECT * FROM trips_by_id")).filter((trip) => trip.driver_id === driver.driver_id);
      if (!trips.some((trip) => activeTripStatuses.has(String(trip.status)))) candidates.push(driver);
    }

    if (!candidates.length) {
      throw new ApiError("Hiện chưa có tài xế phù hợp đang rảnh. Vui lòng thử lại sau ít phút.", 409);
    }

    const driver = candidates[randomInt(candidates.length)];
    return { driver, vehicle: vehicleByDriver.get(String(driver.driver_id))! };
  });
}

export async function reassignTripAfterDriverCancellation(tripId: string, cancellingDriverId: string, note?: string, actor?: Session, requestKey?: string) {
  if (businessJournalEnabled()) {
    if (!actor || !requestKey) throw new ApiError("Không thể xác minh yêu cầu.", 403);
    return reassignTripDurably(tripId, actor, note, requestKey);
  }
  return demoMutation<Record<string, unknown>>(`incident:${tripId}:${cancellingDriverId}:${requestKey || "incident"}`, { tripId, cancellingDriverId }, async () => {
    const trip = await getTrip(tripId) as Record<string, unknown> | null;
    if (!trip || String(trip.driver_id) !== cancellingDriverId) throw new ApiError("Bạn không được phân công chuyến này.", 403);
    if (!["BOOKED", "ACCEPTED", "ARRIVING"].includes(String(trip.status))) throw new ApiError("Chuyến đã khởi hành hoặc kết thúc.", 409);
    const service = await getServiceById(String(trip.service_id));
    if (!service || service.status !== "ACTIVE") throw new ApiError("Dịch vụ không khả dụng.", 409);
    let assignment;
    try { assignment = await claimAvailableDriver(String(service.service_name), tripId, new Set([cancellingDriverId])); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 409) throw error; }
    const history = await getTripHistory(tripId);
    const at = new Date(Math.max(Date.now(), ...history.map((row) => new Date(String(row.changed_at)).getTime() + 1)));
    const offline = { query: "UPDATE drivers SET driver_status = ? WHERE driver_id = ?", params: ["OFFLINE", cancellingDriverId] };
    const notification = demoInsert("notifications_by_user", { user_id: trip.customer_id, created_at: at, notification_id: uuid(),
      title: assignment ? "RideFlow đã đổi tài xế" : "Chuyến đã hủy", content: assignment ? `Tài xế mới: ${String(assignment.driver.full_name)}` : "Chưa có tài xế thay thế.", notification_type: "TRIP", is_read: false });
    if (!assignment) {
      const plan = await prepareDemoStatus(tripId, "CANCELLED", note);
      plan.statements.push(offline, notification);
      return { statements: plan.statements, result: { ...plan.result, reassigned: false, newDriverId: undefined, newDriverName: undefined } };
    }
    const { driver, vehicle } = assignment;
    const updated = { ...trip, driver_id: driver.driver_id, vehicle_id: vehicle.vehicle_id, status: "BOOKED", booked_at: new Date(String(trip.booked_at)), started_at: null, completed_at: null };
    return { statements: [demoInsert("trips_by_id", updated), ...tripProjections(updated),
      { query: "DELETE FROM trips_by_driver WHERE driver_id = ? AND booked_at = ? AND trip_id = ?", params: [cancellingDriverId, new Date(String(trip.booked_at)), tripId] },
      { query: "UPDATE drivers SET driver_status = ? WHERE driver_id = ?", params: ["BUSY", driver.driver_id] }, offline, notification,
      demoInsert("notifications_by_user", driverAssignmentNotification({ tripId, driverId: String(driver.driver_id), pickup: String(trip.pickup_address), destination: String(trip.destination_address), fare: trip.final_fare, at })),
      demoInsert("trip_status_history", { trip_id: tripId, changed_at: at, status: "BOOKED", note: `RideFlow đã đổi tài xế sang ${String(driver.full_name)}` }),
    ], result: { ...updated, reassigned: true, newDriverId: driver.driver_id, newDriverName: driver.full_name } };
  });
}

export async function changeTripStatus(tripId: string, nextStatus: string, note?: string, actor?: Session, requestKey?: string) {
  if (businessJournalEnabled()) {
    if (!actor || !requestKey) throw new ApiError("Không thể xác minh yêu cầu.", 403);
    return changeTripStatusDurably(tripId, nextStatus, note, actor, requestKey);
  }
  return demoMutation(`status:${tripId}:${nextStatus}`, { tripId, nextStatus }, () => prepareDemoStatus(tripId, nextStatus, note), false);
}
