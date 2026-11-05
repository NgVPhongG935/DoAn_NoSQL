import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, message: "Đăng nhập nhanh đã được tắt. Vui lòng dùng email và mật khẩu." },
    { status: 410 },
  );
}
