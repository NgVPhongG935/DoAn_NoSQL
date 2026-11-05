import { z } from "zod";

export const emailSchema = z.string().trim().max(254).email("Email chưa đúng định dạng.").transform((value) => value.toLowerCase());
export const registrationSchema = z.object({
  fullName: z.string().trim().min(2, "Họ tên cần ít nhất 2 ký tự.").max(100),
  phone: z.string().trim().regex(/^0\d{9}$/, "Số điện thoại gồm 10 chữ số, bắt đầu bằng 0."),
  email: emailSchema,
  password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự.").max(128, "Mật khẩu tối đa 128 ký tự.")
    .regex(/[a-z]/, "Cần ít nhất một chữ thường.")
    .regex(/[A-Z]/, "Cần ít nhất một chữ hoa.")
    .regex(/[0-9]/, "Cần ít nhất một chữ số.")
    .regex(/[^A-Za-z0-9\s]/, "Cần ít nhất một ký tự đặc biệt.")
    .regex(/^\S+$/, "Mật khẩu không được chứa khoảng trắng."),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"], message: "Mật khẩu nhập lại chưa khớp.",
});

export const driverRegistrationSchema = registrationSchema.extend({
  licenseNumber: z.string().trim().min(3, "Giấy phép lái xe cần ít nhất 3 ký tự.").max(50),
  vehicleType: z.enum(["BIKE", "CAR_4", "CAR_7"], { error: "Vui lòng chọn loại phương tiện." }),
  licensePlate: z.string().trim().toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{1,2}[0-9]?[- ]\d{3}\.?\d{2}$/, "Biển số xe chưa đúng định dạng."),
  brand: z.string().trim().min(2, "Vui lòng nhập hãng xe.").max(50),
  model: z.string().trim().min(1, "Vui lòng nhập dòng xe.").max(50),
  color: z.string().trim().min(2, "Vui lòng nhập màu xe.").max(30),
  seatCount: z.coerce.number().int().min(2).max(16),
}).refine((value) => value.vehicleType !== "BIKE" || value.seatCount === 2, {
  path: ["seatCount"], message: "Xe máy cần khai báo 2 chỗ ngồi.",
}).refine((value) => value.vehicleType !== "CAR_4" || value.seatCount === 4, {
  path: ["seatCount"], message: "Loại ô tô 4 chỗ cần đúng 4 chỗ ngồi.",
}).refine((value) => value.vehicleType !== "CAR_7" || value.seatCount >= 7, {
  path: ["seatCount"], message: "Loại ô tô 7 chỗ cần ít nhất 7 chỗ ngồi.",
});
