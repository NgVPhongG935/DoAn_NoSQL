import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireAdminResource } from "@/lib/authorization";
import { failure, success } from "@/lib/http";

import { idempotencyKey } from "@/lib/idempotency";
import { serviceSchema, voucherSchema, updateAdminResource } from "@/services/business-resources";
import { timestampValue, type Value } from "@/lib/business-journal";
import { deleteManagedAccount, updateManagedAccount } from "@/services/admin-accounts";

export async function PATCH(request: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await getSession();
    const { resource, id } = await params;
    requireAdminResource(session, resource, "write");
    const body = await request.json();
    if (resource === "customers" || resource === "drivers") return success(await updateManagedAccount(resource, id, body));
    let fields: Record<string, Value>;
    if (resource === "vehicles") fields = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).parse(body);
    else if (resource === "services" || resource === "vouchers") {
      const statusOnly = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).safeParse(body);
      if (statusOnly.success && Object.keys(body).length === 1) fields = statusOnly.data;
      else if (resource === "services") {
        const data = serviceSchema.parse(body);
        fields = { service_name: data.serviceName, description: data.description, base_fare: String(data.baseFare), price_per_km: String(data.pricePerKm), status: data.status };
      } else {
        const data = voucherSchema.parse({ ...body, voucherCode: id });
        fields = { voucher_name: data.voucherName, discount_type: data.discountType, discount_value: String(data.discountValue), max_discount: String(data.maxDiscount), min_trip_amount: String(data.minTripAmount), quantity: data.quantity, start_date: timestampValue(data.startDate.toISOString()), end_date: timestampValue(data.endDate.toISOString()), status: data.status };
      }
    } else return success({ error: "Tài nguyên chưa hỗ trợ cập nhật." }, 405);
    const expectedDriverId = resource === "vehicles" && body.driverId !== undefined ? z.uuid().parse(body.driverId) : undefined;
    return success(await updateAdminResource(resource as "customers" | "drivers" | "vehicles" | "services" | "vouchers", id, fields, idempotencyKey(request), expectedDriverId));
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await getSession();
    const { resource, id } = await params;
    requireAdminResource(session, resource, "write");
    if (resource !== "customers" && resource !== "drivers") return success({ error: "Tài nguyên chưa hỗ trợ xóa." }, 405);
    return success(await deleteManagedAccount(resource, id));
  } catch (error) { return failure(error); }
}
