# Báo cáo kiểm thử lưu dữ liệu RideFlow — demo độc lập

Ngày 02/11/2026 (Asia/Saigon). Run **QA_TEST_ISO_20261102124130**. Đây là kết quả mới nhất; các bản báo cáo trước demo được lưu với tiền tố LichSu_Truoc_DemoDocLap_.

## Kết luận

**Đã kiểm chứng dữ liệu nghiệp vụ tồn tại sau restart Cassandra demo sạch.** Customer/Driver/xe đăng ký từ UI, chuyến được đặt/nhận/chuyển trạng thái/hoàn thành, payment chuyển khoản mô phỏng được xác nhận, review5 sao và doanh thu đều lưu Cassandra. Sau restart Next và Cassandra demo, SELECT cùng UUID/PK và UI Customer/Driver/Admin vẫn đọc đúng. Toàn bộ **335/335 row demo** có hash như baseline.

**Không kết luận tương tự cho Cassandra gốc có durable_writes=false**: node đó không restart và không thay đổi. 902 row, schema và cấu hình keyspace gốc vẫn giữ nguyên. Đã tái hiện lỗi LIMIT100, không sửa source trong lần kiểm thử này.

## 1. Phương án cô lập

| Thuộc tính | Môi trường gốc, giữ nguyên | Demo độc lập đã tạo |
|---|---|---|
| Cassandra |3.11.17 / Test Cluster|3.11.17 / RideFlow_QA_20261102|
| CQL |127.0.0.1:9042|127.0.0.2:9142|
| JMX |7199|7299|
| Storage |7000|7100, seed chỉ127.0.0.2|
| Keyspace |dat_xe_cong_nghe|rideflow_qa_demo|
| RF / durable_writes |3 / false|1 / true|
| Next |localhost:3100|localhost:3200, source copy riêng|
| Data/commitlog/log/config |C:/apache-cassandra-3.11.17/...|QA_PERSISTENCE_TEST/Private/isolated/...|

Keyspace demo trên cùng node chỉ cô lập logic; restart node vẫn ảnh hưởng database gốc. Vì phải thử restart nên chọn instance riêng. Hai instance vẫn chia sẻ CPU/RAM/ổ đĩa vật lý; không gọi đây là cô lập phần cứng hoặc môi trường đo hiệu năng. Kiểm tra trước: khoảng5.3GB RAM trống, hơn150GB disk trống; demo heap768MB.

Chỉ lấy metadata19 bảng/144 cột, giữ loại dữ liệu, PK và clustering order. Không nhập row cũ hoặc password/hash cũ. Không chạy seed-demo-data.mjs hay file CQL seed cũ; schema_only_demo.cql chứa duy nhất CREATE dành cho keyspace demo và chỉ được chạy sau guard cluster_name. Admin demo dùng credential ngẫu nhiên mới; login bằng form, không JWT giả. Service BIKE tạo qua UI Admin. Các định danh UUID không đổi định dạng; dấu QA_TEST_ nằm trong tên actor, mô tả dịch vụ, review và fixture manifest. Địa chỉ là lựa chọn geocode thật.

112 tệp src gốc/copy cùng SHA256; không sửa logic backend để PASS. Chỉ cấu hình turbopack.root của bản copy để dùng dependency đã cài và các biến môi trường của process demo được tách riêng, không copy .env.local.

## 2. Dữ liệu mới thực tế

| Đối tượng | ID |
|---|---|
|Customer|09265dc8-410b-4042-9e43-59c8647bde6f|
|Driver|392d085f-b7b4-4aa7-8377-61dd3b6a1754|
|Vehicle|59b10962-9c0e-442f-aa78-e450ea4177d5|
|Service|81c18f56-f75c-4140-9917-7b8a6ed512db|
|Trip|3aaf340f-cdd0-4cf1-b323-084d54951754|
|Payment|84b9d71f-8180-4f09-abc7-e04e0dd8faf2|
|Review|3bb62c0c-c3fa-4038-810c-5b6e42dac391|

Chuyến Chợ Bến Thành → Dinh Độc Lập, tuyến OSRM1.6km, giá18000đ. Payment BANK_TRANSFER, trạng thái cuối PAID_DEMO; không chuyển tiền thật. Review5 sao. Driver từ PENDING được Admin duyệt ACTIVE, bật AVAILABLE, chuyển BUSY khi booking và về AVAILABLE khi hoàn thành. [ID/khóa đầy đủ](MinhChung/Isolated_20261102/QA_IDs.json).

