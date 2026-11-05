import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireAdminPermission, requireTripAccess } from "@/lib/authorization";
import { ApiError, failure, success, unauthorized } from "@/lib/http";
import { getTrip } from "@/repositories/ride-data";
import { changeTripStatus, reassignTripAfterDriverCancellation } from "@/services/trips";
import { idempotencyKey } from "@/lib/idempotency";
import { businessJournalEnabled } from "@/lib/business-journal";

const bodySchema = z.object({
  status: z.enum(["ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  note: z.string().trim().max(160).optional(),
  cashReceived: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    if (!session) return unauthorized();
    if (session.role === "DRIVER" && session.accountStatus !== "ACTIVE") {
      throw new ApiError("Tài khoản tài xế chưa được duyệt hoặc không khả dụng.", 403);
    }
    if (businessJournalEnabled()) {
      const body = bodySchema.parse(await request.json());
      if (session.role === "CUSTOMER" && body.status !== "CANCELLED") return unauthorized();
      if (body.status === "COMPLETED") {
        const current = await getTrip(id);
        if (current) {
          requireTripAccess(session, current, true);
          if (current.payment_method === "CASH" && body.cashReceived !== true) throw new ApiError("Cần xác nhận đã thu tiền mặt trước khi hoàn thành chuyến.");
        }
      }
      const key = idempotencyKey(request);
      if (session.role === "ADMIN") requireAdminPermission(session, "trips:write");
      if (session.role === "CUSTOMER" && body.status !== "CANCELLED") return unauthorized();
      if (session.role === "DRIVER" && body.status === "CANCELLED") {
        return success(await reassignTripAfterDriverCancellation(id, session.userId, body.note, session, key));
      }
      return success(await changeTripStatus(id, body.status, body.note, session, key));
    }
    const body = bodySchema.parse(await request.json());
    if (session.role === "CUSTOMER" && body.status !== "CANCELLED") return unauthorized();
    const key = idempotencyKey(request);
    // A timed-out reassignment may already have changed driver_id. The service
    // validates the signed driver's ownership when preparing a new request and
    // only replays a cached request scoped to that same driver.
    if (session.role === "DRIVER" && body.status === "CANCELLED") {
      return success(await reassignTripAfterDriverCancellation(id, session.userId, body.note, session, key));
    }
    const trip = await getTrip(id) as Record<string, unknown> | null;
    if (!trip) return unauthorized();
    requireTripAccess(session, trip, true);
    if (body.status === "COMPLETED" && trip.payment_method === "CASH" && body.cashReceived !== true) throw new ApiError("Cần xác nhận đã thu tiền mặt trước khi hoàn thành chuyến.");
    if (session.role === "CUSTOMER"
      && (session.userId !== trip.customer_id || body.status !== "CANCELLED")) return unauthorized();
    return success(await changeTripStatus(id, body.status, body.note, session, key));
  } catch (error) {
    return failure(error);
  }
}
