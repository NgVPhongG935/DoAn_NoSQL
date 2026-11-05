import { withBusinessRead } from "@/lib/business-journal";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { failure, success } from "@/lib/http";
import { getCustomer } from "@/repositories/accounts";
import { getTripsForDriver } from "@/repositories/ride-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "DRIVER", id, "trips:read");
    return await withBusinessRead(async () => {
      const trips = await getTripsForDriver(id);
      const customerIds = [...new Set(trips.map((trip) => String(trip.customer_id)).filter(Boolean))];
      const customers = await Promise.all(customerIds.map((customerId) => getCustomer(customerId)));
      const customerById = new Map(customers.filter(Boolean).map((customer) => [
        String(customer!.customer_id),
        { name: customer!.full_name, phone: customer!.phone },
      ]));
      return success(trips.map((trip) => ({
        ...trip,
        customer_name: customerById.get(String(trip.customer_id))?.name || "Khách chưa xác định",
        customer_phone: customerById.get(String(trip.customer_id))?.phone || null,
      })));
    });
  } catch (error) {
    return failure(error);
  }
}