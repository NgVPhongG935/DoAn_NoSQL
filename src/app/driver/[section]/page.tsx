import { notFound } from "next/navigation";
import { PortalSection } from "@/components/portal/PortalSection";

const sections = new Set(["trips", "revenue", "reviews", "vehicle", "notifications", "profile"]);

export default async function DriverSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ tripId?: string | string[] }> }) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  const requested = (await searchParams).tripId;
  const tripId = section === "trips" && typeof requested === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requested) ? requested : "";
  return <PortalSection key={`${section}:${tripId}`} role="DRIVER" section={section} initialSearch={tripId} />;
}
