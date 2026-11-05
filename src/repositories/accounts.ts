import { cassandraClient, jsonSafe, query } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";

function withoutPassword<T extends Record<string, unknown>>(row: T) {
  const { password: _password, password_version: _passwordVersion, ...safeRow } = row;
  return safeRow;
}

export async function getCustomer(customerId: string) {
  const rows = await query("SELECT * FROM customers WHERE customer_id = ?", [customerId]);
  return rows[0] ? jsonSafe(withoutPassword(rows[0])) : null;
}

// Authentication metadata stays separate from public account/profile responses.
export async function getCustomerSessionState(customerId: string) {
  const rows = await query("SELECT full_name, email, status, password_version FROM customers WHERE customer_id = ?", [customerId]);
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function getDriver(driverId: string) {
  const rows = await query("SELECT * FROM drivers WHERE driver_id = ?", [driverId]);
  return rows[0] ? jsonSafe(withoutPassword(rows[0])) : null;
}

export async function listCustomers(limit = 50) {
  const rows = await query("SELECT * FROM customers LIMIT ?", [limit]);
  return jsonSafe(rows.map(withoutPassword));
}

export async function listDrivers(limit = 50) {
  const rows = await query("SELECT * FROM drivers LIMIT ?", [limit]);
  return jsonSafe(rows.map(withoutPassword));
}

export async function findLoginAccountByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  async function findInTable(cql: string) {
    let pageState: string | undefined;
    do {
      const result = await cassandraClient.execute(cql, [], { prepare: true, pageState });
      const row = result.rows.find((item) => String(item.email).trim().toLowerCase() === normalizedEmail);
      if (row) return row;
      pageState = result.pageState;
    } while (pageState);
    return undefined;
  }
  const [customer, driver] = await Promise.all([
    findInTable("SELECT customer_id, full_name, email, password, password_version, status FROM customers"),
    findInTable("SELECT driver_id, full_name, email, password, account_status FROM drivers"),
  ]);
  if (customer) return {
    role: "CUSTOMER" as const,
    user: { id: String(customer.customer_id), name: String(customer.full_name), email: String(customer.email) },
    passwordHash: String(customer.password || ""),
    credentialVersion: typeof customer.password_version === "string" ? customer.password_version : undefined,
  };
  if (driver) return {
    role: "DRIVER" as const,
    user: { id: String(driver.driver_id), name: String(driver.full_name), email: String(driver.email) },
    passwordHash: String(driver.password || ""),
  };
  return null;
}

export async function listVehicles(limit = 100) {
  return jsonSafe(await query("SELECT * FROM vehicles LIMIT ?", [limit]));
}

export async function getVehiclesForDriver(driverId: string) {
  const vehicles = await listVehicles();
  return vehicles.filter((vehicle) => vehicle.driver_id === driverId);
}

export async function getVehicle(vehicleId: string) {
  const rows = await query("SELECT * FROM vehicles WHERE vehicle_id = ?", [vehicleId]);
  return rows[0] ? jsonSafe(rows[0]) : null;
}

export async function updateCustomer(customerId: string, fullName: string, phone: string) {
  if (!(await getCustomer(customerId))) throw new ApiError("Không tìm thấy khách hàng.", 404);
  await query(
    "UPDATE customers SET full_name = ?, phone = ? WHERE customer_id = ?",
    [fullName, phone, customerId],
  );
  return getCustomer(customerId);
}
