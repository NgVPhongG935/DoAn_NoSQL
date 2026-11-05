import { jsonSafe, query, queryAll } from "@/lib/cassandra";

export async function getMonthlyPartition(table: "trips_by_customer" | "trips_by_driver" | "payments_by_customer", id: string, month: string) {
  const owner = table === "trips_by_driver" ? "driver_id" : "customer_id";
  const time = table === "payments_by_customer" ? "paid_at" : "booked_at";
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const until = new Date(from); until.setUTCMonth(until.getUTCMonth() + 1);
  return queryAll(`SELECT * FROM ${table} WHERE ${owner} = ? AND ${time} >= ? AND ${time} < ?`, [id, from, until]);
}

export async function getTripsForCustomer(customerId: string, limit = 50) {
  return jsonSafe(await query(
    "SELECT * FROM trips_by_customer WHERE customer_id = ? LIMIT ?",
    [customerId, limit],
  ));
}

export async function getTripsForDriver(driverId: string, limit = 50) {
  return jsonSafe(await query(
    "SELECT * FROM trips_by_driver WHERE driver_id = ? LIMIT ?",
    [driverId, limit],
  ));
}

export async function getTrip(tripId: string) {
  const rows = await query("SELECT * FROM trips_by_id WHERE trip_id = ?", [tripId]);
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function getTripHistory(tripId: string) {
  return jsonSafe(await query(
    "SELECT * FROM trip_status_history WHERE trip_id = ?",
    [tripId],
  ));
}

export async function getPaymentsForCustomer(customerId: string, limit?: number) {
  // Payment history includes old methods/statuses and every Cassandra page.
  // New-booking validation must never become a filter for historical payments.
  return limit === undefined
    ? queryAll("SELECT * FROM payments_by_customer WHERE customer_id = ?", [customerId])
    : queryAll("SELECT * FROM payments_by_customer WHERE customer_id = ? LIMIT ?", [customerId, limit]);
}

export async function getPaymentsForTrip(tripId: string) {
  return jsonSafe(await query("SELECT * FROM payments_by_trip WHERE trip_id = ?", [tripId]));
}

export async function getDriverRevenue(driverId: string, yearMonth: string) {
  return jsonSafe(await query(
    "SELECT * FROM driver_revenue_by_month WHERE driver_id = ? AND year_month = ?",
    [driverId, yearMonth],
  ));
}

export async function getCustomerSpending(customerId: string, yearMonth: string) {
  return jsonSafe(await query(
    "SELECT * FROM customer_spending_by_month WHERE customer_id = ? AND year_month = ?",
    [customerId, yearMonth],
  ));
}

export async function getReviewsForDriver(driverId: string, limit = 50) {
  return jsonSafe(await query(
    "SELECT * FROM reviews_by_driver WHERE driver_id = ? LIMIT ?",
    [driverId, limit],
  ));
}

export async function getReviewForTrip(tripId: string) {
  const rows = await query("SELECT * FROM reviews_by_trip WHERE trip_id = ?", [tripId]);
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function getReviewsForCustomer(customerId: string) {
  const trips = await getTripsForCustomer(customerId, 100);
  const reviews = await Promise.all(trips.map((trip) => getReviewForTrip(String(trip.trip_id))));
  return reviews.filter((review) => review !== null);
}

export async function getServices(limit = 50) {
  return jsonSafe(await query("SELECT * FROM service_types LIMIT ?", [limit]));
}

export async function getServiceById(serviceId: string) {
  const rows = await query("SELECT * FROM service_types WHERE service_id = ?", [serviceId]);
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function getVouchers(limit = 100) {
  return jsonSafe(await query("SELECT * FROM vouchers LIMIT ?", [limit]));
}

export async function getVouchersForCustomer(customerId: string) {
  return jsonSafe(await query("SELECT * FROM customer_vouchers WHERE customer_id = ?", [customerId]));
}

export async function getVoucher(voucherCode: string) {
  const rows = await query("SELECT * FROM vouchers WHERE voucher_code = ?", [voucherCode]);
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function getCustomerVoucher(customerId: string, voucherCode: string) {
  const rows = await query(
    "SELECT * FROM customer_vouchers WHERE customer_id = ? AND voucher_code = ?",
    [customerId, voucherCode],
  );
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function getComplaints(customerId: string, limit = 50) {
  return jsonSafe(await query(
    "SELECT * FROM complaints_by_customer WHERE customer_id = ? LIMIT ?",
    [customerId, limit],
  ));
}

export async function getNotifications(userId: string, limit = 30) {
  return queryAll(
    "SELECT * FROM notifications_by_user WHERE user_id = ? LIMIT ?",
    [userId, limit],
  );
}

export async function getTripsByStatusAndDate(status: string, date: string, limit?: number) {
  if (limit === undefined) return queryAll("SELECT * FROM trips_by_status WHERE status = ? AND trip_date = ?", [status, date]);
  return jsonSafe(await query(
    "SELECT * FROM trips_by_status WHERE status = ? AND trip_date = ? LIMIT ?",
    [status, date, limit],
  ));
}

export async function getRecentAdminTrips(month: string, limit?: number) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  const statuses = ["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const dates = Array.from({ length: dayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  });
  const results = await Promise.all(
    statuses.flatMap((status) => dates.map((date) => getTripsByStatusAndDate(status, date, limit))),
  );
  const sorted = results.flat().sort((left, right) =>
    String(right.booked_at).localeCompare(String(left.booked_at)),
  );
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
