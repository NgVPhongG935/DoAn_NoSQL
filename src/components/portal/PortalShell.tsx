"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDownLeft, BadgeDollarSign, Bell, Bike, CarFront, ChevronDown, CircleHelp, ClipboardList, CreditCard, DatabaseBackup, Gauge, LayoutDashboard, LogOut, Menu, MessageSquareText, Settings2, ShieldCheck, TicketPercent, Users, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/lib/demo-users";
import { ConnectionIndicator } from "@/components/portal/ConnectionIndicator";
import { AccountAvatar, AvatarEditor } from "@/components/portal/AccountAvatar";
import { roleLabel } from "@/lib/display-labels";
import { NotificationBell } from "@/components/portal/NotificationBell";

type NavItem = { label: string; href: string; icon: LucideIcon };
const menus: Record<Role, NavItem[]> = {
  CUSTOMER: [
    { label: "Tổng quan", href: "/customer/dashboard", icon: LayoutDashboard },
    { label: "Đặt xe", href: "/customer/booking", icon: CarFront },
    { label: "Chuyến đi", href: "/customer/trips", icon: ClipboardList },
    { label: "Thanh toán", href: "/customer/payments", icon: CreditCard },
    { label: "Ưu đãi", href: "/customer/vouchers", icon: TicketPercent },
    { label: "Khiếu nại", href: "/customer/complaints", icon: CircleHelp },
    { label: "Thông báo", href: "/customer/notifications", icon: Bell },
    { label: "Hồ sơ", href: "/customer/profile", icon: Settings2 },
  ],
  DRIVER: [
    { label: "Tổng quan", href: "/driver/dashboard", icon: LayoutDashboard },
    { label: "Chuyến đi", href: "/driver/trips", icon: CarFront },
    { label: "Doanh thu", href: "/driver/revenue", icon: BadgeDollarSign },
    { label: "Đánh giá", href: "/driver/reviews", icon: MessageSquareText },
    { label: "Phương tiện", href: "/driver/vehicle", icon: Bike },
    { label: "Thông báo", href: "/driver/notifications", icon: Bell },
    { label: "Hồ sơ", href: "/driver/profile", icon: Settings2 },
  ],
  ADMIN: [
    { label: "Tổng quan", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Khách hàng", href: "/admin/customers", icon: Users },
    { label: "Tài xế", href: "/admin/drivers", icon: CarFront },
    { label: "Phương tiện", href: "/admin/vehicles", icon: Bike },
    { label: "Chuyến đi", href: "/admin/trips", icon: ClipboardList },
    { label: "Dịch vụ", href: "/admin/services", icon: Gauge },
    { label: "Thanh toán", href: "/admin/payments", icon: WalletCards },
    { label: "Mã giảm giá", href: "/admin/vouchers", icon: TicketPercent },
    { label: "Khiếu nại", href: "/admin/complaints", icon: CircleHelp },
    { label: "Thông báo", href: "/admin/notifications", icon: Bell },
    { label: "Báo cáo", href: "/admin/reports", icon: BadgeDollarSign },
    { label: "Sao lưu & khôi phục", href: "/admin/backup", icon: DatabaseBackup },
  ],
};
const workspaceTitle: Record<Role, string> = { CUSTOMER: "Không gian khách hàng", DRIVER: "Không gian tài xế", ADMIN: "Trung tâm điều hành" };

export function PortalShell({ role, name, email, userId, children }: {
  role: Role; name: string; email: string; userId: string; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const menu = menus[role];
  const active = menu.find((item) => item.href === pathname)
    || menu.find((item) => item.href === `/${role.toLowerCase()}/${pathname.split("/")[2]}`)
    || menu[0];


  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Chưa thể đăng xuất. Vui lòng thử lại.");
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("Chưa thể đăng xuất. Kiểm tra kết nối rồi thử lại.");
      setLogoutBusy(false);
    }
  }

  return <div className={`portal-app portal-${role.toLowerCase()}`}>
    {logoutError && <div className="data-error" role="alert">{logoutError}</div>}
    {menuOpen && <button className="sidebar-backdrop" aria-label="Đóng menu" onClick={() => setMenuOpen(false)} />}
    <aside className={`portal-sidebar ${menuOpen ? "is-open" : ""}`}>
      <Link href="/" className="brand portal-brand"><span className="brand-mark"><ArrowDownLeft size={18} strokeWidth={2.8} /></span><span>rideflow<span className="brand-period">.</span></span></Link>
      <div className="workspace-label">KHÔNG GIAN</div>
      <div className="workspace-switch"><span className="workspace-avatar">{role === "ADMIN" ? <ShieldCheck size={17} /> : role === "DRIVER" ? <CarFront size={17} /> : <Users size={17} />}</span><span><strong>{workspaceTitle[role]}</strong><small>{role === "ADMIN" ? "Quyền quản trị" : "Tài khoản demo"}</small></span><ChevronDown size={15} /></div>
      <div className="sidebar-caption">DANH MỤC CHÍNH</div>
      <nav className="sidebar-nav">{menu.map(({ label, href, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`sidebar-link ${active.href === href ? "active" : ""}`}><Icon size={18} /><span>{label}</span>{active.href === href && <i />}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-help"><span><ShieldCheck size={18} /></span><strong>Dữ liệu Cassandra</strong><small>Kết nối qua máy chủ an toàn</small><a href="/api/health" target="_blank" rel="noreferrer">Kiểm tra kết nối <ArrowDownLeft size={13} /></a></div><button className="sidebar-logout" onClick={logout}><LogOut size={17} />Đăng xuất</button></div>
    </aside>
    <div className="portal-main"><header className="portal-topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Mở menu" onClick={() => setMenuOpen(true)}><Menu size={19} /></button><div className="breadcrumb"><span>{workspaceTitle[role]}</span><i>/</i><strong>{active.label}</strong></div></div><div className="topbar-right"><ConnectionIndicator /><NotificationBell role={role} userId={userId} /><div className="profile-menu-wrap"><button className="profile-trigger" onClick={() => setProfileOpen(!profileOpen)}><AccountAvatar role={role} userId={userId} name={name} className="profile-avatar" /><span className="profile-copy"><strong>{name}</strong><small>{email}</small></span><ChevronDown size={15} /></button>{profileOpen && <div className="profile-dropdown"><strong>{name}</strong><small>{email}</small><span className="dropdown-id">Mã tài khoản · {userId}</span><AvatarEditor role={role} userId={userId} name={name} /><button onClick={logout}><LogOut size={15} /> Đăng xuất</button></div>}</div></div></header><div className="portal-content">{children}<footer className="portal-footer"><span>HỆ THỐNG QUẢN LÝ RIDEFLOW</span><span>CASSANDRA · {roleLabel(role).toLocaleUpperCase("vi")}</span></footer></div></div>
  </div>;
}
