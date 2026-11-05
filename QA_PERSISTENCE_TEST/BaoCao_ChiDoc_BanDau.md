# Báo cáo kiểm thử lưu dữ liệu RideFlow — giai đoạn chỉ đọc

Ngày: 02/11/2026 (Asia/Saigon). Dự án: `D:\mongodb\DOAN_NOSQL`.

## Phạm vi và giới hạn

Đã kiểm tra cấu trúc src/API/services/repositories/driver, scripts khởi động, các điểm ghi và lưu tạm, cấu hình không bí mật, tiến trình, cổng mạng, metadata Cassandra và một mẫu dữ liệu có sẵn. Inventory SHA256 toàn bộ tệp src nằm trong `MinhChung/SELECT_Baseline.json`; inventory không đồng nghĩa đã kiểm thử mọi nhánh mã.

Không gọi API ghi; không tạo QA_TEST_; không đăng nhập; không chạy ứng dụng, seed/reset/migration/DDL, truncate/drop/delete, flush/drain/snapshot hay restart. Không sửa mã nghiệp vụ hoặc cấu hình. Chỉ thêm bộ báo cáo và auditor SELECT. Chưa kiểm thử toàn bộ hệ thống và chưa chứng minh persistence sau restart.

## Môi trường thực tế

- Cassandra 3.11.17, cluster `Test Cluster`, datacenter1, 127.0.0.1:9042, JMX 7199, PID 11220 tại thời điểm kiểm tra.
- `nodetool status`: một node UN 127.0.0.1. Keyspace `dat_xe_cong_nghe`: SimpleStrategy RF=3, **durable_writes=false**.
- Metadata trực tiếp: 19 bảng, 144 cột; default_time_to_live của cả 19 bảng bằng 0. Chưa kiểm tra TTL từng cell; không suy ra mọi cell đều không có TTL.
- `.env.local`: localOne, journal=false. Không thấy listener Next.js ở cổng 3000/3001 tại thời điểm kiểm tra; chưa loại trừ server ở cổng khác.
- Bản đang chạy: `C:\apache-cassandra-3.11.17`, không phải bản Cassandra trong thư mục D: tài liệu cài đặt.
- Java chạy foreground; không tìm thấy Windows service có tên Cassandra trong lần kiểm tra. Command line có `-Dcassandra.storagedir=C:\apache-cassandra-3.11.17\data`.
- Thư mục SSTable tồn tại: `C:\apache-cassandra-3.11.17\data\data\dat_xe_cong_nghe`. Có commitlog, saved_caches trong storagedir. Không chỉnh sửa các thư mục này.
- Có snapshot tên `1790501865417` của 19 bảng theo nodetool; chưa thử restore, chưa xác nhận đủ dữ liệu mới nhất, chưa có bản sao độc lập đã xác minh. `.backups` của dự án chưa được xác nhận là backup Cassandra.

## Bằng chứng và ID có sẵn

18 SELECT bằng driver thật, không mock; CQL, parameters, timestamp và rows được lưu trong `MinhChung/SELECT_Baseline.json`. Truy vấn metadata chạy trước khi truy vấn bảng nghiệp vụ. Không thu password/hash tài khoản.

| Loại | ID thực tế của dữ liệu CŨ dùng làm baseline |
|---|---|
| Customer | 902b9b2e-45be-54ee-8248-465613351c5c |
| Driver | 884dc18e-b40c-5575-bcbf-ca24aa59334f |
| Vehicle | 02c11186-abd7-5a00-a0d3-ae22f73c21ec |
| Trip | e9b5de17-94ee-530b-99a6-61d8e6bcba9c |
| Payment | a7e44ca3-91b7-5afd-922d-7f31f6dac20f |
| Review | 8a6b3ab4-0176-5760-8e0e-7c421a0c2f7c |

Trip COMPLETED, booked_at `2026-09-19T13:42:00.000Z`, final_fare 95400. Đọc tối đa 30 canonical trips để chọn một mẫu, không quét kiểm tra toàn bộ database. Mẫu này có các projection khách/tài xế/trạng thái, payment theo trip/customer, revenue/spending theo tháng trả tiền và review theo trip/driver phù hợp các trường đã so sánh. Không chứng minh các bản ghi còn lại hoặc dữ liệu tạo mới.

## Bản đồ lưu trữ theo mã nguồn

| Chức năng | Đường ghi / nguồn dữ liệu |
|---|---|
| Đăng ký customer | auth/register → registration.registerCustomer → INSERT customers |
| Đăng ký driver/xe | registration.registerDriver → logged batch drivers + vehicles, liên kết driver_id; driver mới PENDING/OFFLINE, cần Admin duyệt ACTIVE trước luồng nhận chuyến |
| Hồ sơ customer/driver | UPDATE customers/drivers theo UUID qua API; chưa chạy thực tế |
| Xe | GET driver vehicle đọc vehicles; route này chỉ có GET. Cần phân biệt khả năng cập nhật qua Admin với tự chỉnh sửa xe ở portal Driver |
| Trạng thái driver | business-resources.setDriverAvailability → UPDATE drivers |
| Booking | trips.bookTrip → demoMutation → logged batch trips_by_id/customer/driver/status, history, drivers, notifications; voucher nếu có |
| Nhận/chuyển trạng thái/hoàn thành | trips.changeTripStatus → prepareDemoStatus, cập nhật projections; COMPLETED thêm payment và thống kê nếu đã thanh toán |
| Thanh toán demo | payments.preparePaymentWrites → payments_by_trip/customer; PAID/PAID_DEMO ghi driver_revenue_by_month + customer_spending_by_month |
| Đánh giá | API review → reviews_by_trip/driver và drivers.rating |
| Khiếu nại/thông báo | complaints_by_customer, notifications_by_user; đọc/ghi theo owner và clustering keys |
| Admin | Đọc Cassandra; tài khoản Admin từ cấu hình server, không có bảng admin trong 19 bảng |
| Browser sessionStorage | mutation-request lưu payload + Idempotency-Key của request chờ; NotificationBell lưu dấu đã hiện thông báo; không thay Cassandra làm kho chuyến/payment |
| Server memory | demo-mutation Map lưu retry plan/result/pending và hàng đợi; driver-assignment-lock, registration queue, maps cache nằm trong tiến trình |

