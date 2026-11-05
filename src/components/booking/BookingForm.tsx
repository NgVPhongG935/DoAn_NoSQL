"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bike, CarFront, Check, Clock3, LoaderCircle, Route, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { AddressSearch } from "@/components/booking/AddressSearch";
import { RideLoader } from "@/components/ui/RideLoader";
import type { MapPoint, RouteResult } from "@/lib/map-types";

const RideMap = dynamic(() => import("@/components/booking/RideMap"), {
  ssr: false,
  loading: () => <div className="map-loading"><RideLoader variant="panel" label="Đang mở bản đồ RideFlow" /></div>,
});

import { finiteMoney } from "@/lib/business-values";
import { serviceNameLabel } from "@/lib/display-labels";
import { estimateTravelTime, travelTimeLabel } from "@/lib/travel-time";
import { mutationHeaders, completeMutation } from "@/lib/mutation-request";

type Row = Record<string, unknown>;
type Session = { userId: string; name: string };
const vnd = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const serviceIcon = (name: string) => name.includes("BIKE") ? Bike : name.includes("PREMIUM") ? Sparkles : CarFront;
const serviceLabel = serviceNameLabel;

export function BookingForm() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [services, setServices] = useState<Row[]>([]);
  const [vouchers, setVouchers] = useState<Row[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [pickupText, setPickupText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [pickupPlace, setPickupPlace] = useState<MapPoint | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<MapPoint | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [locating, setLocating] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [voucherCode, setVoucherCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdTrip, setCreatedTrip] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/auth/me"), fetch("/api/services")])
      .then(async ([authResponse, serviceResponse]) => {
        const [authBody, serviceBody] = await Promise.all([authResponse.json(), serviceResponse.json()]);
        if (!authResponse.ok || !authBody.success) throw new Error("Phiên đăng nhập không còn hiệu lực.");
        if (!serviceResponse.ok || !serviceBody.success) throw new Error(serviceBody.message || "Không tải được danh mục dịch vụ.");
        const voucherResponse = await fetch(`/api/customers/${authBody.data.userId}/vouchers`);
        const voucherBody = await voucherResponse.json();
        if (!voucherResponse.ok || !voucherBody.success) throw new Error(voucherBody.message || "Không tải được voucher của bạn.");
        setSession(authBody.data);
        const activeServices = (serviceBody.data as Row[]).filter((item) => item.status === "ACTIVE");
        setServices(activeServices);
        setVouchers((voucherBody.data as Row[]).filter((item) => item.status === "AVAILABLE" && item.voucher));
        setServiceId(String(activeServices[0]?.service_id || ""));
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Không thể kết nối máy chủ."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!pickupPlace || !destinationPlace) {
      setRoute(null);
      setRouteError("");
      return;
    }
    const controller = new AbortController();
    setRoute(null);
    setRouteLoading(true);
    setRouteError("");
    fetch("/api/maps/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickup: pickupPlace, destination: destinationPlace }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message || "Không thể tìm tuyến đường.");
        return body.data as RouteResult;
      })
      .then(setRoute)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setRouteError(caught instanceof Error ? caught.message : "Không thể tìm tuyến đường. Vui lòng kiểm tra lại địa chỉ.");
      })
      .finally(() => { if (!controller.signal.aborted) setRouteLoading(false); });
    return () => controller.abort();
  }, [destinationPlace, pickupPlace]);

  const selectedService = services.find((item) => item.service_id === serviceId);
  const travelTime = route && selectedService ? estimateTravelTime(route.distanceKm, selectedService.service_name) : null;
  const selectedVoucher = vouchers.find((item) => item.voucher_code === voucherCode);
  const voucher = selectedVoucher?.voucher as Row | null | undefined;
  const estimate = useMemo(() => route && selectedService
    ? Math.round(Number(selectedService.base_fare || 0) + route.distanceKm * Number(selectedService.price_per_km || 0))
    : 0, [route, selectedService]);
  const voucherValid = Boolean(route && voucher
    && voucher.status === "ACTIVE"
    && Date.now() >= new Date(String(voucher.start_date)).getTime()
    && Date.now() <= new Date(String(voucher.end_date)).getTime()
    && Number.isSafeInteger(Number(voucher.quantity)) && Number(voucher.quantity) > 0
    && finiteMoney(voucher.discount_value) !== null && Number(voucher.discount_value) > 0
    && finiteMoney(voucher.max_discount) !== null && finiteMoney(voucher.min_trip_amount) !== null
    && ["FIXED", "PERCENT"].includes(String(voucher.discount_type))
    && (voucher.discount_type !== "PERCENT" || Number(voucher.discount_value) <= 100)
    && estimate >= Number(voucher.min_trip_amount));
  const discountAmount = voucherValid && voucher
    ? Math.min(
      estimate,
      String(voucher.discount_type) === "PERCENT"
        ? Math.round(estimate * Number(voucher.discount_value) / 100)
        : Number(voucher.discount_value),
      Number(voucher.max_discount),
    )
    : 0;
  const finalFare = Math.max(0, estimate - discountAmount);
  const ready = Boolean(session && pickupPlace && destinationPlace && route && selectedService && !routeLoading
    && finiteMoney(selectedService.base_fare) !== null && finiteMoney(selectedService.price_per_km) !== null
    && Number(selectedService.price_per_km) > 0 && finiteMoney(estimate) !== null && finiteMoney(finalFare) !== null
    && Number.isFinite(route.distanceKm) && route.distanceKm >= 0.1 && route.distanceKm <= 250);

  function changePickup(value: string) {
    setPickupText(value);
    setPickupPlace(null);
    setRoute(null);
  }

  function changeDestination(value: string) {
    setDestinationText(value);
    setDestinationPlace(null);
    setRoute(null);
  }

  function useCurrentLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Trình duyệt của bạn không hỗ trợ lấy vị trí. Bạn vẫn có thể nhập địa chỉ thủ công.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const response = await fetch(`/api/maps/reverse-geocode?lat=${coords.latitude}&lng=${coords.longitude}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message || "Không xác định được địa chỉ hiện tại.");
        const point = body.data as MapPoint;
        setPickupPlace(point);
        setPickupText(point.label);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Không xác định được địa chỉ hiện tại. Bạn có thể nhập địa chỉ thủ công.");
      } finally {
        setLocating(false);
      }
    }, (geoError) => {
      const message = geoError.code === geoError.PERMISSION_DENIED
        ? "Bạn đã từ chối quyền vị trí. Hãy nhập điểm đón thủ công hoặc cấp lại quyền trong trình duyệt."
        : geoError.code === geoError.TIMEOUT
          ? "Lấy vị trí mất quá nhiều thời gian. Vui lòng thử lại hoặc nhập thủ công."
          : "Không lấy được vị trí hiện tại. Vui lòng nhập điểm đón thủ công.";
      setError(message);
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || createdTrip) return;
    if (!ready || !session || !pickupPlace || !destinationPlace || !selectedService) {
      setError("Hãy chọn điểm đón và điểm đến trong danh sách để RideFlow tính tuyến đường trước khi đặt xe.");
      return;
    }
    setBusy(true); setError(""); setCreatedTrip("");
    try {
      const payload = { serviceId, pickup: pickupPlace, destination: destinationPlace, paymentMethod, voucherCode: voucherCode || undefined };
      const scope = `booking:${session.userId}`;
      const response = await fetch("/api/trips", {
        method: "POST", headers: mutationHeaders(scope, payload), body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không thể tạo chuyến.");
      completeMutation(scope);
      setCreatedTrip(body.data.tripId);
      window.setTimeout(() => router.push(`/customer/trips/${body.data.tripId}`), 800);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể đặt chuyến."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="booking-page"><RideLoader variant="panel" label="Đang tìm dịch vụ và tài xế gần bạn" /></div>;

  return <div className="booking-page">
    <div className="page-heading"><div><span className="section-kicker">HÀNH TRÌNH CỦA BẠN</span><h1>Đặt chuyến xe</h1><p>Chọn điểm đón và điểm đến để xem tuyến đường và giá dự kiến.</p></div><span className="secure-chip"><ShieldCheck size={16} /> Đặt xe an tâm</span></div>
    {(error || createdTrip) && <div className={createdTrip ? "inline-success" : "data-error"} role="status">{createdTrip ? <><Check size={17} />Đã tạo chuyến thành công. <Link href={`/customer/trips/${createdTrip}`}>Xem chi tiết <ArrowRight size={14} /></Link></> : <><TriangleAlert size={17} />{error}</>}</div>}
    <div className="booking-layout"><form className="panel booking-form" onSubmit={submit}>
      <div className="booking-form-heading"><span>01</span><div><span className="section-kicker">HÀNH TRÌNH</span><h2>Bạn muốn đi đâu?</h2></div></div>
      <div className="address-fields">
        <AddressSearch kind="pickup" value={pickupText} selected={Boolean(pickupPlace)} disabled={busy} locating={locating} onCurrentLocation={useCurrentLocation} onTextChange={changePickup} onSelect={(place) => { setPickupPlace(place); setPickupText(place.label); }} />
        <div className="address-line" />
        <AddressSearch kind="destination" value={destinationText} selected={Boolean(destinationPlace)} disabled={busy} onTextChange={changeDestination} onSelect={(place) => { setDestinationPlace(place); setDestinationText(place.label); }} />
      </div>
      <div className={`route-summary ${routeLoading ? "is-loading" : route ? "is-ready" : ""}`}>
        {routeLoading ? <><LoaderCircle className="spin" size={18} /><span><strong>Đang tìm tuyến đường...</strong><small>RideFlow đang tính theo đường đi thực tế</small></span></> : route ? <><Route size={19} /><span><strong>{route.distanceKm.toFixed(1)} km</strong><small>Di chuyển tham khảo: {travelTimeLabel(travelTime)}</small></span><i>ƯỚC TÍNH</i></> : <><Route size={19} /><span><strong>Chưa có tuyến đường</strong><small>Chọn đủ điểm đón và điểm đến</small></span></>}
      </div>
      {route && <p className="route-time-note">{travelTime && selectedService ? `Mức tham khảo cho ${serviceLabel(String(selectedService.service_name)).toLocaleLowerCase("vi")}: ${travelTime.minMinutesPerKm}–${travelTime.maxMinutesPerKm} phút/km. ` : "Chưa có mức tham khảo cho loại xe này. "}Đây là ước tính theo giả định, không có dữ liệu giao thông trực tiếp và chưa gồm thời gian chờ tài xế.</p>}
      {routeError && <div className="route-error"><TriangleAlert size={16} />{routeError}</div>}
      <div className="booking-divider" />
      <div className="booking-form-heading"><span>02</span><div><span className="section-kicker">LOẠI DỊCH VỤ</span><h2>Chọn chuyến phù hợp</h2></div></div>
      {services.length ? <div className="service-choice-list">{services.map((service) => { const Icon = serviceIcon(String(service.service_name)); const active = service.service_id === serviceId; const serviceTime = route ? estimateTravelTime(route.distanceKm, service.service_name) : null; const serviceFare = route ? Math.round(Number(service.base_fare || 0) + route.distanceKm * Number(service.price_per_km || 0)) : Number(service.base_fare); return <button type="button" key={String(service.service_id)} aria-pressed={active} className={`service-choice ${active ? "selected" : ""}`} onClick={() => setServiceId(String(service.service_id))}><span className="service-choice-icon"><Icon size={19} /></span><span className="service-choice-copy"><strong>{serviceLabel(String(service.service_name))}</strong><small>{String(service.description || "Dịch vụ di chuyển")}</small></span><span className="service-choice-price"><strong>{vnd.format(serviceFare)} ₫</strong><small>{route ? `${route.distanceKm.toFixed(1)} km · trọn chuyến` : `Từ ${vnd.format(Number(service.base_fare))} ₫`}</small>{serviceTime && <small className="service-travel-time">{travelTimeLabel(serviceTime)}</small>}</span><i className="choice-radio" /></button>; })}</div> : <div className="empty-inline">Chưa có dịch vụ khả dụng trong Cassandra.</div>}
      <div className="booking-form-heading driver-heading"><span>03</span><div><span className="section-kicker">GHÉP CHUYẾN</span><h2>RideFlow tự tìm tài xế</h2></div></div>
      <div className="auto-driver-card">
        <span className="auto-driver-icon"><CarFront size={21} /></span>
        <div><strong>Tự động phân tài xế đang rảnh</strong><small>Hệ thống chọn tài xế có phương tiện phù hợp và giữ riêng tài xế đó cho chuyến của bạn.</small></div>
        <span className="assignment-safe"><ShieldCheck size={14} /> Không trùng chuyến</span>
      </div>
      <div className="booking-payment-grid"><label className="form-field payment-select"><span>Mã giảm giá của bạn</span><select value={voucherCode} onChange={(event) => setVoucherCode(event.target.value)}><option value="">Không dùng mã giảm giá</option>{vouchers.map((item) => { const detail = item.voucher as Row; return <option key={String(item.voucher_code)} value={String(item.voucher_code)}>{String(item.voucher_code)} · {String(detail.voucher_name)}</option>; })}</select></label>
      {voucherCode && !voucherValid && <p className="voucher-warning">Mã giảm giá chưa đủ điều kiện cho chuyến này.</p>}
      <label className="form-field payment-select"><span>Phương thức thanh toán</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option></select></label></div>
      <p className="payment-instructions">{paymentMethod === "CASH" ? "Thanh toán tiền mặt cho tài xế khi kết thúc chuyến." : "Sau khi chuyến hoàn thành, gửi yêu cầu xác nhận thanh toán."}</p>
      <button className="button button-gold booking-submit" disabled={busy || Boolean(createdTrip) || !ready || Boolean(voucherCode && !voucherValid)}>{busy ? <LoaderCircle className="spin" size={18} /> : <CarFront size={18} />}Tìm tài xế & đặt xe <ArrowRight size={17} /></button>
      <p className="booking-footnote">Kiểm tra hành trình và giá dự kiến trước khi đặt chuyến.</p>
    </form>
    <aside className="booking-aside">
      <div className="map-preview real-map-shell"><RideMap pickup={pickupPlace} destination={destinationPlace} geometry={route?.geometry || []} />{routeLoading && <div className="map-routing-overlay"><LoaderCircle className="spin" size={19} /> Đang tìm tuyến đường...</div>}</div>
      <div className="panel fare-panel"><div className="panel-heading"><div><span className="section-kicker">CHI TIẾT CHUYẾN</span><h2>Ước tính của bạn</h2></div><span className="fare-route-icon"><Route size={18} /></span></div><div className="fare-route"><div><i className="pickup-dot" /><span><small>ĐIỂM ĐÓN</small><strong>{pickupPlace?.label || "Chưa chọn điểm đón"}</strong></span></div><div><i className="drop-dot" /><span><small>ĐIỂM ĐẾN</small><strong>{destinationPlace?.label || "Chưa chọn điểm đến"}</strong></span></div></div><div className="fare-meta"><span><Route size={15} />{route ? `${route.distanceKm.toFixed(1)} km` : "— km"}</span><span><Clock3 size={15} />{route ? `Tham khảo: ${travelTimeLabel(travelTime)}` : "— phút"}</span></div><div className="fare-breakdown"><div><span>Tạm tính</span><strong>{route && selectedService ? `${vnd.format(estimate)} ₫` : "—"}</strong></div><div><span>Giảm giá{voucherCode && voucherValid ? ` · ${voucherCode}` : ""}</span><strong>{discountAmount ? `−${vnd.format(discountAmount)} ₫` : "0 ₫"}</strong></div></div><div className="fare-total"><span>Tổng thanh toán</span><strong>{route && selectedService ? `${vnd.format(finalFare)} ₫` : "—"}</strong></div><p className="fare-disclaimer">Khoảng thời gian được tính theo quãng đường và mức phút/km của loại xe đã chọn. Đây là giả định tham khảo, chưa gồm thời gian chờ tài xế; thực tế phụ thuộc giao thông.</p></div>
      <div className="booking-trust"><span><ShieldCheck size={17} /></span><p><strong>Đồng hành cùng RideFlow</strong><small>Theo dõi tài xế và hành trình sau khi đặt chuyến.</small></p></div>
    </aside></div>
  </div>;
}
