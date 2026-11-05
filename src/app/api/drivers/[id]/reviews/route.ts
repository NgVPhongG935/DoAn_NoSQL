import { withBusinessRead } from "@/lib/business-journal";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { failure, success } from "@/lib/http";
import { getReviewsForDriver } from "@/repositories/ride-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "DRIVER", id, "reviews:read");
    return await withBusinessRead(async () => {
      return success(await getReviewsForDriver(id));
    });
  } catch (error) {
    return failure(error);
  }
}