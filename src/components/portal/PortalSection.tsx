"use client";

import { mutationFetch } from "@/lib/mutation-request";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CarFront, Check, CircleAlert, LoaderCircle, Search, ShieldAlert, Star } from "lucide-react";
import type { Role } from "@/lib/demo-users";
import { RideLoader } from "@/components/ui/RideLoader";
import { AdminAccountManager } from "@/components/portal/AdminAccountManager";
import { AdminPaymentsManager } from "@/components/portal/AdminPaymentsManager";
import { AdminTripsManager } from "@/components/portal/AdminTripsManager";
import { columnLabel, discountTypeLabel, localizedSearchText, notificationTypeLabel, roleLabel, serviceNameLabel, statusLabel, statusLabels, vehicleTypeLabel } from "@/lib/display-labels";
import { AccountAvatar, AvatarEditor } from "@/components/portal/AccountAvatar";
import { PaymentAccessButton } from "@/components/trips/TripPaymentPanel";
import { isPaymentSettled, paymentMethodLabel, paymentStatusLabel } from "@/lib/payment-values";

import { adminResourceKey, currentReportMonth, displayMoney } from "@/lib/business-values";

type Row = Record<string, unknown>;
type Session = { userId: string; name: string };
const labels: Record<string, string> = {
  customers: "Khách hàng", drivers: "Tài xế", vehicles: "Phương tiện", trips: "Chuyến đi",
  payments: "Thanh toán", vouchers: "Mã giảm giá", services: "Dịch vụ", reviews: "Đánh giá",
  complaints: "Khiếu nại", notifications: "Thông báo", revenue: "Doanh thu", profile: "Hồ sơ cá nhân",
  reports: "Báo cáo thống kê",
};
const titles: Record<string, string> = {
  trips: "Lịch sử hành trình", payments: "Lịch sử thanh toán", vouchers: "Ưu đãi dành cho bạn",
  complaints: "Hỗ trợ & khiếu nại", notifications: "Hộp thư thông báo", reviews: "Đánh giá tài xế",
  revenue: "Doanh thu theo tháng", vehicles: "Phương tiện của tôi", vehicle: "Phương tiện của tôi", profile: "Thông tin cá nhân",
  customers: "Danh sách khách hàng", drivers: "Đội ngũ tài xế", services: "Danh mục dịch vụ",
  reports: "Báo cáo vận hành", tripsAdmin: "Quản lý chuyến đi",
};
const fmtMoney = displayMoney;
const fmtDate = (value: unknown) => {
  if (value === undefined || value === null) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const statusName = statusLabels;

function safe(value: unknown) { return value === undefined || value === null || value === "" ? "—" : String(value); }

export function PortalSection({ role, section, initialSearch = "" }: { role: Role; section: string; initialSearch?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [tripOptions, setTripOptions] = useState<Row[]>([]);
  const [notificationRecipients, setNotificationRecipients] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [tripFilter, setTripFilter] = useState("ALL");
  const [voucherFilter, setVoucherFilter] = useState("AVAILABLE");
  const [month, setMonth] = useState(currentReportMonth);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({ fullName: "", phone: "" });
  const requestSequence = useRef(0);

  async function load() {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const authResponse = await mutationFetch("/api/auth/me", { cache: "no-store" });
      const authBody = await authResponse.json();
      if (requestId !== requestSequence.current) return;
      if (!authResponse.ok || !authBody.success) throw new Error("Phiên đăng nhập đã hết hạn.");
      const current = authBody.data as Session;
      setSession(current);
      let endpoint = "";
      if (role === "ADMIN") endpoint = `/api/admin/${section}${["reviews", "reports"].includes(section) ? `?month=${month}` : ""}`;
      else if (role === "CUSTOMER") {
        endpoint = section === "profile" ? `/api/customers/${current.userId}`
          : section === "complaints" ? `/api/customers/${current.userId}/complaints`
            : section === "payments" ? `/api/customers/${current.userId}/payments`
              : section === "vouchers" ? `/api/customers/${current.userId}/vouchers`
                : section === "reviews" ? `/api/customers/${current.userId}/reviews`
                : section === "notifications" ? `/api/users/${current.userId}/notifications`
                  : `/api/customers/${current.userId}/trips`;
      } else {
        endpoint = section === "profile" ? `/api/drivers/${current.userId}`
          : section === "revenue" ? `/api/drivers/${current.userId}/revenue/${month}`
            : section === "reviews" ? `/api/drivers/${current.userId}/reviews`
              : section === "vehicle" ? `/api/drivers/${current.userId}/vehicle`
                : section === "notifications" ? `/api/users/${current.userId}/notifications`
                : `/api/drivers/${current.userId}/trips`;
      }
      const response = await mutationFetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (requestId !== requestSequence.current) return;
      if (!response.ok || !body.success) throw new Error(body.data?.message || body.message || "Không thể tải dữ liệu.");
      if (role === "CUSTOMER" && section === "complaints") {
        const tripResponse = await mutationFetch(`/api/customers/${current.userId}/trips`, { cache: "no-store" });
        const tripBody = await tripResponse.json();
        if (requestId !== requestSequence.current) return;
        setTripOptions(tripResponse.ok && tripBody.success && Array.isArray(tripBody.data) ? tripBody.data : []);
      }
      if (section === "profile") {
        const record = body.data.profile || body.data;
        setProfile({ fullName: String(record.full_name || ""), phone: String(record.phone || "") });
        setRows([record]);
      } else {
        if ((section === "payments" || (role === "ADMIN" && section === "trips")) && (!Array.isArray(body.data) || body.data.some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row)))) {
          if (section === "trips") throw new Error("Dữ liệu chuyến đi trả về sai định dạng. Vui lòng thử tải lại.");
          throw new Error("API lịch sử thanh toán trả về sai định dạng. Vui lòng tải lại hoặc kiểm tra API, không xem đây là danh sách trống.");
        }
        setRows(Array.isArray(body.data) ? body.data : []);
      }
      if (role === "ADMIN" && section === "notifications") {
        const recipientResponse = await mutationFetch("/api/admin/notifications?recipients=true", { cache: "no-store" });
        const recipientBody = await recipientResponse.json();
        if (requestId !== requestSequence.current) return;
        if (!recipientResponse.ok || !recipientBody.success) throw new Error("Không tải được danh sách người nhận.");
        setNotificationRecipients(Array.isArray(recipientBody.data) ? recipientBody.data : []);
      }
    } catch (caught) {
      if (requestId !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Đã xảy ra lỗi.");
      if (!(role === "CUSTOMER" && section === "payments")) setRows([]);
    } finally { if (requestId === requestSequence.current) { setLoading(false); setLoadedOnce(true); } }
  }

  useEffect(() => { void load(); }, [role, section, month]);
  useEffect(() => {
    if (role === "ADMIN" || section !== "notifications" || !session) return;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.userId === session.userId && Array.isArray(detail.rows)) setRows(detail.rows);
    };
    window.addEventListener("rideflow:notifications-loaded", receive);
    return () => window.removeEventListener("rideflow:notifications-loaded", receive);
  }, [role, section, session]);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesText = localizedSearchText(row).includes(search.trim().toLocaleLowerCase("vi"));
    const status = String(row.status || "");
    const matchesTripFilter = section !== "trips" || tripFilter === "ALL"
      || (tripFilter === "ACTIVE" && ["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"].includes(status))
      || status === tripFilter;
    const voucher = row.voucher as Row | null;
    const expired = voucher?.end_date ? new Date(String(voucher.end_date)).getTime() < Date.now() : false;
    const matchesVoucherFilter = role !== "CUSTOMER" || section !== "vouchers" || voucherFilter === "ALL"
      || (voucherFilter === "USED" && status === "USED")
      || (voucherFilter === "EXPIRED" && (expired || status === "EXPIRED"))
      || (voucherFilter === "AVAILABLE" && status === "AVAILABLE" && !expired);
    return matchesText && matchesTripFilter && matchesVoucherFilter;
  }), [rows, search, section, tripFilter, voucherFilter, role]);
  const title = titles[section] || (role === "ADMIN" && section === "trips" ? titles.tripsAdmin : labels[section] || "Không gian RideFlow");
  const unsupportedMessage = error.includes("only supports") || error.includes("chỉ hỗ trợ") || error.includes("query-based") || error.includes("chưa hỗ trợ") || error.includes("not")
    ? error : "";

  async function submitComplaint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true); setNotice(""); setError("");
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const response = await mutationFetch(`/api/customers/${session.userId}/complaints`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: form.get("subject"), content: form.get("content"), tripId: form.get("tripId") || undefined }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không thể gửi khiếu nại.");
      setNotice("Đã ghi nhận khiếu nại trong Cassandra.");
      element.reset();
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lỗi gửi khiếu nại."); }
    finally { setBusy(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const endpoint = role === "DRIVER" ? `/api/drivers/${session.userId}` : `/api/customers/${session.userId}`;
      const response = await mutationFetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không thể cập nhật hồ sơ.");
      setNotice("Hồ sơ đã được cập nhật.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lỗi cập nhật."); }
    finally { setBusy(false); }
  }

  async function markRead(row: Row) {
    if (!session || !row.created_at || !row.notification_id) return;
    try {
      const createdAt = encodeURIComponent(String(row.created_at));
      const response = await mutationFetch(`/api/users/${session.userId}/notifications/${createdAt}/${String(row.notification_id)}`, { method: "PATCH" });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setError(body.message || "Không đánh dấu đã đọc được.");
        return;
      }
      setRows((current) => current.map((item) => item.notification_id === row.notification_id && String(item.created_at) === String(row.created_at) ? { ...item, is_read: true } : item));
      window.dispatchEvent(new CustomEvent("rideflow:notifications-read", { detail: { userId: session.userId } }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không đánh dấu đã đọc được."); }
  }

  const columnKeys = section === "trips" && role === "CUSTOMER" ? ["trip_id", "driver_name", "pickup_address", "destination_address", "booked_at", "status", "final_fare"]
    : section === "trips" && role === "DRIVER" ? ["trip_id", "customer_name", "pickup_address", "destination_address", "booked_at", "status", "final_fare"]
    : section === "payments" ? ["payment_id", "trip_id", "amount", "payment_method", "payment_status", "paid_at"]
      : section === "vouchers" && role === "CUSTOMER" ? ["voucher_code", "voucher", "status", "received_at", "used_at"]
        : section === "complaints" ? ["subject", "content", "status", "created_at"]
          : section === "notifications" ? ["title", "content", "notification_type", "is_read", "created_at"]
            : section === "revenue" ? ["trip_id", "trip_date", "fare"]
              : section === "reviews" ? ["rating", "comment", "trip_id", "created_at"]
                : section === "vehicles" || section === "vehicle" ? ["license_plate", "brand", "model", "vehicle_type", "seat_count", "status"]
                  : section === "trips" && role === "ADMIN" ? ["trip_id", "customer_name", "driver_name", "pickup_address", "destination_address", "status", "final_fare"]
                    : section === "customers" ? ["full_name", "phone", "email", "created_at", "status"]
                      : section === "drivers" ? ["full_name", "phone", "email", "license_number", "rating", "driver_status", "account_status"]
                        : section === "services" ? ["service_name", "description", "base_fare", "price_per_km", "status"]
                          : section === "vouchers" ? ["voucher_code", "voucher_name", "discount_type", "discount_value", "quantity", "end_date", "status"]
                            : Object.keys(rows[0] || {}).slice(0, 7);

  if (loading && !loadedOnce) return <div className={`section-page ${section === "notifications" ? "notification-page" : ""}`}><RideLoader variant="panel" label="Đang tải dữ liệu Cassandra" /></div>;
  if (role === "ADMIN" && (section === "customers" || section === "drivers")) return <AdminAccountManager key={section} resource={section} rows={rows} loading={loading} error={error} reload={load} />;
  if (role === "ADMIN" && section === "payments") return <AdminPaymentsManager rows={rows} loading={loading} error={error} reload={load} />;
  if (role === "ADMIN" && section === "trips") return <AdminTripsManager rows={rows} loading={loading} error={error} reload={load} initialSearch={initialSearch} />;

  return <div className="section-page">
    <div className="page-heading"><div><span className="section-kicker">{roleLabel(role).toLocaleUpperCase("vi")} · RIDEFLOW</span><h1>{title}</h1><p>{role === "ADMIN" ? "Theo dõi và quản lý thông tin trong hệ thống." : "Thông tin được cập nhật theo tài khoản của bạn."}</p></div>{(section === "revenue" || (role === "ADMIN" && ["trips", "payments", "reviews", "reports"].includes(section))) && <label className="month-picker">Tháng<input type="month" required value={month} onChange={(event) => setMonth(event.target.value)} /></label>}</div>
    {notice && <div className="inline-success" role="status"><Check size={17} />{notice}</div>}
    {error && <div className={`data-error ${unsupportedMessage ? "limitation-error" : ""}`} role="alert">{unsupportedMessage ? <ShieldAlert size={19} /> : <CircleAlert size={19} />}<span>{error}</span>{!unsupportedMessage && <button onClick={() => void load()}>Thử lại</button>}</div>}
    {section === "trips" && role !== "ADMIN" && rows.length > 0 && <div className="trip-filter-tabs" role="tablist" aria-label="Lọc chuyến đi">{[{ id: "ALL", label: "Tất cả" }, { id: "ACTIVE", label: "Đang diễn ra" }, { id: "COMPLETED", label: "Hoàn thành" }, { id: "CANCELLED", label: "Đã hủy" }].map((tab) => <button type="button" role="tab" aria-selected={tripFilter === tab.id} className={tripFilter === tab.id ? "active" : ""} key={tab.id} onClick={() => setTripFilter(tab.id)}>{tab.label}</button>)}</div>}
    {section === "vouchers" && role === "CUSTOMER" && rows.length > 0 && <div className="trip-filter-tabs" role="tablist" aria-label="Lọc voucher">{[{ id: "AVAILABLE", label: "Có thể sử dụng" }, { id: "USED", label: "Đã sử dụng" }, { id: "EXPIRED", label: "Hết hạn" }, { id: "ALL", label: "Tất cả" }].map((tab) => <button type="button" role="tab" aria-selected={voucherFilter === tab.id} className={voucherFilter === tab.id ? "active" : ""} key={tab.id} onClick={() => setVoucherFilter(tab.id)}>{tab.label}</button>)}</div>}
    {section === "payments" && role === "CUSTOMER" && rows.length > 0 && <div className="section-metric-grid"><article className="panel section-metric"><span className="section-kicker">TỔNG CHI TIÊU</span><strong>{fmtMoney(rows.filter((row) => isPaymentSettled(row.payment_status)).reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong><small>{rows.length} giao dịch đã đọc</small></article><article className="panel section-metric"><span className="section-kicker">THANH TOÁN THÁNG NÀY</span><strong>{fmtMoney(rows.filter((row) => isPaymentSettled(row.payment_status) && String(row.paid_at).slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong><small>{new Date().toLocaleDateString("vi-VN", { month: "long", year: "numeric" })}</small></article></div>}
    {section === "reviews" && role === "DRIVER" && rows.length > 0 && <DriverReviewSummary rows={rows} />}

    {section === "complaints" && role === "CUSTOMER" && <form className="panel form-panel" onSubmit={submitComplaint}><div className="panel-heading"><div><span className="section-kicker">HỖ TRỢ KHÁCH HÀNG</span><h2>Gửi yêu cầu hỗ trợ</h2></div></div><div className="form-grid"><label className="form-field"><span>Chuyến đi liên quan</span><select name="tripId" defaultValue=""><option value="">Không chọn chuyến</option>{tripOptions.map((trip) => <option key={String(trip.trip_id)} value={String(trip.trip_id)}>#{String(trip.trip_id).slice(0, 8).toUpperCase()} · {safe(trip.pickup_address)} → {safe(trip.destination_address)}</option>)}</select></label><label className="form-field"><span>Chủ đề</span><input name="subject" required minLength={4} maxLength={120} placeholder="Ví dụ: Hỗ trợ về chuyến đi" /></label><label className="form-field form-field-wide"><span>Nội dung</span><textarea name="content" required minLength={10} maxLength={2000} rows={4} placeholder="Mô tả điều bạn cần RideFlow hỗ trợ..." /></label></div><button className="button button-gold" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}Gửi khiếu nại <ArrowRight size={16} /></button></form>}

    {section === "vehicle" && role === "DRIVER" && rows[0] && <DriverVehicleCard vehicle={rows[0]} />}
    {section === "profile" && session && <form className="panel profile-panel" onSubmit={saveProfile}><div className="profile-hero"><AccountAvatar role={role} userId={session.userId} name={profile.fullName || session.name} className="large-avatar" /><div><span className="section-kicker">HỒ SƠ CÁ NHÂN</span><h2>{profile.fullName || session.name}</h2><p>{session.name}</p></div><span className="demo-badge">RIDEFLOW</span></div><AvatarEditor role={role} userId={session.userId} name={profile.fullName || session.name} showPreview={false} /><div className="form-grid"><label className="form-field"><span>Họ và tên</span><input value={profile.fullName} onChange={(event) => setProfile({ ...profile, fullName: event.target.value })} required minLength={2} /></label><label className="form-field"><span>Số điện thoại</span><input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} required inputMode="tel" minLength={8} maxLength={18} /></label></div><button className="button button-gold" disabled={busy}>Lưu thay đổi <ArrowRight size={16} /></button></form>}
    {section === "profile" && rows[0] && <section className="panel profile-facts"><div><span className="section-kicker">EMAIL</span><strong>{safe(rows[0].email)}</strong></div><div><span className="section-kicker">TRẠNG THÁI</span><strong>{statusLabel(rows[0].status || rows[0].account_status)}</strong></div>{role === "DRIVER" && <><div><span className="section-kicker">GIẤY PHÉP LÁI XE</span><strong>{safe(rows[0].license_number)}</strong></div><div><span className="section-kicker">ĐÁNH GIÁ</span><strong>★ {Number(rows[0].rating || 0).toFixed(1)}</strong></div></>}<div><span className="section-kicker">THAM GIA</span><strong>{fmtDate(rows[0].created_at)}</strong></div></section>}

    {loading ? <div className="panel loading-panel"><LoaderCircle className="spin" size={24} /><span>Đang đọc dữ liệu Cassandra...</span></div> : rows.length > 0 && section !== "profile" && section !== "complaints" ? <section className="panel data-panel"><div className="panel-heading"><div><span className="section-kicker">{labels[section]?.toUpperCase() || section.toUpperCase()}</span><h2>{rows.length} bản ghi được tải</h2></div><label className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong dữ liệu đã tải" /></label></div><div className="table-scroll"><table className="data-table"><thead><tr>{columnKeys.map((key) => <th key={key}>{columnLabel(key)}</th>)}{role === "DRIVER" && section === "trips" && <th>THAO TÁC</th>}{section === "trips" && role === "CUSTOMER" && <th />}{role === "ADMIN" && section === "payments" && <th>THAO TÁC</th>}{section === "notifications" && <th>THAO TÁC</th>}{role === "ADMIN" && ["customers", "drivers", "vehicles", "services", "vouchers"].includes(section) && <th>THAO TÁC</th>}</tr></thead><tbody>{filtered.map((row, index) => <tr key={JSON.stringify([row.payment_id || row.notification_id || row.complaint_id || row.review_id || row.trip_id || row.voucher_code || row.vehicle_id || row.service_id || row.customer_id || row.driver_id || index, row.created_at || row.paid_at || row.booked_at || row.trip_date || ""])}>{columnKeys.map((key) => <td key={key}>{key === "trip_id" && role === "CUSTOMER" ? <Link className="trip-code" href={`/customer/trips/${String(row.trip_id)}`}>#{safe(row.trip_id).slice(0, 8).toUpperCase()}</Link> : key === "service_name" ? serviceNameLabel(row[key]) : key === "vehicle_type" ? vehicleTypeLabel(row[key]) : key === "discount_type" ? discountTypeLabel(row[key]) : key === "discount_value" ? row.discount_type === "PERCENT" ? `${Number(row[key])}%` : fmtMoney(row[key]) : key === "payment_method" ? paymentMethodLabel(row[key]) : key === "payment_status" ? paymentStatusLabel(row[key]) : key === "paid_at" && !isPaymentSettled(row.payment_status) ? "Chưa thanh toán" : key === "is_read" ? row[key] === true ? "Đã đọc" : "Chưa đọc" : key === "notification_type" ? notificationTypeLabel(row[key]) : key.includes("fare") || key === "amount" || key === "base_fare" || key === "price_per_km" ? fmtMoney(row[key]) : key.endsWith("_at") || key.endsWith("_date") ? fmtDate(row[key]) : key === "status" || key === "payment_status" || key === "driver_status" || key === "account_status" ? <span className={`status-pill status-${String(row[key]).toLowerCase()}`}><i />{section === "vouchers" && row[key] === "AVAILABLE" ? "Có thể sử dụng" : statusLabel(row[key])}</span> : key === "voucher" ? safe((row.voucher as Row | null)?.voucher_name) : key === "rating" ? <span className="rating-value"><Star size={14} fill="currentColor" /> {safe(row[key])}</span> : safe(row[key])}</td>)}{role === "CUSTOMER" && section === "trips" && <td><Link href={`/customer/trips/${String(row.trip_id)}`} aria-label="Xem chi tiết"><ArrowRight size={16} /></Link></td>}{role === "DRIVER" && section === "trips" && <td><DriverTripAction trip={row} onDone={load} onNotice={setNotice} /></td>}{role === "ADMIN" && section === "payments" && <td><PaymentAccessButton tripId={String(row.trip_id)} onChanged={load} /></td>}{section === "notifications" && <td>{role === "DRIVER" && row.notification_type === "TRIP_ASSIGNED" && <Link className="table-action" href={`/driver/trips?tripId=${String(row.content || "").match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0] || ""}`} onClick={() => { if (!row.is_read) void markRead(row); }}>Mở chuyến để nhận</Link>}{row.is_read ? <span className="muted-cell">Đã đọc</span> : <button className="table-action" onClick={() => void markRead(row)}>Đánh dấu đã đọc</button>}</td>}{role === "ADMIN" && ["customers", "drivers", "vehicles", "services", "vouchers"].includes(section) && <td><AdminStatusAction resource={section} row={row} onDone={load} /></td>}</tr>)}</tbody></table></div>{filtered.length === 0 && <div className="empty-inline">Không tìm thấy dữ liệu khớp với nội dung tìm kiếm.</div>}</section> : !loading && !error && section !== "profile" && section !== "complaints" ? <section className="panel empty-state"><span className="empty-icon"><Search size={22} /></span><h2>Chưa có dữ liệu hiển thị</h2><p>{role === "ADMIN" && ["payments", "reviews", "complaints", "notifications", "reports"].includes(section) ? "Chưa có bản ghi phù hợp. Hãy thử chọn thời gian khác hoặc tải lại." : "Chưa có dữ liệu trong mục này."}</p></section> : null}
    {role === "ADMIN" && section === "services" && <ServiceCreateForm onCreated={load} />}
    {role === "ADMIN" && section === "vouchers" && <VoucherCreateForm onCreated={load} />}
    {section === "complaints" && rows.length > 0 && <ComplaintList rows={rows} role={role} onDone={load} />}
    {role === "ADMIN" && section === "notifications" && <NotificationCreateForm recipients={notificationRecipients} onCreated={load} />}
  </div>;
}

function DriverReviewSummary({ rows }: { rows: Row[] }) {
  const ratings = rows.map((row) => Number(row.rating)).filter((rating) => rating >= 1 && rating <= 5);
  const average = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;
  return <section className="panel driver-review-summary"><div><span className="section-kicker">ĐIỂM ĐÁNH GIÁ</span><strong className="driver-rating-score">{average.toFixed(1)} <span>★</span></strong><small>{ratings.length} nhận xét của khách hàng</small></div><div className="rating-distribution">{[5, 4, 3, 2, 1].map((stars) => { const count = ratings.filter((rating) => rating === stars).length; const width = ratings.length ? count / ratings.length * 100 : 0; return <div key={stars}><span>{stars} ★</span><i><b style={{ width: `${width}%` }} /></i><small>{count}</small></div>; })}</div></section>;
}

function DriverVehicleCard({ vehicle }: { vehicle: Row }) {
  return <article className="panel driver-vehicle-card"><div className="vehicle-card-graphic"><span><CarFront size={34} /></span><i>ĐỘI XE RIDEFLOW</i></div><div className="vehicle-card-details"><div className="vehicle-card-title"><div><span className="section-kicker">PHƯƠNG TIỆN ĐANG ĐĂNG KÝ</span><h2>{String(vehicle.brand)} {String(vehicle.model)}</h2></div><span className="status-pill status-active"><i />{statusName[String(vehicle.status)] || String(vehicle.status)}</span></div><strong className="vehicle-plate">{String(vehicle.license_plate)}</strong><div className="vehicle-facts"><span><small>LOẠI XE</small><b>{vehicleTypeLabel(vehicle.vehicle_type)}</b></span><span><small>MÀU SẮC</small><b>{String(vehicle.color)}</b></span><span><small>SỐ CHỖ</small><b>{Number(vehicle.seat_count)} chỗ</b></span></div></div></article>;
}

function ComplaintList({ rows, role, onDone }: { rows: Row[]; role: Role; onDone: () => void }) {
  return <section className="complaint-list"><div className="panel-heading"><div><span className="section-kicker">LỊCH SỬ KHIẾU NẠI</span><h2>{role === "ADMIN" ? "Khiếu nại cần theo dõi" : "Khiếu nại của bạn"}</h2></div></div><div className="complaint-grid">{rows.map((row) => <article className="panel complaint-card" key={String(row.complaint_id)}><div className="complaint-card-head"><div><span className="section-kicker">{role === "ADMIN" ? safe(row.user_name) : `CHUYẾN #${String(row.trip_id || "—").slice(0, 8).toUpperCase()}`}</span><h3>{safe(row.subject)}</h3></div><span className={`status-pill status-${String(row.status).toLowerCase()}`}><i />{statusName[String(row.status)] || safe(row.status)}</span></div><p>{safe(row.content)}</p><div className="complaint-card-foot"><span>{fmtDate(row.created_at)}</span>{role === "ADMIN" && <ComplaintStatusAction row={row} onDone={onDone} />}</div></article>)}</div></section>;
}

function ComplaintStatusAction({ row, onDone }: { row: Row; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const current = String(row.status);
  const next = current === "OPEN" ? "PROCESSING" : current === "PROCESSING" ? "RESOLVED" : "";
  if (!next) return <span className="muted-cell">Đã xử lý</span>;
  return <button className="table-action" disabled={busy} onClick={async () => {
    if (!window.confirm(`Chuyển khiếu nại sang ${statusName[next]}?`)) return;
    setBusy(true);
    const createdAt = encodeURIComponent(String(row.created_at));
    try {
      const response = await mutationFetch(`/api/admin/complaints/${String(row.customer_id)}/${createdAt}/${String(row.complaint_id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không cập nhật được khiếu nại.");
      onDone();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Lỗi cập nhật."); }
    finally { setBusy(false); }
  }}>{busy ? <LoaderCircle className="spin" size={14} /> : next === "PROCESSING" ? "Bắt đầu xử lý" : "Đánh dấu đã giải quyết"}</button>;
}

function NotificationCreateForm({ recipients, onCreated }: { recipients: Row[]; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const options = [...new Map(recipients.map((item) => [String(item.user_id), item])).values()];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const response = await mutationFetch("/api/admin/notifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: form.get("userId"), title: form.get("title"), content: form.get("content"), notificationType: "SYSTEM" }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không gửi được thông báo.");
      setMessage("Đã gửi thông báo đến người nhận."); element.reset(); onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi gửi thông báo."); }
    finally { setBusy(false); }
  }
  return <form className="panel form-panel compact-form" onSubmit={submit}><div className="panel-heading"><div><span className="section-kicker">THÔNG BÁO</span><h2>Gửi thông báo</h2></div></div>{options.length ? <div className="form-grid"><label className="form-field"><span>Người nhận</span><select name="userId" required>{options.map((item) => <option key={String(item.user_id)} value={String(item.user_id)}>{safe(item.user_name)} · {roleLabel(item.user_role)}</option>)}</select></label><label className="form-field"><span>Tiêu đề</span><input name="title" required minLength={2} maxLength={100} /></label><label className="form-field form-field-wide"><span>Nội dung</span><textarea name="content" required minLength={5} maxLength={1000} rows={3} /></label></div> : <div className="empty-inline">Chưa có người nhận trong danh sách.</div>}{message && <p className="form-note">{message}</p>}<button className="button button-gold" disabled={busy || options.length === 0}>Gửi thông báo <ArrowRight size={15} /></button></form>;
}

function DriverTripAction({ trip, onDone, onNotice }: { trip: Row; onDone: () => void; onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const next: Record<string, string> = { BOOKED: "ACCEPTED", ACCEPTED: "ARRIVING", ARRIVING: "IN_PROGRESS", IN_PROGRESS: "COMPLETED" };
  const status = String(trip.status);
  if (status === "COMPLETED") return <div className="trip-actions"><PaymentAccessButton tripId={String(trip.trip_id)} /><span className="muted-cell">Đã hoàn thành chuyến</span></div>;
  if (!next[status]) return <span className="muted-cell">Không cần xử lý</span>;
  async function update(targetStatus: string) {
    const incident = targetStatus === "CANCELLED";
    const question = incident
      ? "Báo sự cố và yêu cầu RideFlow tự đổi tài xế khác cho khách? Bạn sẽ chuyển sang ngoại tuyến."
      : targetStatus === "COMPLETED" ? "Xác nhận hoàn thành chuyến? Nếu thanh toán tiền mặt, chỉ xác nhận sau khi đã thu tiền. Chuyển khoản sẽ chờ tài xế xác nhận đã nhận tiền." : `Xác nhận chuyển chuyến sang ${statusName[targetStatus]}?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const response = await mutationFetch(`/api/trips/${String(trip.trip_id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus, cashReceived: targetStatus === "COMPLETED" ? true : undefined, note: incident ? "Tài xế báo sự cố và yêu cầu đổi tài xế." : undefined }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không cập nhật được chuyến.");
      if (incident) {
        window.alert(body.data.reassigned
          ? `Đã đổi chuyến sang tài xế ${body.data.newDriverName}. Tài khoản của bạn đã chuyển ngoại tuyến.`
          : "Chưa có tài xế thay thế nên chuyến đã được hủy. Tài khoản của bạn đã chuyển ngoại tuyến.");
      }
      onNotice(targetStatus === "COMPLETED"
        ? body.data.payment_method === "BANK_TRANSFER"
          ? "Đã hoàn thành chuyến. Mở Xem thanh toán để xác nhận khi đã nhận tiền chuyển khoản."
          : body.data.payment_method === "CASH"
            ? "Đã hoàn thành chuyến và ghi nhận đã thu tiền mặt."
            : "Đã hoàn thành chuyến. Mở Xem thanh toán để kiểm tra thanh toán."
        : `Đã cập nhật chuyến: ${statusName[targetStatus]}.`);
      onDone();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Lỗi cập nhật."); }
    finally { setBusy(false); }
  }
  return <div className="trip-actions"><button className="table-action" disabled={busy} onClick={() => void update(next[status])}>{busy ? <LoaderCircle className="spin" size={14} /> : statusName[next[status]]}</button>{["BOOKED", "ACCEPTED", "ARRIVING"].includes(status) && <button className="table-action trip-incident" disabled={busy} onClick={() => void update("CANCELLED")}>Báo sự cố</button>}</div>;
}

function AdminStatusAction({ resource, row, onDone }: { resource: string; row: Row; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const key = adminResourceKey(resource, row);
  const current = String(resource === "drivers" ? row.account_status : row.status);
  const next = current === "ACTIVE" ? (resource === "customers" || resource === "drivers" ? "BLOCKED" : "INACTIVE") : "ACTIVE";
  if (!key || !current) return <span className="muted-cell">Không khả dụng</span>;
  return <button className="table-action" disabled={busy} onClick={async () => {
    if (!window.confirm(`Xác nhận đổi trạng thái thành ${statusName[next] || next}?`)) return;
    setBusy(true);
    const body = resource === "drivers" ? { accountStatus: next }
      : resource === "vehicles" ? { status: next, driverId: row.driver_id } : { status: next };
    try {
      const response = await mutationFetch(`/api/admin/${resource}/${encodeURIComponent(key)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Không cập nhật được trạng thái.");
      onDone();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Lỗi cập nhật."); }
    finally { setBusy(false); }
  }}>{busy ? <LoaderCircle className="spin" size={14} /> : current === "ACTIVE" ? "Tạm dừng" : "Kích hoạt"}</button>;
}

function ServiceCreateForm({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const response = await mutationFetch("/api/admin/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceName: form.get("serviceName"), description: form.get("description"), baseFare: Number(form.get("baseFare")), pricePerKm: Number(form.get("pricePerKm")), status: "ACTIVE" }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không thể tạo dịch vụ.");
      setMessage("Dịch vụ đã được thêm vào Cassandra."); element.reset(); onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi tạo dịch vụ."); }
    finally { setBusy(false); }
  }
  return <form className="panel form-panel compact-form" onSubmit={submit}><div className="panel-heading"><div><span className="section-kicker">DANH MỤC DỊCH VỤ</span><h2>Thêm dịch vụ</h2></div></div><div className="form-grid"><label className="form-field"><span>Tên dịch vụ</span><input name="serviceName" required maxLength={40} /></label><label className="form-field"><span>Giá mở cửa (₫)</span><input name="baseFare" type="number" min="0" required /></label><label className="form-field"><span>Giá mỗi km (₫)</span><input name="pricePerKm" type="number" min="1" required /></label><label className="form-field"><span>Mô tả</span><input name="description" maxLength={200} /></label></div>{message && <p className="form-note">{message}</p>}<button className="button button-gold" disabled={busy}>Thêm dịch vụ <ArrowRight size={15} /></button></form>;
}

function VoucherCreateForm({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const response = await mutationFetch("/api/admin/vouchers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voucherCode: form.get("voucherCode"), voucherName: form.get("voucherName"), discountType: form.get("discountType"), discountValue: Number(form.get("discountValue")), maxDiscount: Number(form.get("maxDiscount")), minTripAmount: Number(form.get("minTripAmount")), quantity: Number(form.get("quantity")), startDate: form.get("startDate"), endDate: form.get("endDate"), status: "ACTIVE" }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không thể tạo mã giảm giá.");
      setMessage("Mã giảm giá đã được tạo."); element.reset(); onCreated();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi tạo mã giảm giá."); }
    finally { setBusy(false); }
  }
  return <form className="panel form-panel compact-form" onSubmit={submit}><div className="panel-heading"><div><span className="section-kicker">KHUYẾN MÃI</span><h2>Tạo mã giảm giá</h2></div></div><div className="form-grid"><label className="form-field"><span>Mã voucher</span><input name="voucherCode" required maxLength={24} autoCapitalize="characters" /></label><label className="form-field"><span>Tên chương trình</span><input name="voucherName" required maxLength={80} /></label><label className="form-field"><span>Loại giảm</span><select name="discountType"><option value="PERCENT">Phần trăm</option><option value="FIXED">Số tiền</option></select></label><label className="form-field"><span>Giá trị giảm</span><input name="discountValue" type="number" min="1" required /></label><label className="form-field"><span>Giảm tối đa (₫)</span><input name="maxDiscount" type="number" min="0" defaultValue="50000" required /></label><label className="form-field"><span>Đơn tối thiểu (₫)</span><input name="minTripAmount" type="number" min="0" defaultValue="0" required /></label><label className="form-field"><span>Số lượng</span><input name="quantity" type="number" min="0" required /></label><label className="form-field"><span>Bắt đầu</span><input name="startDate" type="date" required /></label><label className="form-field"><span>Kết thúc</span><input name="endDate" type="date" required /></label></div>{message && <p className="form-note">{message}</p>}<button className="button button-gold" disabled={busy}>Tạo mã giảm giá <ArrowRight size={15} /></button></form>;
}
