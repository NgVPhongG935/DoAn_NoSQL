"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, KeyRound, LoaderCircle, X } from "lucide-react";

export function CustomerPasswordResetButton({ customerId, name, email, disabled, onReset }: {
  customerId: string; name: string; email: string; disabled?: boolean; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const titleId = useId(), descriptionId = useId();
  function close() {
    if (pending.current) return;
    setOpen(false); setPassword(""); setConfirmPassword(""); setShowPassword(false); setError("");
  }
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstInput.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
      const first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keydown); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); };
  }, [open]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    if (password !== confirmPassword) { setError("Mật khẩu nhập lại chưa khớp."); return; }
    pending.current = true; setBusy(true);
    try {
      // Credentials must never enter the generic sessionStorage retry cache.
      const response = await fetch(`/api/admin/customers/${customerId}/password`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ password, confirmPassword }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.details?.map((item: { message: string }) => item.message).join(" ") || body.message || "Chưa đặt lại được mật khẩu.");
      pending.current = false; close(); onReset();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Chưa đặt lại được mật khẩu. Vui lòng thử lại."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <><button ref={trigger} type="button" className="table-action customer-password-action" disabled={disabled} onClick={() => setOpen(true)} aria-label={`Đặt lại mật khẩu ${name}`}><KeyRound size={14} />Đặt lại mật khẩu</button>{open && createPortal(
    <div className="customer-password-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); close(); } }}>
      <div ref={dialog} className="panel customer-password-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <div className="customer-password-heading"><div><span className="section-kicker">HỖ TRỢ KHÁCH HÀNG</span><h2 id={titleId}>Đặt lại mật khẩu</h2></div><button type="button" className="icon-button" disabled={busy} aria-label="Đóng đặt lại mật khẩu" onClick={close}><X size={19} /></button></div>
        <div className="customer-password-identity"><KeyRound size={20} /><div><strong>{name}</strong><span>{email}</span></div></div>
        <p id={descriptionId}>Dùng khi khách quên mật khẩu. Khách sẽ đăng nhập bằng mật khẩu mới; các phiên đăng nhập cũ của khách sẽ hết hiệu lực.</p>
        {error && <div className="data-error" role="alert">{error}</div>}
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="account-fieldset">
            <label className="form-field"><span>Mật khẩu mới</span><div className="customer-password-input"><input ref={firstInput} name="newPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small>Tối thiểu 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt; không có khoảng trắng.</small></label>
            <label className="form-field"><span>Nhập lại mật khẩu mới</span><input name="confirmNewPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          </fieldset>
          <div className="customer-password-buttons"><button type="button" className="table-action" disabled={busy} onClick={close}>Hủy</button><button className="button button-gold" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />}{busy ? "Đang lưu…" : "Xác nhận đặt lại"}</button></div>
        </form>
      </div>
    </div>, document.body,
  )}</>;
}
