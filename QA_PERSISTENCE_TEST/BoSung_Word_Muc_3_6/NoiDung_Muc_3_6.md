# 3.6. Kiểm thử nghiệp vụ và khả năng lưu trữ dữ liệu

> Bản thảo đề xuất, chưa chỉnh file Word. Kết quả áp dụng cho môi trường demo độc lập dưới đây.

## 3.6.1. Mục tiêu và môi trường kiểm thử

Mục tiêu là xác minh thao tác từ website RideFlow ghi dữ liệu thật xuống Apache Cassandra, thay vì chỉ cập nhật state hoặc bộ nhớ trình duyệt. Kiểm thử bao gồm đăng ký Customer/Driver, tạo xe, đặt/nhận/hoàn thành chuyến, thanh toán mô phỏng, đánh giá và kiểm tra dữ liệu sau refresh, đăng nhập lại, restart Next.js và restart Cassandra.

Để không tác động dữ liệu hiện có, hệ thống thử nghiệm dùng Cassandra3.11.17 chạy ở127.0.0.2:9142, cluster RideFlow_QA_20261102, keyspace rideflow_qa_demo; Next.js demo chạy ở localhost:3200. Cấu hình demo dùng SimpleStrategy RF=1 cho một node và durable_writes=true. Cassandra gốc tại127.0.0.1:9042, keyspace dat_xe_cong_nghe, RF=3/durable_writes=false được giữ nguyên và không restart.

Schema demo có19 bảng/144 cột, loại dữ liệu, partition/clustering keys và clustering order khớp metadata môi trường gốc.112 tệp mã nghiệp vụ của bản copy có hash giống bản gốc. Không sao chép tài khoản, password/hash hoặc chuyến cũ. Admin và các tài khoản QA dùng thông tin mới; đăng nhập qua giao diện thật.

## 3.6.2. Quy trình kiểm thử nghiệp vụ

Customer và Driver được đăng ký từ biểu mẫu; phương tiện được tạo cùng hồ sơ Driver và liên kết bằng driver_id. Admin đăng nhập, duyệt hồ sơ PENDING thành ACTIVE, tạo dịch vụ BIKE. Driver bật nhận chuyến. Customer chọn Chợ Bến Thành và Dinh Độc Lập từ kết quả geocode; hệ thống tính tuyến thực tế1.6km và giá18000đ.

Chuyến được xử lý lần lượt BOOKED → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED. Mỗi bước được thực hiện qua UI và đối chiếu SELECT theo các khóa thực tế trong trips_by_id, trips_by_customer, trips_by_driver, trips_by_status và trip_status_history.

Hoàn thành chuyến chuyển khoản tạo payment PENDING. Customer báo đã chuyển khoản mô phỏng, payment chuyển PENDING_CONFIRMATION; Driver xác nhận đã nhận tiền, trạng thái cuối PAID_DEMO. Không có tiền thật được chuyển. Payment được kiểm tra ở cả bảng theo trip và theo customer; doanh thu/chi tiêu chỉ được ghi khi payment được xác nhận, cùng số tiền18000đ. Customer gửi đánh giá5 sao; reviews_by_trip, reviews_by_driver và drivers.rating được đối chiếu.

[Chèn Hình3.6.1–3.6.3 theo DanhMuc_Anh_VaChuThich.md.]

| Đối tượng | UUID dùng đối chiếu xuyên suốt |
|---|---|
|Customer|09265dc8-410b-4042-9e43-59c8647bde6f|
|Driver|392d085f-b7b4-4aa7-8377-61dd3b6a1754|
|Vehicle|59b10962-9c0e-442f-aa78-e450ea4177d5|
|Trip|3aaf340f-cdd0-4cf1-b323-084d54951754|
|Payment|84b9d71f-8180-4f09-abc7-e04e0dd8faf2|
|Review|3bb62c0c-c3fa-4038-810c-5b6e42dac391|

## 3.6.3. Kiểm tra dữ liệu sau khi thoát và khởi động lại

