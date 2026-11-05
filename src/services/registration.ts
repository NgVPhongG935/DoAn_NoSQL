import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { cassandraClient, query, queryAll, uuid } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";
import { getAdminAccount } from "@/lib/security-config";
import { findLoginAccountByEmail } from "@/repositories/accounts";
import type { z } from "zod";
import { driverRegistrationSchema } from "@/lib/registration-schema";

const scrypt = promisify(scryptCallback);
// Serialize registration in the single-server demonstration deployment.
const state = globalThis as typeof globalThis & { registrationQueue?: Promise<void> };

export async function withAccountLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = state.registrationQueue ?? Promise.resolve();
  let release!: () => void;
  state.registrationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await action(); } finally { release(); }
}

export async function hashAccountPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = Buffer.from(await scrypt(password, salt, 64) as ArrayBuffer).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export async function registerCustomer(input: { fullName: string; phone: string; email: string; password: string }) {
  return withAccountLock(async () => {
    await assertUniqueAccount(input.email, input.phone);
    const hash = await hashAccountPassword(input.password);
    const id = uuid();
    await query("INSERT INTO customers (customer_id, full_name, phone, email, password, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, input.fullName, input.phone, input.email, hash, new Date(), "ACTIVE"]);
    return { id, name: input.fullName, email: input.email };
  });
}

async function assertUniqueAccount(email: string, phone: string, licensePlate?: string) {
  if (email === getAdminAccount()?.email || await findLoginAccountByEmail(email)) {
    throw new ApiError("Email đã được sử dụng. Vui lòng dùng email khác hoặc đăng nhập.", 409);
  }
  const [customers, drivers] = await Promise.all([
    queryAll("SELECT phone FROM customers"),
    queryAll("SELECT phone FROM drivers"),
  ]);
  if ([...customers, ...drivers].some((account) => String(account.phone ?? "").trim() === phone)) {
    throw new ApiError("Số điện thoại đã được sử dụng bởi một tài khoản khác.", 409);
  }
  if (licensePlate) {
    const vehicles = await queryAll("SELECT license_plate FROM vehicles");
    const normalizedPlate = licensePlate.replace(/[\s.-]/g, "").toUpperCase();
    if (vehicles.some((vehicle) => String(vehicle.license_plate ?? "").replace(/[\s.-]/g, "").toUpperCase() === normalizedPlate)) {
      throw new ApiError("Biển số xe đã được đăng ký.", 409);
    }
  }
}

type DriverRegistration = Omit<z.infer<typeof driverRegistrationSchema>, "confirmPassword">;

export async function registerDriver(input: DriverRegistration) {
  return withAccountLock(async () => {
    await assertUniqueAccount(input.email, input.phone, input.licensePlate);
    const hash = await hashAccountPassword(input.password);
    const driverId = uuid(), vehicleId = uuid(), createdAt = new Date();
    await cassandraClient.batch([
      {
        query: "INSERT INTO drivers (driver_id, full_name, phone, email, password, license_number, rating, driver_status, account_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [driverId, input.fullName, input.phone, input.email, hash, input.licenseNumber, 0, "OFFLINE", "PENDING", createdAt],
      },
      {
        query: "INSERT INTO vehicles (vehicle_id, driver_id, license_plate, vehicle_type, brand, model, color, seat_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [vehicleId, driverId, input.licensePlate, input.vehicleType, input.brand, input.model, input.color, input.seatCount, "ACTIVE"],
      },
    ], { prepare: true, logged: true });
    return { id: driverId, name: input.fullName, email: input.email, accountStatus: "PENDING" };
  });
}
