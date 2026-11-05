import { createHash } from "node:crypto";
import { displayMoney } from "@/lib/business-values";

export function driverAssignmentNotification(trip: { tripId: string; driverId: string; pickup: string; destination: string; fare: unknown; at: Date }) {
  const hex = createHash("sha256").update(`driver-assignment:${trip.tripId}:${trip.driverId}`).digest("hex");
  const notificationId = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  return {
    user_id: trip.driverId, created_at: trip.at, notification_id: notificationId,
    title: "Bạn có chuyến mới được phân công",
    content: `Chuyến #${trip.tripId.slice(0,8).toUpperCase()} · Mã chuyến: ${trip.tripId} · Đón: ${trip.pickup} → Đến: ${trip.destination} · Giá chuyến: ${displayMoney(trip.fare)}. Mở mục Chuyến đi để kiểm tra và nhận chuyến.`,
    notification_type: "TRIP_ASSIGNED", is_read: false,
  };
}
