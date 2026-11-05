import type { Session } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getAdminAccount } from "@/lib/security-config";

export function hasAdminPermission(session: Session | null, permission?: string) {
  const admin = getAdminAccount();
  return !!session && session.role === "ADMIN" && session.userId === admin?.id
    && session.email === admin.email;
}

export function requireAdminPermission(session: Session | null, permission?: string) {
  if (!session) throw new ApiError("Vui lòng đăng nhập lại.", 401);
  if (!hasAdminPermission(session, permission)) {
    throw new ApiError("Bạn không có quyền thực hiện thao tác này.", 403);
  }
}

export function requireAdminResource(session: Session | null, resource: string, action: "read" | "write") {
  if (!session) throw new ApiError("Vui lòng đăng nhập lại.", 401);
  if (session.role !== "ADMIN") throw new ApiError("Bạn không có quyền quản trị.", 403);
  const resources = ["customers", "drivers", "vehicles", "services", "vouchers", "trips", "payments", "reviews", "complaints", "notifications", "reports"];
  if (!resources.includes(resource)) throw new ApiError("Không tìm thấy tài nguyên.", 404);
  requireAdminPermission(session);
}

export function requireOwnerOrAdmin(
  session: Session | null, role: "CUSTOMER" | "DRIVER", ownerId: string, permission?: string,
) {
  if (!session) throw new ApiError("Vui lòng đăng nhập lại.", 401);
  if (session.role === "ADMIN") return requireAdminPermission(session, permission);
  if (session.role !== role || session.userId !== ownerId) {
    throw new ApiError("Bạn không có quyền truy cập dữ liệu này.", 403);
  }
  if (role === "DRIVER" && session.accountStatus && session.accountStatus !== "ACTIVE") {
    throw new ApiError("Tài khoản tài xế chưa được duyệt hoặc không khả dụng.", 403);
  }
}

export function requireTripAccess(session: Session | null, trip: Record<string, unknown>, write = false) {
  if (!session) throw new ApiError("Vui lòng đăng nhập lại.", 401);
  if (session.role === "ADMIN") return requireAdminPermission(session, write ? "trips:write" : "trips:read");
  if (session.role === "DRIVER" && session.accountStatus && session.accountStatus !== "ACTIVE") {
    throw new ApiError("Tài khoản tài xế chưa được duyệt hoặc không khả dụng.", 403);
  }
  const owner = session.role === "CUSTOMER" ? trip.customer_id : session.role === "DRIVER" ? trip.driver_id : null;
  if (owner !== session.userId) throw new ApiError("Bạn không có quyền truy cập chuyến đi này.", 403);
}
