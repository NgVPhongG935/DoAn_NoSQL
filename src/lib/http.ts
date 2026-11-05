import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ApiError";
  }
}

export function success<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function failure(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ success: false, message: "Nội dung JSON không hợp lệ." }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({
      success: false,
      message: "Dữ liệu gửi lên chưa hợp lệ.",
      details: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
    }, { status: 400 });
  }
  if (error instanceof ApiError) {
    return NextResponse.json({ success: false, message: error.message }, { status: error.status });
  }
  console.error("RideFlow API error:", error);
  const unavailable = error instanceof Error && (error.name === "NoHostAvailableError" || /ECONNREFUSED|No host available|All host\(s\)/i.test(error.message));
  return NextResponse.json({
    success: false,
    message: unavailable ? "Dịch vụ dữ liệu đang tạm ngưng. Vui lòng thử lại sau khi Cassandra được khởi động." : "Đã xảy ra lỗi máy chủ. Vui lòng thử lại sau.",
  }, { status: unavailable ? 503 : 500 });
}

export function notFound(message = "Không tìm thấy dữ liệu.") {
  return NextResponse.json({ success: false, message }, { status: 404 });
}

export function conflict(message: string) {
  return NextResponse.json({ success: false, message }, { status: 409 });
}

export function unauthorized() {
  return NextResponse.json({ success: false, message: "Vui lòng đăng nhập lại." }, { status: 401 });
}
