# Đề xuất migration P1 — chưa thực hiện

File CQL: `migrations/002_business_journal.cql`. Chỉ thêm bảng `rideflow_business_journal`; không ALTER, DROP, TRUNCATE, xóa hoặc cập nhật dữ liệu trong 19 bảng hiện tại. Không tự tạo keyspace production, không tự đổi replication factor/consistency để né lỗi quorum.

## Vì sao cần bảng này

Schema hiện tại không lưu khóa idempotency, quan hệ trip–voucher hoặc kế hoạch ghi để phục hồi sau lỗi. Khóa RAM không tồn tại sau restart và không điều phối nhiều tiến trình. Thêm journal cho phép giữ nguyên schema nghiệp vụ hiện tại mà vẫn lưu các bước ghi đã quyết định trước khi thực hiện chúng.

## Thiết kế đề xuất

- Một partition điều phối `scope=rideflow-business-v1` dành cho quy mô đồ án. LWT conditional batch cùng partition ghi đồng thời con trỏ operation đang hoạt động, timestamp tăng dần và kế hoạch operation PREPARED. Không coi đây là transaction trên các bảng nghiệp vụ.
- Mỗi operation có khóa ổn định, hash request và danh sách CQL/giá trị/timestamp cố định; retry cùng khóa nhưng khác nội dung bị từ chối. Thông tin voucher/chuyến, ID payment, thời điểm history và các bản ghi tổng hợp được lưu trong kế hoạch.
- Toàn bộ ghi ảnh hưởng phân công tài xế, số lượng voucher, trạng thái chuyến và review đi qua journal. Chỉ operation đã ghi đủ projection mới COMMITTED. Operation PREPARED bị lỗi sẽ được roll-forward bằng chính kế hoạch cũ trước khi nhận mutation tiếp theo. Không giải phóng tài xế sau một lỗi ghi chưa rõ kết quả.
- Dùng timestamp Cassandra tăng dần cho mọi bước ghi nghiệp vụ. Executor cũ chạy lại không được ghi đè trạng thái mới hơn. Các ID và clustering timestamp giữ nguyên khi retry.
- Dùng SERIAL cho điều kiện/đọc journal và QUORUM cho đọc/ghi nghiệp vụ trong operation; cluster không đủ quorum sẽ từ chối mutation, không hạ xuống localOne. Cần xác minh cluster trước khi bật tính năng.
- Không TTL cho idempotency hoặc khóa điều phối để tránh tự hết hạn giữa operation. Đây là partition điều phối tập trung có giới hạn tải; chưa phải thiết kế cho quy mô lớn. Không xóa lịch sử journal tự động.

## Triển khai sau khi được xác nhận

1. Dừng writer phiên bản cũ; sao lưu theo quy trình vận hành, kiểm tra metadata/quorum và clock đồng bộ. Không chạy tự động lệnh sửa dữ liệu lịch sử.
2. Chạy migration trên keyspace test riêng đã được cho phép, dùng dữ liệu tổng hợp; kiểm thử LWT/đồng thời/fault injection thật trước.
3. Khi các kiểm thử đủ điều kiện, áp dụng cùng CQL chỉ thêm bảng trên keyspace production được xác nhận. Kiểm tra bảng mới rỗng, 19 bảng cũ không đổi schema/dữ liệu.
4. Bật `RIDEFLOW_BUSINESS_JOURNAL_ENABLED=true` và triển khai đồng nhất tất cả writer. Không cho phiên bản cũ tiếp tục ghi cạnh phiên bản mới.
5. Nếu lỗi: dừng mutation, giữ journal để phục hồi. Không DROP journal hoặc quay lại writer cũ khi có PREPARED chưa hoàn tất.

Các tài xế đã có nhiều chuyến hoạt động theo audit không được tự động hủy/xóa chuyến. Phiên bản mới sẽ chặn phân công/nhận thêm khi phát hiện xung đột; việc sửa dữ liệu lịch sử cần quyết định nghiệp vụ riêng.

## Trạng thái phê duyệt

Chưa được phê duyệt. Chưa chạy DDL hoặc kiểm thử ghi Cassandra thật. Có thể chuẩn bị code, chạy test mô phỏng và sửa UI/API độc lập trong lúc chờ xác nhận.

## Tài liệu đối chiếu

- [Apache Cassandra CQL DML](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html): batch không cung cấp isolation giữa các partition.
- [Apache Cassandra — conditional batch với static columns](https://cassandra.apache.org/doc/stable/cassandra/reference/static.html).
- [Apache Cassandra — ví dụ conditional batch cùng partition](https://cassandra.apache.org/doc/stable/cassandra/developing/cql/batch/batch-good-example.html).
