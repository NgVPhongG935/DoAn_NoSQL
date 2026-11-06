"use client";

import { mutationFetch } from "@/lib/mutation-request";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CarFront, Check, CircleCheck, CircleDot, Clock3, LoaderCircle, MapPin, RefreshCw, Star, XCircle } from "lucide-react";
import { RideLoader } from "@/components/ui/RideLoader";

import { displayMoney, tripFare } from "@/lib/business-values";
import { paymentMethodLabel } from "@/lib/payment-values";
import { serviceNameLabel } from "@/lib/display-labels";
import { TripPaymentPanel } from "@/components/trips/TripPaymentPanel";

type Row = Record<string, unknown>;
const statusLabel: Record<string, string> = { BOOKED: "Đã đặt chuyến", ACCEPTED: "Tài xế đã nhận", ARRIVING: "Tài xế đang đến", IN_PROGRESS: "Đang trên hành trình", COMPLETED: "Đã hoàn thành", CANCELLED: "Đã hủy" };
const dateFormatter = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "medium" });
const timestamp = (value: unknown) => { if (!value) return undefined; const date = new Date(String(value)); return Number.isNaN(date.valueOf()) ? undefined : date.toISOString(); };
const dateText = (value: unknown) => { const iso = timestamp(value); return iso ? dateFormatter.format(new Date(iso)) : "—"; };

