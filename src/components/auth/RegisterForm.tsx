"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { driverRegistrationSchema, registrationSchema } from "@/lib/registration-schema";

const initial = {
  fullName: "", phone: "", email: "", password: "", confirmPassword: "",
  licenseNumber: "", vehicleType: "", licensePlate: "", brand: "", model: "", color: "", seatCount: "2",
};
type Field = keyof typeof initial;
type RegistrationRole = "CUSTOMER" | "DRIVER";

const fields: Array<{ name: Field; label: string; type?: string; autoComplete?: string; maxLength?: number }> = [
  { name: "fullName", label: "Họ và tên", autoComplete: "name", maxLength: 100 },
  { name: "phone", label: "Số điện thoại", type: "tel", autoComplete: "tel", maxLength: 10 },
  { name: "email", label: "Email", type: "email", autoComplete: "email", maxLength: 254 },
  { name: "password", label: "Mật khẩu", type: "password", autoComplete: "new-password", maxLength: 128 },
  { name: "confirmPassword", label: "Xác nhận mật khẩu", type: "password", autoComplete: "new-password", maxLength: 128 },
];

export function RegisterForm() {
  const [role, setRole] = useState<RegistrationRole>("CUSTOMER");
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [visible, setVisible] = useState(false);

  function changeRole(next: RegistrationRole) {
    setRole(next);
    setErrors({});
    setMessage("");
    setDone(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setMessage("");
    const schema = role === "DRIVER" ? driverRegistrationSchema : registrationSchema;
    const result = schema.safeParse(values);
    const next: Partial<Record<Field, string>> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result.data, role }),
      });
      const body = await response.json();
      if (!response.ok) {
        for (const issue of body.details ?? []) next[issue.path as Field] ??= issue.message;
        setErrors(next);
        throw new Error(body.message || "Chưa thể đăng ký. Vui lòng thử lại.");
      }
      setDone(true);
      setValues(initial);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể kết nối máy chủ.");
    } finally {
      setLoading(false);
    }
  }

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function textField(field: (typeof fields)[number]) {
    const secret = field.name === "password" || field.name === "confirmPassword";
    return <div className="login-field" key={field.name}>
      <label htmlFor={`register-${field.name}`}>{field.label}</label>
      <div className={`login-input ${errors[field.name] ? "has-error" : ""}`}>
        <input
          id={`register-${field.name}`}
          type={secret ? (visible ? "text" : "password") : field.type || "text"}
          autoComplete={field.autoComplete}
          maxLength={field.maxLength}
          required
          disabled={loading}
          value={values[field.name]}
          aria-invalid={!!errors[field.name]}
          aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
          onChange={(event) => update(field.name, event.target.value)}
        />
      </div>
      {errors[field.name] && <small id={`${field.name}-error`} className="field-error">{errors[field.name]}</small>}
    </div>;
  }

  function vehicleField(field: Exclude<Field, "fullName" | "phone" | "email" | "password" | "confirmPassword" | "vehicleType" | "seatCount">, label: string, maxLength: number) {
    return <div className="login-field" key={field}>
      <label htmlFor={`register-${field}`}>{label}</label>
      <div className={`login-input ${errors[field] ? "has-error" : ""}`}>
        <input id={`register-${field}`} required disabled={loading} maxLength={maxLength} value={values[field]}
          aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined}
          onChange={(event) => update(field, event.target.value)} />
      </div>
      {errors[field] && <small id={`${field}-error`} className="field-error">{errors[field]}</small>}
    </div>;
  }

  return <main className="register-screen">
    <Link href="/" className="back-link">← Về trang chủ</Link>
    <section className="panel register-panel">
      <span className="section-kicker">TÀI KHOẢN RIDEFLOW</span>
      <h1>Tạo tài khoản</h1>
      <p>Chọn loại tài khoản bạn muốn đăng ký.</p>
      <div className="register-role-picker" role="group" aria-label="Loại tài khoản">
        <button type="button" className={`button ${role === "CUSTOMER" ? "button-gold" : "button-dark"}`} aria-pressed={role === "CUSTOMER"} onClick={() => changeRole("CUSTOMER")}>Đăng ký khách hàng</button>
        <button type="button" className={`button ${role === "DRIVER" ? "button-gold" : "button-dark"}`} aria-pressed={role === "DRIVER"} onClick={() => changeRole("DRIVER")}>Đăng ký tài xế</button>
      </div>
      {done ? <div role="status">
        <p>{role === "DRIVER" ? "Đã gửi hồ sơ tài xế. Bạn có thể đăng nhập để theo dõi trạng thái xét duyệt." : "Đăng ký khách hàng thành công!"}</p>
        <Link className="button button-gold" href="/login">Đến trang đăng nhập</Link>
      </div> : <form className="login-form" onSubmit={submit} noValidate>
        {fields.slice(0, 3).map(textField)}
        {role === "DRIVER" && <>
          {vehicleField("licenseNumber", "Số giấy phép lái xe", 50)}
          <div className="login-field">
            <label htmlFor="register-vehicleType">Loại phương tiện</label>
            <div className={`login-input ${errors.vehicleType ? "has-error" : ""}`}>
              <select id="register-vehicleType" required disabled={loading} value={values.vehicleType}
                aria-invalid={!!errors.vehicleType}
                onChange={(event) => {
                  update("vehicleType", event.target.value);
                  update("seatCount", event.target.value === "BIKE" ? "2" : event.target.value === "CAR_7" ? "7" : "4");
                }}>
                <option value="">Chọn loại phương tiện</option>
                <option value="BIKE">Xe máy</option>
                <option value="CAR_4">Ô tô 4 chỗ</option>
                <option value="CAR_7">Ô tô 7 chỗ</option>
              </select>
            </div>
            {errors.vehicleType && <small className="field-error">{errors.vehicleType}</small>}
          </div>
          {vehicleField("licensePlate", "Biển số xe", 12)}
          {vehicleField("brand", "Hãng xe", 50)}
          {vehicleField("model", "Dòng xe", 50)}
          {vehicleField("color", "Màu sắc", 30)}
          <div className="login-field">
            <label htmlFor="register-seatCount">Số chỗ ngồi</label>
            <div className={`login-input ${errors.seatCount ? "has-error" : ""}`}>
              <input id="register-seatCount" type="number" inputMode="numeric" min={2} max={16} required disabled={loading}
                value={values.seatCount} aria-invalid={!!errors.seatCount} aria-describedby={errors.seatCount ? "seatCount-error" : undefined}
                onChange={(event) => update("seatCount", event.target.value)} />
            </div>
            {errors.seatCount && <small id="seatCount-error" className="field-error">{errors.seatCount}</small>}
          </div>
        </>}
        {fields.slice(3).map(textField)}
        <label className="remember-check"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Hiện mật khẩu</label>
        <p className="login-help">Mật khẩu 8–128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt; không có khoảng trắng.</p>
        {role === "DRIVER" && <p className="login-help">Hồ sơ tài xế cần được quản trị viên duyệt trước khi bạn có thể nhận chuyến.</p>}
        {message && <div className="form-alert" role="alert">{message}</div>}
        <button type="submit" className="button button-gold login-submit" disabled={loading}>{loading ? "Đang gửi đăng ký..." : role === "DRIVER" ? "Gửi hồ sơ tài xế" : "Đăng ký"}</button>
      </form>}
      <p>Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
    </section>
  </main>;
}
