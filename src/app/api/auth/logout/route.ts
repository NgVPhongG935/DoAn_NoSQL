import { clearSession } from "@/lib/auth";
import { success } from "@/lib/http";

export async function POST() {
  await clearSession();
  return success({ loggedOut: true });
}