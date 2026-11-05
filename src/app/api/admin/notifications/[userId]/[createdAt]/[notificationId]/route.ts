import { getSession } from "@/lib/auth";
import { requireAdminResource } from "@/lib/authorization";
import { failure, success } from "@/lib/http";
import { markAdminNotificationRead } from "@/services/admin-support";

export async function PATCH(_request: Request, { params }: { params: Promise<{ userId: string; createdAt: string; notificationId: string }> }) {
  try {
    requireAdminResource(await getSession(), "notifications", "write");
    const { userId, createdAt, notificationId } = await params;
    return success(await markAdminNotificationRead(userId, createdAt, notificationId));
  } catch (error) { return failure(error); }
}
