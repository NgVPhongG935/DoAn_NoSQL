import { RoleDashboard } from "@/components/portal/RoleDashboard";
import { getSession } from "@/lib/auth";

export default async function AdminDashboard() {
  const session = await getSession();
  return <RoleDashboard role="ADMIN" name={session?.name || "Quản trị viên"} />;
}