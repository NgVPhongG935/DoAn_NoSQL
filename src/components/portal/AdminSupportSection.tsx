"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { mutationFetch } from "@/lib/mutation-request";
import { notificationTypeLabel, roleLabel } from "@/lib/display-labels";

type Row = Record<string, unknown>;
type Section = "complaints" | "notifications";
const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
const date = (value: unknown) => {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? "Thời gian không hợp lệ" : parsed.toLocaleString("vi-VN");
};
const labels: Record<string, string> = { OPEN: "Mới tiếp nhận", PROCESSING: "Đang xử lý", RESOLVED: "Đã giải quyết" };
const rowKey = (row: Row) => `${row.customer_id || row.user_id}:${row.created_at}:${row.complaint_id || row.notification_id}`;

async function readResponse(response: Response) {
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.message || "Yêu cầu chưa thành công.");
  return body.data;
}
function arrayData(data: unknown): Row[] {
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("API trả về danh sách không hợp lệ.");
  return data;
}

export function AdminSupportSection({ section }: { section: Section }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [pending, setPending] = useState("");
  const [recipients, setRecipients] = useState<Row[]>([]);
  const [recipientError, setRecipientError] = useState("");
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const listSequence = useRef(0), recipientSequence = useRef(0);
  const complaints = section === "complaints";

  const load = useCallback(async () => {
    const sequence = ++listSequence.current;
    setLoading(true); setListError("");
    try {
      const data = arrayData(await readResponse(await fetch(`/api/admin/${section}`, { cache: "no-store" })));
      if (sequence === listSequence.current) setRows(data);
    } catch (error) {
      if (sequence === listSequence.current) setListError(`Không tải được danh sách ${section === "complaints" ? "khiếu nại" : "thông báo"}: ${error instanceof Error ? error.message : "Lỗi kết nối."}`);
    } finally { if (sequence === listSequence.current) setLoading(false); }
  }, [section]);

  const loadRecipients = useCallback(async () => {
    const sequence = ++recipientSequence.current;
    setRecipientsLoading(true); setRecipientError("");
    try {
      const data = arrayData(await readResponse(await fetch("/api/admin/notifications?recipients=true", { cache: "no-store" })));
      if (sequence === recipientSequence.current) setRecipients(data);
    } catch (error) {
      if (sequence === recipientSequence.current) setRecipientError(`Không tải được người nhận: ${error instanceof Error ? error.message : "Lỗi kết nối."}`);
    } finally { if (sequence === recipientSequence.current) setRecipientsLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    if (section === "notifications") void loadRecipients();
    return () => { listSequence.current++; recipientSequence.current++; };
  }, [section, load, loadRecipients]);

  async function update(row: Row, status?: string) {
    const key = rowKey(row);
    setPending(key); setActionError(""); setNotice("");
    const owner = complaints ? row.customer_id : row.user_id;
    const id = complaints ? row.complaint_id : row.notification_id;
    const url = `/api/admin/${section}/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(row.created_at))}/${encodeURIComponent(String(id))}`;
    try {
      const data = await readResponse(await mutationFetch(url, { method: "PATCH", ...(complaints ? { body: JSON.stringify({ status }) } : {}) }));
      setRows((current) => current.map((item) => rowKey(item) !== key ? item : complaints ? { ...item, status: data.status, resolved_at: data.resolvedAt ?? null } : { ...item, is_read: true }));
      setNotice(complaints ? "Đã cập nhật trạng thái khiếu nại." : "Đã đánh dấu thông báo là đã đọc.");
    } catch (error) {
      setActionError(`${complaints ? "Không cập nhật được khiếu nại" : "Không đánh dấu đã đọc được"}: ${error instanceof Error ? error.message : "Lỗi kết nối."} Danh sách vẫn được giữ nguyên; bạn có thể thử lại thao tác.`);
    } finally { setPending(""); }
  }

  const filtered = rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase("vi-VN").includes(search.trim().toLocaleLowerCase("vi-VN")))
    && (statusFilter === "ALL" || (complaints ? row.status === statusFilter : statusFilter === "READ" ? row.is_read === true : row.is_read !== true)));

  return <div className="section-page admin-support">
    <div className="page-heading"><div><span className="section-kicker">QUẢN TRỊ · RIDEFLOW</span><h1>{complaints ? "Hỗ trợ & khiếu nại" : "Hộp thư thông báo"}</h1><p>{complaints ? "Xem chi tiết và theo dõi quá trình giải quyết khiếu nại." : "Theo dõi thông báo theo người nhận và gửi thông báo mới."}</p></div><button className="table-action" type="button" disabled={loading} onClick={() => void load()}>Tải lại danh sách</button></div>
    {listError && <div className="data-error" role="alert"><span>{listError}{rows.length > 0 && " Đang giữ danh sách đã tải trước đó."}</span><button type="button" onClick={() => void load()}>Thử tải lại</button></div>}
    {actionError && <div className="data-error" role="alert">{actionError}</div>}
    {notice && <div className="inline-success" role="status">{notice}</div>}
    <section className="panel support-list-panel">
      <div className="panel-heading"><div><span className="section-kicker">{complaints ? "KHIẾU NẠI" : "THÔNG BÁO"}</span><h2>{filtered.length} / {rows.length} bản ghi đã tải{loading && " · đang tải…"}</h2></div><div className="support-filters"><label className="table-search"><Search size={16} /><input aria-label="Tìm trong danh sách" placeholder="Tìm trong dữ liệu đã tải" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Lọc trạng thái" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Tất cả trạng thái</option>{complaints ? Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>) : <><option value="UNREAD">Chưa đọc</option><option value="READ">Đã đọc</option></>}</select></div></div>
      {loading && rows.length === 0 ? <div className="loading-panel"><LoaderCircle size={22} className="spin" />Đang tải dữ liệu…</div>
        : rows.length === 0 ? <div className="empty-state"><h2>{listError ? "Chưa tải được dữ liệu" : complaints ? "Chưa có khiếu nại" : "Chưa có thông báo"}</h2><p>{listError ? "Bấm Thử tải lại để kiểm tra kết nối." : complaints ? "Hệ thống hiện chưa ghi nhận khiếu nại nào." : "Danh sách sẽ xuất hiện khi có thông báo được gửi."}</p></div>
          : filtered.length === 0 ? <div className="empty-inline">Không có bản ghi phù hợp với tìm kiếm hoặc bộ lọc.</div>
            : complaints ? <div className="complaint-grid">{filtered.map((row) => <article className="panel complaint-card" key={rowKey(row)}>
              <div className="complaint-card-head"><div><span className="section-kicker">{text(row.user_name)}</span><h3>{text(row.subject)}</h3></div><span className={`status-pill status-${String(row.status).toLowerCase()}`}>{labels[String(row.status)] || text(row.status)}</span></div>
              <dl className="support-facts"><dt>Mã khiếu nại</dt><dd>{text(row.complaint_id)}</dd><dt>Khách hàng</dt><dd>{text(row.customer_id)}</dd><dt>Chuyến liên quan</dt><dd>{text(row.trip_id)}</dd><dt>Thời điểm gửi</dt><dd>{date(row.created_at)}</dd></dl>
              <details className="support-details"><summary>Xem chi tiết</summary><h4>Nội dung khiếu nại</h4><p>{text(row.content)}</p><p><strong>Thời điểm giải quyết: </strong>{date(row.resolved_at)}</p></details>
              <div className="complaint-card-foot account-actions">{row.status === "OPEN" && <button className="table-action" disabled={!!pending} onClick={() => void update(row, "PROCESSING")}>Bắt đầu xử lý</button>}{(row.status === "OPEN" || row.status === "PROCESSING") && <button className="table-action" disabled={!!pending} onClick={() => { if (window.confirm("Xác nhận khiếu nại đã được giải quyết?")) void update(row, "RESOLVED"); }}>Đánh dấu đã giải quyết</button>}{row.status === "RESOLVED" && <span className="muted-cell">Đã hoàn tất xử lý</span>}{pending === rowKey(row) && <span role="status">Đang cập nhật…</span>}</div>
            </article>)}</div>
              : <div className="table-scroll"><table className="data-table support-notifications"><thead><tr><th>NGƯỜI NHẬN</th><th>THÔNG BÁO</th><th>THỜI GIAN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{filtered.map((row) => <tr key={rowKey(row)}><td><strong>{text(row.user_name)}</strong><small className="cell-subline">{roleLabel(row.user_role)}</small><code>{text(row.user_id)}</code></td><td><strong>{text(row.title)}</strong><p>{text(row.content)}</p><small>{notificationTypeLabel(row.notification_type)}</small><code>{text(row.notification_id)}</code></td><td>{date(row.created_at)}</td><td>{row.is_read === true ? "Đã đọc" : "Chưa đọc"}</td><td>{row.is_read === true ? <span className="muted-cell">Đã đọc</span> : <button className="table-action" disabled={!!pending} onClick={() => void update(row)}>{pending === rowKey(row) ? "Đang cập nhật…" : "Đánh dấu đã đọc"}</button>}</td></tr>)}</tbody></table></div>}
    </section>
    {!complaints && <section className="panel form-panel support-compose">
      <div className="panel-heading"><div><span className="section-kicker">THÔNG BÁO MỚI</span><h2>Gửi thông báo</h2></div></div>
      {recipientError && <div className="data-error" role="alert"><span>{recipientError} Danh sách thông báo không bị ảnh hưởng.</span><button type="button" onClick={() => void loadRecipients()}>Thử tải người nhận</button></div>}
      {recipientsLoading ? <p role="status">Đang tải người nhận…</p> : recipients.length === 0 ? <p>{recipientError ? "Chưa thể gửi khi chưa tải được người nhận." : "Chưa có khách hàng hoặc tài xế để nhận thông báo."}</p> : <NotificationForm recipients={recipients} onCreated={load} />}
    </section>}
  </div>;
}

