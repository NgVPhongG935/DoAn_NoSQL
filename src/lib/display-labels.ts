const text = (value: unknown) => value === undefined || value === null || value === "" ? "—" : String(value);

export const statusLabels: Record<string, string> = {
  BOOKED: "Đã đặt", ACCEPTED: "Đã nhận", ARRIVING: "Đang đến", IN_PROGRESS: "Đang đi", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy",
  ACTIVE: "Hoạt động", INACTIVE: "Tạm ngưng", AVAILABLE: "Sẵn sàng", BUSY: "Đang có chuyến", OFFLINE: "Ngoại tuyến", BLOCKED: "Đã khóa",
  PENDING: "Chờ duyệt", REJECTED: "Đã từ chối", OPEN: "Mới tiếp nhận", PROCESSING: "Đang xử lý", RESOLVED: "Đã giải quyết", CLOSED: "Đã đóng",
  PAID: "Đã thanh toán", PAID_DEMO: "Đã thanh toán", PENDING_CONFIRMATION: "Chờ tài xế xác nhận", FAILED: "Bị từ chối", USED: "Đã sử dụng", EXPIRED: "Hết hạn",
};
export function statusLabel(value: unknown) { return statusLabels[String(value)] || text(value); }
export function roleLabel(value: unknown) {
  return ({ ADMIN: "Quản trị viên", CUSTOMER: "Khách hàng", DRIVER: "Tài xế", UNKNOWN: "Chưa xác định" } as Record<string, string>)[String(value)] || "Người dùng";
}
export function serviceNameLabel(value: unknown) {
  return ({ BIKE: "Xe máy", CAR: "Ô tô", CAR_4: "Ô tô 4 chỗ", CAR_7: "Ô tô 7 chỗ", PREMIUM: "Xe cao cấp", DELIVERY: "Giao hàng" } as Record<string, string>)[String(value)] || text(value);
}
export const vehicleTypeLabel = serviceNameLabel;
export function notificationTypeLabel(value: unknown) {
  return ({ SYSTEM: "Hệ thống", TRIP_ASSIGNED: "Chuyến được phân công", TRIP_STATUS: "Cập nhật chuyến đi", TRIP_UPDATE: "Cập nhật chuyến đi", BOOKING: "Đặt chuyến", PAYMENT: "Thanh toán", PROMOTION: "Khuyến mãi", VOUCHER: "Mã giảm giá" } as Record<string, string>)[String(value)] || "Thông báo";
}
export function discountTypeLabel(value: unknown) {
  return value === "PERCENT" ? "Phần trăm" : value === "FIXED" ? "Số tiền cố định" : "Chưa xác định";
}

const columnLabels: Record<string, string> = {
  trip_id: "Mã chuyến", customer_id: "Mã khách hàng", driver_id: "Mã tài xế", vehicle_id: "Mã phương tiện", service_id: "Mã dịch vụ",
  customer_name: "Khách hàng", driver_name: "Tài xế", full_name: "Họ và tên", phone: "Số điện thoại", email: "Email",
  pickup_address: "Điểm đón", destination_address: "Điểm đến", distance_km: "Quãng đường (km)", booked_at: "Thời gian đặt",
  started_at: "Thời gian bắt đầu", completed_at: "Thời gian hoàn thành", created_at: "Ngày tạo", trip_date: "Ngày đi", changed_at: "Thời gian thay đổi",
  status: "Trạng thái", driver_status: "Nhận chuyến", account_status: "Trạng thái tài khoản", estimated_fare: "Giá ước tính", final_fare: "Giá cước", fare: "Giá cước", amount: "Số tiền",
  license_number: "Giấy phép lái xe", license_plate: "Biển số", brand: "Hãng xe", model: "Dòng xe", vehicle_type: "Loại xe", seat_count: "Số chỗ", color: "Màu sắc",
  service_name: "Tên dịch vụ", description: "Mô tả", base_fare: "Giá mở cửa", price_per_km: "Giá mỗi km",
  voucher_code: "Mã giảm giá", voucher_name: "Tên ưu đãi", voucher: "Ưu đãi", discount_type: "Loại giảm", discount_value: "Giá trị giảm", max_discount: "Giảm tối đa", min_trip_amount: "Giá trị chuyến tối thiểu", quantity: "Số lượng", start_date: "Ngày bắt đầu", end_date: "Ngày kết thúc", received_at: "Ngày nhận", used_at: "Ngày sử dụng",
  payment_id: "Mã thanh toán", payment_method: "Phương thức", payment_status: "Trạng thái thanh toán", paid_at: "Thời điểm thanh toán",
  rating: "Đánh giá", comment: "Nhận xét", review_id: "Mã đánh giá", subject: "Chủ đề", content: "Nội dung", title: "Tiêu đề", note: "Ghi chú",
  notification_type: "Loại thông báo", is_read: "Trạng thái đọc", user_name: "Người dùng", user_role: "Vai trò", year_month: "Tháng",
};
export function columnLabel(key: string) { return (columnLabels[key] || "Thông tin").toLocaleUpperCase("vi"); }

export function localizedSearchText(row: Record<string, unknown>) {
  const values = Object.values(row).map(text);
  const readers: Record<string, (value: unknown) => string> = {
    service_name: serviceNameLabel, vehicle_type: vehicleTypeLabel, status: statusLabel,
    account_status: statusLabel, driver_status: statusLabel, user_role: roleLabel,
    notification_type: notificationTypeLabel, discount_type: discountTypeLabel,
  };
  for (const [key, reader] of Object.entries(readers)) if (row[key] !== undefined && row[key] !== null) values.push(reader(row[key]));
  return values.join(" ").toLocaleLowerCase("vi");
}
