import { withBusinessRead } from "@/lib/business-journal";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireAdminResource } from "@/lib/authorization";
import { idempotencyKey } from "@/lib/idempotency";
import { serviceSchema, voucherSchema, createAdminResource } from "@/services/business-resources";
import { timestampValue } from "@/lib/business-journal";
import { ApiError, failure, success } from "@/lib/http";
import { getCustomer, getDriver, listCustomers, listDrivers, listVehicles } from "@/repositories/accounts";
import { getRecentAdminTrips, getReviewForTrip, getServices, getVouchers } from "@/repositories/ride-data";
import { getAdminDashboard } from "@/services/dashboard";

import { currentReportMonth } from "@/lib/business-values";
import { createManagedAccount } from "@/services/admin-accounts";
import { listSupportRecipients, listSupportRecords } from "@/services/admin-support";
import { listAdminPayments } from "@/services/admin-payments";
import { listAdminTrips } from "@/services/admin-trips";

const notificationSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().trim().min(2).max(100),
  content: z.string().trim().min(5).max(1000),
  notificationType: z.string().trim().min(2).max(40).default("SYSTEM"),
});

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const session = await getSession();
    const { resource } = await params;
    requireAdminResource(session, resource, "read");
    return await withBusinessRead(async () => {
      const url = new URL(request.url);
      if (resource === "trips") {
        const tripMonth = url.searchParams.get("month");
        if (tripMonth && tripMonth !== "ALL" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(tripMonth)) {
          throw new ApiError("Tháng cần có định dạng YYYY-MM.", 400);
        }
        return success(await listAdminTrips(tripMonth && tripMonth !== "ALL" ? tripMonth : undefined));
      }
      if (resource === "payments") {
        const paymentMonth = url.searchParams.get("month");
        if (paymentMonth && paymentMonth !== "ALL" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(paymentMonth)) {
          throw new ApiError("Tháng cần có định dạng YYYY-MM.", 400);
        }
        return success(await listAdminPayments(paymentMonth && paymentMonth !== "ALL" ? paymentMonth : undefined));
      }
      const month = url.searchParams.get("month") ?? currentReportMonth();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return success({ error: "Tháng cần có định dạng YYYY-MM." }, 400);
      if (resource === "customers") return success(await listCustomers(100));
      if (resource === "drivers") {
        const [drivers, vehicles] = await Promise.all([listDrivers(100), listVehicles(100)]);
        const vehicleByDriver = new Map(vehicles.map((vehicle) => [String(vehicle.driver_id), vehicle]));
        return success(drivers.map((driver) => {
          const vehicle = vehicleByDriver.get(String(driver.driver_id));
          return vehicle ? { ...driver, license_plate: vehicle.license_plate, vehicle_type: vehicle.vehicle_type,
            vehicle_brand: vehicle.brand, vehicle_model: vehicle.model, vehicle_color: vehicle.color,
            vehicle_seat_count: vehicle.seat_count } : driver;
        }));
      }
      if (resource === "vehicles") return success(await listVehicles(100));
      if (resource === "services") return success(await getServices(100));
      if (resource === "vouchers") return success(await getVouchers(100));
      if (resource === "reviews") {
        const completed = (await getRecentAdminTrips(month)).filter((trip) => trip.status === "COMPLETED");
        const records = await Promise.all(completed.map((trip) => getReviewForTrip(String(trip.trip_id))));
        return success(records.flat().filter(Boolean));
      }
      if (resource === "complaints" || resource === "notifications") {
        if (resource === "notifications" && url.searchParams.get("recipients") === "true") {
          return success(await listSupportRecipients());
        }
        return success(await listSupportRecords(resource));
      }
      if (resource === "reports") return success(await getAdminDashboard(month));
      return success({ unavailable: true, message: "Tài nguyên này chưa được hỗ trợ." }, 501);
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const session = await getSession();
    const { resource } = await params;
    requireAdminResource(session, resource, "write");
    const body = await request.json();
    if (resource === "customers" || resource === "drivers") return success(await createManagedAccount(resource, body), 201);
    const key = idempotencyKey(request);
    if (resource === "services") {
      const data = serviceSchema.parse(body);
      return success(await createAdminResource("services", { service_name: data.serviceName, description: data.description, base_fare: String(data.baseFare), price_per_km: String(data.pricePerKm), status: data.status }, key), 201);
    }
    if (resource === "vouchers") {
      const data = voucherSchema.parse(body);
      return success(await createAdminResource("vouchers", { voucher_code: data.voucherCode, voucher_name: data.voucherName, discount_type: data.discountType, discount_value: String(data.discountValue), max_discount: String(data.maxDiscount), min_trip_amount: String(data.minTripAmount), quantity: data.quantity, start_date: timestampValue(data.startDate.toISOString()), end_date: timestampValue(data.endDate.toISOString()), status: data.status }, key), 201);
    }
    if (resource === "notifications") {
      const data = notificationSchema.parse(body);
      const [customer, driver] = await Promise.all([getCustomer(data.userId), getDriver(data.userId)]);
      if (!customer && !driver) throw new ApiError("Không tìm thấy người nhận.", 404);
      return success(await createAdminResource("notifications", { user_id: data.userId, title: data.title, content: data.content, notification_type: data.notificationType }, key), 201);
    }
    return success({ error: "Tài nguyên này chưa cho phép tạo." }, 405);
  } catch (error) { return failure(error); }
}
