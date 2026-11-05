# Bảng kết quả kiểm thử thực tế — 02/11/2026

PASS: 19 · FAIL: 3 · BLOCKED: 23 · NOT TESTED: 1. Mỗi PASS chỉ áp dụng phạm vi mô tả; đọc danh sách trống không chứng minh tạo chuyến/thanh toán thành công. FAIL cấu hình không đồng nghĩa đã tái hiện mất dữ liệu.

| Mã test | Chức năng | Dữ liệu test | Trước restart | Sau restart | Cassandra SELECT | Kết quả |
|---|---|---|---|---|---|---|
| ENV-01 | Next.js + kết nối Cassandra thật | localhost:3100 → 127.0.0.1:9042 | Health HTTP 200 | Health/route hoạt động sau restart | system.local và schema đọc thật | PASS |
| SAFE-01 | Không sửa/xóa bản ghi cũ | 898 rows / 19 bảng | Lưu hash theo mọi PK | Mọi hash cũ giữ nguyên | SELECT phân trang toàn bộ, comparison JSON | PASS |
| SAFE-02 | Không sửa mã ứng dụng | 112 tệp src | SHA256 audit ban đầu | Không tệp src đổi | Không áp dụng | PASS |
| A-01 | Đăng ký Customer bằng form | QA customer UUID trong QA_IDs.json | HTTP 201, row mới | Còn sau Next restart | customers WHERE customer_id = ? | PASS |
| A-02 | Đăng nhập Customer bằng form | Email QA riêng | HTTP 200 / customer dashboard | Đăng nhập lại thành công | Hồ sơ Cassandra cùng UUID | PASS |
| A-03 | Đổi tên hồ sơ Customer bằng form | Tên có hậu tố _UPDATED | PATCH UI thành công + SELECT khớp | Giữ nguyên tên mới | customers theo PK | PASS |
| A-04 | Đặt chuyến mới | Chưa tạo | Không thực hiện | Không thực hiện | Không có tripId QA | BLOCKED |
| A-05 | Lịch sử của chuyến mới | Chưa có chuyến QA | Không thực hiện | Không thực hiện | Chưa có row trip QA | BLOCKED |
| A-05-EMPTY | Đọc danh sách chuyến đang trống | Partition Customer QA | UI không có chuyến, HTTP 200 [] | Vẫn trống đúng DB | trips_by_customer WHERE customer_id = ? → [] | PASS |
| A-06 | Thanh toán mô phỏng | Chưa có chuyến QA | Không thực hiện | Không thực hiện | Không có paymentId QA | BLOCKED |
| A-06-EMPTY | Đọc lịch sử payment đang trống | Partition Customer QA | UI/GET thành công, không có payment | Vẫn trống đúng DB | payments_by_customer WHERE customer_id = ? → [] | PASS |
| A-07 | Đánh giá chuyến hoàn thành | Chưa có chuyến QA | Không thực hiện | Không thực hiện | Không có reviewId QA | BLOCKED |
| A-08 | Gửi khiếu nại không gắn chuyến | QA_TEST_..._SUPPORT | UI tạo thật, HTTP 201, status OPEN | Còn sau các bước thoát và Next restart | complaints_by_customer đủ customer_id/created_at/complaint_id | PASS |
| A-09-EMPTY | Đọc hộp thông báo trống | Partition Customer QA | UI/GET không có thông báo | Vẫn trống đúng DB | notifications_by_user WHERE user_id = ? → [] | PASS |
| A-09-CREATE | Sinh/đánh dấu thông báo mới | Chưa tạo notification QA | Không thực hiện | Không thực hiện | Không có row QA mới | BLOCKED |
| B-01 | Đăng ký Driver và xe bằng form | Driver + vehicle UUID trong manifest | HTTP 201, driver PENDING/OFFLINE | Hai row vẫn còn | drivers/vehicles theo PK, driver_id khớp | PASS |
| B-02 | Login Driver chờ duyệt | Tài khoản Driver QA | HTTP 200, UI chờ duyệt | Login lại sau lần restart Next thứ nhất thành công | Driver PENDING/OFFLINE và xe còn nguyên | PASS |
| B-03 | Duyệt tài xế thành ACTIVE | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-04 | Sửa hồ sơ Driver qua portal | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-05 | Cập nhật phương tiện | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-06 | Bật/tắt nhận chuyến | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-07 | Nhận chuyến | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-08 | Chuyển trạng thái chuyến | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-09 | Hoàn thành chuyến | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| B-10 | Lịch sử và doanh thu chuyến mới | Driver QA PENDING; thiếu phiên Admin | Chưa thực hiện | Chưa thực hiện | Không tạo/đổi dữ liệu cho test này | BLOCKED |
| C-01 | Login Admin | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| C-02 | Xem Customer QA mới | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| C-03 | Xem Driver QA mới | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| C-04 | Xem xe QA mới | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| C-05 | Xem chuyến QA | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| C-06 | Xem payment QA | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| C-07 | Đối chiếu dashboard Admin tăng theo dữ liệu mới | Chưa có phiên Admin đăng nhập thật | Chưa thực hiện | Chưa thực hiện | SELECT tài khoản QA không thay thế test màn Admin | BLOCKED |
| R-01 | Refresh website | Hồ sơ Customer _UPDATED + complaint OPEN | UI + SELECT có row | UI + SELECT giữ nguyên | Đúng UUID Customer và đủ PK complaint | PASS |
| R-02 | Logout/login | Hồ sơ Customer _UPDATED + complaint OPEN | UI + SELECT có row | UI + SELECT giữ nguyên | Đúng UUID Customer và đủ PK complaint | PASS |
| R-03 | Đóng/mở Edge với cùng profile QA | Hồ sơ Customer _UPDATED + complaint OPEN | UI + SELECT có row | UI + SELECT giữ nguyên | Đúng UUID Customer và đủ PK complaint | PASS |
| R-04 | Dừng/chạy lại Next.js | Customer, Driver, xe, complaint QA | Hai lần Ctrl+C; xác nhận HTTP unreachable | PID Next đổi, Cassandra PID không đổi; SELECT/UI có dữ liệu | SELECT được cả lúc Next tắt, rồi sau bật | PASS |
| R-05 | Restart Cassandra | Chưa được cho phép | Không thực hiện | Không thực hiện | Không có bằng chứng sau restart Cassandra | BLOCKED |
| R-06 | Restart Windows | Chưa được cho phép | Không thực hiện | Không thực hiện | Không có bằng chứng sau reboot | BLOCKED |
| I-01 | Hồ sơ/complaint không về seed | Cùng UUID và tên _UPDATED, cùng complaint PK | Row đã sửa/đã tạo | Không mất/không quay về tên cũ trong phạm vi đã thử | Row chính xác ở mọi mốc | PASS |
| I-02 | Liên kết xe QA–Driver QA | vehicle.driver_id = QA driver UUID | Khớp khi đăng ký | Khớp sau Next restart | vehicles WHERE vehicle_id = ? | PASS |
| I-03 | Đồng bộ các projection khi chạy chuyến QA | Không có chuyến QA | Chưa thực hiện | Chưa thực hiện | Mẫu cũ đã SELECT không thay thế test mới | BLOCKED |
| I-04 | Retry booking qua restart khi mất response | Chỉ phân tích mã | Chưa gây lỗi/ghi booking | Chưa thực hiện | Chưa có repro runtime | NOT TESTED |
| CFG-01 | Tiêu chí durable_writes bật | Keyspace đang dùng | durable_writes=false | Giữ nguyên false theo yêu cầu | system_schema.keyspaces | FAIL |
| CFG-02 | Xác minh RF/node/consistency | SimpleStrategy RF=3 / một node UN / localOne | Đã đọc metadata + nodetool | Không đổi cấu hình | Metadata và cluster status; không phải test failover | PASS |
| OLD-01 | Trạng thái tài xế cũ nhất quán với chuyến hoạt động | 6 driver AVAILABLE còn chuyến hoạt động | Phát hiện trước tạo QA | SELECT lại theo PK vẫn có bất nhất | 99_live_config_and_existing_inconsistencies_SELECT.json | FAIL |
| OLD-02 | Một Driver chỉ có tối đa một chuyến hoạt động | Driver cũ dde73e75-5100-4169-8593-9cf8b9c7df83 | Hai canonical trips trạng thái hoạt động | SELECT trực tiếp xác nhận, không sửa | Hai trips_by_id theo trip_id và drivers theo PK | FAIL |

BLOCKED booking: mọi dịch vụ có driver không thuộc QA đủ điều kiện, app tự chọn ngẫu nhiên. Không thay trạng thái hoặc dữ liệu driver cũ. BLOCKED Admin: chưa có tài khoản/phiên đăng nhập được cung cấp; không giả mạo JWT hoặc thay Admin config. Driver mới PENDING chỉ xem được màn chờ duyệt. Cassandra/Windows restart chưa được cho phép.

NOT TESTED: crash, mất điện, nhiều instance, retry mất response và toàn bộ ma trận chuyển trạng thái. Lần đầu công cụ QA timeout vì selector chọn input avatar và tab tiện ích tự mở; đã sửa công cụ, chạy lại thật thành công, không gán lỗi đó cho RideFlow.

Bằng chứng chi tiết: [thư mục run](MinhChung/Run_20261102/), [manifest ID](MinhChung/Run_20261102/QA_IDs.json), [kết quả máy đọc](MinhChung/Run_20261102/TestResults.json).
