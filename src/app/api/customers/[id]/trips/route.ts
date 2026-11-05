import { withBusinessRead } from "@/lib/business-journal";
import { requireOwnerOrAdmin } from "@/lib/authorization";
import { getSession } from "@/lib/auth";
import { failure, success } from "@/lib/http";
import { getDriver } from "@/repositories/accounts";
import { getTripsForCustomer } from "@/repositories/ride-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    requireOwnerOrAdmin(session, "CUSTOMER", id, "trips:read");
    return await withBusinessRead(async () => {
      const trips = await getTripsForCustomer(id);
      const driverIds = [...new Set(trips.map((trip) => String(trip.driver_id)).filter(Boolean))];
      const drivers = await Promise.all(driverIds.map((driverId) => getDriver(driverId)));
      const driverNames = new Map(drivers.filter(Boolean).map((driver) => [String(driver!.driver_id), driver!.full_name]));
      return success(trips.map((trip) => ({
        ...trip,
        driver_name: driverNames.get(String(trip.driver_id)) || "Tài xế chưa xác định",
      })));
    });
  } catch (error) {
    return failure(error);
  }
}