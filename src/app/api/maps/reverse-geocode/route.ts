import { z } from "zod";
import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";
import { reverseGeocode } from "@/services/maps";

const coordinateSchema = z.coerce.number().finite();

export async function GET(request: Request) {
  try {
    if (!(await getSession())) return unauthorized();
    const params = new URL(request.url).searchParams;
    const lat = coordinateSchema.min(-90).max(90).parse(params.get("lat"));
    const lng = coordinateSchema.min(-180).max(180).parse(params.get("lng"));
    return success(await reverseGeocode(lat, lng));
  } catch (error) {
    return failure(error);
  }
}
