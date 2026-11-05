CREATE KEYSPACE rideflow_qa_demo WITH replication = {'class':'SimpleStrategy','replication_factor':1} AND durable_writes = true;

CREATE TABLE rideflow_qa_demo.complaints_by_customer (complaint_id uuid, content text, created_at timestamp, customer_id uuid, resolved_at timestamp, status text, subject text, trip_id uuid, PRIMARY KEY (customer_id, created_at, complaint_id)) WITH CLUSTERING ORDER BY (created_at DESC, complaint_id ASC);

CREATE TABLE rideflow_qa_demo.customer_spending_by_month (amount decimal, customer_id uuid, trip_date date, trip_id uuid, year_month text, PRIMARY KEY ((customer_id, year_month), trip_date, trip_id)) WITH CLUSTERING ORDER BY (trip_date DESC, trip_id ASC);

CREATE TABLE rideflow_qa_demo.customer_vouchers (customer_id uuid, received_at timestamp, status text, used_at timestamp, voucher_code text, PRIMARY KEY (customer_id, voucher_code)) WITH CLUSTERING ORDER BY (voucher_code ASC);

CREATE TABLE rideflow_qa_demo.customers (created_at timestamp, customer_id uuid, email text, full_name text, password text, phone text, status text, PRIMARY KEY (customer_id));

CREATE TABLE rideflow_qa_demo.driver_revenue_by_month (driver_id uuid, fare decimal, trip_date date, trip_id uuid, year_month text, PRIMARY KEY ((driver_id, year_month), trip_date, trip_id)) WITH CLUSTERING ORDER BY (trip_date DESC, trip_id ASC);

CREATE TABLE rideflow_qa_demo.drivers (account_status text, created_at timestamp, driver_id uuid, driver_status text, email text, full_name text, license_number text, password text, phone text, rating double, PRIMARY KEY (driver_id));

CREATE TABLE rideflow_qa_demo.notifications_by_user (content text, created_at timestamp, is_read boolean, notification_id uuid, notification_type text, title text, user_id uuid, PRIMARY KEY (user_id, created_at, notification_id)) WITH CLUSTERING ORDER BY (created_at DESC, notification_id ASC);

CREATE TABLE rideflow_qa_demo.payments_by_customer (amount decimal, customer_id uuid, paid_at timestamp, payment_id uuid, payment_method text, payment_status text, trip_id uuid, PRIMARY KEY (customer_id, paid_at, payment_id)) WITH CLUSTERING ORDER BY (paid_at DESC, payment_id ASC);

CREATE TABLE rideflow_qa_demo.payments_by_trip (amount decimal, customer_id uuid, paid_at timestamp, payment_id uuid, payment_method text, payment_status text, trip_id uuid, PRIMARY KEY (trip_id, payment_id)) WITH CLUSTERING ORDER BY (payment_id ASC);

CREATE TABLE rideflow_qa_demo.reviews_by_driver (comment text, created_at timestamp, customer_id uuid, driver_id uuid, rating int, review_id uuid, trip_id uuid, PRIMARY KEY (driver_id, created_at, review_id)) WITH CLUSTERING ORDER BY (created_at DESC, review_id ASC);

CREATE TABLE rideflow_qa_demo.reviews_by_trip (comment text, created_at timestamp, customer_id uuid, driver_id uuid, rating int, review_id uuid, trip_id uuid, PRIMARY KEY (trip_id));

CREATE TABLE rideflow_qa_demo.service_types (base_fare decimal, description text, price_per_km decimal, service_id uuid, service_name text, status text, PRIMARY KEY (service_id));

CREATE TABLE rideflow_qa_demo.trip_status_history (changed_at timestamp, note text, status text, trip_id uuid, PRIMARY KEY (trip_id, changed_at)) WITH CLUSTERING ORDER BY (changed_at DESC);

CREATE TABLE rideflow_qa_demo.trips_by_customer (booked_at timestamp, customer_id uuid, destination_address text, driver_id uuid, final_fare decimal, pickup_address text, status text, trip_id uuid, PRIMARY KEY (customer_id, booked_at, trip_id)) WITH CLUSTERING ORDER BY (booked_at DESC, trip_id ASC);

CREATE TABLE rideflow_qa_demo.trips_by_driver (booked_at timestamp, customer_id uuid, destination_address text, driver_id uuid, final_fare decimal, pickup_address text, status text, trip_id uuid, PRIMARY KEY (driver_id, booked_at, trip_id)) WITH CLUSTERING ORDER BY (booked_at DESC, trip_id ASC);

CREATE TABLE rideflow_qa_demo.trips_by_id (booked_at timestamp, completed_at timestamp, customer_id uuid, destination_address text, distance_km double, driver_id uuid, estimated_fare decimal, final_fare decimal, payment_method text, pickup_address text, service_id uuid, started_at timestamp, status text, trip_id uuid, vehicle_id uuid, PRIMARY KEY (trip_id));

CREATE TABLE rideflow_qa_demo.trips_by_status (booked_at timestamp, customer_id uuid, destination_address text, driver_id uuid, final_fare decimal, pickup_address text, status text, trip_date date, trip_id uuid, PRIMARY KEY ((status, trip_date), booked_at, trip_id)) WITH CLUSTERING ORDER BY (booked_at DESC, trip_id ASC);

CREATE TABLE rideflow_qa_demo.vehicles (brand text, color text, driver_id uuid, license_plate text, model text, seat_count int, status text, vehicle_id uuid, vehicle_type text, PRIMARY KEY (vehicle_id));

CREATE TABLE rideflow_qa_demo.vouchers (discount_type text, discount_value decimal, end_date timestamp, max_discount decimal, min_trip_amount decimal, quantity int, start_date timestamp, status text, voucher_code text, voucher_name text, PRIMARY KEY (voucher_code));