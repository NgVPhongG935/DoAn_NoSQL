import { z } from "zod";
import { createHash } from "node:crypto";
import { query, queryAll, uuid } from "@/lib/cassandra";
import { ApiError } from "@/lib/http";
import { registrationSchema } from "@/lib/registration-schema";
import { getAdminAccount } from "@/lib/security-config";
import { getCustomer, getDriver } from "@/repositories/accounts";
import { hashAccountPassword, withAccountLock } from "@/services/registration";
import { ACTIVE_STATUSES } from "@/services/trip-plans";
import { demoMutation } from "@/lib/demo-mutation";
import { removeAvatar } from "@/lib/account-avatars";

export type AccountResource = "customers" | "drivers";
const details = {
  fullName: registrationSchema.shape.fullName,
  phone: registrationSchema.shape.phone,
  email: registrationSchema.shape.email,
};
const license = z.string().trim().min(3, "Giấy phép lái xe cần ít nhất 3 ký tự.").max(50);
const createSchemas = {
  customers: z.object({ ...details, password: registrationSchema.shape.password }).strict(),
  drivers: z.object({ ...details, password: registrationSchema.shape.password, licenseNumber: license }).strict(),
};
const updateSchemas = {
  customers: z.object({ ...details, status: z.enum(["ACTIVE", "BLOCKED"]) }).partial().strict(),
  drivers: z.object({ ...details, licenseNumber: license, accountStatus: z.enum(["ACTIVE", "BLOCKED", "PENDING", "REJECTED"]) }).partial().strict(),
};
const keyFor = (resource: AccountResource) => resource === "customers" ? "customer_id" : "driver_id";
const getAccount = (resource: AccountResource, id: string) => resource === "customers" ? getCustomer(id) : getDriver(id);

export const resetCustomerPasswordSchema = z.object({
  password: registrationSchema.shape.password,
  confirmPassword: z.string().min(1, "Vui lòng nhập lại mật khẩu mới.").max(128),
}).strict().refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"], message: "Mật khẩu nhập lại chưa khớp.",
});

export async function resetCustomerPassword(id: string, body: unknown) {
  z.uuid().parse(id);
  const data = resetCustomerPasswordSchema.parse(body);
  return withAccountLock(async () => {
    if (!(await getCustomer(id))) throw new ApiError("Không tìm thấy khách hàng.", 404);
    const passwordHash = await hashAccountPassword(data.password);
    // Update only credentials; an existing BLOCKED status stays blocked.
    await query("UPDATE customers SET password = ?, password_version = ? WHERE customer_id = ?", [passwordHash, uuid(), id]);
    return { customerId: id, passwordReset: true };
  });
}

async function checkEmail(email: string, exceptResource?: AccountResource, exceptId?: string) {
  if (email === getAdminAccount()?.email) throw new ApiError("Email đã được sử dụng.", 409);
  for (const resource of ["customers", "drivers"] as const) {
    const column = keyFor(resource);
    const accounts = await queryAll(`SELECT ${column}, email FROM ${resource}`);
    if (accounts.some((account) => String(account.email).trim().toLowerCase() === email
      && !(resource === exceptResource && String(account[column]) === exceptId))) {
      throw new ApiError("Email đã được sử dụng bởi một tài khoản khác.", 409);
    }
  }
}

