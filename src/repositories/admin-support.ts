import { queryAll } from "@/lib/cassandra";

// Admin needs all partitions, including records whose original account is gone.
// Page through the small demo tables; do not truncate to the first 100 users.
export function readAdminComplaints() {
  return queryAll("SELECT customer_id, created_at, complaint_id, trip_id, subject, content, status, resolved_at FROM complaints_by_customer");
}

export function readAdminNotifications() {
  return queryAll("SELECT user_id, created_at, notification_id, title, content, notification_type, is_read FROM notifications_by_user");
}

export async function readSupportUsers() {
  const [customers, drivers] = await Promise.all([
    queryAll("SELECT customer_id, full_name FROM customers"),
    queryAll("SELECT driver_id, full_name FROM drivers"),
  ]);
  return [
    ...customers.map((row) => ({ user_id: String(row.customer_id), user_name: String(row.full_name || "Khách hàng"), user_role: "CUSTOMER" })),
    ...drivers.map((row) => ({ user_id: String(row.driver_id), user_name: String(row.full_name || "Tài xế"), user_role: "DRIVER" })),
  ];
}
