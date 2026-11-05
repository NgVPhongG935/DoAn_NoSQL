import { z } from "zod";
import { readAdminComplaints, readAdminNotifications, readSupportUsers } from "@/repositories/admin-support";
import { query } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";

export { readSupportUsers as listSupportRecipients };
const newestFirst = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(b.created_at || "").localeCompare(String(a.created_at || ""));

export async function listSupportRecords(resource: "complaints" | "notifications") {
  const [rows, users] = await Promise.all([
    resource === "complaints" ? readAdminComplaints() : readAdminNotifications(), readSupportUsers(),
  ]);
  return rows.map((row) => {
    const ownerId = String(resource === "complaints" ? row.customer_id : row.user_id);
    const user = users.find((user) => user.user_id === ownerId && (resource !== "complaints" || user.user_role === "CUSTOMER"));
    return { ...row, user_name: user?.user_name || "Tài khoản không còn trong danh sách", user_role: user?.user_role || "UNKNOWN" };
  }).sort(newestFirst);
}

export function supportRecordKey(ownerId: string, encodedCreatedAt: string, recordId: string) {
  z.uuid().parse(ownerId); z.uuid().parse(recordId);
  let decoded: string;
  try { decoded = decodeURIComponent(encodedCreatedAt); }
  catch { throw new ApiError("Thời gian bản ghi không hợp lệ."); }
  const createdAt = new Date(decoded);
  if (Number.isNaN(createdAt.valueOf())) throw new ApiError("Thời gian bản ghi không hợp lệ.");
  return { ownerId, createdAt, recordId };
}

export async function markAdminNotificationRead(userId: string, encodedCreatedAt: string, notificationId: string) {
  const key = supportRecordKey(userId, encodedCreatedAt, notificationId);
  const current = await query("SELECT is_read FROM notifications_by_user WHERE user_id = ? AND created_at = ? AND notification_id = ?", [key.ownerId, key.createdAt, key.recordId]);
  if (!current[0]) throw new ApiError("Không tìm thấy thông báo.", 404);
  // Guard against Cassandra UPDATE creating a partial phantom record.
  if (current[0].is_read !== true) await query("UPDATE notifications_by_user SET is_read = true WHERE user_id = ? AND created_at = ? AND notification_id = ?", [key.ownerId, key.createdAt, key.recordId]);
  return { userId, notificationId, createdAt: key.createdAt.toISOString(), isRead: true };
}
