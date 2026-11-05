import realDriver from "cassandra-driver";
import fakeDriver, { resetTables } from "./support/cassandra.mjs";
import { tables } from "./support/cassandra.mjs";
import { Server } from "node:http";

// Next's production external loader can bypass module resolution hooks. Replace
// the cached driver's constructor before Next is imported, only in this child.
realDriver.Client = fakeDriver.Client;
const c = "20000000-0000-4000-8000-000000000001", d = "20000000-0000-4000-8000-000000000011", v = "20000000-0000-4000-8000-000000000021", s = "20000000-0000-4000-8000-000000000031", t = "20000000-0000-4000-8000-000000000041";
const trip = { trip_id: t, customer_id: c, driver_id: d, vehicle_id: v, service_id: s, status: "COMPLETED", booked_at: "2026-10-10T00:00:00.000Z", completed_at: "2026-10-10T01:00:00.000Z", trip_date: "2026-10-10", estimated_fare: "12000", final_fare: "0", payment_method: "CASH", pickup_address: "Test pickup", destination_address: "Test destination" };
const bankTrip={...trip,trip_id:"20000000-0000-4000-8000-000000000042",payment_method:"BANK_TRANSFER",final_fare:"12000"};
const cashPayment={trip_id:t,payment_id:"20000000-0000-4000-8000-000000000051",customer_id:c,amount:"0",payment_method:"CASH",payment_status:"PAID",paid_at:"2026-10-10T01:00:00.000Z"};
const bankPayment={...cashPayment,trip_id:bankTrip.trip_id,payment_id:"20000000-0000-4000-8000-000000000052",amount:"12000",payment_method:"BANK_TRANSFER",payment_status:"PENDING"};
// In-memory regression fixture only; never seeded into a running Cassandra.
const legacyTrip={...trip,trip_id:"2be76152-0000-4000-8000-000000000001",booked_at:"2026-09-01T00:00:00.000Z",completed_at:"2026-09-01T01:00:00.000Z",trip_date:"2026-09-01",final_fare:"58350"};
const legacyPayment={...cashPayment,trip_id:legacyTrip.trip_id,payment_id:"20000000-0000-4000-8000-000000000053",amount:"58350",paid_at:"2026-09-01T01:00:00.000Z"};
resetTables({
  customers: [{ customer_id: c, full_name: "UI Test Customer", email: "ui-customer@test.invalid", phone: "0901234567", status: "ACTIVE" }],
  drivers: [{ driver_id: d, full_name: "UI Test Driver", email: "ui-driver@test.invalid", phone: "0901234567", account_status: "ACTIVE", driver_status: "AVAILABLE", rating: 5 }],
  vehicles: [{ vehicle_id: v, driver_id: d, brand: "Test", model: "Bike", license_plate: "UI-TEST", vehicle_type: "BIKE", seat_count: 2, status: "ACTIVE" }],
  service_types: [{ service_id: s, service_name: "BIKE", base_fare: "10000", price_per_km: "1000", description: "Test service", status: "ACTIVE" }],
  trips_by_id: [trip,bankTrip,legacyTrip], trips_by_customer: [trip,bankTrip,legacyTrip], trips_by_driver: [trip,bankTrip,legacyTrip], trips_by_status: [trip,bankTrip,legacyTrip],
  payments_by_trip: [cashPayment,bankPayment,legacyPayment],payments_by_customer:[cashPayment,bankPayment,legacyPayment],
  notifications_by_user: [{ user_id: c, notification_id: "20000000-0000-4000-8000-000000000061", created_at: "2026-10-10T00:00:00.000Z", title: "UI test", content: "Test notification", notification_type: "SYSTEM", is_read: false }],
});

// Test-process-only control: simulate another customer's assignment after the
// Driver page is already open. It is never installed by the production app.
const originalEmit = Server.prototype.emit;
Server.prototype.emit = function(event, ...args) {
  const [request, response] = args;
  if (event === "request" && request.url === "/__tests/driver-assignment" && request.method === "POST") {
    const assignedId="20000000-0000-4000-8000-000000000043", at=new Date().toISOString(), vehicleId="20000000-0000-4000-8000-000000000023";
    const assignedTrip={...trip,trip_id:assignedId,status:"BOOKED",booked_at:at,trip_date:at.slice(0,10),completed_at:null,payment_method:"CASH",final_fare:"12000",vehicle_id:vehicleId,pickup_address:"Browser pickup",destination_address:"Browser destination"};
    if (!(tables.get("trips_by_id")||[]).some(row=>row.trip_id===assignedId)) {
      for(const table of ["trips_by_id","trips_by_customer","trips_by_driver","trips_by_status"])tables.get(table).push({...assignedTrip});
      tables.get("vehicles").push({vehicle_id:vehicleId,driver_id:d,status:"ACTIVE",vehicle_type:"BIKE",seat_count:2,brand:"Test",model:"Bike",license_plate:"NEW-TEST"});
      tables.get("drivers").find(row=>row.driver_id===d).driver_status="BUSY";
      tables.get("notifications_by_user").push({user_id:d,notification_id:"20000000-0000-4000-8000-000000000063",created_at:at,title:"Bạn có chuyến mới được phân công",content:`Mã chuyến: ${assignedId} · Browser pickup → Browser destination · 12.000 ₫`,notification_type:"TRIP_ASSIGNED",is_read:false});
    }
    response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({tripId:assignedId}));return true;
  }
  return originalEmit.call(this,event,...args);
};
