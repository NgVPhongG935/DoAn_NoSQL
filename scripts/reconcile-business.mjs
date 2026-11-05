import "./register-typescript.mjs";
import nextEnv from "@next/env";

if (process.argv.includes("--help")) {
  console.log("Default: read-only consistency report. --recover --apply: replay only an existing PREPARED journal operation; no schema changes or automatic fixes to historical conflicts.");
  process.exit(0);
}
nextEnv.loadEnvConfig(process.cwd());
const { cassandraClient } = await import("../src/lib/cassandra.ts");
try {
  const { businessJournalEnabled, businessRead, recoverPendingOperation } = await import("../src/lib/business-journal.ts");
  if (process.argv.includes("--recover")) {
    if (!process.argv.includes("--apply") || !businessJournalEnabled()) throw new Error("Recovery requires --recover --apply and RIDEFLOW_BUSINESS_JOURNAL_ENABLED=true after migration approval.");
    const recovered = await recoverPendingOperation();
    console.log(JSON.stringify({ recovered, operation: "roll-forward existing journal plan only" }));
  } else {
    if (process.argv.includes("--apply")) throw new Error("Read-only inspection does not accept --apply.");
    const [trips, byCustomer, byDriver, byStatus, payments, paymentCustomers, reviews, reviewDrivers, drivers, vehicles, revenue, spending] = await Promise.all([
      "trips_by_id", "trips_by_customer", "trips_by_driver", "trips_by_status", "payments_by_trip", "payments_by_customer",
      "reviews_by_trip", "reviews_by_driver", "drivers", "vehicles", "driver_revenue_by_month", "customer_spending_by_month",
    ].map((table) => businessRead(`SELECT * FROM ${table}`)));
    const findings = [];
    const active = new Set(["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"]);
    for (const driver of drivers) {
      const assigned = trips.filter((trip) => trip.driver_id === driver.driver_id && active.has(trip.status));
      if (assigned.length > 1) findings.push({ type: "multiple_active_trips", driverId: driver.driver_id, tripIds: assigned.map((trip) => trip.trip_id) });
      if (assigned.length && driver.driver_status !== "BUSY") findings.push({ type: "availability_mismatch", driverId: driver.driver_id, status: driver.driver_status });
    }
    for (const trip of trips) {
      for (const [table, rows] of [["trips_by_customer", byCustomer], ["trips_by_driver", byDriver], ["trips_by_status", byStatus]]) {
        const copies = rows.filter((copy) => copy.trip_id === trip.trip_id);
        if (copies.length !== 1 || copies[0]?.status !== trip.status || Number(copies[0]?.final_fare) !== Number(trip.final_fare)
          || copies[0]?.driver_id && copies[0].driver_id !== trip.driver_id || copies[0]?.customer_id && copies[0].customer_id !== trip.customer_id) {
          findings.push({ type: "trip_projection_mismatch", table, tripId: trip.trip_id, count: copies.length });
        }
      }
      const vehicle = vehicles.find((vehicle) => vehicle.vehicle_id === trip.vehicle_id);
      if (!vehicle || vehicle.driver_id !== trip.driver_id) findings.push({ type: "vehicle_owner_mismatch", tripId: trip.trip_id });
      const paid = payments.filter((payment) => payment.trip_id === trip.trip_id);
      if (trip.status === "COMPLETED" && paid.length !== 1 || trip.status !== "COMPLETED" && paid.length) findings.push({ type: "payment_trip_status_mismatch", tripId: trip.trip_id, count: paid.length });
      for (const payment of paid) {
        const copy = paymentCustomers.filter((row) => row.payment_id === payment.payment_id && row.trip_id === trip.trip_id);
        if (copy.length !== 1 || Number(payment.amount) !== Number(trip.final_fare) || Number(copy[0]?.amount) !== Number(payment.amount)) findings.push({ type: "payment_projection_mismatch", tripId: trip.trip_id });
      }
      if (trip.status === "COMPLETED") {
        for (const [table, records, field] of [["driver_revenue_by_month", revenue, "fare"], ["customer_spending_by_month", spending, "amount"]]) {
          const copies = records.filter((row) => row.trip_id === trip.trip_id);
          if (copies.length !== 1 || Number(copies[0]?.[field]) !== Number(trip.final_fare)) findings.push({ type: "finance_projection_mismatch", table, tripId: trip.trip_id, count: copies.length });
        }
      }
    }
    for (const review of reviews) {
      if (reviewDrivers.filter((row) => row.review_id === review.review_id && row.trip_id === review.trip_id && row.driver_id === review.driver_id).length !== 1) findings.push({ type: "review_projection_mismatch", tripId: review.trip_id });
    }
    let pending = [];
    if (businessJournalEnabled()) pending = (await businessRead("SELECT operation_id, kind, state FROM rideflow_business_journal WHERE scope = ?", ["rideflow-business-v1"])).filter((row) => row.state === "PREPARED");
    console.log(JSON.stringify({ readOnly: true, tripCount: trips.length, findings, pending }, null, 2));
    if (findings.length || pending.length) process.exitCode = 2;
  }
} finally { await cassandraClient.shutdown(); }
