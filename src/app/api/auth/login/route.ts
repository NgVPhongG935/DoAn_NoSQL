import { z } from "zod";
import { createSession } from "@/lib/auth";
import { authenticateDemoUser } from "@/lib/demo-auth";
import { roleHome } from "@/lib/demo-users";
import { failure, success } from "@/lib/http";
import { getCustomerSessionState, getDriver } from "@/repositories/accounts";
import { emailSchema } from "@/lib/registration-schema";

const bodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Vui lòng nhập mật khẩu.").max(128),
  remember: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const { email, password, remember } = bodySchema.parse(await request.json());
    const authenticated = await authenticateDemoUser(email, password);

    if (!authenticated) {
      return success({ error: "Email hoặc mật khẩu không chính xác." }, 401);
    }

    const { role, user } = authenticated;
    let credentialVersion: string | undefined;
    if (role === "CUSTOMER") {
      const customer = await getCustomerSessionState(user.id);
      if (!customer || customer.status !== "ACTIVE") {
        return success({ error: "Tài khoản khách hàng đang bị khóa hoặc không khả dụng." }, 403);
      }
      credentialVersion = authenticated.credentialVersion;
      if (customer.password_version && customer.password_version !== credentialVersion) {
        return success({ error: "Mật khẩu vừa được thay đổi. Vui lòng đăng nhập lại." }, 401);
      }
    }

    if (role === "DRIVER") {
      const driver = await getDriver(user.id);
      if (!driver || !["ACTIVE", "PENDING", "REJECTED"].includes(String(driver.account_status))) {
        return success({ error: "Tài khoản tài xế đang bị khóa hoặc không khả dụng." }, 403);
      }
      await createSession({ userId: user.id, role, name: user.name, email: user.email, accountStatus: String(driver.account_status) }, remember);
      return success({
        role,
        redirectTo: roleHome(role),
        accountStatus: String(driver.account_status),
      });
    }

    await createSession({ userId: user.id, role, name: user.name, email: user.email, ...(credentialVersion ? { credentialVersion } : {}) }, remember);
    return success({ role, redirectTo: roleHome(role) });
  } catch (error) {
    return failure(error);
  }
}
