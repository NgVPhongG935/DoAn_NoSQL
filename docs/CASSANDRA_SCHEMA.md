# Cassandra schema: dat_xe_cong_nghe

Đọc trực tiếp từ system_schema.columns vào 2026-10-24T12:56:15.896Z. Đây là metadata của Cassandra đang chạy, không chỉ là suy luận từ CQL.

Số bảng được phát hiện: **19**. Không có thao tác DDL hoặc thay đổi dữ liệu.

## `complaints_by_customer`

**PRIMARY KEY (`customer_id`, `created_at`, `complaint_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `customer_id` | `uuid` | partition_key | 0 |
| `created_at` | `timestamp` | clustering | 0 / desc |
| `complaint_id` | `uuid` | clustering | 1 / asc |
| `content` | `text` | regular | - |
| `resolved_at` | `timestamp` | regular | - |
| `status` | `text` | regular | - |
| `subject` | `text` | regular | - |
| `trip_id` | `uuid` | regular | - |

## `customer_spending_by_month`

**PRIMARY KEY ((`customer_id`, `year_month`), `trip_date`, `trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `customer_id` | `uuid` | partition_key | 0 |
| `year_month` | `text` | partition_key | 1 |
| `trip_date` | `date` | clustering | 0 / desc |
| `trip_id` | `uuid` | clustering | 1 / asc |
| `amount` | `decimal` | regular | - |

## `customer_vouchers`

**PRIMARY KEY (`customer_id`, `voucher_code`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `customer_id` | `uuid` | partition_key | 0 |
| `voucher_code` | `text` | clustering | 0 / asc |
| `received_at` | `timestamp` | regular | - |
| `status` | `text` | regular | - |
| `used_at` | `timestamp` | regular | - |

## `customers`

**PRIMARY KEY (`customer_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `customer_id` | `uuid` | partition_key | 0 |
| `created_at` | `timestamp` | regular | - |
| `email` | `text` | regular | - |
| `full_name` | `text` | regular | - |
| `password` | `text` | regular | - |
| `phone` | `text` | regular | - |
| `status` | `text` | regular | - |

## `driver_revenue_by_month`

**PRIMARY KEY ((`driver_id`, `year_month`), `trip_date`, `trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `driver_id` | `uuid` | partition_key | 0 |
| `year_month` | `text` | partition_key | 1 |
| `trip_date` | `date` | clustering | 0 / desc |
| `trip_id` | `uuid` | clustering | 1 / asc |
| `fare` | `decimal` | regular | - |

## `drivers`

**PRIMARY KEY (`driver_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `driver_id` | `uuid` | partition_key | 0 |
| `account_status` | `text` | regular | - |
| `created_at` | `timestamp` | regular | - |
| `driver_status` | `text` | regular | - |
| `email` | `text` | regular | - |
| `full_name` | `text` | regular | - |
| `license_number` | `text` | regular | - |
| `password` | `text` | regular | - |
| `phone` | `text` | regular | - |
| `rating` | `double` | regular | - |

## `notifications_by_user`

**PRIMARY KEY (`user_id`, `created_at`, `notification_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `user_id` | `uuid` | partition_key | 0 |
| `created_at` | `timestamp` | clustering | 0 / desc |
| `notification_id` | `uuid` | clustering | 1 / asc |
| `content` | `text` | regular | - |
| `is_read` | `boolean` | regular | - |
| `notification_type` | `text` | regular | - |
| `title` | `text` | regular | - |

## `payments_by_customer`

**PRIMARY KEY (`customer_id`, `paid_at`, `payment_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `customer_id` | `uuid` | partition_key | 0 |
| `paid_at` | `timestamp` | clustering | 0 / desc |
| `payment_id` | `uuid` | clustering | 1 / asc |
| `amount` | `decimal` | regular | - |
| `payment_method` | `text` | regular | - |
| `payment_status` | `text` | regular | - |
| `trip_id` | `uuid` | regular | - |

## `payments_by_trip`

**PRIMARY KEY (`trip_id`, `payment_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `trip_id` | `uuid` | partition_key | 0 |
| `payment_id` | `uuid` | clustering | 0 / asc |
| `amount` | `decimal` | regular | - |
| `customer_id` | `uuid` | regular | - |
| `paid_at` | `timestamp` | regular | - |
| `payment_method` | `text` | regular | - |
| `payment_status` | `text` | regular | - |

## `reviews_by_driver`

**PRIMARY KEY (`driver_id`, `created_at`, `review_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `driver_id` | `uuid` | partition_key | 0 |
| `created_at` | `timestamp` | clustering | 0 / desc |
| `review_id` | `uuid` | clustering | 1 / asc |
| `comment` | `text` | regular | - |
| `customer_id` | `uuid` | regular | - |
| `rating` | `int` | regular | - |
| `trip_id` | `uuid` | regular | - |

## `reviews_by_trip`

**PRIMARY KEY (`trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `trip_id` | `uuid` | partition_key | 0 |
| `comment` | `text` | regular | - |
| `created_at` | `timestamp` | regular | - |
| `customer_id` | `uuid` | regular | - |
| `driver_id` | `uuid` | regular | - |
| `rating` | `int` | regular | - |
| `review_id` | `uuid` | regular | - |

## `service_types`

**PRIMARY KEY (`service_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `service_id` | `uuid` | partition_key | 0 |
| `base_fare` | `decimal` | regular | - |
| `description` | `text` | regular | - |
| `price_per_km` | `decimal` | regular | - |
| `service_name` | `text` | regular | - |
| `status` | `text` | regular | - |

## `trip_status_history`

**PRIMARY KEY (`trip_id`, `changed_at`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `trip_id` | `uuid` | partition_key | 0 |
| `changed_at` | `timestamp` | clustering | 0 / desc |
| `note` | `text` | regular | - |
| `status` | `text` | regular | - |

## `trips_by_customer`

**PRIMARY KEY (`customer_id`, `booked_at`, `trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `customer_id` | `uuid` | partition_key | 0 |
| `booked_at` | `timestamp` | clustering | 0 / desc |
| `trip_id` | `uuid` | clustering | 1 / asc |
| `destination_address` | `text` | regular | - |
| `driver_id` | `uuid` | regular | - |
| `final_fare` | `decimal` | regular | - |
| `pickup_address` | `text` | regular | - |
| `status` | `text` | regular | - |

## `trips_by_driver`

**PRIMARY KEY (`driver_id`, `booked_at`, `trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `driver_id` | `uuid` | partition_key | 0 |
| `booked_at` | `timestamp` | clustering | 0 / desc |
| `trip_id` | `uuid` | clustering | 1 / asc |
| `customer_id` | `uuid` | regular | - |
| `destination_address` | `text` | regular | - |
| `final_fare` | `decimal` | regular | - |
| `pickup_address` | `text` | regular | - |
| `status` | `text` | regular | - |

## `trips_by_id`

**PRIMARY KEY (`trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `trip_id` | `uuid` | partition_key | 0 |
| `booked_at` | `timestamp` | regular | - |
| `completed_at` | `timestamp` | regular | - |
| `customer_id` | `uuid` | regular | - |
| `destination_address` | `text` | regular | - |
| `distance_km` | `double` | regular | - |
| `driver_id` | `uuid` | regular | - |
| `estimated_fare` | `decimal` | regular | - |
| `final_fare` | `decimal` | regular | - |
| `payment_method` | `text` | regular | - |
| `pickup_address` | `text` | regular | - |
| `service_id` | `uuid` | regular | - |
| `started_at` | `timestamp` | regular | - |
| `status` | `text` | regular | - |
| `vehicle_id` | `uuid` | regular | - |

## `trips_by_status`

**PRIMARY KEY ((`status`, `trip_date`), `booked_at`, `trip_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `status` | `text` | partition_key | 0 |
| `trip_date` | `date` | partition_key | 1 |
| `booked_at` | `timestamp` | clustering | 0 / desc |
| `trip_id` | `uuid` | clustering | 1 / asc |
| `customer_id` | `uuid` | regular | - |
| `destination_address` | `text` | regular | - |
| `driver_id` | `uuid` | regular | - |
| `final_fare` | `decimal` | regular | - |
| `pickup_address` | `text` | regular | - |

## `vehicles`

**PRIMARY KEY (`vehicle_id`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `vehicle_id` | `uuid` | partition_key | 0 |
| `brand` | `text` | regular | - |
| `color` | `text` | regular | - |
| `driver_id` | `uuid` | regular | - |
| `license_plate` | `text` | regular | - |
| `model` | `text` | regular | - |
| `seat_count` | `int` | regular | - |
| `status` | `text` | regular | - |
| `vehicle_type` | `text` | regular | - |

## `vouchers`

**PRIMARY KEY (`voucher_code`)**

| Column | Type | Role | Position / order |
|---|---|---|---|
| `voucher_code` | `text` | partition_key | 0 |
| `discount_type` | `text` | regular | - |
| `discount_value` | `decimal` | regular | - |
| `end_date` | `timestamp` | regular | - |
| `max_discount` | `decimal` | regular | - |
| `min_trip_amount` | `decimal` | regular | - |
| `quantity` | `int` | regular | - |
| `start_date` | `timestamp` | regular | - |
| `status` | `text` | regular | - |
| `voucher_name` | `text` | regular | - |

