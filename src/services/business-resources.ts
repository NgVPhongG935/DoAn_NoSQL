import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Session } from "@/lib/auth";
import { businessJournalEnabled, businessRead, insertStatement, runBusinessOperation, timestampValue, updateStatement, type Plan, type Value } from "@/lib/business-journal";
import { query, jsonSafe } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";
import { ACTIVE_STATUSES, allCanonicalTrips, businessEntity, stableUuid } from "@/services/trip-plans";

const resources = {
  customers: ["customers", "customer_id"], drivers: ["drivers", "driver_id"], vehicles: ["vehicles", "vehicle_id"],
  services: ["service_types", "service_id"], vouchers: ["vouchers", "voucher_code"],
} as const;
const fare = z.number().finite().min(0).max(1_000_000_000);
export const serviceSchema = z.object({ serviceName: z.string().trim().min(2).max(40), description: z.string().trim().max(200), baseFare: fare, pricePerKm: fare.positive(), status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE") });
export const voucherSchema = z.object({
  voucherCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/), voucherName: z.string().trim().min(2).max(80),
  discountType: z.enum(["PERCENT", "FIXED"]), discountValue: fare.positive(), maxDiscount: fare, minTripAmount: fare,
  quantity: z.number().int().min(0).max(2_147_483_647), startDate: z.coerce.date(), endDate: z.coerce.date(), status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
}).refine((value) => value.startDate <= value.endDate, { path: ["endDate"], message: "Ngày kết thúc phải từ ngày bắt đầu trở đi." })
  .refine((value) => value.discountType !== "PERCENT" || value.discountValue <= 100, { path: ["discountValue"], message: "Giảm theo phần trăm không vượt quá 100%." });

async function entity(table: string, column: string, id: string) {
  if (businessJournalEnabled()) return businessEntity(table, column, id);
  return jsonSafe((await query(`SELECT * FROM ${table} WHERE ${column} = ?`, [id]))[0]);
}

export async function updateAdminResource(resource: keyof typeof resources, id: string, fields: Record<string, Value>, key: string, expectedDriverId?: string) {
  const [table, column] = resources[resource];
  if (resource !== "vouchers") z.uuid().parse(id);
  const validate = async () => {
    const current = await entity(table, column, id);
    if (!current) throw new ApiError("Không tìm thấy bản ghi cần cập nhật.", 404);
    if (resource === "vehicles") {
      const ownerId = String(current.driver_id ?? "");
      if (!z.uuid().safeParse(ownerId).success || !current.license_plate || !current.brand || !current.model) throw new ApiError("Phương tiện thiếu dữ liệu; cần đối soát trước khi cập nhật.", 409);
      const owner = await entity("drivers", "driver_id", ownerId);
      if (!owner || (expectedDriverId && expectedDriverId !== ownerId)) throw new ApiError("Phương tiện không thuộc tài xế được xác định.", 409);
      if (fields.status === "INACTIVE") {
        const trips = businessJournalEnabled() ? await allCanonicalTrips() : jsonSafe(await query("SELECT * FROM trips_by_id"));
        if (trips.some((trip) => trip.vehicle_id === id && ACTIVE_STATUSES.has(String(trip.status)))) throw new ApiError("Phương tiện đang có chuyến hoạt động nên chưa thể tạm ngưng.", 409);
      }
    }
  };
  if (businessJournalEnabled()) {
    return runBusinessOperation("admin-update", `admin-update:${resource}:${id}:${key}`, { resource, id, fields, expectedDriverId: expectedDriverId ?? null }, async (context) => {
      await validate();
      return { statements: [updateStatement(table, fields, { [column]: id }, context.timestamp)], result: { id, ...fields } };
    });
  }
  await validate();
  const names = Object.keys(fields);
  const values = Object.values(fields).map((value) => value && typeof value === "object" && "timestamp" in value ? new Date(value.timestamp) : value);
  await query(`UPDATE ${table} SET ${names.map((name) => `${name} = ?`).join(", ")} WHERE ${column} = ?`, [...values, id]);
  return { id, ...fields };
}

export async function setDriverAvailability(driverId: string, status: "AVAILABLE" | "OFFLINE", key: string) {
  const prepare = async () => {
    const driver = await entity("drivers", "driver_id", driverId);
    if (!driver) throw new ApiError("Không tìm thấy tài xế.", 404);
    if (driver.account_status !== "ACTIVE") throw new ApiError("Tài khoản tài xế không khả dụng.", 403);
    const trips = businessJournalEnabled() ? await allCanonicalTrips() : jsonSafe(await query("SELECT * FROM trips_by_id"));
    if (driver.driver_status === "BUSY" || trips.some((trip) => trip.driver_id === driverId && ACTIVE_STATUSES.has(String(trip.status)))) throw new ApiError("Tài xế đang có chuyến hoạt động nên chưa thể đổi trạng thái.", 409);
  };
  if (businessJournalEnabled()) return runBusinessOperation("driver-availability", `driver-availability:${driverId}:${key}`, { driverId, status }, async (context) => {
    await prepare();
    return { statements: [updateStatement("drivers", { driver_status: status }, { driver_id: driverId }, context.timestamp)], result: { id: driverId, status } };
  });
  await prepare();
  await query("UPDATE drivers SET driver_status = ? WHERE driver_id = ?", [status, driverId]);
  return { id: driverId, status };
}

export async function createAdminResource(resource: "services" | "vouchers" | "notifications", data: Record<string, Value>, key: string) {
  const prepare = async (id: string, at: string) => {
    if (resource === "vouchers" && await entity("vouchers", "voucher_code", String(data.voucher_code))) throw new ApiError("Mã voucher đã tồn tại.", 409);
    return resource === "services" ? { table: "service_types", record: { service_id: id, ...data }, result: { serviceId: id } }
      : resource === "vouchers" ? { table: "vouchers", record: data, result: { voucherCode: data.voucher_code } }
        : { table: "notifications_by_user", record: { ...data, created_at: timestampValue(at), notification_id: id, is_read: false }, result: { notificationId: id, createdAt: at } };
  };
  if (businessJournalEnabled()) return runBusinessOperation("admin-create", `admin-create:${resource}:${key}`, { resource, data }, async (context) => {
    const value = await prepare(stableUuid(context.operationId), context.at);
    return { statements: [insertStatement(value.table, value.record, context.timestamp)], result: value.result };
  });
  const value = await prepare(randomUUID(), new Date().toISOString());
  const names = Object.keys(value.record), values = Object.values(value.record).map((value) => value && typeof value === "object" && "timestamp" in value ? new Date(value.timestamp) : value);
  await query(`INSERT INTO ${value.table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, values);
  return value.result;
}

export async function reviewTripDurably(tripId: string, rating: number, comment: string, actor: Session) {
  return runBusinessOperation("trip-review", `trip-review:${tripId}`, { tripId, rating, comment, customerId: actor.userId }, async (context): Promise<Plan> => {
    const trip = await businessEntity("trips_by_id", "trip_id", tripId);
    if (!trip || actor.role !== "CUSTOMER" || trip.customer_id !== actor.userId) throw new ApiError("Không có quyền đánh giá chuyến.", 403);
    if (trip.status !== "COMPLETED") throw new ApiError("Chỉ được đánh giá chuyến đã hoàn thành.", 409);
    if (await businessEntity("reviews_by_trip", "trip_id", tripId)) throw new ApiError("Chuyến đã được đánh giá.", 409);
    const driverId = String(trip.driver_id), reviewId = stableUuid(`review:${tripId}`);
    const reviews = await businessRead("SELECT * FROM reviews_by_driver WHERE driver_id = ?", [driverId]);
    const rated = reviews.filter((row) => row.trip_id !== tripId && Number(row.rating) >= 1 && Number(row.rating) <= 5);
    const average = Number(((rated.reduce((total, row) => total + Number(row.rating), 0) + rating) / (rated.length + 1)).toFixed(2));
    return { statements: [
      insertStatement("reviews_by_trip", { trip_id: tripId, review_id: reviewId, customer_id: actor.userId, driver_id: driverId, rating, comment, created_at: timestampValue(context.at) }, context.timestamp),
      insertStatement("reviews_by_driver", { driver_id: driverId, created_at: timestampValue(context.at), review_id: reviewId, trip_id: tripId, customer_id: actor.userId, rating, comment }, context.timestamp),
      updateStatement("drivers", { rating: average }, { driver_id: driverId }, context.timestamp),
    ], result: { reviewId, createdAt: context.at, ratingAverage: average } };
  });
}
