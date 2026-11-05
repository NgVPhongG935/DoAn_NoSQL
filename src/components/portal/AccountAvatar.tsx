"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Role } from "@/lib/demo-users";

type Props = { role: Role; userId: string; name: string; className?: string };
const eventName = "rideflow-avatar-updated";
export function AccountAvatar({ role, userId, name, className = "account-avatar" }: Props) {
  const [revision, setRevision] = useState(0);
  // Start with initials during SSR. Request the image after hydration so a fast
  // 404 cannot fire before React attaches the error handler.
  const [failed, setFailed] = useState(true);
  useEffect(() => {
    setFailed(false);
    function update(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail.role === role && detail.userId === userId) { setFailed(false); setRevision(Date.now()); }
    }
    window.addEventListener(eventName, update);
    return () => window.removeEventListener(eventName, update);
  }, [role, userId]);
  const initials = name.trim().split(/\s+/).slice(-2).map((part) => part.charAt(0)).join("").toUpperCase() || "?";
  return <span className={`${className} account-avatar-frame`}>
    {failed ? initials : <img src={`/api/avatars/${role}/${encodeURIComponent(userId)}?v=${revision}`} alt={`Ảnh đại diện ${name}`} onError={() => setFailed(true)} />}
  </span>;
}

export function AvatarEditor({ role, userId, name, showPreview = true }: Props & { showPreview?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  async function change(file?: File) {
    setMessage("");
    if (file && (!file.type.match(/^image\/(png|jpeg|webp)$/) || file.size > 2 * 1024 * 1024)) {
      setMessage("Chọn ảnh PNG, JPG hoặc WebP, tối đa 2 MB."); return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      if (file) form.set("avatar", file);
      const response = await fetch(`/api/avatars/${role}/${encodeURIComponent(userId)}`, { method: file ? "PUT" : "DELETE", ...(file ? { body: form } : {}) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Chưa cập nhật được ảnh đại diện.");
      window.dispatchEvent(new CustomEvent(eventName, { detail: { role, userId } }));
      setMessage(file ? "Đã cập nhật ảnh đại diện." : "Đã dùng lại ảnh mặc định.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi cập nhật ảnh."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  return <div className="avatar-editor">
    {showPreview && <AccountAvatar role={role} userId={userId} name={name} className="large-avatar" />}
    <div className="avatar-editor-controls">
      <input id={inputId} ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Chọn ảnh đại diện" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void change(file); }} hidden />
      <div className="account-actions"><button className="table-action" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Đang lưu ảnh…" : "Đổi ảnh đại diện"}</button><button className="table-action" type="button" disabled={busy} onClick={() => void change()}>Ảnh mặc định</button></div>
      <small>PNG, JPG hoặc WebP · tối đa 2 MB</small>
      {message && <p role="status">{message}</p>}
    </div>
  </div>;
}
