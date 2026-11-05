# Quản lý tài khoản và ảnh đại diện RideFlow

## Cách dùng

Chạy `npm.cmd run dev`, đăng nhập Admin bằng tài khoản đã cấu hình, rồi mở:

- `/admin/customers`: thêm khách hàng, sửa tên/số điện thoại/email, đổi ảnh, khóa/mở khóa và xóa tài khoản chưa có dữ liệu liên quan.
- `/admin/drivers`: thêm tài xế, sửa tên/số điện thoại/email/giấy phép lái xe, đổi ảnh, khóa/mở khóa và xóa tài khoản chưa có dữ liệu liên quan.

Tài khoản mới được tạo ở trạng thái ACTIVE; tài xế mới ở trạng thái OFFLINE, điểm đánh giá ban đầu bằng 0. Mật khẩu ban đầu tuân theo quy tắc đăng ký hiện có và được băm bằng scrypt. Form sửa không thay đổi mật khẩu, mã tài khoản hoặc điểm đánh giá. Đổi email khiến phiên cũ không còn hợp lệ; người dùng đăng nhập lại bằng email mới và mật khẩu cũ.

Sau khi tạo tài khoản, form chuyển sang chế độ sửa để có thể chọn ảnh đại diện. Customer/Driver tự đổi ảnh ở `/customer/profile`, `/driver/profile`. Cả ba vai trò cũng có thể bấm vùng tài khoản ở góc phải trên cùng để đổi ảnh hoặc dùng lại ảnh mặc định.

Ảnh hỗ trợ PNG, JPG, WebP, tối đa 2 MB. Nếu chưa có ảnh, giao diện hiển thị chữ cái tên tài khoản.

## Dữ liệu và giới hạn

- Chức năng tạo/sửa/xóa chỉ ghi vào bảng `customers` hoặc `drivers` khi người quản trị chủ động bấm thao tác trên web. Không đổi schema 19 bảng.
- Xóa là DELETE thật, chỉ cho tài khoản chưa có dữ liệu liên quan. Nếu đã có chuyến, phương tiện, thanh toán, đánh giá, voucher, khiếu nại, thông báo hoặc thống kê, API từ chối xóa và hướng dẫn khóa tài khoản. Không xóa dây chuyền các bảng nghiệp vụ.
- Tài khoản đang có chuyến hoạt động chưa được khóa. Tài xế BUSY chưa được xóa hoặc khóa.
- Ảnh được lưu riêng trên máy chạy web tại `.data/avatars`, không lưu vào Cassandra và không nằm trong thư mục public. Cần giữ thư mục này khi chuyển hoặc sao lưu ứng dụng. Khởi động lại web không làm mất ảnh; môi trường chỉ có ổ đĩa tạm thời không phù hợp với cách lưu này.
- API ảnh yêu cầu phiên hợp lệ và quyền chủ tài khoản hoặc Admin. Tên file do server xác định, không dùng tên file người dùng tải lên.
- Tài xế mới chưa có phương tiện. Để nhận chuyến, tài xế vẫn cần phương tiện ACTIVE phù hợp như điều kiện đặt xe hiện có; thay đổi này không bổ sung form tạo/gán phương tiện.
- Các bước kiểm tra email trùng và xóa tài khoản phù hợp mô hình demo một máy chủ, quy mô dữ liệu sinh viên; không thay thế ràng buộc giao dịch phân tán của database.

## Kiểm thử

- `npm.cmd run typecheck`
- `npm.cmd test`: dùng Cassandra in-memory qua `tests/register.mjs`, có bộ `tests/admin-accounts.test.mjs`.
- `node --test tests/browser-business.test.mjs`: cần Chrome và bản build, chạy máy chủ riêng bằng Cassandra giả lập qua `tests/ui-transport.mjs`; ảnh kiểm thử nằm trong `.tmp`, không dùng thư mục ảnh thật.

Không cần seed, migration hoặc thao tác thủ công với Cassandra để bật các chức năng này. Chưa xác minh CRUD bằng thao tác ghi trên Cassandra thật.
