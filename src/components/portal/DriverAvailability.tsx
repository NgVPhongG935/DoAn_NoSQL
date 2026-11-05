"use client";

import { mutationFetch } from "@/lib/mutation-request";

import { useState } from "react";
import { CarFront, CircleAlert, LoaderCircle } from "lucide-react";

export function DriverAvailability({ driverId, initialStatus, onStatusChange }: {
  driverId: string; initialStatus: string; onStatusChange: (status: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const online = initialStatus === "AVAILABLE";
  const onTrip = initialStatus === "BUSY";

  async function toggle() {
    setBusy(true); setError("");
    try {
      const response = await mutationFetch(`/api/drivers/${driverId}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: online ? "OFFLINE" : "AVAILABLE" }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Không đổi được trạng thái.");
      onStatusChange(body.data.status);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lỗi cập nhật."); }
    finally { setBusy(false); }
  }

  const title = onTrip ? "Đang chở khách" : online ? "Sẵn sàng nhận chuyến" : "Đã tắt nhận chuyến";
  const description = onTrip ? "Không nhận thêm đơn mới" : online ? "RideFlow có thể chọn bạn" : "RideFlow sẽ không chọn bạn";

  return <div className="availability-wrap"><button className={`availability-toggle ${onTrip ? "on-trip" : online ? "online" : "offline"}`} onClick={toggle} disabled={busy || onTrip} aria-pressed={online} aria-label={`${title}. ${description}`}><span className="availability-car">{busy ? <LoaderCircle className="spin" size={18} /> : <CarFront size={18} />}</span><span className="availability-copy"><strong>{title}</strong><small>{description}</small></span><span className="availability-switch" aria-hidden="true"><i /></span></button>{error && <span className="availability-error"><CircleAlert size={13} />{error}</span>}</div>;
}
