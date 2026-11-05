"use client";

import { useEffect, useState } from "react";

export function ConnectionIndicator() {
  const [state, setState] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then((response) => setState(response.ok ? "online" : "offline"))
      .catch(() => { if (!controller.signal.aborted) setState("offline"); });
    return () => controller.abort();
  }, []);

  const label = state === "online" ? "Đã kết nối" : state === "offline" ? "Mất kết nối" : "Đang kiểm tra";
  return <span className={`connection-chip connection-${state}`}><i />{label}</span>;
}
