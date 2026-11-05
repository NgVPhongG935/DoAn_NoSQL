# Kết quả mới nhất — demo độc lập, 02/11/2026

PASS: 29 · FAIL: 4 · BLOCKED: 0 · NOT TESTED: 6. FAIL giới hạn100 đã tái hiện thực tế; không phải mất row Cassandra. NOT TESTED không phải PASS. Không gộp số đếm từ giai đoạn cũ; bảng cũ được lưu LichSu_Truoc_DemoDocLap_BangKetQua_Test.md.

| Mã test | Chức năng | Dữ liệu test | Trước restart | Sau restart | Cassandra SELECT | Kết quả |
|---|---|---|---|---|---|---|
| ISO-01 | Cassandra độc lập | 127.0.0.2:9142 / JMX7299 / cluster riêng | Node mới, không peer | PID mới sau restart, host ID giữ nguyên | system.local + system.peers + status | PASS |
| ISO-02 | Schema tương thích | 19 bảng / 144 cột | Lấy metadata, không copy row | Khóa/cột/clustering khớp | system_schema.columns | PASS |
| ISO-03 | Cấu hình demo | RF1 / durable_writes=true | Đọc metadata thật | Giữ nguyên sau restart | system_schema.keyspaces | PASS |
| SAFE-01 | Không ảnh hưởng database gốc | 902 row /19 bảng | Hash mọi row và schema | Không thay đổi, node11220 vẫn chạy | original_comparison.json | PASS |
| SAFE-02 | Mã nghiệp vụ nguyên bản | 112 tệp src | Copy không .env/credentials | Gốc/copy cùng hash | schema_and_source_compatibility.json | PASS |
| AUTH-01 | Customer đăng ký/login qua UI | 09265dc8-410b-4042-9e43-59c8647bde6f | HTTP201 / login200 | Login lại sau Next/DB restart | customers WHERE customer_id=? | PASS |
| AUTH-02 | Driver đăng ký cùng xe qua UI | 392d085f-b7b4-4aa7-8377-61dd3b6a1754 | Driver PENDING + xe liên kết | Row giữ nguyên, driver ACTIVE sau duyệt | drivers/vehicles theo UUID | PASS |
| AUTH-03 | Admin demo login và duyệt Driver | Credential demo mới, không JWT giả | UI Duyệt thành công | Driver ACTIVE | drivers theo driver_id | PASS |
| CAT-01 | Tạo service qua UI Admin | BIKE /10000 +5000/km | Row mới trên demo | Còn sau restart | service_types theo service_id | PASS |
| DRV-01 | Bật nhận chuyến qua UI | Driver QA AVAILABLE | OFFLINE → AVAILABLE | BUSY khi có chuyến, AVAILABLE sau hoàn thành | drivers WHERE driver_id=? | PASS |
| TRIP-01 | Đặt chuyến qua UI | 3aaf340f-cdd0-4cf1-b323-084d54951754 | BOOKED, route thật1.6km,18000đ | COMPLETED sau thực hiện | canonical + customer/driver/status/history | PASS |
| TRIP-ACCEPTED | Driver cập nhật ACCEPTED | 3aaf340f-cdd0-4cf1-b323-084d54951754 | UI và SELECT khớp trạng thái | COMPLETED giữ nguyên sau restart | các projection/partition trạng thái, history | PASS |
| TRIP-ARRIVING | Driver cập nhật ARRIVING | 3aaf340f-cdd0-4cf1-b323-084d54951754 | UI và SELECT khớp trạng thái | COMPLETED giữ nguyên sau restart | các projection/partition trạng thái, history | PASS |
| TRIP-IN_PROGRESS | Driver cập nhật IN_PROGRESS | 3aaf340f-cdd0-4cf1-b323-084d54951754 | UI và SELECT khớp trạng thái | COMPLETED giữ nguyên sau restart | các projection/partition trạng thái, history | PASS |
| TRIP-COMPLETED | Driver cập nhật COMPLETED | 3aaf340f-cdd0-4cf1-b323-084d54951754 | UI và SELECT khớp trạng thái | COMPLETED giữ nguyên sau restart | các projection/partition trạng thái, history | PASS |
| PAY-01 | Tạo payment khi hoàn thành | BANK_TRANSFER /18000đ | PENDING, chưa ghi doanh thu đã trả | PAID_DEMO sau xác nhận | payments_by_trip/customer | PASS |
| PAY-02 | Customer báo chuyển khoản mô phỏng | 84b9d71f-8180-4f09-abc7-e04e0dd8faf2 | PENDING_CONFIRMATION qua UI | PAID_DEMO sau Driver xác nhận | payment theo trip/customer | PASS |
| PAY-03 | Driver xác nhận đã nhận tiền mô phỏng | 84b9d71f-8180-4f09-abc7-e04e0dd8faf2 | PAID_DEMO, amount18000 | Cùng ID/status/amount sau restart | payment đủ khóa, không row provisional trùng | PASS |
| REV-01 | Doanh thu/chi tiêu sau thanh toán | 18000đ | Đúng1 row mỗi bảng tổng hợp | Driver UI/API/SELECT còn18000 | driver_revenue/customer_spending đủ PK | PASS |
| REVIEW-01 | Đánh giá qua UI | 3bb62c0c-c3fa-4038-810c-5b6e42dac391 | 5 sao, comment QA_TEST_ | Driver/customer đọc lại sau restart | reviews_by_trip/driver, drivers.rating | PASS |
| ADMIN-01 | Admin chuyến/payment/dashboard | 1 completed trip,18000đ, rating5 | UI/API có dữ liệu mới | API xác nhận đúng sau DB restart | admin_after_db_restart_API.json + SELECT | PASS |
| GUARD-01 | Không đổi availability khi đang có trip | Fixture AVAILABLE sai chỉ trong demo | UI từ chối, HTTP409 | Fixture trả lại BUSY trước tiếp tục chuyến | canonical trip còn hoạt động | PASS |
| GUARD-02 | Không phân trùng dù AVAILABLE sai | Cùng driver/canonical trip | API thực từ chối409, trip count không tăng | Không có trip trùng | negative_available_active.json | PASS |
| PERSIST-01 | Refresh | Cùng trip/payment/review UUID | Row hoàn thành/thanh toán/đánh giá | UI và SELECT đầy đủ | check-refresh/check-relogin SELECT | PASS |
| PERSIST-02 | Logout/login | Cùng trip/payment/review UUID | Row hoàn thành/thanh toán/đánh giá | UI và SELECT đầy đủ | check-refresh/check-relogin SELECT | PASS |
| PERSIST-03 | Restart Next demo | 335 row demo | Ctrl+C → app dừng thật | 335/335 hash không đổi, UI login lại đúng | comparison_after-next.json | PASS |
| PERSIST-04 | Restart Cassandra demo sạch | RF1, durable_writes=true | Snapshot/checksum, drain DRAINED, Ctrl+C | 335/335 hash không đổi; UI Customer/Driver/Admin đúng | comparison_after-cassandra + SELECT cùng PK | PASS |
| BACKUP-01 | Bản sao snapshot demo | 166 tệp + schema-only | Copy sang thư mục backup riêng | Checksum166/166 khớp | demo_backup_manifest.json; chưa rehearsal restore | PASS |
| LIMIT-customers | Danh sách customers đủ bản ghi | 106 row trong bảng | API/UI chỉ100; customer search thiếu | Chưa sửa; dữ liệu vẫn trong DB | limit_100_results.json | FAIL |
| LIMIT-drivers | Danh sách drivers đủ bản ghi | 106 row trong bảng | API/UI chỉ100; customer search thiếu | Chưa sửa; dữ liệu vẫn trong DB | limit_100_results.json | FAIL |
| LIMIT-vehicles | Danh sách vehicles đủ bản ghi | 106 row trong bảng | API/UI chỉ100; customer search thiếu | Chưa sửa; dữ liệu vẫn trong DB | limit_100_results.json | FAIL |
| LIMIT-OWN-VEHICLE | Driver thấy xe thuộc mình | Một QA_TEST_LIMIT_ driver | API own vehicle=[]; UI báo trống | SELECT exact vehicle_id trả đúng1 row | limit_100_results.json / driverVehicle | FAIL |
| NT-01 | Restart Cassandra gốc | Ngoài phạm vi/không thực hiện | Không thực hiện | Không kết luận | Không có bằng chứng test này | NOT TESTED |
| NT-02 | Force kill/mất điện/crash | Ngoài phạm vi/không thực hiện | Không thực hiện | Không kết luận | Không có bằng chứng test này | NOT TESTED |
| NT-03 | Restore rehearsal từ backup | Ngoài phạm vi/không thực hiện | Không thực hiện | Không kết luận | Không có bằng chứng test này | NOT TESTED |
| NT-04 | CASH và các phương thức khác | Ngoài phạm vi/không thực hiện | Không thực hiện | Không kết luận | Không có bằng chứng test này | NOT TESTED |
| NT-05 | Retry mất response qua restart | Ngoài phạm vi/không thực hiện | Không thực hiện | Không kết luận | Không có bằng chứng test này | NOT TESTED |
| NT-06 | Sửa lỗi LIMIT và regression sau sửa | Ngoài phạm vi/không thực hiện | Không thực hiện | Không kết luận | Không có bằng chứng test này | NOT TESTED |
| WORD-01 | Chuẩn bị mục3.6 + ảnh | Gói riêng, chưa sửa.docx | Tạo nội dung/ảnh/chú thích | Hash Word không đổi sau chuẩn bị | Word_Unchanged_Comparison.json | PASS |

Các luồng chính dùng UI thật, Edge/CDP và driver Cassandra thật. 105 bộ Customer/Driver/xe dùng cho ngưỡng100 được tạo bằng INSERT fixture có guard cluster demo; không báo chúng là đăng ký UI. Fixture AVAILABLE sai được cố ý tạo trên đúng Driver QA trong demo, test negative qua UI/API thật, rồi phục hồi trường fixture; không chạm Driver cũ.

Kết quả source không có chỉnh sửa lỗi nghiệp vụ. Các giá trị expected ở test là yêu cầu; PASS chỉ được ghi khi dữ liệu thật/HTTP/UI đã khớp. Xem [bằng chứng demo](MinhChung/Isolated_20261102/), [kết quả máy đọc](MinhChung/Isolated_20261102/Isolated_TestResults.json).
