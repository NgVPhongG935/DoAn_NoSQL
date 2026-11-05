# Lỗi phát hiện và hướng xử lý

Cập nhật 02/11/2026 sau kiểm thử UI thật: đã thêm 4 bản ghi QA (customer, driver, vehicle, complaint), sửa tên đúng Customer QA; 898 bản ghi cũ không đổi. Chưa sửa source nghiệp vụ/schema/config DB. Không tái hiện mất dữ liệu sau refresh, login lại, đóng/mở Edge hoặc restart Next trong phạm vi hồ sơ/complaint đã thử. Restart Cassandra chưa được phép.

## F01 — durability không đáp ứng mục tiêu chống mất ghi khi dừng bất thường

Mức ưu tiên P0. Phát hiện thực tế: SELECT system_schema.keyspaces trả durable_writes=false. Tái hiện bằng SELECT trong SELECT_Baseline.json, không cần ghi dữ liệu. Với cấu hình này, ghi keyspace bỏ qua commit log; ghi chưa flush có rủi ro mất khi node/máy dừng bất thường. Dừng sạch có flush khác với crash; chưa kiểm thử cả hai. FAIL cho tiêu chí cấu hình durable writes, không đánh FAIL các test restart chưa chạy.

Đề xuất quản trị: sau backup và xác nhận riêng, đánh giá bật durable_writes=true; đây là thay đổi keyspace ngoài phạm vi sửa source, KHÔNG thực hiện. Kiểm chứng lại metadata và chạy kiểm thử persistence được duyệt. Không hứa thay đổi này bảo đảm tuyệt đối mọi ghi trong mọi kiểu sự cố.

## F02 — retry booking không bền qua Next.js restart

P1, phát hiện qua mã nguồn, chưa tái hiện runtime. .env.local tắt journal; demo-mutation.ts giữ key/body/plan/result/pending chỉ trong globalThis Map. trips.ts tạo tripId UUID mới khi prepare booking. Nếu Cassandra nhận batch nhưng response bị mất, restart Next xóa cache; gửi lại cùng requestKey có thể chuẩn bị tripId mới. Nếu chỉ một QA driver thì có thể bị từ chối vì driver BUSY; nếu còn driver phù hợp thì nguy cơ tạo chuyến thứ hai. Không kết luận mọi restart làm mất chuyến đã ghi.

Cách kiểm thử sau cho phép: tạo request QA trong môi trường cô lập, mô phỏng mất response sau khi DB nhận ghi; lưu key, restart Next sạch, retry cùng key và kiểm tra canonical trip/projection/payment. Yêu cầu đúng một operation nghiệp vụ.

Đề xuất: cơ chế idempotency/operation recovery bền vững. Không chỉ bật cờ journal: bảng rideflow_business_journal chưa tồn tại trong schema 19 bảng; journal đòi quorum nhưng cluster chỉ có một node RF=3. Cần thiết kế/triển khai riêng được duyệt, không tự migration hay hạ consistency để chạy.

## F03 — RF=3 trên cluster một node, localOne

P1, quan sát thực tế qua metadata và nodetool status. RF=3 không chứng minh đang có ba bản sao dữ liệu. Hiện chỉ thấy một node UN, app localOne; không có khả năng chịu mất node đã được chứng minh. Chưa gửi QUORUM probe, không báo timeout quorum là lỗi đã tái hiện.

Đề xuất: thống nhất mô hình demo một node hoặc môi trường nhiều replica trước khi tuyên bố quorum/failover; không đổi RF/schema theo lần audit này.

## F04 — dữ liệu tồn tại nhưng có thể không hiện trên Admin/vehicle

P2, giới hạn mã nguồn chưa tái hiện ở ngưỡng dữ liệu thực. accounts.listCustomers/listDrivers/listVehicles và dashboard đọc LIMIT 100, getVehiclesForDriver lọc danh sách 100 xe; Cassandra LIMIT không bảo đảm lấy bản ghi mới nhất. Khi vượt ngưỡng, đăng ký ghi thành công vẫn có thể không thấy ở Admin hoặc tìm xe theo driver. getTripsForCustomer/Driver giới hạn mặc định 50; reviews theo customer dựa tối đa 100 trips. Dashboard lọc tháng; baseline tháng 09 không dùng để kết luận dashboard tháng 11 bị mất dữ liệu.

