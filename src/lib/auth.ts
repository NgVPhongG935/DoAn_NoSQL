import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/lib/demo-users";
import { getAdminAccount, getJwtSecret } from "@/lib/security-config";
import { getCustomerSessionState, getDriver } from "@/repositories/accounts";

const COOKIE_NAME = "rideflow_session";
const ISSUER = "rideflow";
const AUDIENCE = "rideflow-session";

export type Session = { userId: string; role: Role; name: string; email: string; accountStatus?: string };

export async function createSession(session: Session & { credentialVersion?: string }, remember = false) {
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(remember ? "30d" : "8h")
    .sign(getJwtSecret());
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const secret = getJwtSecret();
  let session: Session;
  let credentialVersion: string | undefined;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE,
      requiredClaims: ["sub", "iat", "exp"], maxTokenAge: "30d",
    });
    if (typeof payload.userId !== "string" || typeof payload.name !== "string"
      || typeof payload.email !== "string"
      || payload.sub !== payload.userId
      || !["CUSTOMER", "DRIVER", "ADMIN"].includes(String(payload.role))) return null;
    if (payload.credentialVersion !== undefined && typeof payload.credentialVersion !== "string") return null;
    credentialVersion = payload.credentialVersion as string | undefined;
    session = {
      userId: payload.userId,
      role: payload.role as Role,
      name: payload.name,
      email: payload.email,
      ...(typeof payload.accountStatus === "string" ? { accountStatus: payload.accountStatus } : {}),
    };
  } catch {
    return null;
  }
  // Read current account state outside JWT parsing: database failures must fail closed.
  if (session.role === "ADMIN") {
    const admin = getAdminAccount();
    return admin && session.userId === admin.id && session.email === admin.email
      ? { ...session, name: admin.name } : null;
  }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session.userId)) return null;
  const account = session.role === "CUSTOMER" ? await getCustomerSessionState(session.userId) : await getDriver(session.userId);
  if (session.role === "CUSTOMER" && account?.password_version && account.password_version !== credentialVersion) return null;
  const accountStatus = session.role === "CUSTOMER" ? String(account?.status ?? "") : String(account?.account_status ?? "");
  if (!account || (session.role === "CUSTOMER" ? accountStatus !== "ACTIVE" : !["ACTIVE", "PENDING", "REJECTED"].includes(accountStatus))
    || String(account.email).trim().toLowerCase() !== session.email) return null;
  return { ...session, name: String(account.full_name), ...(session.role === "DRIVER" ? { accountStatus } : {}) };
}
