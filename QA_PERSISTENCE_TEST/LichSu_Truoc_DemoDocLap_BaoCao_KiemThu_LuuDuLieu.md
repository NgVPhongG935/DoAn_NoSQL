# Báo cáo kiểm thử lưu dữ liệu RideFlow

Cập nhật 02/11/2026, Asia/Saigon. Run: **QA_TEST_20261102121343**. Đây là kết quả mới nhất; [báo cáo chỉ đọc ban đầu](BaoCao_ChiDoc_BanDau.md) được giữ làm lịch sử, không dùng các trạng thái BLOCKED cũ thay cho kết quả lần này.

## Kết luận thực tế

RideFlow đã ghi thật Customer, Driver, xe và khiếu nại QA vào Cassandra qua các form của website. Hồ sơ Customer sau đổi tên và khiếu nại vẫn tồn tại sau F5, logout/login, đóng/mở lại Edge và khởi động lại Next.js. SELECT vẫn đọc được dữ liệu khi Next.js đã tắt. Không thấy những bản ghi QA đã kiểm tra biến mất hoặc quay về seed.

**Chưa chứng minh booking/thanh toán/hoàn thành/đánh giá qua website, và chưa kiểm thử restart Cassandra. Không báo PASS cho các phần này.**

## An toàn và phạm vi đã thực hiện

Trước ghi, SELECT phân trang 19 bảng, lưu SHA256 từng row theo PK; kiểm tra không trùng email/phone/biển số. Luồng registration/profile đã đọc để xác nhận không gửi email/SMS và không ghi tài khoản cũ. Dùng Edge thật qua CDP, profile riêng, Next dev thực tại http://127.0.0.1:3100; không dùng mock driver, ui-transport, JWT giả hay API ghi thay cho submit form.

Đối chiếu cuối: **898 bản ghi cũ không sửa, không mất**, chỉ thêm 1 customers + 1 drivers + 1 vehicles + 1 complaints_by_customer. 112 tệp src có SHA256 giữ nguyên so với audit ban đầu. Không sửa source nghiệp vụ, schema, RF, durable_writes hoặc cấu hình database; không seed/reset/xóa/truncate/drop/flush/drain/snapshot; không restart Cassandra. Các file mới chỉ thuộc bộ QA và build/cache Next phát sinh bình thường.

Driver QA giữ PENDING/OFFLINE, không tham gia phân chuyến. Complaint không có trip_id nên không liên kết chuyến thật, không hoàn tiền. Tên, giấy phép, brand/model có QA_TEST_; phone và biển số dùng định dạng validator hợp lệ, đối chiếu không trùng thay vì nhét tiền tố vào trường số.

## ID mới thực tế

| Loại | ID / khóa |
|---|---|
| Customer | 9bfe09c0-f7a2-4dfd-9170-5150e48be477 |
| Driver | 91857c4a-2cdc-4d43-8401-28c4cb00dc44 |
| Vehicle | 729edc21-e7c3-40e3-9495-ff8f71a32597 |
| Complaint | 32bcd6aa-8bf0-462c-876c-30513e2a5474 |
| Complaint created_at | 2026-11-02T12:22:40.390Z |
| Trip/payment/review | Chưa tạo, không có ID QA |

Tên Customer cuối: **QA_TEST_20261102121343_CUSTOMER_UPDATED**. Driver mới PENDING/OFFLINE. Complaint OPEN. [Manifest](MinhChung/Run_20261102/QA_IDs.json) không chứa mật khẩu; thông tin đăng nhập QA được giữ ở Private/qa-run.json, Private đã được thêm vào .gitignore. Không chia sẻ thư mục Private cùng báo cáo.

## Trình tự kiểm thử và bằng chứng