function NotificationForm({ recipients, onCreated }: { recipients: Row[]; onCreated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget, form = new FormData(element);
    setBusy(true); setMessage(""); setError("");
    try {
      await readResponse(await mutationFetch("/api/admin/notifications", { method: "POST", body: JSON.stringify({ userId: form.get("userId"), title: form.get("title"), content: form.get("content"), notificationType: "SYSTEM" }) }));
      element.reset(); setMessage("Đã gửi thông báo đến người nhận."); await onCreated();
    } catch (error) { setError(`Không gửi được thông báo: ${error instanceof Error ? error.message : "Lỗi kết nối."}`); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}><div className="form-grid"><label className="form-field"><span>Người nhận</span><select name="userId" required>{recipients.map((row) => <option key={`${row.user_role}:${row.user_id}`} value={String(row.user_id)}>{text(row.user_name)} · {roleLabel(row.user_role)}</option>)}</select></label><label className="form-field"><span>Tiêu đề</span><input name="title" required minLength={2} maxLength={100} /></label><label className="form-field form-field-wide"><span>Nội dung</span><textarea name="content" rows={3} required minLength={5} maxLength={1000} /></label></div>{message && <p className="inline-success" role="status">{message}</p>}{error && <p className="data-error" role="alert">{error}</p>}<button className="button button-gold" disabled={busy}>Gửi thông báo <ArrowRight size={15} /></button></form>;
}
