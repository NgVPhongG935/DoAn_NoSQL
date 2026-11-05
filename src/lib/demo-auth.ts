import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getAdminAccount } from "@/lib/security-config";
import { findLoginAccountByEmail } from "@/repositories/accounts";

const scrypt = promisify(scryptCallback);

async function verifyPassword(password: string, encodedHash: string) {
  const parts = encodedHash.split("$");
  const [algorithm, salt, storedHex] = parts;
  if (parts.length !== 3 || algorithm !== "scrypt" || !/^[a-f0-9]{32}$/i.test(salt || "") || !/^[a-f0-9]{128}$/i.test(storedHex || "")) return false;

  const stored = Buffer.from(storedHex, "hex");
  const derived = Buffer.from(await scrypt(password, salt, stored.length) as ArrayBuffer);
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

export async function authenticateDemoUser(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const admin = getAdminAccount();
  if (admin?.email === normalizedEmail) {
    if (!(await verifyPassword(password, admin.passwordHash))) return null;
    return { role: "ADMIN" as const, user: { id: admin.id, name: admin.name, email: admin.email }, credentialVersion: undefined };
  }

  const account = await findLoginAccountByEmail(normalizedEmail);
  if (!account || !(await verifyPassword(password, account.passwordHash))) return null;

  return {
    role: account.role,
    user: account.user,
    credentialVersion: account.role === "CUSTOMER" ? account.credentialVersion : undefined,
  };
}
