import { redirect } from "next/navigation";
import Link from "next/link";
import { PortalShell } from "@/components/portal/PortalShell";
import { getSession } from "@/lib/auth";

export default async function DriverLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "DRIVER") redirect(`/${session.role.toLowerCase()}/dashboard`);
  if (session.accountStatus === "PENDING") return <main className="driver-approval-screen"><section className="panel driver-approval-card">
    <span className="section-kicker">HỒ SƠ TÀI XẾ</span><h1>Hồ sơ đang chờ duyệt</h1>
    <p>RideFlow đã nhận thông tin đăng ký của bạn. Bạn sẽ có thể truy cập nghiệp vụ tài xế và bật nhận chuyến sau khi quản trị viên duyệt hồ sơ.</p>
    <Link className="button button-gold" href="/">Về trang chủ</Link>
  </section></main>;
  if (session.accountStatus === "REJECTED") return <main className="driver-approval-screen"><section className="panel driver-approval-card">
    <span className="section-kicker">HỒ SƠ TÀI XẾ</span><h1>Hồ sơ chưa được duyệt</h1>
    <p>Hồ sơ đăng ký của bạn đã bị từ chối. Vui lòng liên hệ quản trị viên RideFlow để biết thêm thông tin.</p>
    <Link className="button button-gold" href="/">Về trang chủ</Link>
  </section></main>;
  return <PortalShell role={session.role} name={session.name} email={session.email} userId={session.userId}>{children}</PortalShell>;
}