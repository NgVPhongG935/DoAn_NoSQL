import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireAdminPermission } from "@/lib/authorization";
import { failure, success } from "@/lib/http";
import { getServiceById } from "@/repositories/ride-data";
import { listDrivers, listVehicles } from "@/repositories/accounts";

export async function GET(request: Request) {
  try {
    requireAdminPermission(await getSession(), "drivers:read");
    const serviceId = new URL(request.url).searchParams.get("serviceId");
    const drivers = await listDrivers(100);
    if (!serviceId) return success(drivers);
    if (!z.string().uuid().safeParse(serviceId).success) return success({ error: "serviceId phải là UUID hợp lệ." }, 400);
    const service = await getServiceById(serviceId);
    if (!service || service.status !== "ACTIVE") return success([]);
    const vehicles = await listVehicles(100);
    const serviceName = String(service.service_name);
    const compatible = vehicles.filter((vehicle) => {
      const type = String(vehicle.vehicle_type);
      const seats = Number(vehicle.seat_count || 0);
      if (vehicle.status !== "ACTIVE") return false;
      if (serviceName === "BIKE") return type === "BIKE";
      if (serviceName === "CAR_4") return ["CAR", "CAR_4"].includes(type) && seats >= 4;
      if (serviceName === "CAR_7") return ["CAR", "CAR_7"].includes(type) && seats >= 7;
      if (serviceName === "PREMIUM") return ["CAR", "CAR_4", "CAR_7"].includes(type) && seats >= 4;
      return true;
    });
    const vehicleByDriver = new Map(compatible.map((vehicle) => [String(vehicle.driver_id), vehicle]));
    return success(drivers
      .filter((driver) => driver.account_status === "ACTIVE" && driver.driver_status === "AVAILABLE" && vehicleByDriver.has(String(driver.driver_id)))
      .map((driver) => {
        const vehicle = vehicleByDriver.get(String(driver.driver_id));
        return { ...driver, vehicle_id: vehicle?.vehicle_id, vehicle_type: vehicle?.vehicle_type, vehicle_plate: vehicle?.license_plate };
      }));
  } catch (error) {
    return failure(error);
  }
}
