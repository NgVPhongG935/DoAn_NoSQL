import { withBusinessRead } from "@/lib/business-journal";
import { getSession } from "@/lib/auth";
import { hasAdminPermission, requireTripAccess } from "@/lib/authorization";
import { failure, notFound, success, unauthorized } from "@/lib/http";
import { getDriver, getVehicle } from "@/repositories/accounts";
import { getPaymentsForTrip, getReviewForTrip, getServiceById, getTrip, getTripHistory } from "@/repositories/ride-data";
import { queryAll } from "@/lib/cassandra";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    if (!session) return unauthorized();
    return await withBusinessRead(async () => {
      const trip = await getTrip(id) as Record<string, unknown> | null;
      if (!trip) return notFound("Không tìm thấy chuyến đi.");
      requireTripAccess(session, trip);
      const [history, payments, review, driver, vehicle, service] = await Promise.all([
        getTripHistory(id),
        session.role !== "ADMIN" || hasAdminPermission(session, "payments:read") ? getPaymentsForTrip(id) : Promise.resolve([]),
        session.role !== "ADMIN" || hasAdminPermission(session, "reviews:read") ? getReviewForTrip(id) : Promise.resolve(null),
        getDriver(String(trip.driver_id)),
        getVehicle(String(trip.vehicle_id)),
        getServiceById(String(trip.service_id)),
      ]);
      const contact = driver ? {
        driver_id: driver.driver_id, full_name: driver.full_name, phone: driver.phone, rating: driver.rating,
      } : null;
      const tripVehicle = vehicle ? {
        vehicle_id: vehicle.vehicle_id, brand: vehicle.brand, model: vehicle.model,
        license_plate: vehicle.license_plate, vehicle_type: vehicle.vehicle_type,
        color: vehicle.color, seat_count: vehicle.seat_count,
      } : null;
      let reviewSynced = true;
      if (review) {
        const reviews = await queryAll("SELECT * FROM reviews_by_driver WHERE driver_id = ?", [trip.driver_id]);
        const mirror = reviews.find((row) => row.trip_id === id && row.review_id === review.review_id && String(row.created_at) === String(review.created_at));
        const rated = reviews.filter((row) => Number(row.rating) >= 1 && Number(row.rating) <= 5);
        const average = rated.length ? Number((rated.reduce((total, row) => total + Number(row.rating), 0) / rated.length).toFixed(2)) : 0;
        reviewSynced = !!mirror && mirror.customer_id === review.customer_id && Number(mirror.rating) === Number(review.rating)
          && String(mirror.comment || "") === String(review.comment || "") && Math.abs(Number(driver?.rating) - average) < 0.005;
      }
      return success({ ...trip, history, payments, review, reviewSynced, driver: contact, vehicle: tripVehicle, service });
    });
  } catch (error) {
    return failure(error);
  }
}
