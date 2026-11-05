import { RoleDashboard } from "@/components/portal/RoleDashboard";
import { getSession } from "@/lib/auth";

export default async function CustomerDashboard() {
  const session = await getSession();
  return <RoleDashboard role="CUSTOMER" name={session?.name || "Khách hàng"} />;
}