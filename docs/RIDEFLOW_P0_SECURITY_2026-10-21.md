# RideFlow — kết quả Giai đoạn 1 (P0), 21/10/2026

Đã đọc toàn bộ `docs/RIDEFLOW_AUDIT_2026-10-13.md`, đối chiếu 33 file Route Handler (37 phương thức API), thư viện phiên, repository tài khoản, dịch vụ đăng ký/dashboard và các nơi gọi API trên giao diện. Chỉ triển khai Giai đoạn 1 theo yêu cầu. Chưa chuyển sang Giai đoạn 2 hoặc 3.

## Lỗi đã khắc phục

1. Bỏ hoàn toàn khóa ký JWT dự phòng và việc sử dụng `AUTH_SECRET`. `JWT_SECRET` phải có ít nhất 32 byte, ít nhất 12 ký tự khác nhau, không chứa khoảng trắng thừa hoặc các mẫu placeholder đã chặn. Chính sách kiểm tra hình thức không thay thế việc sinh khóa ngẫu nhiên bằng CSPRNG; README có lệnh tạo 48 byte ngẫu nhiên.
2. Kiểm tra cấu hình trong `next.config.ts` ở phase development/production server, đồng thời kiểm tra tại instrumentation và nơi ký/xác minh JWT. Thiếu/sai khóa khiến `next start` thoát lỗi. Build không cần khóa thật của môi trường triển khai.
3. Chỉ chấp nhận JWT HS256, đúng issuer/audience/subject, có `iat`/`exp`, đúng kiểu dữ liệu và một trong ba vai trò được hỗ trợ. Token ký bằng khóa fallback cũ, bị sửa, hết hạn, sai thuật toán hoặc sai claims bị từ chối.
4. Phiên Customer/Driver phải khớp tài khoản Cassandra hiện tại về ID/email/vai trò và trạng thái ACTIVE. Tài khoản bị khóa, xóa hoặc email đã thay đổi không dùng lại được phiên cũ. Database lỗi thì từ chối xử lý; không tiếp tục bằng thông tin phiên cũ.
5. Sửa kiểm tra vai trò và chủ sở hữu ở toàn bộ nhóm API Customer/Driver. Driver không đọc được thanh toán/khiếu nại/hồ sơ khách; Customer không đọc được doanh thu/hồ sơ/chuyến của tài xế. Trùng UUID giữa hai vai trò cũng không cấp quyền.
6. API quản trị yêu cầu quyền cụ thể lấy từ cấu hình server (`ADMIN_PERMISSIONS`), tách quyền đọc/ghi, mặc định không cấp quyền. Body/query không thể bổ sung quyền. Quyền đọc chuyến không tự cấp quyền đọc payment/review đính kèm; quyền đọc hồ sơ tài xế không tự cấp quyền đọc danh sách xe đính kèm.
7. Bỏ hash mật khẩu Admin cố định trong source. Admin được cấu hình bằng `ADMIN_EMAIL` và `ADMIN_PASSWORD_HASH`; không có hash thì không có đăng nhập Admin. Phiên Admin phải khớp định danh/email đã cấu hình. Vẫn sử dụng một định danh Admin do server quản lý để không thêm bảng Cassandra.
8. Giữ việc chọn customer khi đặt chuyến, customer/driver khi review và vai trò khi đăng nhập/đăng ký ở server. Kiểm thử chứng minh body/query chứa `customer_id`, `driver_id`, `role`, giá giả không ghi đè quyết định này. ID trên URL không đủ để cấp quyền; API kiểm tra chủ sở hữu trước khi trả dữ liệu hoặc ghi nghiệp vụ. API chi tiết chuyến đọc bản ghi chính để xác định chủ chuyến rồi mới tải dữ liệu liên quan.
9. Khiếu nại có `tripId` phải trỏ tới chuyến của người gửi. Đây là kiểm tra quyền sở hữu thuộc P0.
10. `/api/drivers` chỉ dành cho Admin có `drivers:read`. Chi tiết chuyến chỉ trả thông tin liên hệ tài xế và thông tin xe cần cho chuyến; loại email, số giấy phép và trạng thái tài khoản tài xế khỏi response này. Health công khai chỉ trả trạng thái, không trả tên keyspace.

