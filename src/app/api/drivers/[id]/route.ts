import { withBusinessRead } from "@/lib/business-journal";
import { hasAdminPermission, requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { z } from "zod";
import { query } from "@/lib/cassandra";
import { failure, notFound, success } from "@/lib/http";
import { getDriver, getVehiclesForDriver } from "@/repositories/accounts";

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^[+0-9 ()-]{8,18}$/),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "DRIVER", id, "drivers:read");
    return await withBusinessRead(async () => {
      const driver = await getDriver(id);
      if (!driver) return notFound("Không tìm thấy tài xế.");
      const vehicles = session?.role !== "ADMIN" || hasAdminPermission(session, "vehicles:read")
        ? await getVehiclesForDriver(id) : [];
      return success({ ...driver, vehicles });
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "DRIVER", id, "drivers:write");
    const body = updateSchema.parse(await request.json());
    if (!(await getDriver(id))) return notFound("Không tìm thấy tài xế.");
    await query("UPDATE drivers SET full_name = ?, phone = ? WHERE driver_id = ?", [body.fullName, body.phone, id]);
    return success(await getDriver(id));
  } catch (error) {
    return failure(error);
  }
}
