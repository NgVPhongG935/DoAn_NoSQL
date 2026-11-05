import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";

export async function GET() {
  try {
    const session = await getSession();
    return session ? success(session) : unauthorized();
  } catch (error) {
    return failure(error);
  }
}