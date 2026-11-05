"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { displayMoney } from "@/lib/business-values";
import { isPaymentSettled, paymentMethodLabel, paymentStatusLabel } from "@/lib/payment-values";
import { mutationFetch } from "@/lib/mutation-request";
import "@/app/trip-payments.css";

type Row = Record<string, unknown>;
type PaymentData = { payments: Row[]; method: string; tripStatus: string; role: string };
export function TripPaymentPanel({ tripId, onChanged }: { tripId: string; onChanged?: () => void }) {
  const [data, setData] = useState<PaymentData | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/payment`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không tải được thanh toán.");
      setData(body.data); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Lỗi tải thanh toán."); }
    finally { setLoading(false); }
  }, [tripId]);
  useEffect(() => { void load(); }, [load]);
  async function act(action: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await mutationFetch(`/api/trips/${tripId}/payment`, { method: "POST", body: JSON.stringify({ action }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Chưa cập nhật được thanh toán.");
      setNotice(action === "REPORT_TRANSFER" ? "Đã gửi yêu cầu. Đang chờ tài xế xác nhận." : action === "REJECT_TRANSFER" ? "Đã từ chối yêu cầu xác nhận thanh toán." : "Đã xác nhận đã nhận tiền.");
      await load(); onChanged?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Lỗi cập nhật thanh toán."); }
    finally { setBusy(false); }
  }
  const payment = data?.payments[0];
  const settled = isPaymentSettled(payment?.payment_status);
  return <section className="payment-panel" aria-label="Thanh toán chuyến đi">
    <h3>Thanh toán chuyến đi</h3>
    {error && <div className="data-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Tải lại</button></div>}
    {notice && <p className="inline-success" role="status">{notice}</p>}
    {loading && <p role="status">Đang tải thông tin thanh toán…</p>}
    {data && <>
      <div className="payment-summary"><strong>{paymentMethodLabel(data.method)}</strong><span>{paymentStatusLabel(payment?.payment_status)}</span>{payment && <strong>{displayMoney(payment.amount)}</strong>}</div>
      {settled && payment?.paid_at ? <p>Thời điểm xác nhận đã nhận tiền: {new Date(String(payment.paid_at)).toLocaleString("vi-VN")}</p> : <p>Thời điểm thanh toán: chưa xác nhận.</p>}
      {data.method === "CASH" ? <p>Thanh toán tiền mặt cho tài xế khi kết thúc chuyến. Tài xế chỉ xác nhận hoàn thành sau khi đã thu tiền mặt.</p> : data.method === "BANK_TRANSFER" ? <>
        <dl className="payment-transfer-details"><dt>Mã chuyến đi</dt><dd>{tripId}</dd><dt>Số tiền cần thanh toán</dt><dd>{payment ? displayMoney(payment.amount) : "—"}</dd><dt>Nội dung chuyển khoản</dt><dd>RIDEFLOW {tripId}</dd></dl>
        {payment?.payment_status === "PENDING_CONFIRMATION" && <p className="payment-pending-notice" role="status">Đang chờ tài xế xác nhận đã nhận tiền.</p>}
        {payment?.payment_status === "FAILED" && <p className="payment-rejected-notice" role="status">Yêu cầu trước đã bị từ chối. Bạn có thể gửi lại yêu cầu nếu cần.</p>}
        {data.tripStatus === "COMPLETED" && !settled && data.role === "CUSTOMER" && payment?.payment_status !== "PENDING_CONFIRMATION" && <button type="button" className="button button-gold" disabled={busy || loading} onClick={() => void act("REPORT_TRANSFER")}>{busy ? "Đang gửi…" : "Tôi đã chuyển khoản"}</button>}
        {data.tripStatus === "COMPLETED" && ["PENDING", "PENDING_CONFIRMATION"].includes(String(payment?.payment_status)) && data.role === "DRIVER" && <button type="button" className="button button-gold" disabled={busy || loading} onClick={() => void act("CONFIRM_TRANSFER")}>{busy ? "Đang ghi nhận…" : "Xác nhận đã nhận tiền"}</button>}
        {data.tripStatus === "COMPLETED" && payment?.payment_status === "PENDING_CONFIRMATION" && data.role === "ADMIN" && <button type="button" className="button button-reject" disabled={busy || loading} onClick={() => void act("REJECT_TRANSFER")}>Từ chối xác nhận</button>}
      </> : <p>Phương thức thanh toán cũ; không áp dụng cho đặt chuyến mới.</p>}
      {data.tripStatus !== "COMPLETED" && <p>Thông tin thanh toán sẽ được ghi nhận khi chuyến hoàn thành.</p>}
    </>}
  </section>;
}

export function PaymentAccessButton({ tripId, onChanged }: { tripId: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) || []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    };
  }, [open]);
  // The list's entrance animation leaves a transformed ancestor. A fixed
  // dialog inside that ancestor centers on the entire table, below the screen.
  return <><button ref={trigger} className="table-action" type="button" onClick={() => setOpen(true)}>Xem thanh toán</button>{open && createPortal(
    <div className="payment-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) { event.preventDefault(); setOpen(false); }
    }}>
      <div ref={dialog} className="panel payment-dialog" role="dialog" aria-modal="true" aria-label="Chi tiết thanh toán" tabIndex={-1}>
        <button ref={closeButton} className="table-action payment-close" type="button" onClick={() => setOpen(false)}>Đóng</button>
        <TripPaymentPanel tripId={tripId} onChanged={onChanged} />
      </div>
    </div>, document.body,
  )}</>;
}
