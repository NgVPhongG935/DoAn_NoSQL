import { notFound } from "next/navigation";
import { PortalSection } from "@/components/portal/PortalSection";
import { RoleDashboard } from "@/components/portal/RoleDashboard";
import { getSession } from "@/lib/auth";
import { AdminSupportSection } from "@/components/portal/AdminSupportSection";
import "@/app/admin-support.css";

const sections = new Set(["customers", "drivers", "vehicles", "trips", "services", "payments", "vouchers", "reviews", "complaints", "notifications", "reports"]);

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  if (section === "complaints" || section === "notifications") return <AdminSupportSection key={section} section={section} />;
  if (section === "reports") {
    const session = await getSession();
    return <RoleDashboard role="ADMIN" name={session?.name || "Quản trị viên"} />;
  }
  return <PortalSection role="ADMIN" section={section} />;
}
