"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeDollarSign, CarFront, CircleCheck, Clock3, CreditCard, MapPin, ShieldCheck, Star, TicketPercent, Users, XCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Role } from "@/lib/demo-users";
import { DriverAvailability } from "@/components/portal/DriverAvailability";
import { RideLoader } from "@/components/ui/RideLoader";

import { currentReportMonth, displayMoney } from "@/lib/business-values";
import { statusLabel } from "@/lib/display-labels";

type Row = Record<string, unknown>;
type DashboardData = {
  month: string;
  profile?: Row;
  stats: Record<string, number>;
  trips: Row[];
  revenue?: Row[];
  spending?: Row[];
  reviews?: Row[];
  notifications?: Row[];
  charts?: { daily: Array<{ date: string; trips: number }>; revenue: Array<{ date: string; amount: number }>; status: Array<{ name: string; value: number }> };
  limitations?: Record<string, string>;
};

const dateTime = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const chartColors = ["#db2777", "#f472b6", "#be185d", "#fb7185", "#a855f7", "#9d174d"];
const labels: Record<string, string> = { BOOKED: "Đã đặt", ACCEPTED: "Đã nhận", ARRIVING: "Đang đến", IN_PROGRESS: "Đang đi", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy" };
const moneyText = displayMoney;
const safeText = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const dateText = (value: unknown) => { const parsed = new Date(String(value)); return Number.isNaN(parsed.valueOf()) ? "—" : dateTime.format(parsed); };

export function RoleDashboard({ role, name }: { role: Role; name: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(currentReportMonth);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/dashboard?month=${month}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message || "Không tải được dashboard.");
        return body.data as DashboardData;
      })
      .then((value) => { if (!controller.signal.aborted) { setData(value); setError(""); } })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Lỗi tải dữ liệu."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, reload]);

  const cards = role === "ADMIN" ? [
    { label: "Khách hàng đã đọc", value: data?.stats.customerRecords, icon: Users, note: "Tối đa 100 bản ghi" },
    { label: "Tài xế đã đọc", value: data?.stats.driverRecords, icon: CarFront, note: "Tối đa 100 bản ghi" },
    { label: "Chuyến trong tháng", value: data?.stats.tripCount, icon: Clock3, note: "Partition trạng thái-ngày" },
    { label: "Hoàn thành", value: data?.stats.completedTrips, icon: CircleCheck, note: "Trong tháng chọn" },
    { label: "Đã hủy", value: data?.stats.cancelledTrips, icon: XCircle, note: "Trong tháng chọn" },
    { label: "Doanh thu hoàn thành", value: moneyText(data?.stats.revenue), icon: BadgeDollarSign, note: "Từ trips_by_status" },
    { label: "Rating tài xế", value: Number(data?.stats.averageRating || 0).toFixed(1), icon: Star, note: "Trung bình hồ sơ đã đọc" },
  ] : role === "DRIVER" ? [
    { label: "Chuyến hôm nay", value: data?.stats.todayTrips, icon: CarFront, note: "Theo trips_by_driver" },
    { label: "Hoàn thành gần đây", value: data?.stats.completedTrips, icon: CircleCheck, note: "Trong 50 chuyến gần nhất" },
    { label: "Doanh thu tháng", value: moneyText(data?.stats.totalRevenue), icon: BadgeDollarSign, note: `Tháng ${month}` },
    { label: "Đánh giá", value: Number(data?.stats.averageRating || 0).toFixed(1), icon: Star, note: "Sao trung bình" },
  ] : [
    { label: "Chuyến gần đây", value: data?.stats.totalTrips, icon: CarFront, note: "Tối đa 50 bản ghi" },
    { label: "Hoàn thành gần đây", value: data?.stats.completedTrips, icon: CircleCheck, note: "Trong 50 chuyến gần nhất" },
    { label: "Chi tiêu gần đây", value: moneyText(data?.stats.totalSpent), icon: BadgeDollarSign, note: "50 giao dịch gần nhất" },
    { label: "Voucher của tôi", value: data?.stats.voucherCount, icon: TicketPercent, note: "Đang khả dụng" },
  ];
  const chartData = role === "ADMIN" ? data?.charts?.daily
    : role === "DRIVER" ? data?.revenue?.map((row) => ({ date: safeText(row.trip_date).slice(5), trips: Number(row.fare || 0) }))
      : data?.spending?.map((row) => ({ date: safeText(row.trip_date).slice(5), trips: Number(row.amount || 0) }));
  const chartLabel = role === "ADMIN" ? "NHỊP ĐỘ VẬN HÀNH" : role === "DRIVER" ? "DOANH THU" : "CHI TIÊU";
  const chartTitle = role === "ADMIN" ? "Chuyến đi theo ngày" : `Tháng ${month}`;

  return <div className="dashboard-page">
    <div className="dashboard-heading"><div><span className="section-kicker">{role === "ADMIN" ? "RIDEFLOW · TRUNG TÂM ĐIỀU HÀNH" : "RIDEFLOW · HÀNH TRÌNH CỦA BẠN"}</span><h1>{role === "ADMIN" ? "Bức tranh vận hành" : role === "DRIVER" ? "Hôm nay trên mọi nẻo đường" : "Mỗi chuyến đi, một ngày vui"}</h1><p>Xin chào, <strong>{name}</strong>. Tổng quan được cập nhật từ dữ liệu Cassandra.</p></div><label className="month-picker">Tháng dữ liệu<input type="month" required value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} /></label>{role === "ADMIN" ? null : role === "DRIVER" ? <DriverAvailability driverId={String(data?.profile?.driver_id || "")} initialStatus={String(data?.profile?.driver_status || "OFFLINE")} onStatusChange={(status) => setData((current) => current ? { ...current, profile: { ...current.profile, driver_status: status } } : current)} /> : <Link href="/customer/booking" className="button button-gold"><CarFront size={17} /> Đặt chuyến mới</Link>}</div>
    {loading && <RideLoader variant="inline" label="RideFlow đang tải dữ liệu Cassandra" />}
    {error && <div className="data-error" role="alert"><XCircle size={18} />{error}<button onClick={() => setReload((value) => value + 1)}>Thử lại</button></div>}
    <div className="stat-grid">{cards.map(({ label, value, icon: Icon, note }, index) => <article className={`stat-card stat-card-${index + 1}`} key={label}><div className="stat-card-top"><span>{label}</span><i><Icon size={18} /></i></div><strong>{loading ? <span className="skeleton skeleton-value" /> : value ?? "—"}</strong><small>{note}</small></article>)}</div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><span className="section-kicker">{chartLabel}</span><h2>{chartTitle}</h2></div><span className="chart-period"><i /> Cassandra</span></div>{loading ? <div className="chart-skeleton"><span /><span /><span /><span /><span /><span /></div> : chartData?.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid stroke="#e9edf0" vertical={false} /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#8995a3", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#8995a3", fontSize: 11 }} /><Tooltip cursor={{ fill: "#f3f5f6" }} formatter={(value) => role === "ADMIN" ? [value, "Chuyến"] : [moneyText(value), role === "DRIVER" ? "Doanh thu" : "Chi tiêu"]} /><Bar dataKey="trips" fill="#dfa42b" radius={[4, 4, 0, 0]} maxBarSize={32} /></BarChart></ResponsiveContainer></div> : <div className="empty-chart"><span><Clock3 size={20} /></span><strong>Chưa có dữ liệu trong kỳ này</strong><small>Biểu đồ sẽ cập nhật khi Cassandra có phát sinh.</small></div>}</section>
      {role === "ADMIN" ? <section className="panel status-panel"><div className="panel-heading"><div><span className="section-kicker">PHÂN BỔ</span><h2>Trạng thái chuyến</h2></div><span className="panel-menu">•••</span></div>{loading ? <div className="chart-skeleton" /> : data?.charts?.status.length ? <><div className="donut-wrap"><ResponsiveContainer width="100%" height={188}><PieChart><Pie data={data.charts.status} dataKey="value" nameKey="name" innerRadius={58} outerRadius={81} paddingAngle={3} stroke="none">{data.charts.status.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value, name) => [value, statusLabel(name)]} /></PieChart></ResponsiveContainer><div className="donut-total"><strong>{data.stats.tripCount}</strong><small>chuyến</small></div></div><div className="legend-list">{data.charts.status.map((item, index) => <div key={item.name}><i style={{ background: chartColors[index % chartColors.length] }} />{labels[item.name] || item.name}<strong>{item.value}</strong></div>)}</div></> : <div className="empty-chart"><small>Không có dữ liệu trạng thái cho tháng này.</small></div>}</section> : <section className="panel journey-panel"><div className="panel-heading"><div><span className="section-kicker">LỐI TẮT</span><h2>{role === "CUSTOMER" ? "Việc cần làm" : "Không gian tài xế"}</h2></div></div><div className="shortcut-list">{(role === "CUSTOMER" ? [{ icon: CarFront, title: "Đặt một chuyến xe", note: "Điểm đến tiếp theo đang chờ bạn", href: "/customer/booking" }, { icon: CreditCard, title: "Xem thanh toán", note: "Theo dõi lịch sử giao dịch", href: "/customer/payments" }, { icon: MapPin, title: "Gửi phản hồi", note: "Chúng tôi luôn lắng nghe", href: "/customer/complaints" }] : [{ icon: CarFront, title: "Cập nhật chuyến", note: "Theo dõi trạng thái đang chạy", href: "/driver/trips" }, { icon: BadgeDollarSign, title: "Xem doanh thu", note: "Chi tiết thu nhập theo tháng", href: "/driver/revenue" }, { icon: Star, title: "Đánh giá của bạn", note: "Phản hồi từ khách hàng", href: "/driver/reviews" }]).map(({ icon: Icon, title, note, href }) => <Link href={href} className="shortcut" key={href}><i><Icon size={17} /></i><span><strong>{title}</strong><small>{note}</small></span><ArrowRight size={16} /></Link>)}</div><div className="journey-note"><span><Star size={16} fill="currentColor" /></span><p><strong>Hành trình của bạn, theo cách riêng.</strong><br />RideFlow đồng hành cùng mỗi điểm đến.</p></div></section>}
    </div>
    <section className="panel trips-panel"><div className="panel-heading"><div><span className="section-kicker">CẬP NHẬT MỚI NHẤT</span><h2>{role === "ADMIN" ? "Chuyến đi gần đây" : "Chuyến đi của bạn"}</h2></div><Link href={role === "ADMIN" ? "/admin/trips" : role === "DRIVER" ? "/driver/trips" : "/customer/trips"} className="text-link">Xem tất cả <ArrowRight size={15} /></Link></div>{loading ? <div className="table-skeleton"><i /><i /><i /><i /></div> : data?.trips?.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>MÃ CHUYẾN</th>{role === "ADMIN" && <th>KHÁCH HÀNG</th>}<th>HÀNH TRÌNH</th><th>THỜI GIAN</th><th>TRẠNG THÁI</th><th className="align-right">GIÁ CƯỚC</th></tr></thead><tbody>{data.trips.slice(0, 6).map((trip) => <tr key={safeText(trip.trip_id)}><td><span className="trip-code">#{safeText(trip.trip_id).slice(0, 8).toUpperCase()}</span></td>{role === "ADMIN" && <td><strong>{safeText(trip.customer_name, "Khách")}</strong><small className="cell-subline">Tài xế: {safeText(trip.driver_name, "—")}</small></td>}<td><span className="route-cell"><i />{safeText(trip.pickup_address)}<br /><i />{safeText(trip.destination_address)}</span></td><td>{dateText(trip.booked_at)}</td><td><span className={`status-pill status-${safeText(trip.status).toLowerCase()}`}><i />{labels[String(trip.status)] || safeText(trip.status)}</span></td><td className="align-right fare-cell">{moneyText(trip.final_fare)}</td></tr>)}</tbody></table></div> : <div className="empty-table"><span><CarFront size={21} /></span><strong>Chưa có chuyến đi nào</strong><small>Chuyến mới sẽ xuất hiện ở đây sau khi được lưu vào Cassandra.</small>{role === "CUSTOMER" && <Link href="/customer/booking" className="text-link">Đặt chuyến đầu tiên <ArrowRight size={15} /></Link>}</div>}</section>
    {role === "ADMIN" && <section className="panel chart-panel admin-revenue-chart"><div className="panel-heading"><div><span className="section-kicker">DOANH THU HOÀN THÀNH</span><h2>Doanh thu theo ngày</h2></div><span className="chart-period"><i /> Chuyến hoàn thành</span></div>{loading ? <RideLoader variant="panel" label="Đang tổng hợp doanh thu" /> : data?.charts?.revenue?.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.charts.revenue} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid stroke="#e9edf0" vertical={false} /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#8995a3", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#8995a3", fontSize: 11 }} /><Tooltip formatter={(value) => [moneyText(value), "Doanh thu"]} /><Bar dataKey="amount" fill="#4e947e" radius={[4, 4, 0, 0]} maxBarSize={32} /></BarChart></ResponsiveContainer></div> : <div className="empty-chart"><small>Chưa có doanh thu trong kỳ này.</small></div>}</section>}
    {role === "ADMIN" && data?.limitations && <div className="limitation-note"><ShieldCheck size={17} /><span><strong>Phạm vi thống kê.</strong> {data.limitations.customerRecords} {data.limitations.revenue}</span></div>}
    {role === "CUSTOMER" && <section className="panel dashboard-activity"><div className="panel-heading"><div><span className="section-kicker">HỘP THƯ</span><h2>Thông báo mới</h2></div><Link href="/customer/notifications" className="text-link">Mở hộp thư <ArrowRight size={14} /></Link></div>{data?.notifications?.length ? data.notifications.slice(0, 3).map((item) => <article className="activity-row" key={safeText(item.notification_id)}><span className={`activity-dot ${item.is_read ? "read" : "unread"}`} /><span><strong>{safeText(item.title)}</strong><small>{safeText(item.content)}</small></span><time>{dateText(item.created_at)}</time></article>) : <div className="empty-inline">Chưa có thông báo mới.</div>}</section>}
    {role === "DRIVER" && <section className="panel dashboard-activity"><div className="panel-heading"><div><span className="section-kicker">PHẢN HỒI GẦN ĐÂY</span><h2>Khách hàng đánh giá</h2></div><Link href="/driver/reviews" className="text-link">Tất cả đánh giá <ArrowRight size={14} /></Link></div>{data?.reviews?.length ? data.reviews.slice(0, 3).map((item) => <article className="activity-row" key={safeText(item.review_id)}><span className="activity-star">★</span><span><strong>{safeText(item.comment, "Khách hàng đã gửi đánh giá")}</strong><small>{Number(item.rating || 0)} / 5 sao</small></span><time>{dateText(item.created_at)}</time></article>) : <div className="empty-inline">Chưa có đánh giá của tài xế.</div>}</section>}
  </div>;
}