export function TripDetail({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [notice, setNotice] = useState("");
  const [tripNotice, setTripNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await mutationFetch(`/api/trips/${tripId}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không tải được chuyến đi.");
      setTrip(body.data); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lỗi tải chuyến đi."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tripId]);

  async function submitReview(event: FormEvent<HTMLFormElement>, savedReview?: Row) {
    event.preventDefault(); setBusy(true); setNotice(""); setError("");
    try {
      const response = await mutationFetch(`/api/trips/${tripId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: savedReview ? Number(savedReview.rating) : rating, comment: savedReview ? String(savedReview.comment || "") : comment }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không gửi được đánh giá.");
      setNotice("Cảm ơn bạn đã chia sẻ đánh giá."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lỗi gửi đánh giá."); }
    finally { setBusy(false); }
  }

  async function cancelTrip(changeJourney: boolean) {
    setBusy(true); setError(""); setTripNotice("");
    try {
      const response = await mutationFetch(`/api/trips/${tripId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "CANCELLED",
          note: changeJourney ? "Khách hàng hủy chuyến cũ để đổi hành trình." : "Khách hàng xác nhận hủy chuyến.",
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không thể hủy chuyến.");
      if (changeJourney) {
        router.push("/customer/booking");
        return;
      }
      setCancelOpen(false);
      setTripNotice("Chuyến đã được hủy. Voucher của chuyến cũ chưa có liên kết sẽ cần được đối chiếu riêng.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể hủy chuyến.");
    } finally { setBusy(false); }
  }

  if (loading) return <div className="panel loading-panel"><RideLoader variant="panel" label="Đang theo dõi hành trình" /></div>;
  if (!trip) return <div className="panel empty-state"><h2>Không thể mở chuyến đi</h2><p>{error || "Không tìm thấy dữ liệu."}</p><Link className="text-link" href="/customer/trips"><ArrowLeft size={15} /> Quay lại lịch sử</Link></div>;
  const history = (trip.history as Row[] || []).slice().sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));
  const driver = trip.driver as Row | null;
  const vehicle = trip.vehicle as Row | null;
  const service = trip.service as Row | null;

  return <div className="trip-detail-page"><Link href="/customer/trips" className="back-link"><ArrowLeft size={16} /> Lịch sử chuyến đi</Link><div className="detail-heading"><div><span className="section-kicker">CHI TIẾT HÀNH TRÌNH</span><h1>Chuyến #{tripId.slice(0, 8).toUpperCase()}</h1><p>Đặt lúc <time dateTime={timestamp(trip.booked_at)} title={timestamp(trip.booked_at)}>{dateText(trip.booked_at)}</time></p><p className="trip-booked-timestamp"><span>Đối chiếu CQL · booked_at (UTC):</span><code>{timestamp(trip.booked_at) || "—"}</code></p></div><span className={`status-pill status-${String(trip.status).toLowerCase()}`}><i />{statusLabel[String(trip.status)] || String(trip.status)}</span></div>
    <div className="detail-grid"><section className="panel detail-route-panel"><div className="panel-heading"><div><span className="section-kicker">HÀNH TRÌNH</span><h2>Thông tin chuyến đi</h2></div><span className="detail-fare">{displayMoney(tripFare(trip))}</span></div><div className="detail-route"><div><i className="pickup-dot" /><span><small>ĐIỂM ĐÓN</small><strong>{String(trip.pickup_address || "—")}</strong></span></div><div><i className="drop-dot" /><span><small>ĐIỂM ĐẾN</small><strong>{String(trip.destination_address || "—")}</strong></span></div></div><div className="detail-facts"><span><MapPin size={15} />{Number(trip.distance_km || 0).toFixed(1)} km</span><span><Clock3 size={15} />{paymentMethodLabel(trip.payment_method)}</span><span className="detail-trip-reference">Mã chuyến đi: <code>{tripId}</code></span></div><TripPaymentPanel tripId={tripId} /></section>
      <section className="panel timeline-panel"><div className="panel-heading"><div><span className="section-kicker">TRẠNG THÁI</span><h2>Tiến trình chuyến đi</h2><p className="trip-timezone-note">Giờ Việt Nam (UTC+7) · Hiển thị cả giây</p></div></div>{history.length ? <ol className="timeline">{history.map((entry) => <li key={`${String(entry.status)}-${String(entry.changed_at)}`}><span className="timeline-dot"><CircleDot size={15} /></span><span className="timeline-copy"><strong>{statusLabel[String(entry.status)] || String(entry.status)}</strong><small>{String(entry.note || "")}</small></span><time dateTime={timestamp(entry.changed_at)} title={timestamp(entry.changed_at)}>{dateText(entry.changed_at)}</time></li>)}</ol> : <div className="empty-inline">Chưa có lịch sử trạng thái.</div>}</section>
    </div>
    <section className="panel trip-assignment"><span className="trip-assignment-icon"><CarFront size={23} /></span><div className="trip-assignment-driver"><span className="section-kicker">TÀI XẾ</span><strong>{String(driver?.full_name || "Đang cập nhật")}</strong><small>{String(driver?.phone || "")}</small></div><div><span className="section-kicker">PHƯƠNG TIỆN</span><strong>{[vehicle?.brand, vehicle?.model].filter(Boolean).join(" ") || "Đang cập nhật"}</strong><small>{String(vehicle?.license_plate || "Chưa có biển số")}</small></div><div><span className="section-kicker">DỊCH VỤ</span><strong>{serviceNameLabel(service?.service_name)}</strong><small>{serviceNameLabel(vehicle?.vehicle_type)}</small></div></section>
    {error && <div className="data-error" role="alert">{error}</div>}
    {notice && <div className="inline-success"><Check size={16} />{notice}</div>}
    {tripNotice && <div className="inline-success"><Check size={16} />{tripNotice}</div>}
    {trip.status === "CANCELLED" && <button className="table-action" disabled={busy} onClick={() => void cancelTrip(false)}>Xác nhận hủy chuyến</button>}
    {["BOOKED", "ACCEPTED", "ARRIVING"].includes(String(trip.status)) && <section className="panel trip-cancel-panel">
      {!cancelOpen ? <><div><span className="section-kicker">CẦN THAY ĐỔI?</span><h2>Hành trình có vấn đề</h2><p>Bạn có thể đổi hành trình hoặc hủy chuyến hiện tại.</p></div><button className="button cancel-trip-trigger" onClick={() => setCancelOpen(true)}><XCircle size={16} /> Xử lý chuyến</button></> : <div className="cancel-decision">
        <div><span className="section-kicker">XÁC NHẬN LỰA CHỌN</span><h2>Bạn muốn đổi địa điểm hay hủy chuyến luôn?</h2><p>Đổi hành trình sẽ hủy chuyến cũ, trả tài xế hiện tại và mở màn hình đặt xe để tính lại tuyến đường cùng giá.</p></div>
        <div className="cancel-decision-actions"><button className="button decision-back" disabled={busy} onClick={() => setCancelOpen(false)}>Tiếp tục chuyến</button><button className="button decision-change" disabled={busy} onClick={() => void cancelTrip(true)}>{busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Đổi hành trình</button><button className="button decision-cancel" disabled={busy} onClick={() => void cancelTrip(false)}><XCircle size={15} /> Hủy chuyến luôn</button></div>
      </div>}
    </section>}
    {trip.status === "COMPLETED" && !trip.review && !reviewOpen && <section className="panel review-start"><button className="button button-gold" onClick={() => setReviewOpen(true)}>Đánh giá tài xế</button></section>}
    {trip.status === "COMPLETED" && !trip.review && reviewOpen && <form className="panel review-form" onSubmit={submitReview}><div className="panel-heading"><div><span className="section-kicker">CHIA SẺ TRẢI NGHIỆM</span><h2>Chuyến đi thế nào?</h2></div></div><div className="rating-input" aria-label="Chọn số sao">{[1, 2, 3, 4, 5].map((item) => <button type="button" key={item} aria-label={`${item} sao`} aria-pressed={item === rating} disabled={busy} onClick={() => setRating(item)} className={item <= rating ? "selected" : ""}><Star size={24} fill="currentColor" /></button>)}</div><label className="form-field"><span>Nhận xét</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} rows={3} placeholder="Chia sẻ điều bạn hài lòng..." /></label>{notice && <div className="inline-success"><Check size={16} />{notice}</div>}<button className="button button-gold" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <CircleCheck size={17} />}Gửi đánh giá</button></form>}
    {Boolean(trip.review) && <div className="panel existing-review"><span className="section-kicker">ĐÁNH GIÁ CỦA BẠN</span><div className="rating-value"><Star size={16} fill="currentColor" /> {String((trip.review as Row).rating)}/5</div><p>{String((trip.review as Row).comment || "")}</p>{trip.reviewSynced === false && <form onSubmit={(event) => void submitReview(event, trip.review as Row)}><button className="table-action" disabled={busy}>Thử đồng bộ đánh giá</button></form>}</div>}
  </div>;
}
