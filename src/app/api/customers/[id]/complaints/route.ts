import { withBusinessRead } from "@/lib/business-journal";
import { z } from "zod";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { query, uuid } from "@/lib/cassandra";
import { ApiError, failure, success, unauthorized } from "@/lib/http";
import { getComplaints, getTrip } from "@/repositories/ride-data";

const complaintSchema = z.object({
  subject: z.string().trim().min(4).max(120),
  content: z.string().trim().min(10).max(2000),
  tripId: z.string().uuid().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "CUSTOMER", id, "complaints:read");
    return await withBusinessRead(async () => {
      return success(await getComplaints(id));
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    if (!session || session.role !== "CUSTOMER" || session.userId !== id) return unauthorized();
    const body = complaintSchema.parse(await request.json());
    if (body.tripId) {
      const trip = await getTrip(body.tripId);
      if (!trip || trip.customer_id !== session.userId) {
        throw new ApiError("Bạn không có quyền gửi khiếu nại cho chuyến đi này.", 403);
      }
    }
    const createdAt = new Date();
    const complaintId = uuid();
    await query(
      "INSERT INTO complaints_by_customer (customer_id, created_at, complaint_id, trip_id, subject, content, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, createdAt, complaintId, body.tripId || null, body.subject, body.content, "OPEN"],
    );
    return success({ complaintId, createdAt: createdAt.toISOString(), status: "OPEN" }, 201);
  } catch (error) {
    return failure(error);
  }
}
