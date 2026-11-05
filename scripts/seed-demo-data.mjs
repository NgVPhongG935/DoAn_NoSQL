import { createHash } from "node:crypto";
import cassandra from "cassandra-driver";

const demoPasswordHash = "scrypt$f9e282eaebaa6106c022f3aa16eab0c1$ef9ea05a3b034fafc22fa66e1059237ad98cfc67926953052a730e4ee2a4837fd89f0311e0e9d7a47d62c022cb552306f5cbc388b96e05aba96192e17b9fc423";

const tables = [
  "customers", "drivers", "vehicles", "service_types", "trips_by_id",
  "trips_by_customer", "trips_by_driver", "trips_by_status", "trip_status_history",
  "payments_by_trip", "payments_by_customer", "reviews_by_trip", "reviews_by_driver",
  "vouchers", "customer_vouchers", "complaints_by_customer", "notifications_by_user",
  "driver_revenue_by_month", "customer_spending_by_month",
];
const demoCustomerId = "4bae3c1f-2dce-4210-bd2d-829f0bf4a7ef";
const demoDriverId = "dde73e75-5100-4169-8593-9cf8b9c7df83";
const customerNames = [
  "Nguyễn Minh Anh", "Trần Gia Bảo", "Lê Hoàng Yến", "Phạm Đức Huy", "Võ Thảo Linh",
  "Đặng Quốc Bảo", "Bùi Ngọc Mai", "Đỗ Khánh Vy", "Hồ Tuấn Kiệt", "Nguyễn Phương Thảo",
  "Trần Đức Anh", "Lê Bảo Ngọc", "Phạm Minh Khang", "Võ Gia Hân", "Đặng Nhật Nam",
  "Bùi Thanh Trúc", "Đỗ Anh Khoa", "Hồ Mỹ Duyên", "Nguyễn Quang Huy", "Trần Hồng Nhung",
  "Lê Thành Đạt", "Phạm Ngọc Hà", "Võ Minh Nhật", "Đặng Thùy Dương", "Bùi Tiến Đạt",
];
const driverNames = [
  "Trần Quốc Bảo", "Nguyễn Văn Hùng", "Lê Minh Tuấn", "Phạm Hoàng Long", "Võ Thành Trung",
  "Đặng Minh Khoa", "Bùi Quốc Thịnh", "Đỗ Anh Dũng", "Hồ Văn Phúc", "Nguyễn Hải Nam",
  "Trần Đức Thành", "Lê Quang Vinh",
];
const routes = [
  ["Chợ Bến Thành, Quận 1", "Nhà thờ Đức Bà, Quận 1"],
  ["Sân bay Tân Sơn Nhất, Tân Bình", "Landmark 81, Bình Thạnh"],
  ["Phố đi bộ Nguyễn Huệ, Quận 1", "Bến xe Miền Đông mới, TP. Thủ Đức"],
  ["Đại học Bách Khoa, Quận 10", "Dinh Độc Lập, Quận 1"],
  ["Thảo Điền, TP. Thủ Đức", "Chợ Bến Thành, Quận 1"],
  ["Crescent Mall, Quận 7", "Bưu điện Thành phố, Quận 1"],
  ["Bệnh viện Chợ Rẫy, Quận 5", "Đại học Quốc gia, TP. Thủ Đức"],
  ["Công viên Tao Đàn, Quận 1", "Nhà văn hóa Thanh Niên, Quận 1"],
  ["Khu đô thị Phú Mỹ Hưng, Quận 7", "Sân bay Tân Sơn Nhất, Tân Bình"],
  ["Ga Sài Gòn, Quận 3", "Landmark 81, Bình Thạnh"],
];
const tripStatuses = [
  ...Array(43).fill("COMPLETED"), "CANCELLED", "CANCELLED",
  "BOOKED", "BOOKED", "BOOKED", "ACCEPTED", "ACCEPTED", "ARRIVING", "IN_PROGRESS", "IN_PROGRESS",
];
const statusPath = {
  COMPLETED: ["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED"],
  CANCELLED: ["BOOKED", "CANCELLED"],
  BOOKED: ["BOOKED"],
  ACCEPTED: ["BOOKED", "ACCEPTED"],
  ARRIVING: ["BOOKED", "ACCEPTED", "ARRIVING"],
  IN_PROGRESS: ["BOOKED", "ACCEPTED", "ARRIVING", "IN_PROGRESS"],
};
const statusNotes = {
  BOOKED: "Khách hàng tạo yêu cầu chuyến đi",
  ACCEPTED: "Tài xế đã nhận chuyến",
  ARRIVING: "Tài xế đang đến điểm đón",
  IN_PROGRESS: "Chuyến đi đã bắt đầu",
  COMPLETED: "Chuyến đi hoàn thành",
  CANCELLED: "Chuyến đi đã được hủy",
};
const paymentMethods = ["CASH", "CARD", "WALLET"];
const knownTables = new Set(tables);
const keyspace = process.env.CASSANDRA_KEYSPACE || "dat_xe_cong_nghe";
const client = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS || "127.0.0.1")
    .split(",").map((host) => host.trim()).filter(Boolean),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER || "datacenter1",
  protocolOptions: { port: Number(process.env.CASSANDRA_PORT || 9042) },
  keyspace,
  queryOptions: { consistency: cassandra.types.consistencies.localOne },
});

