# Kết quả sửa hai trang Khiếu nại và Thông báo của Admin

## Nguyên nhân đã xác minh

### Khiếu nại

Đọc trực tiếp Cassandra ngày 24/10/2026 cho thấy `complaints_by_customer` có 0 dòng. Trong `PortalSection` cũ, cả nhánh danh sách chung lẫn trạng thái trống đều loại `section === "complaints"`; `ComplaintList` lại chỉ xuất hiện khi có dữ liệu. Kết quả là trang rỗng không hiển thị bất kỳ trạng thái trống nào dưới tiêu đề. Đây không phải bằng chứng Cassandra bị mất dữ liệu hoặc có lỗi kết nối.

Trang Admin hiện dùng component riêng, có trạng thái đang tải, lỗi, trống, tìm kiếm không có kết quả và danh sách. Không sửa component hồ sơ/khiếu nại của Customer hoặc Driver.

### Thông báo

Hàm `markRead` cũ dựng URL từ `session.userId`, nên Admin gọi:

`PATCH /api/users/admin-demo/notifications/{createdAt}/{notificationId}`

Route này xác nhận ID trùng session rồi dùng `admin-demo` làm `user_id` trong CQL. Schema thật quy định `user_id` là UUID. Driver Cassandra báo `Invalid string representation of Uuid`. Đã tái hiện bằng SELECT theo cùng giá trị UUID sai, không thực hiện PATCH/UPDATE trên dữ liệu thật.

Đây là lỗi đánh dấu đã đọc, khác với lỗi tải danh sách. `markRead` cũ đặt banner lỗi mà vẫn giữ `rows`, phù hợp hiện tượng 38 dòng cùng banner 500. Đọc trực tiếp Cassandra và chạy service mới đều trả về 38 thông báo hợp lệ.

Admin hiện gọi route riêng:

`PATCH /api/admin/notifications/{userId}/{createdAt}/{notificationId}`

Route kiểm tra quyền Admin, xác thực UUID/thời gian, SELECT kiểm tra bản ghi tồn tại rồi cập nhật đúng người nhận và toàn bộ khóa chính. Customer/Driver tiếp tục dùng route cũ, không được cấp thêm quyền.

## Thay đổi và chức năng

- Danh sách Admin đọc các trang Cassandra đầy đủ, không còn giới hạn theo 100 người dùng, 30/50 bản ghi mỗi người hoặc cắt ngầm ở 200 dòng. Cách đọc toàn bảng này phù hợp dữ liệu nhỏ của đồ án, không phải phân trang giao diện cho hệ thống lớn.
- Các bản ghi còn dữ liệu nhưng không còn tài khoản tương ứng vẫn được hiển thị với chú thích phù hợp.
- Khiếu nại hiển thị mã, tên/mã khách hàng, mã chuyến, chủ đề, nội dung chi tiết, trạng thái, thời gian tạo và giải quyết. Hỗ trợ OPEN → PROCESSING → RESOLVED và OPEN → RESOLVED theo backend sẵn có.
- Gửi lại cùng trạng thái đã hoàn thành được trả thành công mà không ghi lại thời điểm giải quyết; chuyển ngược trạng thái vẫn bị từ chối.
- Thông báo giữ danh sách, tìm kiếm, lọc đã đọc/chưa đọc, gửi mới và đánh dấu đã đọc theo người nhận.
- Lỗi tải danh sách, tải người nhận, gửi và cập nhật được hiển thị riêng. Request phụ thất bại không xóa danh sách đã tải. Lỗi tải lại cũng giữ dữ liệu cũ và ghi rõ điều này.
- Số lượng hiển thị có dạng `X / Y bản ghi đã tải`, không gọi đó là tổng số toàn hệ thống.

## Schema Cassandra thật đã đối chiếu

| Bảng | Partition Key | Clustering Column |
|---|---|---|
| `complaints_by_customer` | `customer_id uuid` | `created_at timestamp DESC`, `complaint_id uuid ASC` |
| `notifications_by_user` | `user_id uuid` | `created_at timestamp DESC`, `notification_id uuid ASC` |

