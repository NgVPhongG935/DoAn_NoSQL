"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, Banknote, CheckCheck, Clock3, CreditCard, RefreshCw, Search, WalletCards, X } from "lucide-react";
import { displayMoney } from "@/lib/business-values";
import { isPaymentSettled, paymentMethodLabel, paymentStatusLabel } from "@/lib/payment-values";
import { PaymentAccessButton } from "@/components/trips/TripPaymentPanel";

type Row = Record<string, unknown>;
function paymentMonth(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}
function dateLabel(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short",
  }).format(date) : "Chưa ghi nhận";
}
const code = (value: unknown) => value ? `#${String(value).slice(0, 8).toUpperCase()}` : "—";
const pending = (row: Row) => ["PENDING", "PENDING_CONFIRMATION"].includes(String(row.payment_status));

export function AdminPaymentsManager({ rows, loading, error, reload }: {
  rows: Row[]; loading: boolean; error: string; reload: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [method, setMethod] = useState("ALL");
  const months = useMemo(() => [...new Set(rows.map((row) => paymentMonth(row.paid_at)).filter(Boolean))].sort().reverse(), [rows]);
  const period = rows.filter((row) => month === "ALL" || paymentMonth(row.paid_at) === month);
  const paid = period.filter((row) => isPaymentSettled(row.payment_status));
  const waiting = period.filter(pending);
  const total = paid.reduce((sum, row) => sum + (Number.isFinite(Number(row.amount)) ? Number(row.amount) : 0), 0);
  const filtered = period.filter((row) => {
    const matchesStatus = status === "ALL" || (status === "PAID" ? isPaymentSettled(row.payment_status) : status === "PENDING" ? pending(row) : row.payment_status === status);
    const query = search.trim().toLocaleLowerCase("vi");
    return matchesStatus && (method === "ALL" || row.payment_method === method)
      && [row.customer_name, row.customer_id, row.payment_id, row.trip_id, row.amount, paymentMethodLabel(row.payment_method), paymentStatusLabel(row.payment_status)].some((value) => String(value || "").toLocaleLowerCase("vi").includes(query));
  });
  const hasFilters = Boolean(search || month !== "ALL" || status !== "ALL" || method !== "ALL");
  function reset() { setSearch(""); setMonth("ALL"); setStatus("ALL"); setMethod("ALL"); }
  return <div className="section-page admin-payments-page">
    <div className="page-heading"><div><span className="section-kicker">QUẢN TRỊ · RIDEFLOW</span><h1>Quản lý thanh toán</h1><p>Theo dõi giao dịch, số tiền đã thu và các khoản đang chờ xác nhận.</p></div><button type="button" className="button payment-refresh" disabled={loading} onClick={() => void reload()}><RefreshCw size={15} className={loading ? "spin" : ""} />Làm mới</button></div>
    {error && <div className="data-error" role="alert"><span>{error}</span><button type="button" onClick={() => void reload()}>Thử tải lại</button></div>}
    <div className="admin-overview" aria-label="Tổng quan thanh toán" aria-busy={loading}>
      <div className="admin-overview-card"><span><WalletCards size={17} />Tổng giao dịch</span><strong>{loading ? "…" : period.length}</strong><small>{month === "ALL" ? "Toàn bộ lịch sử thanh toán" : `Trong tháng ${month.split("-").reverse().join("/")}`}</small></div>
      <div className="admin-overview-card overview-success"><span><ArrowDownLeft size={17} />Đã thu</span><strong>{loading ? "…" : displayMoney(total)}</strong><small>{paid.length} giao dịch đã thanh toán</small></div>
      <div className="admin-overview-card overview-waiting"><span><Clock3 size={17} />Chờ thanh toán</span><strong>{loading ? "…" : waiting.length}</strong><small>Gồm các khoản chờ tài xế xác nhận</small></div>
      <div className="admin-overview-card"><span><CheckCheck size={17} />Tỷ lệ hoàn tất</span><strong>{loading ? "…" : period.length ? `${Math.round(paid.length / period.length * 100)}%` : "—"}</strong><small>Tính trên giao dịch trong khoảng đã chọn</small></div>
    </div>
    <section className="panel payment-history-panel" aria-busy={loading}>
      <div className="payment-history-heading"><div><span className="section-kicker">LỊCH SỬ GIAO DỊCH</span><h2>{filtered.length} giao dịch <span>/ {rows.length} giao dịch đã tải</span></h2></div><label className="table-search"><Search size={16} /><input aria-label="Tìm giao dịch" placeholder="Tên khách, mã giao dịch, mã chuyến…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <div className="admin-list-toolbar"><div className="admin-filter-tabs" role="group" aria-label="Trạng thái thanh toán">{[{ id: "ALL", label: "Tất cả" }, { id: "PAID", label: "Đã thanh toán" }, { id: "PENDING", label: "Đang chờ" }, { id: "FAILED", label: "Bị từ chối" }].map((tab) => <button type="button" key={tab.id} aria-pressed={status === tab.id} className={status === tab.id ? "active" : ""} onClick={() => setStatus(tab.id)}>{tab.label}</button>)}</div><div className="admin-select-filters"><select aria-label="Lọc tháng thanh toán" value={month} onChange={(event) => setMonth(event.target.value)}><option value="ALL">Tất cả thời gian</option>{months.map((value) => <option key={value} value={value}>Tháng {value.split("-").reverse().join("/")}</option>)}</select><select aria-label="Lọc phương thức thanh toán" value={method} onChange={(event) => setMethod(event.target.value)}><option value="ALL">Mọi phương thức</option>{[...new Set(rows.map((row) => String(row.payment_method || "")))].filter(Boolean).sort().map((value) => <option key={value} value={value}>{paymentMethodLabel(value)}</option>)}</select></div></div>
      {loading ? <div className="loading-panel" role="status"><RefreshCw size={20} className="spin" />Đang tải giao dịch…</div> : filtered.length ? <div className="table-scroll"><table className="data-table admin-payment-table"><thead><tr><th>GIAO DỊCH / CHUYẾN</th><th>KHÁCH HÀNG</th><th>SỐ TIỀN</th><th>PHƯƠNG THỨC</th><th>TRẠNG THÁI</th><th>THỜI ĐIỂM GHI NHẬN</th><th>CHI TIẾT</th></tr></thead><tbody>{filtered.map((row) => <tr key={`${row.trip_id}:${row.payment_id}`}><td><strong className="payment-code" title={String(row.payment_id || "")}>{code(row.payment_id)}</strong><small className="cell-subline" title={String(row.trip_id || "")}>Chuyến {code(row.trip_id)}</small></td><td><strong className="payment-customer">{String(row.customer_name || "Chưa xác định")}</strong><small className="cell-subline">{code(row.customer_id)}</small></td><td className="payment-amount">{displayMoney(row.amount)}</td><td><span className="payment-method">{row.payment_method === "CASH" ? <Banknote size={15} /> : <CreditCard size={15} />}{paymentMethodLabel(row.payment_method)}</span></td><td><span className={`status-pill payment-status-${isPaymentSettled(row.payment_status) ? "paid" : pending(row) ? "pending" : row.payment_status === "FAILED" ? "failed" : "unknown"}`}><i />{paymentStatusLabel(row.payment_status)}</span></td><td><span>{dateLabel(row.paid_at)}</span>{!isPaymentSettled(row.payment_status) && <small className="cell-subline">Chưa xác nhận đã nhận tiền</small>}</td><td>{row.trip_id ? <PaymentAccessButton tripId={String(row.trip_id)} onChanged={() => void reload()} /> : "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><WalletCards size={24} /></span><h2>{error ? "Chưa tải được giao dịch" : rows.length ? "Không có giao dịch phù hợp" : "Chưa có giao dịch thanh toán"}</h2><p>{error ? "Bấm Thử tải lại để kết nối lại." : rows.length ? "Thử thay đổi thời gian, trạng thái hoặc từ khóa tìm kiếm." : "Giao dịch sẽ xuất hiện khi hệ thống ghi nhận thanh toán cho chuyến đi."}</p>{hasFilters && <button type="button" className="table-action" onClick={reset}><X size={13} />Xóa bộ lọc</button>}</div>}
      <div className="admin-list-footer"><span>Hiển thị {filtered.length} giao dịch</span><span>Thời gian Việt Nam · Đơn vị VND</span></div>
    </section>
  </div>;
}