1. Health Cassandra thật HTTP 200; đăng ký Customer qua form HTTP 201 và SELECT customer_id. Đăng nhập qua form HTTP 200.
2. Đổi full_name qua form hồ sơ thành hậu tố _UPDATED; SELECT customers xác nhận.
3. Đăng ký Driver + xe qua form HTTP 201; SELECT từng UUID và driver_id liên kết. Login Driver vào màn chờ duyệt đúng trạng thái PENDING.
4. Tạo complaint qua form Customer, không chọn chuyến; HTTP 201, SELECT theo đủ customer_id + created_at + complaint_id.
5. F5, logout/login, Browser.close rồi mở lại Edge và login: UI tên _UPDATED/complaint OPEN và SELECT cùng PK vẫn khớp.
6. Next được dừng bình thường bằng Ctrl+C hai lần. Cổng app không phản hồi khi dừng, SELECT QA vẫn thành công. Chạy lại bằng cùng lệnh/config và login: dữ liệu không đổi. Lần thứ hai bao gồm complaint tạo bổ sung. PID Next 4456 → 14528 → xem next2_after_restart_processes.json; Cassandra giữ PID 11220 xuyên suốt.
7. Đọc UI/API danh sách trips/payments/notifications của Customer QA và SELECT partition: đều trống đúng thực tế, không được tính là đã kiểm thử tạo chuyến, thanh toán hoặc sinh notification. Đối chiếu lại toàn bộ row cũ.

Có **46 screenshot thực tế** trong [MinhChung/Run_20261102](MinhChung/Run_20261102/). Screenshot SELECT chụp một trang xem bằng chứng cục bộ trình bày kết quả SELECT thật từ driver, không giả là màn UI RideFlow hoặc cửa sổ cqlsh. JSON kèm CQL/parameters/rows là bằng chứng gốc.

Các mốc quan trọng: [Customer đã sửa](MinhChung/Run_20261102/customer_06_profile_saved.png), [sau Next restart](MinhChung/Run_20261102/customer-after-next-restart_profile_before.png), [complaint sau Next restart](MinhChung/Run_20261102/customer-after-next-restart_complaints.png), [SELECT sau restart](MinhChung/Run_20261102/customer-after-next-restart_SELECT.json), [SELECT khi web tắt](MinhChung/Run_20261102/next_stopped_SELECT.json), [đối chiếu dữ liệu cũ](MinhChung/Run_20261102/99_existing_rows_comparison.json).

## Kết quả theo vai trò

- Customer: PASS đăng ký/login/sửa tên/gửi complaint và persistence phạm vi trên. PASS đọc các danh sách trống. BLOCKED booking, payment, review vì chưa thể tạo chuyến cô lập.
- Driver: PASS đăng ký/login chờ duyệt, xe liên kết và các row tồn tại sau Next restart. BLOCKED duyệt, hồ sơ sau duyệt, availability, nhận/chạy/hoàn thành chuyến và doanh thu do chưa có Admin hợp lệ và môi trường booking riêng. Portal đang PENDING chặn truy cập nghiệp vụ; không gọi API ghi để vượt màn chờ duyệt.
- Admin: BLOCKED, chưa có phiên đăng nhập thật được cung cấp. SELECT tài khoản mới không thay cho kiểm tra màn Admin/dashboard. Không thay Admin config hoặc tạo JWT để vượt xác thực.
- Toàn bộ bảng test: PASS 19, FAIL 3, BLOCKED 23, NOT TESTED 1. [Bảng kết quả](BangKetQua_Test.md) nêu chính xác phạm vi mỗi dòng.

## Phát hiện cấu hình và dữ liệu cũ

