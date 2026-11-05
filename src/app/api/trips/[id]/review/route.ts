import { z } from "zod";
import { getSession } from "@/lib/auth";
import { queryAll, uuid } from "@/lib/cassandra";
import { failure, success, unauthorized } from "@/lib/http";
import { getReviewForTrip, getTrip } from "@/repositories/ride-data";
import { businessJournalEnabled } from "@/lib/business-journal";
import { reviewTripDurably } from "@/services/business-resources";
import { demoMutation } from "@/lib/demo-mutation";
import { demoInsert } from "@/services/demo-trip-status";
import { ApiError } from "@/lib/http";

const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default("") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    if (!session || session.role !== "CUSTOMER") return unauthorized();
    z.uuid().parse(id);
    const trip = await getTrip(id) as Record<string, unknown> | null;
    if (!trip) throw new ApiError("Không tìm thấy chuyến.", 404);
    if (trip.customer_id !== session.userId) throw new ApiError("Bạn không có quyền đánh giá chuyến này.", 403);
    if (trip.status !== "COMPLETED") throw new ApiError("Chỉ được đánh giá chuyến đã hoàn thành.", 409);
    const body = reviewSchema.parse(await request.json());
    if (businessJournalEnabled()) return success(await reviewTripDurably(id, body.rating, body.comment, session), 201);
    const result = await demoMutation(`review:${id}`, { customerId: session.userId, ...body }, async () => {
      const existing = await getReviewForTrip(id);
      if (existing && (Number(existing.rating) !== body.rating || String(existing.comment || "") !== body.comment || existing.customer_id !== session.userId || existing.driver_id !== trip.driver_id)) {
        throw new ApiError("Chuyến đã có đánh giá với nội dung khác.", 409);
      }
      const reviewId = existing?.review_id || uuid();
      const createdAt = existing?.created_at ? new Date(String(existing.created_at)) : new Date();
      const reviews = await queryAll("SELECT * FROM reviews_by_driver WHERE driver_id = ?", [trip.driver_id]);
      const rated = reviews.filter((item) => item.trip_id !== id && Number(item.rating) >= 1 && Number(item.rating) <= 5);
      const average = Number(((rated.reduce((sum, item) => sum + Number(item.rating), 0) + body.rating) / (rated.length + 1)).toFixed(2));
      return { statements: [
        demoInsert("reviews_by_trip", { trip_id: id, review_id: reviewId, customer_id: session.userId, driver_id: trip.driver_id, rating: body.rating, comment: body.comment, created_at: createdAt }),
        demoInsert("reviews_by_driver", { driver_id: trip.driver_id, created_at: createdAt, review_id: reviewId, trip_id: id, customer_id: session.userId, rating: body.rating, comment: body.comment }),
        { query: "UPDATE drivers SET rating = ? WHERE driver_id = ?", params: [average, trip.driver_id] },
      ], result: { reviewId, createdAt: createdAt.toISOString(), ratingAverage: average } };
    });
    return success(result, 201);
  } catch (error) {
    return failure(error);
  }
}