Không phát hiện localStorage trong src bằng tìm kiếm. React state hiển thị form/loading/response không phải bằng chứng dữ liệu bền vững. Không phát hiện seed/reset/DDL được gọi trong dev/start/instrumentation/next.config; package chỉ khai báo lệnh seed chạy riêng. Chưa chứng minh hành vi runtime sau khởi động.

`npm test` dùng tests/register.mjs thay cassandra-driver bằng fixture; kết quả đó không được dùng làm PASS lưu Cassandra. Không chạy test hiện có vì chưa cần cho giai đoạn chỉ đọc và chưa sửa nghiệp vụ.

## Trả lời 5 câu hỏi

1. Có dữ liệu thật trong Cassandra và source có đường ghi thật. Chưa xác minh website tạo dữ liệu mới thành công.
2. Chưa xác nhận dữ liệu mới tồn tại sau tắt web: BLOCKED chờ cho phép tạo test, khởi chạy app và kiểm thử browser/restart.
3. Chưa xác nhận sau tắt/bật Cassandra: BLOCKED; durable_writes=false là rủi ro, không phải bằng chứng đã mất dữ liệu.
4. Chưa tái hiện mất dữ liệu/quay lại seed. Không thấy auto-seed trong startup source. Có rủi ro retry/khôi phục sau restart và giới hạn danh sách gây không thấy bản ghi.
5. Ưu tiên xử lý/kiểm chứng durable_writes, cơ chế retry sau restart, RF/quorum và khả năng Admin tìm thấy dữ liệu ngoài LIMIT. Xem báo cáo lỗi để phân biệt phát hiện cấu hình, phân tích mã và lỗi đã tái hiện.

## Kế hoạch tiếp theo cần xác nhận

Chưa đủ cơ sở gọi môi trường an toàn để tạo test hoặc restart: tên Test Cluster không xác nhận đây là database riêng; có dữ liệu hiện hữu và backup chưa thử restore. Cần người dùng xác nhận keyspace này là demo cho phép thêm dữ liệu QA_TEST_, cho phép bật Next.js và nêu phạm vi tác động được chấp thuận. Chấp thuận tạo test không mặc nhiên chấp thuận restart Cassandra.

Sau xác nhận: dùng customer/driver mới có tên QA_TEST_<runId>, email riêng; số điện thoại/biển số tuân validator, không ép QA_TEST_ vào trường không cho phép. Lưu đầy đủ ID và các khóa booked_at/paid_at/created_at/trip_date/year_month thực tế. Driver PENDING phải được Admin duyệt. Booking tự chọn ngẫu nhiên driver AVAILABLE: không thay trạng thái tài xế hiện hữu để ép chọn QA; cần môi trường cô lập bảo đảm chỉ tài xế QA phù hợp. Admin cần thông tin đăng nhập do người dùng cung cấp qua kênh phù hợp, không ghi mật khẩu vào báo cáo.

Mỗi bước phải qua UI thật, ghi response/ID, SELECT đúng khóa và đối chiếu các projection; thêm screenshot thật. Lần lượt F5, logout/login, đóng toàn bộ browser/mở lại, dừng Next bình thường/chạy lại. Sau mỗi bước SELECT chính những ID đó, không lấy seed làm mẫu thay thế.

Restart Cassandra là bước riêng: cần backup độc lập và thử restore trong môi trường cô lập trước; snapshot hiện có chưa đáp ứng. Sau xác nhận riêng, ngừng ghi ứng dụng, lưu baseline, dùng nodetool drain và chờ hoàn tất, rồi Ctrl+C tại console Cassandra và chờ thoát sạch; không dùng taskkill/Stop-Process/force kill. Khởi chạy bản `C:\apache-cassandra-3.11.17\bin\cassandra.bat` với môi trường Java hiện tại, chờ nodetool status UN và SELECT system.local thành công. SELECT lại ID QA/projections, đăng nhập lại và chụp UI. Đây là quy trình dự kiến chưa chạy, không bảo đảm PASS. Nếu không điều khiển được console, dừng và để người dùng thực hiện; không tự thay cơ chế dừng.

Restart máy thủ công: chỉ sau backup/restore xác minh, dừng ghi, drain và đóng Cassandra sạch, dừng Next bằng Ctrl+C; dùng Restart Windows bình thường. Sau mở máy chạy Cassandra trước, kiểm tra UN/SELECT rồi chạy Next và đăng nhập/SELECT lại toàn bộ ID QA. Không mô phỏng mất điện, không xóa data/commitlog/snapshot và không sửa cấu hình.

Tài liệu giải thích durable_writes: [Apache Cassandra DDL](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html), [Storage Engine](https://cassandra.apache.org/doc/stable/cassandra/architecture/storage-engine.html). `durable_writes` quyết định dùng commit log cho keyspace; không được suy diễn rằng đã có mất dữ liệu chỉ từ cấu hình này.
