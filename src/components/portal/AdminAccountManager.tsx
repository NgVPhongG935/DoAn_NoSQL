"use client";

import { type FormEvent, useState } from "react";
import { ArrowRight, CarFront, Check, Clock3, Eye, LoaderCircle, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Trash2, UnlockKeyhole, Users, X } from "lucide-react";
import { AccountAvatar, AvatarEditor } from "@/components/portal/AccountAvatar";
import { CustomerPasswordResetButton } from "@/components/portal/CustomerPasswordResetButton";
import { statusLabel, vehicleTypeLabel } from "@/lib/display-labels";

type Row = Record<string, unknown>;
type Resource = "customers" | "drivers";
type Fields = { fullName: string; phone: string; email: string; licenseNumber: string; password: string; confirmPassword: string };
const blank: Fields = { fullName: "", phone: "", email: "", licenseNumber: "", password: "", confirmPassword: "" };
function fieldsFor(row: Row): Fields {
  return { ...blank, fullName: String(row.full_name || ""), phone: String(row.phone || ""), email: String(row.email || ""), licenseNumber: String(row.license_number || "") };
}

export function AdminAccountManager({ resource, rows, loading, error, reload }: {
  resource: Resource; rows: Row[]; loading: boolean; error: string; reload: () => Promise<void>;
}) {
  const isDriver = resource === "drivers", role = isDriver ? "DRIVER" : "CUSTOMER";
  const label = isDriver ? "tài xế" : "khách hàng", idKey = isDriver ? "driver_id" : "customer_id";
  const [editing, setEditing] = useState<Row | null | undefined>();
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const [fields, setFields] = useState<Fields>(blank);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [availabilityFilter, setAvailabilityFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const visible = rows.filter((row) => (!isDriver || statusFilter === "ALL" || row.account_status === statusFilter)
    && (!isDriver || availabilityFilter === "ALL" || row.driver_status === availabilityFilter)
    && [row.full_name, row.phone, row.email, row.license_number, row.license_plate, row.vehicle_brand, row.vehicle_model].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));

  function edit(row: Row | null) { setEditing(row); setFields(row ? fieldsFor(row) : { ...blank }); setProblem(""); setNotice(""); }
  async function send(url: string, method: string, data?: unknown) {
    // Creation passwords must never enter mutationFetch's sessionStorage retry cache.
    const response = await fetch(url, { method, ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
    const body = await response.json();
    if (!response.ok || !body.success) {
      const details = body.details?.map((item: { message: string }) => item.message).join(" ");
      throw new Error(details || body.message || "Thao tác chưa thành công.");
    }
    return body.data;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProblem(""); setNotice("");
    if (!editing && fields.password !== fields.confirmPassword) { setProblem("Mật khẩu nhập lại chưa khớp."); return; }
    setBusy(true);
    try {
      const payload = { fullName: fields.fullName, phone: fields.phone, email: fields.email,
        ...(isDriver ? { licenseNumber: fields.licenseNumber } : {}), ...(!editing ? { password: fields.password } : {}) };
      const saved = await send(`/api/admin/${resource}${editing ? `/${editing[idKey]}` : ""}`, editing ? "PATCH" : "POST", payload);
      setNotice(editing ? "Đã lưu thông tin tài khoản." : `Đã thêm ${label}. Bạn có thể chọn ảnh đại diện bên dưới.`);
      setEditing(saved); setFields(fieldsFor(saved));
      await reload();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Chưa lưu được tài khoản."); }
    finally { setBusy(false); }
  }
  async function rowAction(row: Row, remove: boolean) {
    const status = String(isDriver ? row.account_status : row.status), block = status === "ACTIVE";
    const question = remove ? `Xóa tài khoản ${row.full_name}? Chỉ tài khoản chưa có dữ liệu liên quan mới được xóa. Thao tác không thể hoàn tác.`
      : `${block ? "Khóa" : "Mở khóa"} tài khoản ${row.full_name}?`;
    if (!window.confirm(question)) return;
    setBusy(true); setProblem(""); setNotice("");
    try {
      await send(`/api/admin/${resource}/${row[idKey]}`, remove ? "DELETE" : "PATCH",
        remove ? undefined : isDriver ? { accountStatus: block ? "BLOCKED" : "ACTIVE" } : { status: block ? "BLOCKED" : "ACTIVE" });
      setNotice(remove ? "Đã xóa tài khoản chưa có dữ liệu liên quan." : `Đã ${block ? "khóa" : "mở khóa"} tài khoản.`);
      if (editing?.[idKey] === row[idKey]) { setEditing(undefined); setFields({ ...blank }); }
      await reload();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Thao tác chưa thành công."); }
    finally { setBusy(false); }
  }
  async function reviewDriver(row: Row, approve: boolean) {
    const status = approve ? "ACTIVE" : "REJECTED";
    const question = approve
      ? `Duyệt hồ sơ tài xế ${row.full_name}?`
      : `Từ chối hồ sơ tài xế ${row.full_name}?`;
    if (!window.confirm(question)) return;
    setBusy(true); setProblem(""); setNotice("");
    try {
      await send(`/api/admin/drivers/${row[idKey]}`, "PATCH", { accountStatus: status });
      setNotice(approve ? "Đã duyệt hồ sơ tài xế." : "Đã từ chối hồ sơ tài xế.");
      await reload();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Chưa cập nhật được hồ sơ."); }
    finally { setBusy(false); }
  }
  function input(name: keyof Fields, value: string) { setFields((current) => ({ ...current, [name]: value })); }
  function passwordWasReset(row: Row) {
    setNotice(`Đã đặt lại mật khẩu cho ${row.full_name}. Khách có thể đăng nhập bằng mật khẩu mới.`);
  }
  return <div className={`section-page account-management ${isDriver ? "driver-account-management" : "customer-account-management"}`}>
    <div className="page-heading"><div><span className="section-kicker">QUẢN TRỊ · RIDEFLOW</span><h1>{isDriver ? "Đội ngũ tài xế" : "Danh sách khách hàng"}</h1><p>Thêm tài khoản, chỉnh sửa thông tin và quản lý trạng thái.</p></div><button type="button" className="button button-gold" disabled={busy || loading} onClick={() => edit(null)}><Plus size={16} />Thêm {label}</button></div>
    {isDriver && <div className="admin-overview" aria-label="Tổng quan đội ngũ tài xế">
      <div className="admin-overview-card"><span><Users size={17} />Tổng tài xế</span><strong>{rows.length}</strong><small>Tài khoản trong hệ thống</small></div>
      <div className="admin-overview-card overview-success"><span><ShieldCheck size={17} />Đã duyệt</span><strong>{rows.filter((row) => row.account_status === "ACTIVE").length}</strong><small>Hồ sơ được chấp thuận</small></div>
      <div className="admin-overview-card overview-waiting"><span><CarFront size={17} />Sẵn sàng nhận chuyến</span><strong>{rows.filter((row) => row.account_status === "ACTIVE" && row.driver_status === "AVAILABLE").length}</strong><small>Tài xế đã duyệt và đang sẵn sàng</small></div>
      <div className="admin-overview-card"><span><Clock3 size={17} />Chờ xét duyệt</span><strong>{rows.filter((row) => row.account_status === "PENDING").length}</strong><small>Hồ sơ cần kiểm tra</small></div>
    </div>}
    {notice && <div className="inline-success" role="status">{notice}</div>}
    {(problem || error) && <div className="data-error" role="alert"><span>{problem || error}</span>{error && <button type="button" onClick={() => void reload()}>Thử tải lại</button>}</div>}
    {editing !== undefined && <form className="panel form-panel account-form" onSubmit={save}>
      <div className="panel-heading"><div><span className="section-kicker">THÔNG TIN TÀI KHOẢN</span><h2>{editing ? `Chỉnh sửa ${label}` : `Thêm ${label}`}</h2></div><button type="button" className="icon-button" aria-label="Đóng form tài khoản" disabled={busy} onClick={() => { setEditing(undefined); setFields({ ...blank }); }}><X size={18} /></button></div>
      {editing && <AvatarEditor role={role} userId={String(editing[idKey])} name={String(editing.full_name || "")} />}
      <fieldset disabled={busy} className="account-fieldset"><div className="form-grid">
        <label className="form-field"><span>Họ và tên</span><input name="fullName" value={fields.fullName} onChange={(e) => input("fullName", e.target.value)} required minLength={2} maxLength={100} autoComplete="name" /></label>
        <label className="form-field"><span>Số điện thoại</span><input name="phone" value={fields.phone} onChange={(e) => input("phone", e.target.value)} required type="tel" pattern="0[0-9]{9}" maxLength={10} title="10 chữ số, bắt đầu bằng 0" autoComplete="tel" /></label>
        <label className="form-field"><span>Email đăng nhập</span><input name="email" type="email" value={fields.email} onChange={(e) => input("email", e.target.value)} required maxLength={254} autoComplete="off" /></label>
        {isDriver && <label className="form-field"><span>Giấy phép lái xe</span><input name="licenseNumber" value={fields.licenseNumber} onChange={(e) => input("licenseNumber", e.target.value)} required minLength={3} maxLength={50} /></label>}
        {!editing && <>
          <label className="form-field"><span>Mật khẩu ban đầu</span><input name="password" type="password" value={fields.password} onChange={(e) => input("password", e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /><small>Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</small></label>
          <label className="form-field"><span>Nhập lại mật khẩu</span><input name="confirmPassword" type="password" value={fields.confirmPassword} onChange={(e) => input("confirmPassword", e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></label>
        </>}
      </div></fieldset>
      {editing && <p className="account-hint">Đổi email đăng nhập sẽ yêu cầu người dùng đăng nhập lại. Mật khẩu hiện tại được giữ nguyên.</p>}
      <button className="button button-gold" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{editing ? "Lưu thông tin" : `Tạo tài khoản ${label}`}</button>
    </form>}
    <section className="panel data-panel"><div className="panel-heading"><div><span className="section-kicker">{isDriver ? "DANH SÁCH TÀI XẾ" : "KHÁCH HÀNG"}</span><h2>{loading ? "Đang tải…" : `${visible.length} / ${rows.length} tài khoản`}</h2></div><label className="table-search"><Search size={16} /><input aria-label="Tìm tài khoản" placeholder={isDriver ? "Tên, số điện thoại, biển số…" : "Tên, email, số điện thoại"} value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
      {isDriver && <div className="admin-list-toolbar"><div className="admin-filter-tabs" role="group" aria-label="Lọc hồ sơ tài xế">{[{ id: "ALL", label: "Tất cả" }, { id: "PENDING", label: "Chờ duyệt" }, { id: "ACTIVE", label: "Đã duyệt" }, { id: "BLOCKED", label: "Đã khóa" }, { id: "REJECTED", label: "Từ chối" }].map((tab) => <button type="button" key={tab.id} aria-pressed={statusFilter === tab.id} className={statusFilter === tab.id ? "active" : ""} onClick={() => setStatusFilter(tab.id)}>{tab.label}</button>)}</div><div className="admin-select-filters"><select aria-label="Lọc trạng thái nhận chuyến" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option value="ALL">Mọi trạng thái hoạt động</option><option value="AVAILABLE">Sẵn sàng</option><option value="BUSY">Đang có chuyến</option><option value="OFFLINE">Ngoại tuyến</option></select></div></div>}
      <div className="table-scroll"><table className={`data-table ${isDriver ? "driver-management-table" : ""}`}><thead><tr><th>{isDriver ? "TÀI XẾ / LIÊN HỆ" : "TÀI KHOẢN"}</th>{!isDriver && <th>LIÊN HỆ</th>}{isDriver && <><th>PHƯƠNG TIỆN</th><th>GIẤY PHÉP</th><th>HOẠT ĐỘNG</th></>}<th>{isDriver ? "HỒ SƠ" : "TRẠNG THÁI"}</th><th>THAO TÁC</th></tr></thead><tbody>{visible.map((row) => {
        const active = (isDriver ? row.account_status : row.status) === "ACTIVE";
        const availability: Record<string, string> = { AVAILABLE: "Sẵn sàng", OFFLINE: "Ngoại tuyến", BUSY: "Đang có chuyến" };
        const accountStatus = String(row.account_status || row.status || "");
        const statusLabel: Record<string, string> = { ACTIVE: "Đã duyệt", PENDING: "Chờ duyệt", REJECTED: "Đã từ chối", BLOCKED: "Đã khóa" };
        return <tr key={String(row[idKey])}><td><div className="account-person"><AccountAvatar role={role} userId={String(row[idKey])} name={String(row.full_name || "")} /><span><strong>{String(row.full_name || "Chưa có tên")}</strong>{isDriver ? <><small>{String(row.phone || "Chưa có số điện thoại")}</small><small className="driver-email" title={String(row.email || "")}>{String(row.email || "—")}</small></> : <small>#{String(row[idKey]).slice(0, 8).toUpperCase()}</small>}</span></div></td>{!isDriver && <td>{String(row.email || "—")}<small className="cell-subline">{String(row.phone || "—")}</small></td>}{isDriver && <><td>{row.license_plate ? <div className="driver-vehicle-cell"><strong>{String(row.license_plate)}</strong><span>{[row.vehicle_brand, row.vehicle_model].filter(Boolean).join(" ") || "Chưa có dòng xe"}</span><small>{[row.vehicle_color, row.vehicle_seat_count ? `${row.vehicle_seat_count} chỗ` : null].filter(Boolean).join(" · ") || vehicleTypeLabel(row.vehicle_type)}</small></div> : <span className="muted-cell">Chưa khai báo xe</span>}</td><td><span className="driver-license">{String(row.license_number || "—")}</span></td><td><span className={`status-pill status-${String(row.driver_status || "offline").toLowerCase()}`}><i />{availability[String(row.driver_status)] || String(row.driver_status || "—")}</span></td></>}<td><span className={`status-pill status-${accountStatus.toLowerCase()}`}><i />{isDriver ? statusLabel[accountStatus] || accountStatus : active ? "Hoạt động" : "Đã khóa"}</span></td><td><div className="account-actions">{isDriver && <button type="button" className="table-action driver-profile-action" disabled={busy || loading} onClick={() => setReviewing(row)}><Eye size={14} />Hồ sơ</button>}{isDriver && accountStatus === "PENDING" ? <><button type="button" className="table-action driver-icon-action" title="Duyệt hồ sơ" aria-label={`Duyệt ${row.full_name}`} disabled={busy || loading} onClick={() => void reviewDriver(row, true)}><Check size={15} /></button><button type="button" className="table-action driver-icon-action" title="Từ chối hồ sơ" aria-label={`Từ chối ${row.full_name}`} disabled={busy || loading} onClick={() => void reviewDriver(row, false)}><X size={15} /></button></> : <button type="button" className={`table-action ${isDriver ? "driver-icon-action" : ""}`} title={active ? "Khóa tài khoản" : "Mở khóa tài khoản"} aria-label={`${active ? "Khóa" : "Mở khóa"} ${row.full_name}`} disabled={busy || loading} onClick={() => void rowAction(row, false)}>{isDriver ? active ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} /> : active ? "Khóa" : "Mở khóa"}</button>}<button type="button" className={`table-action ${isDriver ? "driver-icon-action" : ""}`} title="Chỉnh sửa thông tin" aria-label={`Sửa ${row.full_name}`} disabled={busy || loading} onClick={() => edit(row)}><Pencil size={14} />{!isDriver && "Sửa"}</button>{!isDriver && <CustomerPasswordResetButton customerId={String(row.customer_id)} name={String(row.full_name || label)} email={String(row.email || "")} disabled={busy || loading} onReset={() => passwordWasReset(row)} />}<button type="button" className={`table-action account-delete ${isDriver ? "driver-icon-action" : ""}`} title="Xóa tài khoản" aria-label={`Xóa ${row.full_name}`} disabled={busy || loading} onClick={() => void rowAction(row, true)}><Trash2 size={14} />{!isDriver && "Xóa"}</button></div></td></tr>;
      })}</tbody></table></div>
      {!visible.length && !loading && <div className="empty-inline">{rows.length ? "Không tìm thấy tài khoản phù hợp." : "Chưa có tài khoản. Bạn có thể dùng nút Thêm phía trên."}</div>}
      {isDriver && <div className="admin-list-footer"><span>Hiển thị {visible.length} / {rows.length} tài xế</span><span>Chọn Hồ sơ để xem đầy đủ thông tin</span></div>}
    </section>
    {isDriver && reviewing && <div className="driver-review-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setReviewing(null);
    }}>
      <section className="panel driver-review-dialog" role="dialog" aria-modal="true" aria-labelledby="driver-review-title">
        <div className="driver-review-heading">
          <div><span className="section-kicker">ĐỐI CHIẾU THÔNG TIN ĐĂNG KÝ</span><h2 id="driver-review-title">Hồ sơ tài xế</h2></div>
          <button type="button" className="icon-button" aria-label="Đóng hồ sơ" onClick={() => setReviewing(null)}><X size={18} /></button>
        </div>
        <div className="driver-review-person">
          <AccountAvatar role="DRIVER" userId={String(reviewing.driver_id)} name={String(reviewing.full_name || "")} />
          <div><strong>{String(reviewing.full_name || "—")}</strong><small>{String(reviewing.driver_id || "—")}</small></div>
          <span className={`status-pill status-${String(reviewing.account_status || "").toLowerCase()}`}><i />{statusLabel(reviewing.account_status)}</span>
        </div>
        <div className="driver-review-grid">
          <div><span>HỌ VÀ TÊN</span><strong>{String(reviewing.full_name || "—")}</strong></div>
          <div><span>SỐ ĐIỆN THOẠI</span><strong>{String(reviewing.phone || "—")}</strong></div>
          <div><span>EMAIL</span><strong>{String(reviewing.email || "—")}</strong></div>
          <div><span>SỐ GIẤY PHÉP LÁI XE</span><strong>{String(reviewing.license_number || "Chưa khai báo")}</strong></div>
          <div><span>TRẠNG THÁI XÉT DUYỆT</span><strong>{statusLabel(reviewing.account_status)}</strong></div>
          <div><span>TRẠNG THÁI NHẬN CHUYẾN</span><strong>{availabilityLabel(String(reviewing.driver_status || ""))}</strong></div>
        </div>
        <div className="driver-review-vehicle">
          <span className="section-kicker">PHƯƠNG TIỆN ĐĂNG KÝ</span>
          {reviewing.license_plate ? <div className="driver-review-grid">
            <div><span>LOẠI XE</span><strong>{vehicleTypeLabel(reviewing.vehicle_type)}</strong></div>
            <div><span>BIỂN SỐ</span><strong>{String(reviewing.license_plate || "—")}</strong></div>
            <div><span>HÃNG XE</span><strong>{String(reviewing.vehicle_brand || "—")}</strong></div>
            <div><span>DÒNG XE</span><strong>{String(reviewing.vehicle_model || "—")}</strong></div>
            <div><span>MÀU SẮC</span><strong>{String(reviewing.vehicle_color || "—")}</strong></div>
            <div><span>SỐ CHỖ</span><strong>{reviewing.vehicle_seat_count ? `${String(reviewing.vehicle_seat_count)} chỗ` : "—"}</strong></div>
          </div> : <p>Hồ sơ này chưa có thông tin phương tiện.</p>}
        </div>
        <p className="driver-review-note">Hệ thống hiện lưu số giấy phép do người đăng ký khai báo, chưa có ảnh giấy phép để đối chiếu giấy tờ gốc.</p>
        {String(reviewing.account_status) === "PENDING" && <div className="driver-review-actions">
          <button type="button" className="button button-gold" disabled={busy} onClick={() => { setReviewing(null); void reviewDriver(reviewing, true); }}>Duyệt hồ sơ</button>
          <button type="button" className="button driver-review-reject" disabled={busy} onClick={() => { setReviewing(null); void reviewDriver(reviewing, false); }}>Từ chối</button>
        </div>}
      </section>
    </div>}
    <p className="account-hint">Chỉ xóa tài khoản chưa có dữ liệu liên quan. Với tài khoản đã phát sinh dữ liệu, dùng Khóa để giữ lịch sử.</p>
  </div>;
}

function availabilityLabel(status: string) {
  const labels: Record<string, string> = { AVAILABLE: "Sẵn sàng", OFFLINE: "Ngoại tuyến", BUSY: "Đang có chuyến" };
  return labels[status] || status || "—";
}
