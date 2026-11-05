"use client";

import { useState } from "react";
import { CarFront, CheckCheck, Clock3, MapPin, RefreshCw, Search, X, XCircle } from "lucide-react";
import { currentReportMonth, displayMoney, tripFare } from "@/lib/business-values";

type Row = Record<string, unknown>;
const statuses: Record<string, string> = { BOOKED: "Đã đặt", ACCEPTED: "Đã nhận", ARRIVING: "Đang đến", IN_PROGRESS: "Đang đi", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy" };
const active = (row: Row) => ["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"].includes(String(row.status));
function tripMonth(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? currentReportMonth(date) : "";
}
function bookedAt(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(date) : "Chưa ghi nhận";
}
const code = (value: unknown) => value ? `#${String(value).slice(0, 8).toUpperCase()}` : "—";

export function AdminTripsManager({ rows, loading, error, reload, initialSearch = "" }: {
  rows: Row[]; loading: boolean; error: string; reload: () => Promise<void>; initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [month, setMonth] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const months = [...new Set(rows.map((row) => tripMonth(row.booked_at)).filter(Boolean))].sort().reverse();
  const period = rows.filter((row) => month === "ALL" || tripMonth(row.booked_at) === month);
  const ongoing = period.filter(active).length;
  const completed = period.filter((row) => row.status === "COMPLETED").length;
  const cancelled = period.filter((row) => row.status === "CANCELLED").length;
  const filtered = period.filter((row) => {
    const matchesStatus = status === "ALL" || (status === "ACTIVE" ? active(row) : row.status === status);
    const query = search.trim().toLocaleLowerCase("vi");
    return matchesStatus && [row.trip_id, row.customer_name, row.driver_name, row.pickup_address, row.destination_address, statuses[String(row.status)]].some((value) => String(value || "").toLocaleLowerCase("vi").includes(query));
  });
  const hasFilters = Boolean(search || month !== "ALL" || status !== "ALL");
  return <div className="section-page admin-trips-page">
    <div className="page-heading"><div><span className="section-kicker">QUẢN TRỊ · RIDEFLOW</span><h1>Quản lý chuyến đi</h1><p>Theo dõi hành trình, khách hàng, tài xế và trạng thái chuyến đi.</p></div><button type="button" className="button trip-refresh" disabled={loading} onClick={() => void reload()}><RefreshCw size={15} className={loading ? "spin" : ""} />Làm mới</button></div>
    {error && <div className="data-error" role="alert"><span>{error}</span><button type="button" onClick={() => void reload()}>Thử tải lại</button></div>}
    <div className="admin-overview" aria-label="Tổng quan chuyến đi" aria-busy={loading}>
      <div className="admin-overview-card"><span><CarFront size={17} />Tổng chuyến đi</span><strong>{loading ? "…" : period.length}</strong><small>{month === "ALL" ? "Toàn bộ lịch sử hành trình" : `Trong tháng ${month.split("-").reverse().join("/")}`}</small></div>
      <div className="admin-overview-card overview-waiting"><span><Clock3 size={17} />Đang diễn ra</span><strong>{loading ? "…" : ongoing}</strong><small>Đã đặt, đã nhận, đang đến và đang đi</small></div>
      <div className="admin-overview-card overview-success"><span><CheckCheck size={17} />Hoàn thành</span><strong>{loading ? "…" : completed}</strong><small>Chuyến đã kết thúc hành trình</small></div>
      <div className="admin-overview-card"><span><XCircle size={17} />Đã hủy</span><strong>{loading ? "…" : cancelled}</strong><small>Giữ lại trong lịch sử chuyến đi</small></div>
    </div>
    <section className="panel trip-history-panel" aria-busy={loading}>
      <div className="trip-history-heading"><div><span className="section-kicker">LỊCH SỬ HÀNH TRÌNH</span><h2>{filtered.length} chuyến đi <span>/ {rows.length} chuyến đã tải</span></h2></div><label className="table-search"><Search size={16} /><input aria-label="Tìm chuyến đi" placeholder="Mã chuyến, tên khách, tài xế, địa điểm…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <div className="admin-list-toolbar"><div className="admin-filter-tabs" role="group" aria-label="Lọc trạng thái chuyến đi">{[{ id: "ALL", label: "Tất cả" }, { id: "ACTIVE", label: "Đang diễn ra" }, { id: "COMPLETED", label: "Hoàn thành" }, { id: "CANCELLED", label: "Đã hủy" }].map((tab) => <button type="button" key={tab.id} className={status === tab.id ? "active" : ""} aria-pressed={status === tab.id} onClick={() => setStatus(tab.id)}>{tab.label}</button>)}</div><div className="admin-select-filters"><select aria-label="Lọc tháng đặt chuyến" value={month} onChange={(event) => setMonth(event.target.value)}><option value="ALL">Tất cả thời gian</option>{months.map((value) => <option key={value} value={value}>Tháng {value.split("-").reverse().join("/")}</option>)}</select></div></div>
      {loading ? <div className="loading-panel" role="status"><RefreshCw size={20} className="spin" />Đang tải chuyến đi…</div> : filtered.length ? <div className="table-scroll"><table className="data-table admin-trip-table"><thead><tr><th>CHUYẾN ĐI</th><th>KHÁCH HÀNG</th><th>TÀI XẾ</th><th>HÀNH TRÌNH</th><th>THỜI GIAN ĐẶT</th><th>TRẠNG THÁI</th><th>GIÁ CƯỚC</th></tr></thead><tbody>{filtered.map((row) => <tr key={String(row.trip_id)}><td><strong className="trip-code" title={String(row.trip_id || "")}>{code(row.trip_id)}</strong><small className="cell-subline">{row.distance_km !== null && row.distance_km !== undefined ? `${row.distance_km} km` : "—"}</small></td><td><strong className="trip-person">{String(row.customer_name || "Khách chưa xác định")}</strong><small className="cell-subline">{code(row.customer_id)}</small></td><td><strong className="trip-person">{String(row.driver_name || "Chưa phân công")}</strong><small className="cell-subline">{code(row.driver_id)}</small></td><td><div className="admin-trip-route"><span><i />{String(row.pickup_address || "Chưa có điểm đón")}</span><span><MapPin size={12} />{String(row.destination_address || "Chưa có điểm đến")}</span></div></td><td>{bookedAt(row.booked_at)}</td><td><span className={`status-pill status-${String(row.status || "").toLowerCase()}`}><i />{statuses[String(row.status)] || String(row.status || "Chưa xác định")}</span></td><td className="trip-amount">{displayMoney(tripFare(row))}{row.final_fare === null || row.final_fare === undefined ? <small className="cell-subline">Ước tính</small> : null}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><CarFront size={24} /></span><h2>{error ? "Chưa tải được chuyến đi" : rows.length ? "Không có chuyến đi phù hợp" : "Chưa có chuyến đi"}</h2><p>{error ? "Bấm Thử tải lại để kết nối lại." : rows.length ? "Thử thay đổi thời gian, trạng thái hoặc từ khóa tìm kiếm." : "Chuyến mới sẽ xuất hiện sau khi khách hàng đặt xe."}</p>{hasFilters && <button type="button" className="table-action" onClick={() => { setSearch(""); setMonth("ALL"); setStatus("ALL"); }}><X size={13} />Xóa bộ lọc</button>}</div>}
      <div className="admin-list-footer"><span>Hiển thị {filtered.length} chuyến đi</span><span>Thời gian Việt Nam · Đơn vị VND</span></div>
    </section>
  </div>;
}
