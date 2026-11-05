import { withBusinessRead } from "@/lib/business-journal";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { failure, success } from "@/lib/http";
import { getDriverRevenue } from "@/repositories/ride-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; month: string }> }) {
  try {
    const session = await getSession();
    const { id, month } = await params;
    requireOwnerOrAdmin(session, "DRIVER", id, "reports:read");
    return await withBusinessRead(async () => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return success({ error: "Tháng cần có định dạng YYYY-MM." }, 400);
      return success(await getDriverRevenue(id, month));
    });
  } catch (error) {
    return failure(error);
  }
}