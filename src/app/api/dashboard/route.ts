import { withBusinessRead } from "@/lib/business-journal";
import { getSession } from "@/lib/auth";
import { requireAdminPermission } from "@/lib/authorization";
import { failure, success, unauthorized } from "@/lib/http";
import { getAdminDashboard, getCustomerDashboard, getDriverDashboard } from "@/services/dashboard";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    const month = new URL(request.url).searchParams.get("month");
    if (session.role === "CUSTOMER") return success(await withBusinessRead(() => getCustomerDashboard(session.userId, month)));
    if (session.role === "DRIVER") return success(await withBusinessRead(() => getDriverDashboard(session.userId, month)));
    requireAdminPermission(session, "reports:read");
    return success(await withBusinessRead(() => getAdminDashboard(month)));
  } catch (error) {
    return failure(error);
  }
}
