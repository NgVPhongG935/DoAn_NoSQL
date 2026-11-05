# RideFlow — đơn giản hóa xác thực demo (21/10/2026)

## Phạm vi và sao lưu

Không tìm thấy repository Git tại thư mục dự án, nên không thể xác định commit trước P0 để khôi phục chính xác. Đơn giản hóa code hiện tại; không reset toàn dự án. Code trước chỉnh sửa và bản cấu hình riêng được lưu tại thư mục cục bộ bị gitignore: .backups/auth-before-simplify-2026-10-21T11-55-30-291Z/. Không chia sẻ thư mục này vì có bản sao môi trường chứa bí mật.

Đã kiểm tra tài liệu audit, P0, README và đường đi xác thực hiện tại. Không thay UI, nghiệp vụ P1, schema, keyspace hoặc 19 bảng. Không chạy seed/migration/reset hay cập nhật tài khoản Cassandra.

## Lỗi đã sửa và cơ chế hiện tại

Admin không đăng nhập được vì ADMIN_PASSWORD_HASH còn trống. Theo phương án được người dùng xác nhận, đã điền hash scrypt của mật khẩu demo Admin cũ vào .env.local. Không đưa hash này vào source; không có credential dự phòng trong code. Kiểm tra bằng code cho thấy mọi byte cấu hình khác, bao gồm JWT_SECRET, giữ nguyên.

Customer/Driver tiếp tục tra email trong Cassandra và so sánh mật khẩu với hash scrypt có sẵn, không thay đổi mật khẩu. Vai trò được lấy từ kết quả xác thực phía server, bỏ qua role/ID do frontend tự khai. Tài khoản phải đang active. Đăng ký vẫn tạo Customer với salt ngẫu nhiên; đăng xuất xóa cookie. Không phát hiện chức năng quên mật khẩu đã hoàn thiện để khôi phục; không bổ sung tính năng này.

Bỏ cấu hình quyền Admin chi tiết ADMIN_PERMISSIONS. Mọi phiên ADMIN hợp lệ, khớp danh tính Admin cấu hình, có toàn quyền quản trị. Biến ADMIN_PERMISSIONS cũ trong .env.local được giữ nguyên nhưng không còn tác dụng. Giữ tên các helper cũ để không phải thay các route nghiệp vụ; tham số quyền không còn quyết định việc cấp quyền. Danh sách tài nguyên API hợp lệ vẫn được kiểm tra để không truy cập bảng tùy ý.

Admin cấu hình thiếu/sai hash chỉ bị tắt đăng nhập Admin, không làm Customer/Driver ngừng chạy. JWT_SECRET vẫn bắt buộc hợp lệ khi khởi động. Giữ HS256, xác minh chữ ký/issuer/audience/thời hạn, cookie HttpOnly/SameSite và Secure khi production; giữ kiểm tra vai trò, tài khoản active và chủ sở hữu dữ liệu Customer/Driver. Không có OTP, 2FA hoặc dịch vụ xác thực bên ngoài.

## File thay đổi trong đợt xác thực

- src/lib/security-config.ts: bỏ danh sách và parser quyền Admin; cấu hình Admin không hợp lệ trả null.
- src/lib/authorization.ts: kiểm tra danh tính và vai trò ADMIN, giữ nguyên kiểm tra chủ sở hữu.
- src/instrumentation.ts và next.config.ts: chỉ yêu cầu cấu hình JWT khi khởi động.
- .env.local: chỉ bổ sung hash Admin còn thiếu, theo xác nhận; file riêng tư.
- .env.example: bỏ khóa JWT đã được điền nhầm trong ví dụ, bỏ ADMIN_PERMISSIONS.
- .gitignore: loại trừ các file môi trường riêng, backup và thư mục tạm.
- tests/security.test.mjs: cập nhật kỳ vọng Admin toàn quyền, giữ ma trận vai trò/chủ sở hữu; bổ sung sai mật khẩu ba vai trò.
- tests/production-security.test.mjs: kiểm tra Admin theo vai trò và sửa escape hash trong môi trường test khi Next mở rộng biến dotenv.
- README.md và báo cáo này: hướng dẫn cấu hình hiện tại; không đề nghị reset mật khẩu để sửa đăng nhập.

Các file nghiệp vụ P1 đã có trước đợt này được giữ nguyên.

## Kết quả kiểm thử

- npm test: 261/261 đạt, gồm 148 ca security và 113 ca business. Bộ security thực thi 37 phương thức thuộc 33 file API. Kiểm tra đăng nhập ba vai trò, sai mật khẩu, đăng ký, đăng xuất, chống giả mạo JWT/role và truy cập dữ liệu tài khoản khác. Transport Cassandra trong bộ này là in-memory mock.
- npm run typecheck: đạt.
- npm run build: đạt.
- npm run test:security:production: 6/6 đạt. Khởi động next start thật; 32 phương thức API từ chối anonymous và token ký khóa cũ; xác minh đăng nhập/cookie Admin, kiểm tra input và đăng xuất. Không gửi thao tác ghi Cassandra hợp lệ; cấu hình Cassandra test trỏ cổng đóng và keyspace test.
- Xác minh riêng mật khẩu Admin demo cũ với hash thực tế từ .env.local qua authenticateDemoUser: đạt, dùng mock transport, không ghi database.
- Thử khởi động thêm next dev bị chặn do tiến trình hiện có giữ khóa .next/dev. Không dừng tiến trình của người dùng. Server dev hiện có tại localhost:3000 trả GET /login HTTP 200. Cần khởi động lại server hiện có để nạp biến môi trường mới; chưa chứng minh khởi động dev mới độc lập.

Log của lần kiểm tra này: docs/evidence/AUTH_DEMO_TESTS_2026-10-21.txt, AUTH_DEMO_BUILD_2026-10-21.txt và AUTH_DEMO_PRODUCTION_2026-10-21.txt.

Không kiểm thử đăng nhập Customer/Driver bằng dữ liệu Cassandra thật hoặc tạo tài khoản thật. Các ca dùng hash scrypt trên fixture chứng minh đường đi xác thực; không phải bằng chứng mật khẩu của mọi tài khoản hiện tại đúng. Không kiểm thử ghi Cassandra thật.

## Chạy demo

Giữ nguyên .env.local, không copy đè từ .env.example. Dừng server dev hiện có bằng Ctrl+C trong terminal của bạn rồi chạy npm run dev. Mở http://localhost:3000/login. Admin dùng email ADMIN_EMAIL hiện tại (admin@rideflow.vn) và mật khẩu demo cũ đã được xác minh riêng. Customer/Driver dùng email và mật khẩu cũ, Cassandra cần hoạt động. Không cần ADMIN_PERMISSIONS hay script seed/reset.

## Giới hạn

Không có lịch sử Git để đối chiếu chính xác phiên bản trước P0. Kiểm thử Customer/Driver chỉ dùng mock. Quyền ADMIN cố ý là toàn quyền theo phương án demo được duyệt; chức năng quên mật khẩu chưa có. Không triển khai thêm P1/P3 hoặc migration trong đợt này.
