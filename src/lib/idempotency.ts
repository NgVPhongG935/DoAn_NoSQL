import { ApiError } from "@/lib/http";

export function idempotencyKey(request: Request, required = false) {
  const key = request.headers.get("Idempotency-Key");
  if (!key) {
    if (required) throw new ApiError("Thiếu mã yêu cầu Idempotency-Key. Vui lòng tải lại trang đặt xe.");
    return crypto.randomUUID();
  }
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new ApiError("Idempotency-Key không hợp lệ.");
  return key;
}