function stableUuid(label) {
  const bytes = createHash("sha256").update(`RideFlow demo: ${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const localDate = (value) => cassandra.types.LocalDate.fromDate(value);

function makeCustomers() {
  return customerNames.map((fullName, index) => ({
    id: index === 0 ? demoCustomerId : stableUuid(`customer:${index + 1}`),
    fullName,
    email: index === 0 ? "khach01@example.com" : `customer${String(index + 1).padStart(2, "0")}@rideflow.demo`,
    phone: `090${String(1000000 + index * 1379).slice(-7)}`,
    createdAt: new Date(Date.UTC(2026, 1, 1 + index)),
  }));
}

function makeDrivers() {
  return driverNames.map((fullName, index) => ({
    id: index === 0 ? demoDriverId : stableUuid(`driver:${index + 1}`),
    fullName,
    email: index === 0 ? "taixe01@example.com" : `driver${String(index + 1).padStart(2, "0")}@rideflow.demo`,
    phone: `091${String(2000000 + index * 1783).slice(-7)}`,
    licenseNumber: `GPLX-RF-${String(index + 1).padStart(4, "0")}`,
  }));
}

const services = [
  { id: stableUuid("service:BIKE"), name: "BIKE", baseFare: 12000, pricePerKm: 4500, description: "Xe máy - linh hoạt trong phố" },
  { id: stableUuid("service:CAR_4"), name: "CAR_4", baseFare: 25000, pricePerKm: 11000, description: "Ô tô 4 chỗ - thoải mái mỗi ngày" },
  { id: stableUuid("service:CAR_7"), name: "CAR_7", baseFare: 35000, pricePerKm: 14500, description: "Ô tô 7 chỗ - rộng rãi cho nhóm" },
];
const customers = makeCustomers();
const drivers = makeDrivers();
const vehicles = drivers.map((driver, index) => {
  const vehicleType = index < 6 ? "BIKE" : index < 10 ? "CAR_4" : "CAR_7";
  const details = vehicleType === "BIKE"
    ? { brand: "Honda", model: ["Vision", "Air Blade", "Future"][index % 3], seats: 2, color: ["Đen", "Đỏ", "Trắng"][index % 3] }
    : vehicleType === "CAR_4"
      ? { brand: index % 2 ? "Hyundai" : "Toyota", model: index % 2 ? "Accent" : "Vios", seats: 4, color: index % 2 ? "Bạc" : "Trắng" }
      : { brand: "Mitsubishi", model: "Xpander", seats: 7, color: "Ghi" };
  return { id: stableUuid(`vehicle:${index + 1}`), driverId: driver.id, vehicleType, ...details, plate: `${index < 6 ? "59" : "51"}${String.fromCharCode(65 + index)}-${String(10000 + index * 137).slice(-5)}` };
});
const vouchers = Array.from({ length: 10 }, (_, index) => ({
  code: `RFDEMO26-${String(index + 1).padStart(2, "0")}`,
  name: ["Chào bạn mới", "Đi phố cuối tuần", "Hành trình xanh", "Ưu đãi tháng 9", "Bạn đồng hành"][index % 5],
  discountType: index % 3 === 0 ? "FIXED" : "PERCENT",
  discountValue: index % 3 === 0 ? 20000 + (index % 2) * 10000 : 10 + (index % 4) * 5,
  maxDiscount: 50000,
  minimum: 50000 + (index % 3) * 25000,
  quantity: 100 - index * 5,
  startDate: new Date(Date.UTC(2026, 8, 1)),
  endDate: new Date(Date.UTC(2026, 10, 30, 23, 59, 59)),
}));

function makeTrips() {
  return tripStatuses.map((status, index) => {
    const demoFlow = index === 45;
    const customer = customers[demoFlow ? 0 : (index * 7 + 3) % customers.length];
    const driver = drivers[demoFlow ? 0 : (index * 5 + 2) % drivers.length];
    const vehicle = vehicles.find((item) => item.driverId === driver.id);
    const service = services.find((item) => item.name === vehicle.vehicleType);
    const [pickup, destination] = routes[(index * 3 + 1) % routes.length];
    const distance = [3.8, 5.2, 6.4, 8.1, 11.3, 14.6, 18.2, 22.5][index % 8];
    const fare = Math.round(service.baseFare + service.pricePerKm * distance);
    const day = index < 43 ? 1 + (index % 24) : 26;
    const bookedAt = new Date(Date.UTC(2026, 8, day, 7 + (index % 12), (index * 11) % 60));
    const events = statusPath[status].map((eventStatus, eventIndex) => ({
      status: eventStatus,
      changedAt: new Date(bookedAt.getTime() + eventIndex * 5 * 60 * 1000),
      note: statusNotes[eventStatus],
    }));
    return {
      id: stableUuid(`trip:${String(index + 1).padStart(3, "0")}`),
      customerId: customer.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      serviceId: service.id,
      pickup,
      destination,
      distance,
      fare,
      status,
      bookedAt,
      startedAt: events.find((event) => event.status === "IN_PROGRESS")?.changedAt || null,
      completedAt: status === "COMPLETED" ? events.at(-1).changedAt : null,
      paymentMethod: paymentMethods[index % paymentMethods.length],
      events,
    };
  });
}
const trips = makeTrips();

async function insert(table, columns, values) {
  if (!knownTables.has(table)) throw new Error(`Unapproved table name: ${table}`);
  await client.execute(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    values,
    { prepare: true },
  );
}

async function assertSchemaAndEmpty() {
  const schema = await client.execute(
    "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?",
    [keyspace],
    { prepare: true },
  );
  const present = new Set(schema.rows.map((row) => row.table_name));
  const missing = tables.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Thiếu bảng trong ${keyspace}: ${missing.join(", ")}. Không có gì được ghi.`);

  const nonEmpty = [];
  for (const table of tables) {
    const result = await client.execute(`SELECT * FROM ${table} LIMIT 1`);
    if (result.rowLength > 0) nonEmpty.push(table);
  }
  if (nonEmpty.length) {
    throw new Error(`Seed dừng an toàn: bảng đã có dữ liệu: ${nonEmpty.join(", ")}. Không có gì được ghi.`);
  }
}