Đề xuất tối thiểu cần đánh giá theo từng màn: pagination thật và tìm theo UUID cho hỗ trợ demo; thiết kế query tables cần phê duyệt riêng. Chưa sửa để tránh thay đổi phạm vi/hiệu năng khi chưa tái hiện.

## F05 — chưa cô lập booking, thiếu Admin và chưa cho phép restart Cassandra

Đã mở khóa browser/Next/account-only testing: Next localhost:3100, Edge headless thật qua CDP, profile riêng, 46 screenshot mới và SELECT thật. Không dùng ảnh từ Bai9 hoặc lần kiểm thử cũ. Customer mới và khiếu nại qua form đã được kiểm tra sau logout/login, đóng/mở Edge và restart Next; Driver/vehicle có SELECT sau restart, Driver login PENDING thành công sau lần restart Next thứ nhất.

Vẫn BLOCKED: booking có thể chọn tài xế cũ ở cả 3 dịch vụ, làm đổi trạng thái/notification/revenue dữ liệu cũ; chưa có Admin login được cung cấp để duyệt driver mới và kiểm tra portal Admin. Cassandra restart vẫn chưa được phép và snapshot chưa thử restore. Không giả JWT, không thay Admin config, không chỉnh trạng thái tài xế cũ, không gọi API để vượt UI PENDING.

Phương án chuẩn bị: Cassandra instance demo riêng, port/data dirs riêng, schema từ metadata hiện có, chỉ service và QA actors cần thiết, Next riêng và Admin hợp lệ. Chưa thực hiện do dựng schema/config mới vượt quyền hiện tại; không dùng seed cũ. Kế hoạch cụ thể nằm trong BaoCao_KiemThu_LuuDuLieu.md. Dữ liệu QA hiện tại giữ nguyên để đối chiếu, không dọn xóa.

## F06 — trạng thái tài xế và chuyến hoạt động cũ bất nhất

P1, FAIL dữ liệu thực tế. Trước khi tạo QA đã thấy 6 Driver account ACTIVE, driver_status AVAILABLE trong khi canonical trips_by_id vẫn có BOOKED/ACCEPTED/ARRIVING/IN_PROGRESS. Sau kiểm thử đã SELECT từng driver_id và trip_id xác nhận lại. Driver dde73e75-5100-4169-8593-9cf8b9c7df83 có hai chuyến hoạt động, vi phạm điều kiện một tài xế chỉ có một chuyến hoạt động. Không có trip QA nào được tạo; đây là dữ liệu tồn tại trước test.

Bằng chứng: MinhChung/Run_20261102/00_existing_driver_inconsistencies.json và 99_live_config_and_existing_inconsistencies_SELECT.json. Tái hiện chỉ bằng SELECT trong file thứ hai, theo đầy đủ partition key. 99_existing_rows_comparison.json xác nhận mọi row cũ không bị sửa trong test.

Nguồn gốc chưa xác định: không kết luận seed hay mã phiên bản hiện tại tạo ra. Booking hiện có kiểm tra canonical active trips để bỏ qua ứng viên bận, nên trạng thái AVAILABLE sai không đủ để kết luận mã hiện tại vừa phân trùng. Cần kiểm tra luồng tạo dữ liệu lịch sử và các writer trạng thái. Chuẩn bị danh sách đối soát chỉ đọc, xác minh chuyến nào thực sự kết thúc; chỉ chỉnh dữ liệu sau phê duyệt riêng. Không tự hủy chuyến, đặt BUSY hoặc chạy reconcile ghi.

## Phân biệt lỗi app và lỗi công cụ kiểm thử

Lần đầu automation timeout do selector chọn input upload avatar thay vì ô tên, đồng thời có tab tiện ích browser tự mở. Đã cố định tab, chọn .form-grid input, tắt extensions ở các lần mở browser sau và chạy lại kiểm thử thật thành công. Đây là lỗi harness, không tính FAIL RideFlow. HTTP 404 avatar mặc định không có ảnh tải lên cũng không được coi là lỗi persistence. Không sửa app để làm test PASS.
