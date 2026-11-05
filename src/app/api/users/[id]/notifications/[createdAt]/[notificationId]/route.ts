import { getSession } from "@/lib/auth";
import { z } from "zod";
import { query } from "@/lib/cassandra";
import { ApiError, failure, notFound, success, unauthorized } from "@/lib/http";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string; createdAt: string; notificationId: string }> }) {
  try {
    const session = await getSession();
    const { id, createdAt, notificationId } = await params;
    if (!session || session.userId !== id) return unauthorized();
    z.uuid().parse(id); z.uuid().parse(notificationId);
    let decoded: string;
    try { decoded = decodeURIComponent(createdAt); } catch { throw new ApiError("Thời gian thông báo không hợp lệ."); }
    const timestamp = new Date(decoded);
    if (Number.isNaN(timestamp.valueOf())) throw new ApiError("Thời gian thông báo không hợp lệ.");
    const existing = await query("SELECT is_read FROM notifications_by_user WHERE user_id = ? AND created_at = ? AND notification_id = ?", [id, timestamp, notificationId]);
    if (!existing[0]) return notFound("Không tìm thấy thông báo.");
    if (existing[0].is_read === true) return success({ notificationId, isRead: true });
    await query(
      "UPDATE notifications_by_user SET is_read = true WHERE user_id = ? AND created_at = ? AND notification_id = ?",
      [id, timestamp, notificationId],
    );
    return success({ notificationId, isRead: true });
  } catch (error) {
    return failure(error);
  }
}