## Ma trận quyền API

`C` = Customer sở hữu tài khoản/chuyến; `D` = Driver sở hữu tài khoản/được phân công chuyến. Người chưa đăng nhập nhận 401. Truy cập sai quyền bị từ chối; các guard mới trả 403. Một số guard cũ đã an toàn vẫn trả 401 cho truy cập sai quyền để giữ phạm vi thay đổi nhỏ.

| API và phương thức | Customer | Driver | Admin |
|---|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/register` | Công khai; role do server xác định | Như bên trái | Không thể đăng ký Admin qua API công khai |
| `POST /api/auth/logout` | Xóa cookie của request | Như bên trái | Như bên trái |
| `POST /api/auth/demo` | Luôn 410 | Luôn 410 | Luôn 410 |
| `GET /api/auth/me` | Phiên hợp lệ | Phiên hợp lệ | Phiên khớp cấu hình |
| `GET /api/health` | Công khai, chỉ trạng thái | Như bên trái | Như bên trái |
| `GET /api/services`, `GET /api/maps/geocode`, `GET /api/maps/reverse-geocode`, `POST /api/maps/route` | Có phiên hợp lệ | Có phiên hợp lệ | Có phiên hợp lệ |
| `GET /api/dashboard` | Dữ liệu C lấy từ phiên | Dữ liệu D lấy từ phiên | `reports:read` |
| `GET /api/customers/[id]` | C | Từ chối | `customers:read` |
| `PATCH /api/customers/[id]` | C, chỉ tên/phone | Từ chối | `customers:write` |
| `GET /api/customers/[id]/trips` | C | Từ chối | `trips:read` |
| `GET /api/customers/[id]/payments` | C | Từ chối | `payments:read` |
| `GET /api/customers/[id]/reviews` | C | Từ chối | `reviews:read` |
| `GET /api/customers/[id]/vouchers` | C | Từ chối | `vouchers:read` |
| `GET /api/customers/[id]/complaints` | C | Từ chối | `complaints:read` |
| `POST /api/customers/[id]/complaints` | C, trip phải thuộc C nếu có | Từ chối | Từ chối |
| `GET /api/drivers` | Từ chối | Từ chối | `drivers:read` |
| `GET /api/drivers/[id]` | Từ chối | D | `drivers:read`; xe đính kèm cần thêm `vehicles:read` |
| `PATCH /api/drivers/[id]`, `PATCH /api/drivers/[id]/status` | Từ chối | D | `drivers:write` |
| `GET /api/drivers/[id]/trips` | Từ chối | D | `trips:read` |
| `GET /api/drivers/[id]/reviews` | Từ chối | D | `reviews:read` |
| `GET /api/drivers/[id]/vehicle` | Từ chối | D | `vehicles:read` |
| `GET /api/drivers/[id]/revenue/[month]` | Từ chối | D | `reports:read` |
| `POST /api/trips` | Customer trong phiên; driver và giá do server chọn/tính | Từ chối | Từ chối |
| `GET /api/trips/[id]` | C | D được gán | `trips:read`; payment/review cần quyền tương ứng |
| `PATCH /api/trips/[id]/status` | C, chỉ CANCELLED | D được gán; giữ quy tắc chuyển trạng thái hiện có | `trips:write` |
| `POST /api/trips/[id]/review` | C, chuyến COMPLETED | Từ chối | Từ chối |
| `GET /api/users/[id]/notifications` | Chính người nhận | Chính người nhận | Chính người nhận |
| `PATCH /api/users/[id]/notifications/[createdAt]/[notificationId]` | Chính người nhận | Chính người nhận | Chính người nhận |
| `GET /api/admin/[resource]` | Từ chối | Từ chối | `<resource>:read` thuộc danh sách cho phép |
| `POST /api/admin/[resource]` | Từ chối | Từ chối | `<resource>:write`; hiện hỗ trợ services/vouchers/notifications |
| `PATCH /api/admin/[resource]/[id]` | Từ chối | Từ chối | `<resource>:write`; giữ các resource đã hỗ trợ |
| `PATCH /api/admin/complaints/[customerId]/[createdAt]/[complaintId]` | Từ chối | Từ chối | `complaints:write` |

`reports:read` cho phép xem báo cáo hiện có, gồm các chỉ số và danh sách chuyến có tên khách/tài xế mà dashboard đang trả. Các quyền theo resource cho phép thông tin tối thiểu liên quan cần để hiển thị resource đó; không cho phép gọi trực tiếp API hồ sơ hoặc API resource khác nếu thiếu quyền tương ứng.

## Các file đã sửa hoặc thêm

| Nhóm | File | Nội dung |
|---|---|---|
| Cấu hình | `next.config.ts`, `.env.example` | Kiểm tra khóa khi khởi động; khai báo biến JWT/Admin |
| Phiên | `src/lib/auth.ts` | JWT nghiêm ngặt; kiểm tra tài khoản hiện tại |
| Cấu hình bảo mật mới | `src/lib/security-config.ts` | Kiểm tra JWT secret, tài khoản và quyền Admin |
| Guard mới | `src/lib/authorization.ts` | Quyền theo role, chủ sở hữu, chuyến, resource Admin |
| Khởi tạo mới | `src/instrumentation.ts` | Kiểm tra cấu hình bổ sung khi khởi tạo runtime |
| Đăng nhập Admin | `src/lib/demo-auth.ts` | Bỏ hash Admin cố định, dùng cấu hình server |
| Đăng ký | `src/services/registration.ts` | Dành riêng email Admin theo cấu hình server |
| Dashboard | `src/services/dashboard.ts` | Hồ sơ Admin từ cấu hình, chỉ trả id/name/email |
| API Customer | `src/app/api/customers/[id]/route.ts` | GET/PATCH theo role và chủ sở hữu |
| API Customer | `src/app/api/customers/[id]/trips/route.ts` | Quyền đọc chuyến của tài khoản |
| API Customer | `src/app/api/customers/[id]/payments/route.ts` | Quyền đọc thanh toán |
| API Customer | `src/app/api/customers/[id]/reviews/route.ts` | Quyền đọc đánh giá |
| API Customer | `src/app/api/customers/[id]/vouchers/route.ts` | Quyền đọc voucher |
| API Customer | `src/app/api/customers/[id]/complaints/route.ts` | Quyền đọc; kiểm tra chủ chuyến khi tạo |
| API Driver | `src/app/api/drivers/route.ts` | Hạn chế danh sách tài xế |
| API Driver | `src/app/api/drivers/[id]/route.ts` | Quyền đọc/ghi hồ sơ; quyền xe đính kèm |
| API Driver | `src/app/api/drivers/[id]/trips/route.ts` | Quyền đọc chuyến |
| API Driver | `src/app/api/drivers/[id]/reviews/route.ts` | Quyền đọc đánh giá |
| API Driver | `src/app/api/drivers/[id]/vehicle/route.ts` | Quyền đọc xe |
| API Driver | `src/app/api/drivers/[id]/revenue/[month]/route.ts` | Quyền đọc doanh thu |
| API Driver | `src/app/api/drivers/[id]/status/route.ts` | Quyền cập nhật trạng thái |
| API Admin | `src/app/api/admin/[resource]/route.ts` | Quyền đọc/tạo theo resource |
| API Admin | `src/app/api/admin/[resource]/[id]/route.ts` | Quyền cập nhật theo resource |
| API Admin | `src/app/api/admin/complaints/[customerId]/[createdAt]/[complaintId]/route.ts` | Quyền xử lý khiếu nại |
| API dashboard | `src/app/api/dashboard/route.ts` | Kiểm tra `reports:read` cho Admin |
| API chuyến | `src/app/api/trips/[id]/route.ts` | Chủ chuyến, quyền Admin và response tối thiểu |
| API chuyến | `src/app/api/trips/[id]/status/route.ts` | Guard chủ chuyến/quyền ghi Admin |
| Health | `src/app/api/health/route.ts` | Bỏ metadata keyspace khỏi response công khai |
| Công cụ mới | `scripts/hash-admin-password.mjs` | Tạo scrypt hash từ stdin; hỗ trợ escape cho dotenv |
| Kiểm thử | `package.json` | Thêm script test, test:security và test:security:production |
| Kiểm thử mới | `tests/register.mjs` | Nạp TS/alias và thay transport trong test |
| Kiểm thử mới | `tests/support/cookies.mjs` | Cookie riêng cho từng request test |
| Kiểm thử mới | `tests/support/cassandra.mjs` | Cassandra giả lập trong bộ nhớ; ghi nhận mọi truy vấn |
| Kiểm thử mới | `tests/support/maps.mjs` | Maps giả lập cho kiểm thử không phụ thuộc mạng |
| Kiểm thử mới | `tests/security.test.mjs` | Kiểm thử phiên, vai trò, chủ sở hữu, dữ liệu trả về, body giả mạo |
| Kiểm thử mới | `tests/production-security.test.mjs` | `next start` và kiểm thử HTTP trên production build thật |
| Tài liệu | `README.md`, tài liệu này | Thiết lập an toàn, ma trận quyền, kết quả và giới hạn |

Những API vốn đã có guard an toàn vẫn được kiểm thử dù không cần sửa source. Không sửa `DULIEU/NoSQL_DOAN.cql`, script seed/reset password, repository ghi nghiệp vụ hoặc `src/services/trips.ts`.

## Bằng chứng kiểm thử

Môi trường: Windows PowerShell, Node.js 24.17.0, Next.js 16.3.6 cài trong workspace. Đã đọc hướng dẫn Next.js cục bộ về Route Handlers, instrumentation, biến môi trường và next.config trước khi sửa các phần tương ứng.

| Lệnh | Kết quả lần chạy cuối | Phạm vi chứng minh |
|---|---|---|
| `npm.cmd test` | **147/147 pass**, 0 fail/skip | Gọi đủ 37 phương thức trong 33 file route; ma trận Customer/Customer khác/Driver/Driver khác/Admin; JWT giả/hết hạn/sai claims; tài khoản bị khóa/xóa; lỗi kết nối; giả mạo ID/role/giá; luồng được phép vẫn chạy |
| `npm.cmd run typecheck` | **Exit 0** | TypeScript toàn dự án |
| `npm.cmd run build` | **Exit 0** | Production build hoàn tất, 22 trang tĩnh được sinh; không cần secret triển khai tại build |
| `npm.cmd run test:security:production` | **6/6 pass**, 0 fail/skip | Năm cấu hình khóa sai khiến `next start` thoát khác 0; HTTP production xác nhận 32 phương thức API bảo vệ trả 401 cho cả không cookie và token khóa cũ; đăng nhập Admin hợp lệ, cookie Secure/HttpOnly/SameSite và quyền đọc/ghi được kiểm tra |

Bộ test Route Handler giữ nguyên auth/JWT, route, repository và service thật; chỉ thay cookie context, transport `cassandra-driver` và provider bản đồ. Các thử nghiệm ghi chỉ tác động bộ nhớ của tiến trình test. Test từ chối ghi kiểm tra không phát sinh truy vấn ghi. Đây không phải kiểm thử Cassandra tích hợp hoặc kiểm thử trình duyệt.

Bộ HTTP production chạy `next start` thật trên cổng riêng với khóa/mật khẩu ngẫu nhiên tạm thời, dùng tên keyspace test riêng và cổng Cassandra riêng không có dịch vụ. Chỉ gửi các yêu cầu bị chặn trước truy vấn hoặc yêu cầu không sử dụng database; request Admin có quyền ghi chỉ gửi body không hợp lệ để dừng tại validation. Không chạy ghi trên database hiện có, không tạo/reset keyspace hoặc bảng test.

Kiểm thử ban đầu phát hiện instrumentation production chạy trễ trong phiên bản Next này. Đã bổ sung kiểm tra trong `next.config.ts`, chạy lại build và toàn bộ bộ test production thành công. Next 16.3.6 in thông báo `Ready` trước khi tải config; tiêu chí kiểm thử khóa sai là **tiến trình thoát lỗi với thông báo JWT_SECRET**, không dựa vào dòng log `Ready`.

## Dữ liệu và cấu hình triển khai

- Không chạy DDL, DROP, TRUNCATE, seed, reset password, đối soát hoặc sửa bất kỳ dữ liệu nào trong 19 bảng Cassandra hiện tại.
- Không thêm/sửa cấu trúc database. Không thay mật khẩu khách/tài xế hiện có.
- Chưa đặt secret hoặc mật khẩu Admin thật vào `.env.local`; cần người vận hành cấu hình khóa mới và credential/quyền Admin theo README trước khi khởi động app. Không tái sử dụng khóa fallback hoặc khóa đã lộ.
- Khóa mới và claims mới khiến token cũ không còn hợp lệ; người dùng cần đăng nhập lại. Khi xoay khóa, cập nhật đồng nhất các instance rồi khởi động lại chúng.

## Vấn đề còn tồn tại ngoài Giai đoạn 1

- Chưa kiểm thử end-to-end Customer/Driver trên Cassandra test thật hoặc kiểm thử UI bằng browser. Kết quả ở trên không chứng minh atomicity, khả năng chịu lỗi hoặc tính nhất quán của cluster thật.
- Toàn bộ P1 nghiệp vụ của audit vẫn cần giai đoạn tiếp theo: nhiều chuyến hoạt động/availability, chọn nhầm khóa xe ở UI Admin, idempotency, ghi dở dang, đồng bộ các bảng, voucher, form/retry/giá. Không sửa hoặc đối soát dữ liệu hiện có trong lần này.
- Chưa làm quên/đổi mật khẩu, đăng ký/phê duyệt tài xế, CRUD xe cho tài xế, UI quản lý trạng thái chuyến/cấp voucher, realtime hoặc sửa tìm kiếm bản đồ.
- Chưa có giới hạn thử đăng nhập phân tán, quản lý nhiều tài khoản Admin trong database hoặc thu hồi riêng từng JWT sau logout. Logout vẫn xóa cookie; kiểm tra ACTIVE hiện tại ngăn tài khoản bị khóa tiếp tục dùng phiên. Đổi mật khẩu Admin chưa tự thu hồi từng token; có thể xoay JWT_SECRET để thu hồi toàn bộ phiên.
- Mật khẩu demo của Customer/Driver trong dữ liệu cũ chưa thay đổi. Quyền Admin hiện được quản lý bằng cấu hình server của một tài khoản, không có UI phân quyền. UI vẫn có thể hiển thị mục Admin mà tài khoản thiếu quyền; API từ chối đúng quyền.
- Việc đọc trạng thái tài khoản ở mỗi request làm tăng số truy vấn Cassandra. Chưa đo hiệu năng/tải; không thêm cache trạng thái để tránh kéo dài thời gian hiệu lực của phiên sau khi khóa tài khoản.

Dừng ở Giai đoạn 1, chờ người dùng xác nhận trước khi bắt đầu Giai đoạn 2.
