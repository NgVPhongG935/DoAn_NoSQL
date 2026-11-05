import { z } from "zod";
import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";
import { bookTrip } from "@/services/trips";
import { idempotencyKey } from "@/lib/idempotency";
import { businessJournalEnabled } from "@/lib/business-journal";

const bookingSchema = z.object({
  serviceId: z.string().uuid(),
  pickup: z.object({
    label: z.string().trim().min(3).max(180),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  destination: z.object({
    label: z.string().trim().min(3).max(180),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]).default("CASH"),
  voucherCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "CUSTOMER") return unauthorized();
    const body = bookingSchema.parse(await request.json());
    const key = idempotencyKey(request, businessJournalEnabled());
    return success(await bookTrip({ ...body, customerId: session.userId }, key), 201);
  } catch (error) {
    return failure(error);
  }
}