Các cột đang đọc/cập nhật đều có trong metadata thật. Không thay đổi schema, không dùng ALLOW FILTERING, seed hoặc migration.

## File thay đổi

- `src/app/admin/[section]/page.tsx`: chỉ định component cho hai trang Admin.
- `src/app/admin-support.css`: kiểu hiển thị được giới hạn trong hai trang.
- `src/components/portal/AdminSupportSection.tsx`: danh sách, chi tiết, form, tìm kiếm, bộ lọc, cập nhật và trạng thái lỗi/trống.
- `src/repositories/admin-support.ts`: truy vấn danh sách và người nhận, đọc đầy đủ pageState.
- `src/services/admin-support.ts`: ghép thông tin người dùng, xác thực khóa, đánh dấu đã đọc.
- `src/app/api/admin/[resource]/route.ts`: chuyển riêng GET complaints/notifications sang service mới.
- `src/app/api/admin/complaints/[customerId]/[createdAt]/[complaintId]/route.ts`: kiểm tra khóa và xử lý retry cùng trạng thái.
- `src/app/api/admin/notifications/[userId]/[createdAt]/[notificationId]/route.ts`: API cập nhật dành riêng cho Admin.
- `tests/admin-support.test.mjs`: kiểm thử API/repository/service bằng Cassandra in-memory.
- `tests/browser-business.test.mjs`: kiểm tra hai trang, thao tác và các request thất bại bằng Chrome với Cassandra giả lập.
- `package.json`: đưa test mới vào `npm test`; không thêm dependency ứng dụng.
- `docs/ADMIN_SUPPORT_FIXES.md`: báo cáo này.

## Kiểm chứng

- TypeScript: `npm.cmd run typecheck` thành công.
- ESLint: thành công cho các file TS/TSX/MJS liên quan. Dự án chưa có ESLint; công cụ và cấu hình chạy tạm trong `.tmp/admin-support-lint` và `.tmp/admin-support-eslint.config.mjs`, không thay dependency/lockfile của ứng dụng.
- `npm.cmd test`: 334 bài thành công, gồm 14 bài mới cho hai trang. Các truy vấn ghi trong test đều đi qua Cassandra in-memory.
- Chrome: kiểm tra danh sách, chi tiết, trạng thái trống, chuyển trạng thái khiếu nại, gửi thông báo, tìm kiếm, đánh dấu đã đọc, lỗi tải người nhận, lỗi tải lại danh sách và lỗi đánh dấu đã đọc. Danh sách còn nguyên sau các lỗi được chủ động đưa vào môi trường test.
- Build: thành công trong `.tmp/admin-support-preview`; bộ chặn kết nối Cassandra được nạp cho cả tiến trình và build worker. Không ghi đè `.next` của web đang chạy.
- Cassandra thật: chỉ SELECT metadata/dữ liệu. Service/repository mới trả 0 khiếu nại, 38 thông báo và 39 người nhận; cả 38 thông báo đủ ba thành phần khóa, `is_read` là boolean. Lần xác minh service mới thực hiện 8 SELECT, 0 truy vấn ghi.
- Chưa kiểm thử cập nhật trạng thái/đánh dấu đã đọc/gửi mới bằng thao tác ghi trên Cassandra thật; các thao tác này chỉ được kiểm thử bằng mock.

## Chạy web

Nếu đang dùng `npm.cmd run dev`, tải lại `/admin/complaints` và `/admin/notifications`; thường không cần restart. Nếu chạy `npm.cmd run start`, cần build lại và khởi động lại Next.js để dùng source mới. Không cần thao tác thủ công hoặc khởi động lại Cassandra.

Thư mục không có Git. Đã sao lưu source và test trước khi sửa tại `.backups/admin-support-20261024-144805`. Không sửa `.env.local`, mật khẩu, JWT, cấu hình bảo mật hoặc Word.
