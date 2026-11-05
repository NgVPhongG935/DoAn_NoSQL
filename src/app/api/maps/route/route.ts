import { z } from "zod";
import { getSession } from "@/lib/auth";
import { failure, success, unauthorized } from "@/lib/http";
import { getDrivingRoute } from "@/services/maps";

const pointSchema = z.object({
  label: z.string().trim().min(2).max(180),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function POST(request: Request) {
  try {
    if (!(await getSession())) return unauthorized();
    const { pickup, destination } = z.object({ pickup: pointSchema, destination: pointSchema }).parse(await request.json());
    return success(await getDrivingRoute(pickup, destination));
  } catch (error) {
    return failure(error);
  }
}
