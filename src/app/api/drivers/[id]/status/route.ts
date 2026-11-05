import { z } from "zod";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { withDriverAssignmentLock } from "@/lib/driver-assignment-lock";
import { failure, success } from "@/lib/http";
import { setDriverAvailability } from "@/services/business-resources";
import { idempotencyKey } from "@/lib/idempotency";

const schema = z.object({ status: z.enum(["AVAILABLE", "OFFLINE"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "DRIVER", id, "drivers:write");
    const { status } = schema.parse(await request.json());
    return success(await withDriverAssignmentLock(() => setDriverAvailability(id, status, idempotencyKey(request))));
  } catch (error) {
    return failure(error);
  }
}
