import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireAdminPermission, requireOwnerOrAdmin } from "@/lib/authorization";
import { MAX_AVATAR_BYTES, readAvatar, removeAvatar, saveAvatar } from "@/lib/account-avatars";
import { ApiError, failure, success } from "@/lib/http";
import { getCustomer, getDriver } from "@/repositories/accounts";

export const runtime = "nodejs";
type Context = { params: Promise<{ role: string; id: string }> };
async function authorize(context: Context) {
  const session = await getSession();
  if (!session) throw new ApiError("Vui lòng đăng nhập lại.", 401);
  const params = await context.params;
  const role = z.enum(["CUSTOMER", "DRIVER", "ADMIN"]).parse(params.role);
  if (role === "ADMIN") {
    requireAdminPermission(session);
    if (params.id !== session.userId) throw new ApiError("Không tìm thấy tài khoản.", 404);
  } else {
    requireOwnerOrAdmin(session, role, params.id);
    z.uuid().parse(params.id);
    const account = role === "CUSTOMER" ? await getCustomer(params.id) : await getDriver(params.id);
    if (!account) throw new ApiError("Không tìm thấy tài khoản.", 404);
  }
  return { role, id: params.id };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { role, id } = await authorize(context);
    const avatar = await readAvatar(role, id);
    if (!avatar) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(avatar.bytes), { headers: {
      "Content-Type": avatar.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { role, id } = await authorize(context);
    // Reject oversized multipart bodies before reading them into memory.
    if (Number(request.headers.get("content-length")) > MAX_AVATAR_BYTES + 65536) throw new ApiError("Ảnh đại diện tối đa 2 MB.", 413);
    const form = await request.formData();
    const file = form.get("avatar");
    if (!(file instanceof File)) throw new ApiError("Vui lòng chọn ảnh đại diện.");
    await saveAvatar(role, id, file);
    return success({ saved: true });
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { role, id } = await authorize(context);
    await removeAvatar(role, id);
    return success({ removed: true });
  } catch (error) { return failure(error); }
}
