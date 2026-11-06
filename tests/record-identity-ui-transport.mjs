import "./ui-transport.mjs";
import { tables } from "./support/cassandra.mjs";

// Reproduce stale/imported projections without touching a live database.
const trip = tables.get("trips_by_id")[0];
tables.get("trips_by_status").push({ ...trip, status: "BOOKED" });
const payment = tables.get("payments_by_customer")[0];
tables.get("payments_by_customer").push({ ...payment, payment_id: "20000000-0000-4000-8000-000000000054", paid_at: "2026-10-10T02:00:00.000Z" });
const notification = tables.get("notifications_by_user")[0];
tables.get("notifications_by_user").push({ ...notification, created_at: "2026-10-11T00:00:00.000Z", title: "Second notification" });
