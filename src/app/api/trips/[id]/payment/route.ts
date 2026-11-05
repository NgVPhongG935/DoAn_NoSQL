import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireTripAccess } from "@/lib/authorization";
import { withBusinessRead } from "@/lib/business-journal";
import { idempotencyKey } from "@/lib/idempotency";
import { failure, notFound, success, unauthorized } from "@/lib/http";
import { getPaymentsForTrip, getTrip } from "@/repositories/ride-data";
import { changeTransferPayment } from "@/services/payments";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    const { id } = await params; z.uuid().parse(id);
    return await withBusinessRead(async () => {
      const trip = await getTrip(id);
      if (!trip) return notFound("Không tìm thấy chuyến.");
      requireTripAccess(session, trip);
      return success({ payments: await getPaymentsForTrip(id), method: trip.payment_method, tripStatus: trip.status, role: session.role });
    });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const session = await getSession();
    if (!session) return unauthorized();
    const { id } = await params; z.uuid().parse(id);
    const body = z.object({ action: z.enum(["REPORT_TRANSFER","CONFIRM_TRANSFER","REJECT_TRANSFER"]) }).parse(await request.json());
    return success(await changeTransferPayment(id, body.action, session, idempotencyKey(request)));
  } catch (error) { return failure(error); }
}
