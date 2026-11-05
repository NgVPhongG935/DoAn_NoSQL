"use client";

import Link from "next/link";
import { Bell, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/demo-users";
import "@/app/trip-notifications.css";

type Notification = { notification_id: string; created_at: string; title?: string; content?: string; notification_type?: string; is_read?: boolean };
const assignedTripLink = (row: Notification) => `/driver/trips?tripId=${row.content?.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0] || ""}`;
export function NotificationBell({ role, userId }: { role: Role; userId: string }) {
  const [unreadCount, setUnreadCount] = useState(0), [syncError, setSyncError] = useState(false);
  const [arrival, setArrival] = useState<Notification | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (role === "ADMIN") return;
    const controller = new AbortController();
    let stopped = false, inFlight = false;
    seen.current.clear();
    async function refresh() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/users/${userId}/notifications`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.success || !Array.isArray(body.data)) throw new Error("Không tải được thông báo.");
        if (stopped) return;
        const rows = body.data as Notification[];
        setUnreadCount(rows.filter((row) => row.is_read !== true).length); setSyncError(false);
        window.dispatchEvent(new CustomEvent("rideflow:notifications-loaded", { detail: { userId, rows } }));
        if (role === "DRIVER") {
          const recent = rows.filter((row) => row.notification_type === "TRIP_ASSIGNED" && row.is_read !== true)
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
          for (const row of recent) {
            const key = `${row.created_at}:${row.notification_id}`, storageKey = `rideflow.driver-alert.${userId}.${key}`;
            let alreadySeen = seen.current.has(key);
            try { alreadySeen ||= sessionStorage.getItem(storageKey) === "1"; } catch { /* Memory fallback. */ }
            if (alreadySeen) continue;
            const tripId = row.content?.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0];
            if (!tripId) continue;
            const tripResponse = await fetch(`/api/trips/${tripId}`, { cache: "no-store", signal: controller.signal });
            if (stopped) return;
            if (!tripResponse.ok && ![403,404].includes(tripResponse.status)) continue;
            const tripBody = await tripResponse.json();
            seen.current.add(key);
            try { sessionStorage.setItem(storageKey, "1"); } catch { /* Memory fallback. */ }
            if (!tripBody.success || tripBody.data.driver_id !== userId || tripBody.data.status !== "BOOKED") continue;
            setArrival(row); break;
          }
        }
      } catch {
        if (!stopped) setSyncError(true); // Keep the last successful count and inbox.
      } finally { inFlight = false; }
    }
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.userId || detail.userId === userId) void refresh();
    };
    const onFocus = () => void refresh();
    void refresh();
    const timer = window.setInterval(onFocus, 10_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("rideflow:notifications-read", onChanged);
    return () => {
      stopped = true; controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("rideflow:notifications-read", onChanged);
    };
  }, [role, userId]);
  return <>
    <Link className="topbar-icon notification-bell" title={syncError ? "Chưa cập nhật được thông báo. Sẽ tự thử lại." : "Thông báo gần đây"} aria-label={unreadCount ? `Thông báo gần đây, ${unreadCount} chưa đọc` : "Thông báo"} href={`/${role.toLowerCase()}/notifications`}><Bell size={18} />{unreadCount > 0 && <i>{unreadCount > 9 ? "9+" : unreadCount}</i>}{syncError && <span className="notification-sync-error" aria-label="Chưa cập nhật được thông báo" />}</Link>
    {role === "DRIVER" && arrival && <aside className="driver-trip-alert" role="status" aria-live="polite"><button className="driver-alert-close" aria-label="Ẩn thông báo chuyến mới" onClick={() => setArrival(null)}><X size={17} /></button><strong>{arrival.title}</strong><p>{arrival.content}</p><Link href={assignedTripLink(arrival)} onClick={() => setArrival(null)}>Mở chuyến để nhận →</Link><Link href="/driver/notifications" onClick={() => setArrival(null)}>Xem thông báo</Link></aside>}
  </>;
}