## 3. Luồng đã kiểm thử thật

Đăng ký Customer, Driver và xe qua form; login Admin mới, duyệt Driver, tạo dịch vụ. Customer chọn địa chỉ qua Photon, route qua OSRM, đặt chuyến bằng form. Driver nhận/chuyển BOOKED → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED qua UI với hộp xác nhận thật.

Hoàn thành tạo payment PENDING. Customer bấm Tôi đã chuyển khoản → PENDING_CONFIRMATION; Driver bấm Xác nhận đã nhận tiền → PAID_DEMO. SELECT xác nhận payment theo trip/customer, không còn row provisional trùng và revenue/spending đúng18000. Customer gửi review; hai bảng review và rating Driver đều khớp5.

Mỗi mốc có screenshot UI và SELECT theo PK thực từ schema. Các bảng kiểm tra: customers, drivers, vehicles, trips_by_id/customer/driver/status, trip_status_history, payments_by_trip/customer, reviews_by_trip/driver, driver_revenue_by_month, customer_spending_by_month, notifications_by_user. Khi chuyển trạng thái, partition trạng thái cũ không còn row của chuyến, partition hiện hành có đúng1 row.

Admin đọc đúng trip/payment sau restart; dashboard có tripCount1, completedTrips1, revenue18000, averageRating5. CustomerRecords/DriverRecords bị giới hạn100 thay vì106; API có nêu giới hạn nên không gọi đó là tổng toàn cluster. Driver đọc lịch sử COMPLETED, doanh thu18000 và review5 sau DB restart.

## 4. Restart và bằng chứng

- F5, logout/login: cùng trip/payment/review vẫn đọc được bằng UI và SELECT.
- Restart Next demo: Ctrl+C, xác minh cổng3200 không phản hồi, khởi chạy cùng cấu hình;335 row giữ nguyên hash.
- Trước restart DB: lưu SELECT theo UUID, baseline335 row; snapshot demo và copy166 file sang backup riêng có checksum khớp, kèm schema-only. **Chưa diễn tập restore**; đây là giới hạn riêng được ghi NOT TESTED.
- Đóng browser QA để ngừng polling. Drain duy nhất JMX7299, log ghi DRAINING lúc19:55:45 và DRAINED lúc19:55:47 (UTC+7). Sau đó Ctrl+C đúng console demo, không force kill; cổng9142/7299 tắt trong khi9042/7199 vẫn PID11220.
- Bật lại đúng demo config/data/commitlog; chờ SELECT được và nodetool UN. Host ID vẫn4ca6b4c4-33a3-4505-b9cf-aa2a92019821, PID demo đã đổi.
- Đối chiếu335/335 row, không mất/thay đổi hash; cấu hình RF1/durable_writes=true vẫn đúng. Login lại Customer/Driver/Admin và đối chiếu UI/API cùng ID.

[SELECT trước](MinhChung/Isolated_20261102/select-before-restart_SELECT.json), [SELECT sau](MinhChung/Isolated_20261102/check-after-cassandra_SELECT.json), [so sánh toàn bộ row](MinhChung/Isolated_20261102/comparison_after-cassandra.json), [ảnh đối chiếu SELECT](MinhChung/Isolated_20261102/SELECT_compact_comparison.png), [UI sau restart](MinhChung/Isolated_20261102/check-after-cassandra_trip.png).

Ảnh SELECT là screenshot trình xem kết quả driver thật, ghi rõ không phải cqlsh. Ảnh đối chiếu gọn được dựng sau kiểm thử từ JSON có timestamp trước/sau; JSON và screenshot gốc trước restart vẫn giữ. Không sao chép ảnh từ các lần demo cũ.

Giới hạn kết luận: restart sạch đã drain/flush và có snapshot; **không chứng minh crash recovery, commitlog replay khi mất điện, failover nhiều node hoặc độ bền mọi loại sự cố**. Không test force kill. durable_writes=true tương thích3.11.17 đã xác minh, nhưng lần test không cô lập riêng tác dụng commit log vì dữ liệu đã flush trong shutdown sạch.

## 5. AVAILABLE sai và LIMIT100

