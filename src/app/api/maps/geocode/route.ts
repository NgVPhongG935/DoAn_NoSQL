import { z } from "zod";
import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";
import { searchPlaces } from "@/services/maps";

const querySchema = z.string().trim().min(3).max(120);

export async function GET(request: Request) {
  try {
    if (!(await getSession())) return unauthorized();
    const query = querySchema.parse(new URL(request.url).searchParams.get("q") || "");
    return success(await searchPlaces(query));
  } catch (error) {
    return failure(error);
  }
}
