import { driverRegistrationSchema, registrationSchema } from "@/lib/registration-schema";
import { registerCustomer, registerDriver } from "@/services/registration";
import { failure, success } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const role = body?.role ?? "CUSTOMER";
    const user = role === "DRIVER"
      ? await registerDriver(driverRegistrationSchema.parse(body))
      : await registerCustomer(registrationSchema.parse(body));
    return success({ user, redirectTo: "/login" }, 201);
  } catch (error) { return failure(error); }
}
