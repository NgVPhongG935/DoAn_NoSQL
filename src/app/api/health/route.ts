import { cassandraClient } from "@/lib/cassandra";
import { failure, success } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await cassandraClient.execute("SELECT release_version FROM system.local");
    return success({ status: "ok" });
  } catch (error) {
    return failure(error);
  }
}
