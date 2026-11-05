import { getAdminAccount } from "@/lib/security-config";
import { currentReportMonth, isReportMonth } from "@/lib/business-values";
import { ApiError } from "@/lib/http";
import { isPaymentSettled } from "@/lib/payment-values";
import { getMonthlyPartition } from "@/repositories/ride-data";
import {
  getCustomerSpending,
  getDriverRevenue,
  getNotifications,
  getRecentAdminTrips,
  getReviewsForDriver,
  getVouchers,
  getVouchersForCustomer,
} from "@/repositories/ride-data";
import { getCustomer, getDriver, listCustomers, listDrivers } from "@/repositories/accounts";

const SUCCESS_STATUSES = new Set(["COMPLETED"]);

function validMonth(month: string | null) {
  if (month === null) return currentReportMonth();
  if (!isReportMonth(month)) throw new ApiError("Tháng cần có định dạng YYYY-MM.");
  return month;
}

export async function getCustomerDashboard(customerId: string, monthParam: string | null) {
  const month = validMonth(monthParam);
  const [customer, trips, payments, spending, ownedVouchers, vouchers, notifications] = await Promise.all([
    getCustomer(customerId),
    getMonthlyPartition("trips_by_customer", customerId, month),
    getMonthlyPartition("payments_by_customer", customerId, month),
    getCustomerSpending(customerId, month),
    getVouchersForCustomer(customerId),
    getVouchers(),
    getNotifications(customerId),
  ]);
  const voucherByCode = new Map(vouchers.map((voucher) => [String(voucher.voucher_code), voucher]));
  const joinedVouchers = ownedVouchers.map((item) => ({
    ...item,
    voucher: voucherByCode.get(String(item.voucher_code)) ?? null,
  }));
  const totalSpent = payments.filter((payment) => isPaymentSettled(payment.payment_status)).reduce((total, payment) => total + Number(payment.amount || 0), 0);
  return {
    role: "CUSTOMER",
    month,
    profile: customer,
    trips,
    payments,
    spending,
    vouchers: joinedVouchers,
    notifications,
    stats: {
      totalTrips: trips.length,
      completedTrips: trips.filter((trip) => SUCCESS_STATUSES.has(String(trip.status))).length,
      totalSpent,
      voucherCount: joinedVouchers.filter((item) =>
        String((item as Record<string, unknown>).status) === "AVAILABLE",
      ).length,
    },
  };
}

export async function getDriverDashboard(driverId: string, monthParam: string | null) {
  const month = validMonth(monthParam);
  const [driver, trips, revenue, reviews] = await Promise.all([
    getDriver(driverId),
    getMonthlyPartition("trips_by_driver", driverId, month),
    getDriverRevenue(driverId, month),
    getReviewsForDriver(driverId),
  ]);
  const totalRevenue = revenue.reduce((total, item) => total + Number(item.fare || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayTrips = trips.filter((trip) => String(trip.booked_at).slice(0, 10) === today).length;
  const ratedReviews = reviews.filter((item) => Number(item.rating) > 0);
  const averageRating = ratedReviews.length
    ? ratedReviews.reduce((total, item) => total + Number(item.rating), 0) / ratedReviews.length
    : Number(driver?.rating || 0);
  return {
    role: "DRIVER",
    month,
    profile: driver,
    trips,
    revenue,
    reviews,
    stats: {
      totalTrips: trips.length,
      todayTrips,
      completedTrips: trips.filter((trip) => SUCCESS_STATUSES.has(String(trip.status))).length,
      totalRevenue,
      averageRating,
    },
  };
}

export async function getAdminDashboard(monthParam: string | null) {
  const month = validMonth(monthParam);
  const [customers, drivers, trips] = await Promise.all([
    listCustomers(100),
    listDrivers(100),
    getRecentAdminTrips(month),
  ]);
  const customerIds = [...new Set(trips.map((trip) => String(trip.customer_id)).filter(Boolean))];
  const driverIds = [...new Set(trips.map((trip) => String(trip.driver_id)).filter(Boolean))];
  const [customerRecords, driverRecords] = await Promise.all([
    Promise.all(customerIds.map((id) => getCustomer(id))),
    Promise.all(driverIds.map((id) => getDriver(id))),
  ]);
  const customerNames = new Map(customerRecords.filter(Boolean).map((item) => [String(item!.customer_id), item!.full_name]));
  const driverNames = new Map(driverRecords.filter(Boolean).map((item) => [String(item!.driver_id), item!.full_name]));
  const enrichedTrips = trips.map((trip) => ({
    ...trip,
    customer_name: customerNames.get(String(trip.customer_id)) || "Khách chưa xác định",
    driver_name: driverNames.get(String(trip.driver_id)) || "Tài xế chưa xác định",
  }));
  const completed = trips.filter((trip) => String(trip.status) === "COMPLETED");
  const cancelledCount = trips.filter((trip) => String(trip.status) === "CANCELLED").length;
  const revenue = completed.reduce((total, trip) => total + Number(trip.final_fare || 0), 0);
  const ratedDrivers = drivers.filter((driver) => Number(driver.rating) > 0);
  const averageRating = ratedDrivers.length
    ? ratedDrivers.reduce((total, driver) => total + Number(driver.rating), 0) / ratedDrivers.length
    : 0;
  const statusCounts = new Map<string, number>();
  const dailyCounts = new Map<string, number>();
  const dailyRevenue = new Map<string, number>();
  for (const trip of trips) {
    const status = String(trip.status);
    const day = String(trip.booked_at).slice(0, 10);
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    if (status === "COMPLETED") dailyRevenue.set(day, (dailyRevenue.get(day) || 0) + Number(trip.final_fare || 0));
  }
  const seededCustomerCount = customers.length;
  const seededDriverCount = drivers.length;
  const admin = getAdminAccount();
  const profile = admin ? { id: admin.id, name: admin.name, email: admin.email } : null;
  return {
    role: "ADMIN",
    month,
    profile,
    trips: enrichedTrips,
    stats: {
      customerRecords: seededCustomerCount,
      driverRecords: seededDriverCount,
      tripCount: trips.length,
      completedTrips: completed.length,
      cancelledTrips: cancelledCount,
      revenue,
      averageRating,
    },
    charts: {
      status: [...statusCounts].map(([name, value]) => ({ name, value })),
      daily: [...dailyCounts].sort(([a], [b]) => a.localeCompare(b)).map(([date, tripsCount]) => ({ date: date.slice(5), trips: tripsCount })),
      revenue: [...dailyRevenue].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date: date.slice(5), amount })),
    },
    limitations: {
      customerRecords: "Số tài khoản thống kê theo danh sách hiện được tải.",
      revenue: "Doanh thu được tính từ giá cước của các chuyến hoàn thành trong tháng đặt chuyến.",
    },
  };
}
