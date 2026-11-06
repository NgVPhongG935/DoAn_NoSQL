# Sao lưu và khôi phục trên web

Đăng nhập quản trị, mở **Sao lưu & khôi phục** tại `/admin/backup`.

- **Tải JSON**: bản sao 19 bảng, schema cột, thời điểm và SHA-256 cho từng bảng. Tương thích file JSON RideFlow đã xuất trước đây.
- **Tải CQL**: schema và `INSERT`, có thể chạy trong CQL Editor của NoSQL Manager.
- **Khôi phục**: chọn file `.json` hoặc `.cql` UTF-8 tối đa 20 MB, bấm **Kiểm tra file**, xem số bảng/bản ghi, chọn cách khôi phục và đánh dấu xác nhận.
- **Thêm/cập nhật** giữ bản ghi ngoài file. Bản ghi trùng khóa được cập nhật theo nội dung file.
- **Thay thế** làm trống rồi nạp lại các bảng có trong file; bảng ngoài file được giữ nguyên. File đầy đủ 19 bảng khôi phục cả dữ liệu bảng trống.

Web khôi phục dữ liệu vào schema hiện có. Không chạy DDL do người dùng tải lên. `CREATE`, `USE` và `SELECT` hợp lệ trong file CQL được đọc/bỏ qua; chỉ dữ liệu `INSERT ... VALUES` của 19 bảng ứng dụng được nhập qua câu lệnh có tham số. Lệnh xóa, sửa schema, batch, TTL, hàm và keyspace khác bị từ chối. File không tương thích phải được chuyển về schema của ứng dụng trước.

Trước mỗi lần khôi phục, máy chủ lưu snapshot JSON vào `.backups/before_restore_*.json` (hoặc thư mục `RIDEFLOW_BACKUP_DIR`). Trang trả về liên kết tải bản này cho admin. File được kiểm tra toàn bộ trước khi ghi. Nếu ghi hoặc đối chiếu thất bại, máy chủ thử hoàn tác các bảng đã chọn từ bản sao này và kiểm tra lại. Khi Cassandra ngừng hoạt động khiến hoàn tác cũng thất bại, trang thông báo rõ kết quả chưa được xác nhận và giữ bản sao để phục hồi.

Khôi phục nhiều bảng Cassandra không phải giao dịch nguyên tử. Tính năng dành cho triển khai một máy chủ ứng dụng, nên dùng khi hệ thống tạm dừng hoạt động người dùng. Hàng đợi nghiệp vụ trên máy chủ được giữ trong suốt quá trình; không vượt qua thao tác chuyến còn kết quả chưa xác nhận. Chế độ nhật ký nghiệp vụ bật (`RIDEFLOW_BUSINESS_JOURNAL_ENABLED=true`) không hỗ trợ restore trên web. Không sao lưu/khôi phục ảnh đại diện, `.env.local`, mật khẩu admin hoặc JWT secret.

API `/api/admin/backup` yêu cầu phiên admin thật, trả về `Cache-Control: private, no-store`, không cho phép đường dẫn file tùy ý. POST kiểm tra Origin, giới hạn dung lượng thật khi đọc body, mã băm nội dung xem trước, xác nhận và mã yêu cầu chống lặp. Snapshot chứa thông tin cá nhân và mật khẩu tài khoản dạng băm; không đưa các file dữ liệu lên GitHub.

Kiểm tra: `npm run test:backup`, `npm run typecheck`, `npm test`. Kiểm thử khôi phục dùng Cassandra giả lập; không ghi dữ liệu thật khi chạy test.