Sau khi hoàn tất nghiệp vụ, hệ thống lưu JSON gồm câu SELECT, parameters, kết quả và timestamp, kèm screenshot thật. Refresh và logout/login không làm đổi tripId, paymentId, reviewId hoặc trạng thái đã lưu. Restart Next.js được thực hiện bằng dừng bình thường Ctrl+C và chạy lại cùng cấu hình; dữ liệu và giao diện vẫn đúng.

Trước restart Cassandra demo, lưu baseline335 row trong19 bảng. Tạo snapshot demo, sao chép166 file và kiểm tra checksum; giữ schema-only riêng. Việc diễn tập restore chưa được thực hiện. Demo được drain qua JMX7299 đến trạng thái DRAINED rồi dừng bằng Ctrl+C, không force kill hoặc giả lập mất điện. Sau bật lại đúng thư mục dữ liệu, chờ node UN và SELECT thành công.

Kết quả đối chiếu sau restart: **335/335 row giữ nguyên hash**, host ID và cấu hình keyspace không đổi. SELECT cùng UUID xác nhận trip COMPLETED, payment PAID_DEMO/18000đ, review5 sao; các projection, doanh thu và chi tiêu nhất quán. Customer, Driver và Admin đăng nhập lại và đọc được dữ liệu nghiệp vụ tương ứng.902 row/schema/cấu hình keyspace gốc không đổi; node gốc vẫn PID11220.

[Chèn Hình3.6.4–3.6.6.]

## 3.6.4. Kiểm thử dữ liệu bất nhất và giới hạn truy vấn

Để kiểm tra điều kiện Driver AVAILABLE trong khi còn chuyến hoạt động, tạo có chủ đích trạng thái sai trên Driver QA trong demo. API đổi availability từ chối409; thử đặt thêm chuyến cũng bị từ chối409 và số trip không tăng. Fixture được khôi phục trước khi tiếp tục chuyến. Kết quả cho thấy guard hiện tại chặn tình huống đã thử; không chứng minh toàn bộ trường hợp cạnh tranh nhiều server hoặc nguyên nhân dữ liệu sai trong môi trường gốc.

Đối với giới hạn100, tạo105 bộ fixture giả QA mới trong demo, tổng cộng106 Customer/Driver/xe mỗi bảng. Các fixture được INSERT trực tiếp để chuẩn bị ngưỡng, không được tính là đăng ký qua UI. Admin chỉ tải100/106 row. Một Driver không thấy phương tiện của mình vì hàm tìm xe lọc từ global list đã LIMIT100, trong khi SELECT theo vehicle_id vẫn có row đúng. Đây là lỗi truy vấn/hiển thị, không phải mất dữ liệu Cassandra. Cần sửa access pattern theo Driver và pagination thực của Admin.

[Chèn Hình3.6.7–3.6.8 nếu đưa phần lỗi vào nội dung chính; nếu không, chuyển vào phụ lục.]

## 3.6.5. Đánh giá kết quả và giới hạn

Các bước đăng ký, đặt/nhận/chuyển/hoàn thành chuyến, thanh toán BANK_TRANSFER mô phỏng, đánh giá, lịch sử/doanh thu và restart sạch đều PASS trong run demo độc lập. Bốn kiểm tra truy cập dữ liệu vượt LIMIT100 là FAIL thực tế. Không sửa lỗi nghiệp vụ hoặc schema môi trường gốc trong lần thử.

Kết luận: RideFlow sử dụng Cassandra để lưu các dữ liệu nghiệp vụ đã kiểm tra và giữ chúng qua restart sạch của Cassandra demo. Kết quả này **không khẳng định cấu hình durable_writes=false của node gốc có cùng đặc tính**, cũng không chứng minh chịu crash, mất điện, failover nhiều node, restore backup hoặc retry mất response. Snapshot và drain đã flush dữ liệu nên đây không phải thí nghiệm cô lập khả năng phục hồi commit log. Các trường hợp chưa thực hiện được đánh dấu NOT TESTED, không coi là PASS.

Bằng chứng đầy đủ và bảng kết quả: QA_PERSISTENCE_TEST/BangKetQua_Test.md và MinhChung/Isolated_20261102/.
