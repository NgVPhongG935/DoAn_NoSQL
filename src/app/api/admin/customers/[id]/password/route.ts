import { getSession } from "@/lib/auth";
import { requireAdminResource } from "@/lib/authorization";
import { failure, success } from "@/lib/http";
import { resetCustomerPassword } from "@/services/admin-accounts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdminResource(await getSession(), "customers", "write");
    const { id } = await params;
    const result = await resetCustomerPassword(id, await request.json());
    const response = success(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return failure(error); }
}
