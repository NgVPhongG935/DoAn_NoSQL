import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireAdminPermission } from "@/lib/authorization";
import { query } from "@/lib/cassandra";
import { ApiError, failure, notFound, success } from "@/lib/http";
import { supportRecordKey } from "@/services/admin-support";

const statusSchema = z.object({ status: z.enum(["PROCESSING", "RESOLVED"]) });
const allowedTransitions: Record<string, string[]> = { OPEN: ["PROCESSING", "RESOLVED"], PROCESSING: ["RESOLVED"] };

export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string; createdAt: string; complaintId: string }> }) {
  try {
    const session = await getSession();
    requireAdminPermission(session, "complaints:write");
    const { customerId, createdAt: encodedCreatedAt, complaintId } = await params;
    const { createdAt } = supportRecordKey(customerId, encodedCreatedAt, complaintId);
    const { status } = statusSchema.parse(await request.json());
    const current = await query(
      "SELECT status, resolved_at FROM complaints_by_customer WHERE customer_id = ? AND created_at = ? AND complaint_id = ?",
      [customerId, createdAt, complaintId],
    );
    if (!current[0]) return notFound("Không tìm thấy khiếu nại.");
    const previousStatus = String(current[0].status);
    if (previousStatus === status) return success({ customerId, complaintId, status, resolvedAt: current[0].resolved_at });
    if (!allowedTransitions[previousStatus]?.includes(status)) {
      throw new ApiError(`Không thể chuyển khiếu nại từ ${previousStatus} sang ${status}.`, 409);
    }
    const resolvedAt = status === "RESOLVED" ? new Date() : null;
    await query(
      "UPDATE complaints_by_customer SET status = ?, resolved_at = ? WHERE customer_id = ? AND created_at = ? AND complaint_id = ?",
      [status, resolvedAt, customerId, createdAt, complaintId],
    );
    return success({ customerId, complaintId, status, resolvedAt: resolvedAt?.toISOString() ?? null });
  } catch (error) {
    return failure(error);
  }
}
