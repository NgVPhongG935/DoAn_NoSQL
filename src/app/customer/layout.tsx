import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { getSession } from "@/lib/auth";

export default async function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "CUSTOMER") redirect(`/${session.role.toLowerCase()}/dashboard`);
  return <PortalShell role={session.role} name={session.name} email={session.email} userId={session.userId}>{children}</PortalShell>;
}