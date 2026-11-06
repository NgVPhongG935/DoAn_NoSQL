"use client";

import { useRef, useState } from "react";
import { CheckCircle2, DatabaseBackup, Download, FileCheck2, FileJson, FileText, LoaderCircle, RotateCcw, Upload, XCircle } from "lucide-react";
import "@/app/admin-backup.css";

type Preview = { hash: string; keyspace: string; tableCount: number; totalRows: number; ignoredStatements: number; tables: { name: string; rows: number; currentRows: number }[] };
const maxBytes = 20 * 1024 * 1024;
export function AdminBackup() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmed, setConfirmed] = useState(false);
  const [safetyBackup, setSafetyBackup] = useState("");
  const fileContent = useRef("");
  const requestKey = useRef("");
  const format = selected?.name.toLowerCase().endsWith(".json") ? "json" : "cql";
  async function download(kind: "json" | "cql") {
    setBusy(kind); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/backup?format=${kind}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.message || "Không tạo được bản sao lưu."); }
      const blob = await response.blob();
      const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || `RideFlow_backup.${kind}`;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(`Đã tạo và tải bản sao lưu ${kind.toUpperCase()}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không tải được file sao lưu."); }
    finally { setBusy(""); }
  }
  function selectFile(file: File | null) {
    setSelected(null); setPreview(null); setConfirmed(false); setError(""); setNotice(""); fileContent.current = ""; requestKey.current = "";
    if (!file) return;
    if (!/\.(json|cql)$/i.test(file.name)) { setError("Vui lòng chọn file .json hoặc .cql."); return; }
    if (!file.size || file.size > maxBytes) { setError("File phải có dữ liệu và không lớn hơn 20 MB."); return; }
    setSelected(file);
  }
  async function inspect() {
    if (!selected) return;
    setBusy("preview"); setError(""); setPreview(null); setConfirmed(false); setNotice("");
    try {
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer()); }
      catch { throw new Error("File phải sử dụng mã hóa UTF-8."); }
      const response = await fetch(`/api/admin/backup?action=preview&format=${format}`, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "File backup chưa hợp lệ.");
      fileContent.current = text; requestKey.current = crypto.randomUUID(); setPreview(body.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không kiểm tra được file."); }
    finally { setBusy(""); }
  }
  async function restore() {
    if (!preview || !confirmed || !fileContent.current) return;
    setBusy("restore"); setError(""); setNotice(""); setSafetyBackup("");
    try {
      const response = await fetch(`/api/admin/backup?action=restore&format=${format}&mode=${mode}`, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", "X-Restore-Confirm": "RESTORE", "X-Backup-Hash": preview.hash, "Idempotency-Key": requestKey.current }, body: fileContent.current });
      const body = await response.json();
      if (body.safetyBackup || body.data?.safetyBackup) setSafetyBackup(body.safetyBackup || body.data.safetyBackup);
      if (!response.ok || !body.success) throw new Error(body.message || "Khôi phục chưa thành công.");
      setNotice(`Đã khôi phục và kiểm tra ${body.data.totalRows.toLocaleString("vi-VN")} bản ghi trong ${body.data.tableCount} bảng.`);
      setPreview(null); setConfirmed(false); fileContent.current = "";
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể xác nhận kết quả khôi phục. Giữ nguyên file và thử lại."); }
    finally { setBusy(""); }
  }
  return <div className="section-page admin-backup-page">
    <div className="page-heading"><div><span className="section-kicker">RIDEFLOW · QUẢN TRỊ DỮ LIỆU</span><h1>Sao lưu & khôi phục</h1><p>Tải bản sao dữ liệu Cassandra hoặc khôi phục từ file JSON, CQL.</p></div><span className="backup-heading-icon"><DatabaseBackup size={27} /></span></div>
    {error && <div className="data-error" role="alert"><XCircle size={19} /><span>{error}</span></div>}
    {notice && <div className="inline-success" role="status"><CheckCircle2 size={19} />{notice}</div>}
    {safetyBackup && <div className="backup-safety"><CheckCircle2 size={18} /><div><strong>Đã giữ bản sao dữ liệu trước khôi phục</strong><a href={`/api/admin/backup?safety=${encodeURIComponent(safetyBackup)}`} download>Tải bản sao trước khôi phục <Download size={14} /></a></div></div>}
    <div className="backup-grid">
      <section className="panel backup-card"><div className="backup-card-heading"><span><Download size={21} /></span><div><span className="section-kicker">SAO LƯU</span><h2>Tải dữ liệu hiện tại</h2></div></div><p>Sao lưu đầy đủ 19 bảng, gồm tài khoản, chuyến đi, thanh toán và thông báo. Không bao gồm ảnh đại diện hoặc cấu hình máy chủ.</p>
        <div className="backup-format"><FileJson size={24} /><div><strong>Backup JSON</strong><small>Dữ liệu và thông tin cột, dùng để kiểm tra và khôi phục trên web.</small></div><button type="button" className="button" disabled={!!busy} onClick={() => void download("json")}>{busy === "json" ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}Tải JSON</button></div>
        <div className="backup-format"><FileText size={24} /><div><strong>Backup CQL</strong><small>Cấu trúc bảng và câu lệnh INSERT, dùng được trong CQL Editor.</small></div><button type="button" className="button" disabled={!!busy} onClick={() => void download("cql")}>{busy === "cql" ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}Tải CQL</button></div>
        <p className="backup-note">File sao lưu chứa dữ liệu tài khoản và mật khẩu dạng băm. Hãy giữ file ở nơi riêng tư.</p>
      </section>
      <section className="panel backup-card"><div className="backup-card-heading"><span><RotateCcw size={21} /></span><div><span className="section-kicker">KHÔI PHỤC</span><h2>Chọn bản sao lưu</h2></div></div><p>Kiểm tra file trước, xem số bảng và bản ghi rồi xác nhận khôi phục. Hệ thống tự lưu bản sao hiện tại trước khi ghi dữ liệu.</p>
        <label className="backup-upload"><Upload size={27} /><strong>{selected ? selected.name : "Chọn file JSON hoặc CQL"}</strong><small>{selected ? `${(selected.size / 1024).toFixed(1)} KB · Bấm để đổi file` : "File UTF-8, tối đa 20 MB"}</small><input type="file" accept=".json,.cql,application/json,text/plain" disabled={!!busy} onChange={event => selectFile(event.target.files?.[0] || null)} /></label>
        <button type="button" className="button backup-inspect" disabled={!!busy || !selected} onClick={() => void inspect()}>{busy === "preview" ? <LoaderCircle className="spin" size={17} /> : <FileCheck2 size={17} />}Kiểm tra file</button>
        <p className="backup-note">Trên web, file CQL nhập dữ liệu vào cấu trúc bảng hiện có. Các lệnh tạo bảng và truy vấn SELECT được bỏ qua.</p>
      </section>
    </div>
    {preview && <section className="panel backup-preview"><div className="panel-heading"><div><span className="section-kicker">FILE ĐÃ KIỂM TRA</span><h2>{preview.tableCount} bảng · {preview.totalRows.toLocaleString("vi-VN")} bản ghi</h2><p>Keyspace: {preview.keyspace}</p></div><FileCheck2 size={26} /></div><div className="table-scroll"><table className="data-table"><thead><tr><th>BẢNG</th><th>BẢN GHI TRONG FILE</th><th>BẢN GHI HIỆN TẠI</th></tr></thead><tbody>{preview.tables.map(table => <tr key={table.name}><td>{table.name}</td><td>{table.rows.toLocaleString("vi-VN")}</td><td>{table.currentRows.toLocaleString("vi-VN")}</td></tr>)}</tbody></table></div>
      <div className="backup-confirm"><label className="form-field"><span>Cách khôi phục</span><select value={mode} disabled={!!busy} onChange={event => { setMode(event.target.value as "merge" | "replace"); setConfirmed(false); requestKey.current = crypto.randomUUID(); }}><option value="merge">Thêm / cập nhật bản ghi, giữ dữ liệu khác</option><option value="replace">Thay thế toàn bộ dữ liệu các bảng trong file</option></select></label><p>{mode === "replace" ? "Các bảng trong file sẽ được làm trống rồi nạp lại. Bản ghi mới hơn backup trong các bảng này sẽ bị thay thế." : "Bản ghi trùng khóa sẽ được cập nhật theo file backup. Các bản ghi khác được giữ nguyên."}</p><label className="backup-ack"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} /><span>Tôi đã kiểm tra file và đồng ý khôi phục theo cách đã chọn.</span></label><button type="button" className="button button-gold" disabled={!!busy || !confirmed} onClick={() => void restore()}>{busy === "restore" ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}{busy === "restore" ? "Đang sao lưu và khôi phục…" : "Xác nhận khôi phục"}</button></div>
    </section>}
  </div>;
}
