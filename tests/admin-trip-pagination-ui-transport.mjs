import "./ui-transport.mjs";
import { tables } from "./support/cassandra.mjs";

const sample = tables.get("trips_by_id")[0];
tables.set("trips_by_id", Array.from({ length: 62 }, (_, index) => ({
  ...sample,
  trip_id: `92000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  booked_at: `2026-${index < 31 ? "10" : "09"}-${String(index % 20 + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
  status: ["BOOKED", "COMPLETED", "CANCELLED"][index % 3],
  pickup_address: `Điểm đón phân trang ${index + 1}`,
})));
