import { notFound } from "next/navigation";
import { PortalSection } from "@/components/portal/PortalSection";

const sections = new Set(["trips", "payments", "vouchers", "reviews", "complaints", "notifications", "profile"]);

export default async function CustomerSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  return <PortalSection role="CUSTOMER" section={section} />;
}