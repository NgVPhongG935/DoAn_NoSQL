export const paymentMethodLabel = (value: unknown) => ({ CASH: "Tiền mặt", BANK_TRANSFER: "Chuyển khoản", CARD: "Thẻ (cũ)", WALLET: "Ví (cũ)" }[String(value)] || "Chưa xác định");
export const paymentStatusLabel = (value: unknown) => ({ PAID: "Đã thanh toán", PAID_DEMO: "Đã thanh toán", PENDING: "Chờ thanh toán", PENDING_CONFIRMATION: "Chờ tài xế xác nhận", FAILED: "Bị từ chối" }[String(value)] || "Chưa ghi nhận");
export const isPaymentSettled = (value: unknown) => value === "PAID" || value === "PAID_DEMO";