SELECT cuối vẫn cho durable_writes=false, SimpleStrategy RF=3. nodetool status hiện chỉ một node UN; app dùng localOne. durable_writes=false bỏ qua commit log của keyspace, có rủi ro mất ghi chưa flush khi dừng bất thường; **không có mất dữ liệu đã tái hiện**. Kết quả Next restart không chứng minh chịu restart/crash Cassandra. [Apache DDL](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/ddl.html), [Storage Engine](https://cassandra.apache.org/doc/stable/cassandra/architecture/storage-engine.html).

RF=3 là cấu hình mong muốn số replica, không phải bằng chứng có ba bản sao trên một node. Với một replica sẵn sàng, localOne có thể phục vụ; quorum RF=3 cần 2 replica, nên không thể dựa vào cluster hiện tại để tuyên bố quorum/failover. Đây là phân tích cấu hình, chưa thử QUORUM request và không tự sửa RF.

Có 6 Driver cũ AVAILABLE nhưng canonical trips vẫn hoạt động, trong đó driver dde73e75-5100-4169-8593-9cf8b9c7df83 có hai chuyến hoạt động. Đã thấy trước khi QA ghi và SELECT lại theo PK; không do test mới. Mã booking hiện có kiểm tra active trip để bỏ qua driver đó, nhưng dữ liệu hiện hữu vẫn bất nhất. Chưa xác định nguồn phát sinh từ seed/phiên bản cũ hay thao tác trước. Không tự đối soát ghi.

Journal=false nên retry plan/idempotency trong Map mất qua Next restart: rủi ro phân tích mã, chưa tái hiện mất response/booking trùng. Admin/vehicle LIMIT 100 cũng là giới hạn cần kiểm thử thêm, chưa tái hiện bản ghi bị ẩn trong dataset nhỏ hiện tại.

## Vì sao chưa thể kiểm thử booking an toàn

BIKE, CAR_4 và CAR_7 đều có Driver không thuộc QA đang đủ điều kiện. Booking chọn ngẫu nhiên rồi cập nhật driver BUSY, tạo history/notification và khi hoàn thành ghi revenue/payment. Không có cơ chế QA-only hiện có. Dùng customer mới đơn thuần không cô lập tác động này. Không tắt driver cũ, không giả response/maps/driver, không chèn trip trực tiếp vì như vậy không kiểm thử luồng website thật hoặc ảnh hưởng dữ liệu cũ.

## Phương án chuẩn bị phần còn lại — chưa thực hiện

Đề xuất một Cassandra demo **riêng hoàn toàn**, không restart node hiện tại: process/container mới, native port 9142 và thư mục dữ liệu/commitlog riêng dưới D:/mongodb/QA_RIDEFLOW_ISOLATED/, xác minh cổng và đường dẫn trước khi tạo. Tái tạo schema 19 bảng từ metadata đã đọc, chỉ tạo service cần thiết và tài khoản QA qua luồng ứng dụng, không sao chép người dùng/chuyến cũ và không chạy seed cũ. Một Next instance riêng trỏ tới Cassandra demo bằng biến môi trường của process, không sửa .env.local hoặc node/keyspace hiện tại. Admin demo phải được cung cấp hoặc cấu hình riêng được cho phép; không dùng JWT giả. Khi đó mới tạo/duyệt driver QA và chạy trọn booking → nhận → hoàn thành → payment → review → persistence, SELECT mọi projection.

**Việc dựng schema/config cho môi trường mới nằm ngoài quyền hiện tại**, vì người dùng chưa cho sửa schema/cấu hình database. Bản đề xuất này chỉ là kế hoạch, chưa tạo process Cassandra, schema, seed hoặc thay cổng DB. Có thể dùng một môi trường demo cô lập sẵn do người dùng cung cấp thay thế. Không đổi cấu hình app hiện tại để chỉ chọn QA rồi coi đó là bằng chứng hành vi nguyên bản.

Đề xuất durable_writes: sau khi có backup độc lập và thử restore thành công, quản trị viên đánh giá bật durable_writes=true theo thay đổi keyspace được duyệt. Đề xuất RF: chọn một-node demo RF phù hợp hoặc dựng đủ node/replica trước khi đòi quorum; mọi thay đổi cần review và kế hoạch riêng, không thực hiện lần này. Snapshot cũ đã thấy chưa được thử restore; không coi là backup đủ tin cậy để restart DB.

## Trả lời cuối cùng

1. **Có lưu thật**, đã chứng minh cho Customer, Driver, xe và complaint mới từ UI.
2. **Có tồn tại sau tắt/bật Next.js** với những dữ liệu QA trên; hồ sơ và complaint còn qua logout/login và mở browser lại.
3. **Chưa biết sau tắt/bật Cassandra** — BLOCKED và chưa được phép thử.
4. **Không thấy quay về seed/mất dữ liệu trong phạm vi đã thử**; không mở rộng kết luận sang trip/payment/review chưa tạo hoặc Cassandra chưa restart.
5. **Trước bảo vệ:** xử lý/giải trình durable_writes, đối soát sáu driver cũ, kiểm thử retry bền vững, thống nhất RF/node; mở khóa môi trường booking riêng và Admin để hoàn tất ma trận nghiệp vụ. Chi tiết trong [lỗi và hướng xử lý](LoiPhatHien_VaHuongXuLy.md).

Next.js được để chạy ở localhost:3100 để người dùng tiếp tục xem. Cassandra hiện tại giữ nguyên. Các tài khoản QA/khiếu nại không bị dọn xóa.
