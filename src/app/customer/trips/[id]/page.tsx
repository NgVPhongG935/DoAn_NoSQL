import { TripDetail } from "@/components/trips/TripDetail";

export default async function CustomerTripDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripDetail tripId={id} />;
}