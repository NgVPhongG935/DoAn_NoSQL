import { withBusinessRead } from "@/lib/business-journal";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { failure, success } from "@/lib/http";
import { getVouchers, getVouchersForCustomer } from "@/repositories/ride-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "CUSTOMER", id, "vouchers:read");
    return await withBusinessRead(async () => {
      const [owned, vouchers] = await Promise.all([getVouchersForCustomer(id), getVouchers()]);
      const byCode = new Map(vouchers.map((voucher) => [String(voucher.voucher_code), voucher]));
      return success(owned.map((item) => ({ ...item, voucher: byCode.get(String(item.voucher_code)) ?? null })));
    });
  } catch (error) {
    return failure(error);
  }
}