async function seed() {
  await assertSchemaAndEmpty();
  const dryRun = process.argv.includes("--dry-run");
  const plan = {
    customers: customers.length,
    drivers: drivers.length,
    vehicles: vehicles.length,
    services: services.length,
    trips: trips.length,
    completedTrips: trips.filter((trip) => trip.status === "COMPLETED").length,
    vouchers: vouchers.length,
    customerVoucherAssignments: customers.length * 2 + 3,
    complaints: 8,
    notifications: customers.length + drivers.length,
  };
  console.log(`${dryRun ? "DRY RUN" : "EMPTY KEYSPACE VERIFIED"} ${keyspace}: ${JSON.stringify(plan)}`);
  if (dryRun) return;

  for (const customer of customers) {
    await insert("customers", ["customer_id", "full_name", "phone", "email", "password", "created_at", "status"],
      [customer.id, customer.fullName, customer.phone, customer.email, demoPasswordHash, customer.createdAt, "ACTIVE"]);
  }
  for (const service of services) {
    await insert("service_types", ["service_id", "service_name", "base_fare", "price_per_km", "description", "status"],
      [service.id, service.name, String(service.baseFare), String(service.pricePerKm), service.description, "ACTIVE"]);
  }
  for (const voucher of vouchers) {
    await insert("vouchers", ["voucher_code", "voucher_name", "discount_type", "discount_value", "max_discount", "min_trip_amount", "start_date", "end_date", "quantity", "status"],
      [voucher.code, voucher.name, voucher.discountType, String(voucher.discountValue), String(voucher.maxDiscount), String(voucher.minimum), voucher.startDate, voucher.endDate, voucher.quantity, "ACTIVE"]);
  }

  const ratingsByDriver = new Map(drivers.map((driver) => [driver.id, []]));
  for (const trip of trips) {
    await insert("trips_by_id", ["trip_id", "customer_id", "driver_id", "vehicle_id", "service_id", "pickup_address", "destination_address", "distance_km", "estimated_fare", "final_fare", "booked_at", "started_at", "completed_at", "status", "payment_method"],
      [trip.id, trip.customerId, trip.driverId, trip.vehicleId, trip.serviceId, trip.pickup, trip.destination, trip.distance, String(trip.fare), String(trip.fare), trip.bookedAt, trip.startedAt, trip.completedAt, trip.status, trip.paymentMethod]);
    await insert("trips_by_customer", ["customer_id", "booked_at", "trip_id", "driver_id", "pickup_address", "destination_address", "final_fare", "status"],
      [trip.customerId, trip.bookedAt, trip.id, trip.driverId, trip.pickup, trip.destination, String(trip.fare), trip.status]);
    await insert("trips_by_driver", ["driver_id", "booked_at", "trip_id", "customer_id", "pickup_address", "destination_address", "final_fare", "status"],
      [trip.driverId, trip.bookedAt, trip.id, trip.customerId, trip.pickup, trip.destination, String(trip.fare), trip.status]);
    await insert("trips_by_status", ["status", "trip_date", "booked_at", "trip_id", "customer_id", "driver_id", "pickup_address", "destination_address", "final_fare"],
      [trip.status, localDate(trip.bookedAt), trip.bookedAt, trip.id, trip.customerId, trip.driverId, trip.pickup, trip.destination, String(trip.fare)]);
    for (const event of trip.events) {
      await insert("trip_status_history", ["trip_id", "changed_at", "status", "note"], [trip.id, event.changedAt, event.status, event.note]);
    }

    if (trip.status !== "COMPLETED") continue;
    const paymentId = stableUuid(`payment:${trip.id}`);
    const paidAt = new Date(trip.completedAt.getTime() + 4 * 60 * 1000);
    await insert("payments_by_trip", ["trip_id", "payment_id", "customer_id", "amount", "payment_method", "payment_status", "paid_at"],
      [trip.id, paymentId, trip.customerId, String(trip.fare), trip.paymentMethod, "PAID", paidAt]);
    await insert("payments_by_customer", ["customer_id", "paid_at", "payment_id", "trip_id", "amount", "payment_method", "payment_status"],
      [trip.customerId, paidAt, paymentId, trip.id, String(trip.fare), trip.paymentMethod, "PAID"]);
    const yearMonth = trip.completedAt.toISOString().slice(0, 7);
    const tripDate = localDate(trip.completedAt);
    await insert("driver_revenue_by_month", ["driver_id", "year_month", "trip_date", "trip_id", "fare"],
      [trip.driverId, yearMonth, tripDate, trip.id, String(trip.fare)]);
    await insert("customer_spending_by_month", ["customer_id", "year_month", "trip_date", "trip_id", "amount"],
      [trip.customerId, yearMonth, tripDate, trip.id, String(trip.fare)]);

    const rating = trip.id.charCodeAt(0) % 7 === 0 ? 4 : 5;
    const reviewId = stableUuid(`review:${trip.id}`);
    const reviewedAt = new Date(paidAt.getTime() + 9 * 60 * 1000);
    const comment = rating === 5 ? "Tài xế thân thiện, chuyến đi rất thoải mái." : "Đón đúng giờ, hành trình an toàn.";
    await insert("reviews_by_trip", ["trip_id", "review_id", "customer_id", "driver_id", "rating", "comment", "created_at"],
      [trip.id, reviewId, trip.customerId, trip.driverId, rating, comment, reviewedAt]);
    await insert("reviews_by_driver", ["driver_id", "created_at", "review_id", "trip_id", "customer_id", "rating", "comment"],
      [trip.driverId, reviewedAt, reviewId, trip.id, trip.customerId, rating, comment]);
    ratingsByDriver.get(trip.driverId).push(rating);
  }

  for (let index = 0; index < drivers.length; index += 1) {
    const driver = drivers[index];
    const ratings = ratingsByDriver.get(driver.id);
    const rating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 4.8;
    await insert("drivers", ["driver_id", "full_name", "phone", "email", "password", "license_number", "rating", "driver_status", "account_status", "created_at"],
      [driver.id, driver.fullName, driver.phone, driver.email, demoPasswordHash, driver.licenseNumber, Number(rating.toFixed(2)), "AVAILABLE", "ACTIVE", new Date(Date.UTC(2026, 1, 1 + index))]);
  }
  for (const vehicle of vehicles) {
    await insert("vehicles", ["vehicle_id", "driver_id", "license_plate", "vehicle_type", "brand", "model", "color", "seat_count", "status"],
      [vehicle.id, vehicle.driverId, vehicle.plate, vehicle.vehicleType, vehicle.brand, vehicle.model, vehicle.color, vehicle.seats, "ACTIVE"]);
  }

  for (let index = 0; index < customers.length; index += 1) {
    const customer = customers[index];
    const assignments = index === 0
      ? [{ voucher: vouchers[0], used: true }, { voucher: vouchers[3], used: false }, { voucher: vouchers[4], used: false }, { voucher: vouchers[6], used: false }, { voucher: vouchers[7], used: false }]
      : [0, 1].map((offset) => ({ voucher: vouchers[(index + offset * 3) % vouchers.length], used: (index + offset) % 4 === 0 }));
    for (const { voucher, used } of assignments) {
      await insert("customer_vouchers", ["customer_id", "voucher_code", "received_at", "used_at", "status"],
        [customer.id, voucher.code, new Date(Date.UTC(2026, 8, 3 + index % 20)), used ? new Date(Date.UTC(2026, 8, 12 + index % 12)) : null, used ? "USED" : "AVAILABLE"]);
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const customer = customers[index];
    const customerTrip = trips.find((trip) => trip.customerId === customer.id && trip.status === "COMPLETED");
    const complaintId = stableUuid(`complaint:${index + 1}`);
    const createdAt = new Date(Date.UTC(2026, 8, 20 + index % 6, 10 + index, 15));
    const status = ["OPEN", "PROCESSING", "RESOLVED"][index % 3];
    const subject = ["Hỗ trợ hành lý", "Kiểm tra cước phí", "Góp ý chất lượng dịch vụ"][index % 3];
    await insert("complaints_by_customer", ["customer_id", "created_at", "complaint_id", "trip_id", "subject", "content", "status", "resolved_at"],
      [customer.id, createdAt, complaintId, customerTrip?.id || null, subject, "Tôi cần RideFlow hỗ trợ kiểm tra lại thông tin của chuyến đi này.", status, status === "RESOLVED" ? new Date(createdAt.getTime() + 2 * 60 * 60 * 1000) : null]);
  }
  const notificationTargets = [
    ...customers.map((user) => ({ id: user.id, role: "khách hàng" })),
    ...drivers.map((user) => ({ id: user.id, role: "tài xế" })),
  ];
  for (let index = 0; index < notificationTargets.length; index += 1) {
    const user = notificationTargets[index];
    const createdAt = new Date(Date.UTC(2026, 8, 25, 8 + (index % 12), (index * 5) % 60));
    await insert("notifications_by_user", ["user_id", "created_at", "notification_id", "title", "content", "notification_type", "is_read"],
      [user.id, createdAt, stableUuid(`notification:${user.id}`), "Chào mừng đến với RideFlow", `Tài khoản ${user.role} của bạn đã sẵn sàng cho hành trình mới.`, "SYSTEM", index % 3 === 0]);
  }

  console.log("Seed hoàn tất. Chỉ có INSERT sau khi xác nhận đủ 19 bảng rỗng.");
  console.log(`Demo Customer: ${customers[0].email} / ${customers[0].id}`);
  console.log(`Demo Driver: ${drivers[0].email} / ${drivers[0].id}`);
}

try {
  await client.connect();
  await seed();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.shutdown();
}
