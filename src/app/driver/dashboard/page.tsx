import { RoleDashboard } from "@/components/portal/RoleDashboard";
import { getSession } from "@/lib/auth";

export default async function DriverDashboard() {
  const session = await getSession();
  return <RoleDashboard role="DRIVER" name={session?.name || "Tài xế"} />;
}