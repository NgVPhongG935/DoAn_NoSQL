import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";
import { getNotifications } from "@/repositories/ride-data";
import { withBusinessRead } from "@/lib/business-journal";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    if (!session || session.userId !== id) return unauthorized();
    return await withBusinessRead(async () => success(await getNotifications(id)));
  } catch (error) {
    return failure(error);
  }
}