export async function createManagedAccount(resource: AccountResource, body: unknown) {
  const data = createSchemas[resource].parse(body);
  return withAccountLock(async () => {
    await checkEmail(data.email);
    const id = uuid(), passwordHash = await hashAccountPassword(data.password);
    if (resource === "customers") {
      await query("INSERT INTO customers (customer_id, full_name, phone, email, password, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, data.fullName, data.phone, data.email, passwordHash, new Date(), "ACTIVE"]);
    } else {
      await query("INSERT INTO drivers (driver_id, full_name, phone, email, password, license_number, rating, driver_status, account_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, data.fullName, data.phone, data.email, passwordHash, (data as z.infer<typeof createSchemas.drivers>).licenseNumber, 0, "OFFLINE", "ACTIVE", new Date()]);
    }
    return getAccount(resource, id);
  });
}

export async function updateManagedAccount(resource: AccountResource, id: string, body: unknown) {
  z.uuid().parse(id);
  const data = updateSchemas[resource].parse(body);
  if (!Object.keys(data).length) throw new ApiError("Chưa có thông tin cần cập nhật.");
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return withAccountLock(() => demoMutation(`admin-account-update:${resource}:${id}:${fingerprint}`, { resource, id, data }, async () => {
    const current = await getAccount(resource, id);
    if (!current) throw new ApiError("Không tìm thấy tài khoản.", 404);
    if (data.email !== undefined) await checkEmail(data.email, resource, id);
    const values = data as Record<string, string>;
    if (values.status === "BLOCKED" || values.accountStatus === "BLOCKED") {
      const trips = await queryAll("SELECT * FROM trips_by_id");
      if (current.driver_status === "BUSY" || trips.some((trip) => String(trip[keyFor(resource)]) === id && ACTIVE_STATUSES.has(String(trip.status)))) {
        throw new ApiError("Tài khoản đang có chuyến hoạt động. Hãy hoàn tất chuyến trước khi khóa.", 409);
      }
    }
    const columns: Record<string, string> = { fullName: "full_name", phone: "phone", email: "email", licenseNumber: "license_number", status: "status", accountStatus: "account_status" };
    const entries = Object.entries(values);
    // Password, IDs, rating and driver availability are never editable here.
    return {
      statements: [{ query: `UPDATE ${resource} SET ${entries.map(([name]) => `${columns[name]} = ?`).join(", ")} WHERE ${keyFor(resource)} = ?`, params: [...entries.map(([, value]) => value), id] }],
      result: { ...current, ...Object.fromEntries(entries.map(([name, value]) => [columns[name], value])) },
    };
  }, false));
}

// Scan the small demonstration dataset without ALLOW FILTERING or a fixed LIMIT.
// Refuse deletion even if only a denormalized copy remains after a partial write.
const references: Record<AccountResource, Array<[string, string]>> = {
  customers: [
    ["trips_by_id", "customer_id"], ["trips_by_customer", "customer_id"], ["trips_by_driver", "customer_id"], ["trips_by_status", "customer_id"],
    ["payments_by_trip", "customer_id"], ["payments_by_customer", "customer_id"], ["reviews_by_trip", "customer_id"], ["reviews_by_driver", "customer_id"],
    ["customer_vouchers", "customer_id"], ["complaints_by_customer", "customer_id"], ["notifications_by_user", "user_id"], ["customer_spending_by_month", "customer_id"],
  ],
  drivers: [
    ["vehicles", "driver_id"], ["trips_by_id", "driver_id"], ["trips_by_customer", "driver_id"], ["trips_by_driver", "driver_id"], ["trips_by_status", "driver_id"],
    ["reviews_by_trip", "driver_id"], ["reviews_by_driver", "driver_id"], ["notifications_by_user", "user_id"], ["driver_revenue_by_month", "driver_id"],
  ],
};

export async function deleteManagedAccount(resource: AccountResource, id: string) {
  z.uuid().parse(id);
  // Share the existing trip mutation queue so booking cannot race the reference check.
  const result = await withAccountLock(() => demoMutation(`admin-account-delete:${resource}:${id}`, { resource, id }, async () => {
    const current = await getAccount(resource, id);
    if (current?.driver_status === "BUSY") throw new ApiError("Tài xế đang có chuyến, chưa thể xóa.", 409);
    for (const [table, column] of references[resource]) {
      const records = await queryAll(`SELECT ${column} FROM ${table}`);
      if (records.some((row) => String(row[column]) === id)) {
        throw new ApiError("Tài khoản đã có dữ liệu liên quan (chuyến, phương tiện, giao dịch hoặc thông báo). Hãy khóa tài khoản để giữ lịch sử.", 409);
      }
    }
    return { statements: [{ query: `DELETE FROM ${resource} WHERE ${keyFor(resource)} = ?`, params: [id] }], result: { id, deleted: true } };
  }));
  try { await removeAvatar(resource === "customers" ? "CUSTOMER" : "DRIVER", id); }
  catch { console.warn("Could not remove a deleted account's local avatar."); }
  return result;
}