Trong luồng bình thường, trạng thái Driver luôn BUSY khi có chuyến và AVAILABLE sau COMPLETED. Một negative test cố ý đổi trạng thái QA driver thành AVAILABLE khi canonical trip còn ACCEPTED, chỉ trong demo: UI availability trả409, thử booking tiếp qua API có xác thực trả409 và số trip không tăng. Fixture được khôi phục về BUSY trước khi tiếp tục. Không kết luận code hiện tại tự tạo trạng thái sai. Sáu driver sai của database gốc là phát hiện cũ, không chỉnh dữ liệu.

Để kiểm tra ngưỡng100, tạo105 bộ Customer/Driver/xe giả mới bằng fixture INSERT có guard cluster demo, tổng mỗi bảng106. Đây là dữ liệu chuẩn bị tải, **không báo105 bộ này là đăng ký UI**. Admin/API chỉ trả100; tìm Customer bị loại khỏi trang không thấy dù row còn trong DB. Một Driver QA_TEST_LIMIT_ đăng nhập có API /vehicle trả[] trong khi SELECT exact vehicle_id có1 row. [Kết quả](MinhChung/Isolated_20261102/limit_100_results.json), [ảnh lỗi xe](MinhChung/Isolated_20261102/limit_driver_own_vehicle_missing.png).

## 6. Ưu tiên sửa

1. **P1: vehicle theo Driver bị cắt bởi global LIMIT100.** Cần query đúng access pattern theo Driver; giải pháp demo ngắn hạn là đọc đủ pagination rồi lọc có giới hạn rõ ràng, không coi bản ghi ngoài100 là không tồn tại. Query table mới cần review schema riêng.
2. **P1/P2: Admin customers/drivers/vehicles không có cách xem đủ/search ngoài100.** Thêm pagination thực và tìm kiếm phù hợp schema; không chỉ tăng LIMIT. Kiểm thử regression106/1001 row và actor chính sau sửa.
3. **P0 về mục tiêu durability của môi trường gốc:** durable_writes=false vẫn giữ nguyên. Đề xuất backup/restore được duyệt trước khi thay cấu hình; kết quả demo không tự sửa hoặc bảo đảm node gốc.
4. **P1: đối soát dữ liệu Driver cũ và retry qua restart.** Journal=false, retry cache trong RAM vẫn là rủi ro chưa tái hiện timeout/retry; chưa sửa source hoặc dữ liệu lịch sử.

[Bảng PASS/FAIL/NOT TESTED](BangKetQua_Test.md): PASS 29, FAIL 4, BLOCKED 0, NOT TESTED 6. Không còn blocker cho luồng demo chính được yêu cầu; các giới hạn chưa thử được nêu riêng, không tính PASS.

## 7. Trả lời yêu cầu cuối

1. Có ghi Cassandra thật: đã kiểm chứng đầy đủ luồng demo qua UI và SELECT.
2. Có giữ dữ liệu sau refresh/logout/login/restart Next trong phạm vi run này.
3. **Có giữ dữ liệu sau restart Cassandra demo sạch**,335/335 row không đổi. Chưa thử restart Cassandra gốc.
4. Không phát hiện row quay về seed; đã phát hiện bản ghi bị ẩn bởi LIMIT100. Phân biệt lỗi truy vấn/hiển thị với mất dữ liệu vật lý.
5. Cần xử lý lỗi vehicle và pagination trước bảo vệ; giải trình/tách rõ durable_writes, RF và giới hạn restart sạch.

## 8. Word và trạng thái môi trường

Đã chuẩn bị [nội dung mục3.6](BoSung_Word_Muc_3_6/NoiDung_Muc_3_6.md), [ảnh/chú thích](BoSung_Word_Muc_3_6/DanhMuc_Anh_VaChuThich.md) và ảnh riêng để review. **Chưa sửa bất kỳ.docx nào**; hash ba file Word được đối chiếu giữ nguyên.

Demo được giữ để xem lại: Next http://127.0.0.1:3200, Cassandra127.0.0.2:9142. Data/backup ở Private/isolated, không dọn xóa. Thông tin đăng nhập demo ở Private/isolated/demo-env.json và isolated-run.json, không đưa vào báo cáo/ảnh. Node gốc vẫn chạy riêng.

Tài liệu chính thức: [Cassandra3.11 configuration](https://cassandra.apache.org/doc/3.11/cassandra/configuration/cass_yaml_file.html), [nodetool](https://cassandra.apache.org/doc/3.11/cassandra/tools/nodetool/nodetool.html).
