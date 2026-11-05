"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  CheckCircle2,
  Eye,
  EyeOff,
  Heart,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { emailSchema } from "@/lib/registration-schema";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  function validate() {
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextErrors.email = "Vui lòng nhập email.";
    else if (!emailSchema.safeParse(email).success) nextErrors.email = "Email chưa đúng định dạng.";
    if (!password) nextErrors.password = "Vui lòng nhập mật khẩu.";
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!validate()) return;

    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body.data?.error || body.message || "Chưa thể đăng nhập.");
      }
      router.replace(body.data.redirectTo);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể kết nối máy chủ.");
      setLoading(false);
    }
  }

  return <main className="login-screen">
    <section className="login-left">
      <Link href="/" className="login-back"><ArrowLeft size={16} /> Về trang chủ</Link>
      <div className="login-brand"><span className="brand-mark"><Heart size={18} fill="currentColor" /></span><span>rideflow<span className="brand-period">.</span></span></div>
      <div className="login-art" aria-hidden="true">
        <span className="login-art-orbit orbit-one" />
        <span className="login-art-orbit orbit-two" />
        <span className="login-art-pin"><CarFront size={28} /></span>
        <span className="login-art-dot dot-one" />
        <span className="login-art-dot dot-two" />
        <span className="login-art-route" />
      </div>
      <div className="login-message">
        <span className="section-kicker"><Sparkles size={13} /> CHÀO MỪNG TRỞ LẠI</span>
        <h1>Mỗi hành trình<br />đều có một <em>niềm vui.</em></h1>
        <p>Một tài khoản duy nhất để đặt chuyến, đồng hành cùng khách hàng hoặc vận hành toàn bộ RideFlow.</p>
        <div className="login-benefits">
          <span><CheckCircle2 size={15} /> Tự nhận diện vai trò</span>
          <span><ShieldCheck size={15} /> Phiên đăng nhập bảo mật</span>
        </div>
      </div>
      <span className="login-coordinate">RIDEFLOW · SÀI GÒN · 2026</span>
    </section>

    <section className="login-right">
      <div className="login-panel">
        <div className="login-panel-badge"><ShieldCheck size={16} /> CỔNG ĐĂNG NHẬP AN TOÀN</div>
        <h2>Xin chào bạn!</h2>
        <p className="login-panel-intro">Nhập thông tin tài khoản để tiếp tục đến không gian của bạn.</p>

        <form className="login-form" onSubmit={login} noValidate>
          <label className="login-field">
            <span>Email</span>
            <div className={`login-input ${fieldErrors.email ? "has-error" : ""}`}>
              <Mail size={18} />
              <input
                type="email"
                autoComplete="email"
                placeholder="ban@rideflow.vn"
                value={email}
                disabled={loading}
                onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
              />
            </div>
            {fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}
          </label>

          <label className="login-field">
            <span>Mật khẩu</span>
            <div className={`login-input ${fieldErrors.password ? "has-error" : ""}`}>
              <LockKeyhole size={18} />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Nhập mật khẩu"
                value={password}
                disabled={loading}
                onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); }}
              />
              <button type="button" className="password-toggle" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}
          </label>

          <div className="login-form-meta">
            <label className="remember-check"><input type="checkbox" checked={remember} disabled={loading} onChange={(event) => setRemember(event.target.checked)} /><span /> Ghi nhớ đăng nhập</label>
            <Link className="login-help" href="/register">Chưa có tài khoản? Đăng ký</Link>
          </div>

          {error && <div className="form-alert" role="alert">{error}</div>}

          <button className="button button-gold login-submit" type="submit" disabled={loading}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Đang đăng nhập...</> : <>Đăng nhập <ArrowRight size={18} /></>}
          </button>
        </form>

        <div className="login-divider"><span />RIDEFLOW ACCOUNT<span /></div>
        <p className="login-footnote"><ShieldCheck size={14} /> Mật khẩu được kiểm tra ở máy chủ và không bao giờ được gửi ngược về trình duyệt.</p>
      </div>
      <div className="login-bottom"><span>HỒNG HƠN · VUI HƠN · RIDEFLOW</span><Link href="/">rideflow.vn <ArrowRight size={13} /></Link></div>
    </section>
  </main>;
}
