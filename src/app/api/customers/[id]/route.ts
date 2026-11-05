import { withBusinessRead } from "@/lib/business-journal";
import { z } from "zod";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { failure, notFound, success } from "@/lib/http";
import { getCustomer, updateCustomer } from "@/repositories/accounts";

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^[+0-9 ()-]{8,18}$/),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "CUSTOMER", id, "customers:read");
    return await withBusinessRead(async () => {
      const customer = await getCustomer(id);
      return customer ? success(customer) : notFound("Không tìm thấy khách hàng.");
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "CUSTOMER", id, "customers:write");
    const body = updateSchema.parse(await request.json());
    return success(await updateCustomer(id, body.fullName, body.phone));
  } catch (error) {
    return failure(error);
  }
}