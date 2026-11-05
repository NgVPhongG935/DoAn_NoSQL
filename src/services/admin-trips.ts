import { queryAll } from "@/lib/cassandra";
import { currentReportMonth } from "@/lib/business-values";

// The demo's authoritative trip table contains history across every month.
// Page through it instead of relying on a possibly incomplete status projection.
export async function listAdminTrips(month?: string) {
  const [trips, customers, drivers] = await Promise.all([
    queryAll("SELECT * FROM trips_by_id"),
    queryAll("SELECT customer_id, full_name FROM customers"),
    queryAll("SELECT driver_id, full_name FROM drivers"),
  ]);
  const customerNames = new Map(customers.map((row) => [String(row.customer_id), row.full_name]));
  const driverNames = new Map(drivers.map((row) => [String(row.driver_id), row.full_name]));
  return trips.filter((trip) => {
    if (!month) return true;
    const date = trip.booked_at ? new Date(String(trip.booked_at)) : null;
    return date && !Number.isNaN(date.getTime()) && currentReportMonth(date) === month;
  }).map((trip): Record<string, unknown> => ({
    ...trip,
    customer_name: customerNames.get(String(trip.customer_id)) || "Khách chưa xác định",
    driver_name: driverNames.get(String(trip.driver_id)) || (trip.driver_id ? "Tài xế chưa xác định" : "Chưa phân công"),
  })).sort((a, b) => String(b.booked_at || "").localeCompare(String(a.booked_at || "")) || String(a.trip_id).localeCompare(String(b.trip_id)));
}
