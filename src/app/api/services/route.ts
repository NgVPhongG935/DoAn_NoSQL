import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";
import { getServices } from "@/repositories/ride-data";

export async function GET() {
  try {
    if (!(await getSession())) return unauthorized();
    return success(await getServices());
  } catch (error) {
    return failure(error);
  }
}