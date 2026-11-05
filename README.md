# RideFlow

> Ứng dụng minh họa quản trị và khai thác Apache Cassandra cho nghiệp vụ đặt xe công nghệ, phục vụ đồ án DbSchema.

RideFlow là ứng dụng full-stack dùng **Next.js App Router + TypeScript**. Route Handlers và server-side repositories kết nối trực tiếp tới Cassandra; trình duyệt không kết nối database. Thiết kế truy vấn theo schema trong `DULIEU/NoSQL_DOAN.cql` và metadata đọc từ keyspace đang chạy.

## Stack và kiến trúc

- Next.js 16.3.6, React 19, TypeScript, App Router / Route Handlers.
- Tailwind CSS 4 (PostCSS), CSS design tokens, Lucide React, Leaflet / React Leaflet.
- Recharts cho dashboard, Zod cho validation, `cassandra-driver` cho CQL, `jose` cho phiên demo.
- Apache Cassandra là database duy nhất. Không có Express server riêng.

```text
Browser -> Next.js pages/components -> Next.js Route Handlers
        -> services -> Cassandra repositories -> dat_xe_cong_nghe
```

Repo tham khảo `MrKhanhDong/DoAnCuNhan-Web` thực tế dùng Next.js 16.3.4, React 19, TypeScript, Tailwind 4, App Router, Route Handlers và JWT/RBAC; database của repo tham khảo là MongoDB. RideFlow giữ tổ chức App Router, layout theo role và API server-side, thay persistence bằng Cassandra, không dùng lại nghiệp vụ cũ.

## Cấu trúc

```text
src/
  app/                 Public pages, customer/driver/admin portals, API routes
  components/          Landing, auth, booking, dashboards, reusable portal UI
  lib/                 Cassandra client, sessions, HTTP helpers, demo identities
  repositories/        Prepared CQL grouped by access pattern
  services/            Trip lifecycle and dashboard aggregation
scripts/
  inspect-cassandra-schema.mjs
docs/
  CASSANDRA_SCHEMA.md  Metadata đọc từ system_schema.columns
DULIEU/
  NoSQL_DOAN.cql       Schema và dữ liệu mẫu; app không tự chạy file này
```

## Yêu cầu và chạy trên Windows

- Node.js 20.9 trở lên (đã kiểm tra với Node 24.17.0).
- Apache Cassandra đang chạy, native transport mở trên `127.0.0.1:9042`.
- Keyspace `dat_xe_cong_nghe` và bảng đã tồn tại. Ứng dụng không tạo, xóa hay làm rỗng keyspace/bảng.

Mở terminal tại thư mục project:

```powershell
Copy-Item .env.example .env.local
npm install
npm run db:migrate:customer-password
npm run db:inspect
```

Trước khi chạy server, tạo khóa mới bằng lệnh dưới rồi điền kết quả vào `JWT_SECRET` trong `.env.local`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
npm run dev
```

Không có khóa mặc định. `next dev` và `next start` dừng nếu khóa thiếu, quá ngắn hoặc là placeholder. `AUTH_SECRET` cũ không còn được dùng; phiên cũ phải đăng nhập lại. `next build` có thể chạy không cần khóa triển khai, còn server luôn kiểm tra lại cấu hình lúc khởi động.

Mở [http://localhost:3000](http://localhost:3000). Backend API chạy cùng Next.js tại [http://localhost:3000/api/health](http://localhost:3000/api/health). Health response kiểm tra kết nối bằng truy vấn `system.local`.

Nếu Cassandra chạy ở nơi khác, sửa `.env.local`:

```dotenv
CASSANDRA_CONTACT_POINTS=127.0.0.1
CASSANDRA_PORT=9042
CASSANDRA_LOCAL_DATACENTER=datacenter1
CASSANDRA_KEYSPACE=dat_xe_cong_nghe
CASSANDRA_CONSISTENCY=localOne
JWT_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
PHOTON_BASE_URL=https://photon.komoot.io
OSRM_BASE_URL=https://router.project-osrm.org
```

`npm run db:inspect` đọc `system_schema.columns`, gồm cột, kiểu dữ liệu, partition/clustering key và clustering order, rồi cập nhật `docs/CASSANDRA_SCHEMA.md`. Script chỉ đọc metadata.

`npm run db:migrate:customer-password` thêm cột `customers.password_version` nếu chưa có, trước khi chạy phiên bản hỗ trợ đặt lại mật khẩu. Lệnh giữ nguyên dữ liệu tài khoản và mật khẩu hiện có; có thể chạy lại. Quản trị viên vào **Khách hàng → Đặt lại mật khẩu**, kiểm tra tên/email, nhập mật khẩu mới hai lần rồi xác nhận. Khách đăng nhập bằng mật khẩu mới; phiên cũ của khách được thu hồi. Mật khẩu không được lưu trong bộ nhớ retry của trình duyệt và không xuất hiện trong phản hồi API.

Keyspace đang chạy được metadata xác nhận là `SimpleStrategy` RF=3, trong khi file CQL nguồn khai báo RF=1; hiện chỉ một replica phản hồi. Ứng dụng mặc định `localOne` để chạy demo trên node đơn mà không chỉnh sửa database. Khi các replica trong local datacenter sẵn sàng, có thể đổi sang `localQuorum`.

Keyspace cần giữ `durable_writes=true` để ghi nhật ký cho các cập nhật. Môi trường đã được bật lại tùy chọn này sau khi phát hiện các sửa chữ chưa được flush bị mất lúc máy chủ dừng. Công cụ sửa tiếng Việt từ chối áp dụng khi tùy chọn này đang tắt; nó vẫn cho phép chạy kiểm tra chỉ đọc.

Ở lần kiểm tra gần nhất, cả 19 bảng nghiệp vụ đều rỗng nên RideFlow đã nạp bộ demo bằng `scripts/seed-demo-data.mjs`: 25 khách hàng, 12 tài xế/xe, 3 dịch vụ, 53 chuyến seed (43 completed), 43 payments/reviews, 10 vouchers, 53 customer-voucher assignments (5 cấp cho Customer demo), 8 complaints và 37 notifications, kèm history/revenue/spending. Sau kiểm thử tự động ghép/đổi/khóa tài xế, keyspace có thêm 5 chuyến test đã hủy; các tài xế thử nghiệm được trả lại trạng thái `AVAILABLE`. Script kiểm tra metadata và xác nhận toàn bộ bảng rỗng trước lần ghi đầu; sau khi có dữ liệu, chạy lại sẽ dừng an toàn.

```powershell
npm run db:seed:demo -- --dry-run
npm run db:seed:demo
```

Chỉ chạy trên một keyspace demo trống. `--dry-run` chỉ đọc metadata và kiểm tra một row mỗi bảng; lệnh seed thật dùng `INSERT` theo schema đã xác minh. Không chạy `DROP`, `TRUNCATE`, DDL hoặc ghi đè khi bảng đã có dữ liệu. Với keyspace RideFlow hiện đang chạy, seed sẽ dừng vì bảng đã có dữ liệu. Không dùng `cqlsh -f DULIEU/NoSQL_DOAN.cql` cho bộ demo này vì file gốc chỉ có 15 chuyến và dùng tên mẫu transliterated.

## Tài khoản demo

Đăng ký khách hàng tại `/register` qua `POST /api/auth/register`. Email được chuẩn hóa chữ thường, kiểm tra định dạng và trùng trên khách hàng/tài xế/admin. Mật khẩu 8–128 ký tự, có chữ hoa, chữ thường, số, ký tự đặc biệt, không có khoảng trắng; xác nhận phải khớp. Mật khẩu lưu bằng scrypt với salt ngẫu nhiên. Đăng ký không cấp quyền tài xế/admin và chưa xác minh email bằng OTP.

Kiểm tra email hiện đọc toàn bộ hai bảng và khóa đăng ký trong một tiến trình Node.js, phù hợp bản demo một máy chủ. Nếu triển khai nhiều instance, cần bảng tra cứu email và cơ chế đặt chỗ duy nhất phân tán trên Cassandra đủ quorum; không dùng cơ chế hiện tại để bảo đảm duy nhất toàn cluster. Cassandra phải hoạt động để đăng ký/đăng nhập khách hàng và tài xế; lỗi kết nối được trả HTTP 503 với thông báo dễ hiểu.

Trang `/login` dùng email và mật khẩu, tự nhận diện vai trò rồi chuyển đến đúng portal. Bộ dữ liệu demo khách hàng và tài xế có mật khẩu `RideFlow@123`; Giai đoạn 1 không sửa mật khẩu hay dữ liệu Cassandra hiện có. Admin demo được cấu hình riêng trong `.env.local`, không có mật khẩu dự phòng trong source. Ngoài hai tài khoản mẫu dưới đây, email lần lượt có dạng `customer02@rideflow.demo`…`customer25@rideflow.demo` và `driver02@rideflow.demo`…`driver12@rideflow.demo`:

| Vai trò | Email | Nguồn hồ sơ |
|---|---|---|
| Customer | `khach01@example.com` | Cassandra `customers`, ID `4bae3c1f-2dce-4210-bd2d-829f0bf4a7ef` |
| Driver | `taixe01@example.com` | Cassandra `drivers`, ID `dde73e75-5100-4169-8593-9cf8b9c7df83` |
| Admin | Giá trị `ADMIN_EMAIL` | Cấu hình server; schema hiện tại không có bảng admin/account |

Mật khẩu không được lưu dạng rõ: Cassandra lưu chuỗi băm `scrypt`, API không bao giờ trả trường `password`, và server so sánh constant-time. Không chạy seed, migration hoặc script đặt lại mật khẩu để xử lý đăng nhập. Auth tạo cookie HttpOnly ký bằng `jose`, hết hạn sau 8 giờ hoặc 30 ngày khi chọn “Ghi nhớ đăng nhập”. Customer và Driver chỉ đăng nhập được khi hồ sơ Cassandra tương ứng tồn tại và ở trạng thái active. Endpoint đăng nhập nhanh cũ đã bị vô hiệu hóa.

Để bật Admin, chỉ cần `ADMIN_EMAIL` và `ADMIN_PASSWORD_HASH` trong `.env.local`. Mọi phiên ADMIN hợp lệ có toàn quyền quản trị; không cần `ADMIN_PERMISSIONS` (biến cũ được bỏ qua). Không cấu hình hash thì đăng nhập Admin bị tắt, Customer/Driver vẫn dùng Cassandra. Có thể tạo hash bằng mật khẩu nhập ẩn trên PowerShell:

```powershell
$rideflowAdminPassword = Read-Host "Mật khẩu Admin mới" -AsSecureString
$rideflowAdminPlain = [System.Net.NetworkCredential]::new("", $rideflowAdminPassword).Password
$rideflowAdminPlain | node scripts/hash-admin-password.mjs --dotenv
Remove-Variable rideflowAdminPlain, rideflowAdminPassword
```

Dán dòng `ADMIN_PASSWORD_HASH=...` xuất ra vào `.env.local`. Giữ các ký tự `\$` vì Next.js mở rộng biến chứa `$`. Mật khẩu Admin cần 12–128 ký tự, có hoa/thường/số/ký tự đặc biệt. Không ghi mật khẩu hoặc khóa JWT vào source. Khởi động lại các instance sau khi đổi cấu hình hoặc xoay khóa.

Mỗi request có phiên Customer/Driver đều kiểm tra lại tài khoản Cassandra để chặn phiên của tài khoản đã khóa/xóa. API kiểm tra vai trò và quyền sở hữu; `customer_id`, `driver_id`, `role` trong body/query không cấp quyền. Cấu hình demo hiện tại xem [báo cáo đơn giản hóa xác thực](docs/RIDEFLOW_AUTH_DEMO_2026-10-21.md). Báo cáo P0 là tài liệu lịch sử; phần quyền Admin chi tiết đã được thay bằng kiểm tra vai trò.

Kiểm thử bảo mật dùng Node.js 22.15+ hoặc 24. Các route/repository/service thật được chạy với Cassandra trong bộ nhớ; không kết nối database hiện tại:

```powershell
npm test
npm run typecheck
npm run build
npm run test:security:production
```

Bộ production yêu cầu build có sẵn, khởi động các tiến trình test trên cổng riêng, kiểm tra cấu hình/JWT/quyền Admin qua HTTP và dừng chúng khi xong. Nó không gửi yêu cầu hợp lệ có thể ghi Cassandra.

## Giai đoạn 2: nghiệp vụ và migration đang chờ duyệt

Các sửa lỗi form, retry dashboard, tháng báo cáo, hiển thị giá 0, chọn đúng `vehicle_id`, kiểm tra bản ghi tồn tại và validation voucher đã có trong source. Phần điều phối bền vững chuyến/voucher/payment/review được chuẩn bị riêng, mặc định **chưa bật**: `RIDEFLOW_BUSINESS_JOURNAL_ENABLED=false`.

Để bật phần này cần duyệt và áp dụng [migration chỉ thêm một bảng journal](docs/RIDEFLOW_P1_MIGRATION_PROPOSAL.md), kiểm thử trên Cassandra test riêng và xác minh production đủ SERIAL/QUORUM. Chưa có migration hoặc kiểm thử ghi Cassandra thật nào được thực hiện trong Giai đoạn 2. Khi cờ còn `false`, ứng dụng giữ luồng ghi cũ; các bảo đảm journal/idempotency/phục hồi mới chưa có hiệu lực. Không được mô tả môi trường hiện tại là đã có đầy đủ bảo đảm P1.

Chế độ journal lưu kế hoạch ghi trước, dùng LWT cùng partition để điều phối, ID/timestamp cố định để retry và phục hồi bằng roll-forward. Các API dữ liệu tài chính/chuyến từ chối trả snapshot nếu đang có operation chưa xong hoặc có mutation xen giữa lần đọc. API đặt chuyến yêu cầu `Idempotency-Key`; giao diện giữ khóa này khi kết quả chưa rõ và chỉ tạo khóa mới cho thao tác mới. CARD/WALLET tiếp tục là mô phỏng.

Kiểm thử mã và trình duyệt, không ghi database hiện tại:

```powershell
npm test
npm run test:security:journal
npm run typecheck
npm run build
npm run test:security:production
npm run test:business:browser
```

Kiểm thử browser cần Chrome trên Windows, có thể đặt `RIDEFLOW_TEST_CHROME` nếu dùng đường dẫn khác. Nó dùng production build thật, dữ liệu Cassandra trong bộ nhớ và profile Chrome tạm riêng; không chứng minh Cassandra thật hoạt động. Chi tiết nằm trong [báo cáo P1](docs/RIDEFLOW_P1_BUSINESS_2026-10-21.md).

`npm run db:business:check` là công cụ đối soát chỉ đọc; trả exit 2 nếu phát hiện dữ liệu cần xử lý. Chạy `node scripts/reconcile-business.mjs --help` để xem cách dùng mà không kết nối database. Chế độ `--recover --apply` chỉ dành cho operation PREPARED đã lưu sau khi migration được duyệt/bật, không tự hủy/xóa chuyến xung đột từ dữ liệu lịch sử. Không chạy đối soát ghi trên database hiện tại khi chưa được phép.

## Chức năng và bảng Cassandra

| Chức năng | Bảng Cassandra |
|---|---|
| Hồ sơ khách hàng, cập nhật tên/điện thoại | `customers` |
| Hồ sơ tài xế, trạng thái online/offline | `drivers` |
| Phương tiện | `vehicles` |
| Danh mục và giá dịch vụ | `service_types` |
| Chi tiết chuyến | `trips_by_id` |
| Lịch sử chuyến khách hàng | `trips_by_customer` |
| Lịch sử chuyến tài xế | `trips_by_driver` |
| Báo cáo chuyến theo trạng thái/ngày | `trips_by_status` |
| Timeline trạng thái | `trip_status_history` |
| Thanh toán chuyến | `payments_by_trip` |
| Lịch sử thanh toán khách hàng | `payments_by_customer` |
| Review theo chuyến | `reviews_by_trip` |
| Review tài xế | `reviews_by_driver` |
| Catalog voucher | `vouchers` |
| Voucher đã nhận của khách | `customer_vouchers` |
| Khiếu nại theo khách hàng | `complaints_by_customer` |
| Thông báo theo người dùng | `notifications_by_user` |
| Doanh thu tài xế theo tháng | `driver_revenue_by_month` |
| Chi tiêu khách hàng theo tháng | `customer_spending_by_month` |

Booking nhận điểm đón/điểm đến từ Photon, dùng OSRM tính tuyến đường thực tế rồi tính lại km và giá ở server. Khách không chọn tài xế: RideFlow tự chọn ngẫu nhiên trong nhóm tài xế `AVAILABLE`, không có chuyến hoạt động và có phương tiện phù hợp. Tài xế được chuyển sang `BUSY`, vì vậy chỉ giữ đúng một đơn cho tới khi hoàn thành/hủy. Nếu tài xế báo sự cố, RideFlow chuyển tài xế cũ sang `OFFLINE`, tự gán tài xế khác và đưa chuyến về `BOOKED`; nếu không còn người thay thế thì chuyến mới bị hủy. Khách hủy được hỏi tiếp tục, đổi hành trình hoặc hủy hẳn; đổi hành trình sẽ giải phóng chuyến cũ rồi mở form đặt xe để tính lại tuyến và giá. Hệ thống đồng bộ `trips_by_id`, `trips_by_customer`, `trips_by_driver`, `trips_by_status`, `trip_status_history` và gửi notification cho khách khi đổi tài xế.

## API chính

- `GET /api/health` — kiểm tra Cassandra.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` — đăng nhập bằng email/mật khẩu, đọc và kết thúc phiên; endpoint `/api/auth/demo` cũ trả `410 Gone`.
- `GET /api/dashboard?month=YYYY-MM` — dashboard theo role.
- `GET /api/customers/:id`, `PATCH /api/customers/:id` — hồ sơ khách.
- `GET /api/customers/:id/trips|payments|vouchers|reviews|complaints`; complaints hỗ trợ `POST`.
- `GET /api/drivers/:id`, `/trips`, `/reviews`, `/vehicle`, `/revenue/:month`; trạng thái dùng `PATCH /api/drivers/:id/status`.
- `GET /api/maps/geocode`, `GET /api/maps/reverse-geocode`, `POST /api/maps/route` — tìm địa chỉ, vị trí hiện tại và tuyến đường qua proxy server-side.
- `GET /api/services`; `POST /api/trips`; `GET /api/trips/:id`; `PATCH /api/trips/:id/status`; `POST /api/trips/:id/review`.
- `/api/admin/:resource` — danh sách/fan-out giới hạn, tạo service/voucher/notification; `/api/admin/:resource/:id` — cập nhật customer/driver/vehicle/service/voucher status.
- `PATCH /api/admin/complaints/:customerId/:createdAt/:complaintId` — chuyển khiếu nại theo đầy đủ partition/clustering key.
- `GET /api/users/:id/notifications`; đánh dấu đã đọc dùng đầy đủ partition/clustering key.

CQL nằm trong repositories/services server-side. API dùng Zod validation, prepared statements và error response có status rõ ràng.

## Giới hạn theo schema

- `customers`, `drivers`, `vehicles`, `service_types` và `vouchers` không có partition/query table để liệt kê theo điều kiện. Trang quản trị đọc tối đa 100 dòng bằng `LIMIT`, không lọc server-side để giả lập search. Cách này chỉ phù hợp quy mô đồ án nhỏ.
- Admin thống kê chuyến bằng truy vấn `(status, trip_date)`, đọc đủ các trang trong tháng chọn. Tháng mặc định là tháng hiện tại ở Việt Nam; ranh giới lọc dữ liệu lịch sử vẫn dùng UTC. Tổng customer/driver là số bản ghi đọc tối đa 100, không phải tổng đếm toàn cluster.
- Customer/Driver dashboard lọc chuyến/thanh toán theo khoảng thời gian trong partition của tài khoản, không còn lấy 50 chuyến gần nhất rồi coi là dữ liệu tháng chọn. Những màn danh sách khác vẫn có giới hạn đọc riêng.
- Không có partition tổng thể cho payments/reviews/complaints/notifications. Admin đọc payments/reviews theo completed trips đã truy vấn trong tháng; complaints/notifications vẫn fan-out trên tối đa 100 customer và 100 driver partitions, rồi giới hạn response. Giá trị chuyến COMPLETED theo tháng đặt chuyến khác dòng tiền theo tháng thanh toán; dashboard ghi rõ cách tính.
- `vehicles` chỉ có partition `vehicle_id`; tìm phương tiện theo tài xế dùng danh sách giới hạn 100, phù hợp dữ liệu demo.
- Photon và OSRM mặc định là public demo endpoint, phù hợp trình diễn nhưng không có cam kết uptime; production nên thay `PHOTON_BASE_URL`/`OSRM_BASE_URL` bằng dịch vụ tự host hoặc nhà cung cấp có SLA. `CASH/CARD/WALLET` là trạng thái demo, không kết nối cổng thanh toán.
- Khi journal chưa bật, khóa gán tài xế chỉ nằm trong tiến trình Next.js, không có bảo đảm cho nhiều instance/restart. Audit từng ghi nhận RF=3 và chưa xác minh quorum. Chế độ journal bắt buộc quorum; không tự hạ consistency để tiếp tục ghi khi cluster không đủ replica.
- 19 bảng cũ không lưu quan hệ trip-voucher. Chế độ journal lưu quan hệ này trong kết quả booking, giảm quantity và hoàn đúng một lượt khi hủy trước khi bắt đầu. Không suy đoán voucher của chuyến cũ để tự hoàn lượt; cần đối soát riêng.
- Cassandra không có transaction quan hệ xuyên nhiều partition. Chế độ journal điều phối các writer và từ chối snapshot đọc không ổn định; ghi dở có thể tồn tại trong lúc operation PREPARED và cần roll-forward. Không coi BATCH nghiệp vụ nhiều partition là transaction MySQL. Cơ chế này chưa có hiệu lực khi cờ đang `false`.
- Ứng dụng không chạy migration/DDL; không `DROP`, `TRUNCATE` hay xóa dữ liệu hiện tại.

## Kiểm tra và ảnh báo cáo

```powershell
npm run typecheck
npm run build
npm run db:inspect
```

Gợi ý ảnh: landing page, Customer dashboard, trang đặt xe có voucher, chi tiết/timeline chuyến, Driver dashboard với trạng thái online, Admin dashboard tháng 09/2026, danh sách service/voucher và `docs/CASSANDRA_SCHEMA.md` để giải thích partition/clustering key.

Các kiểm thử API/Cassandra và browser mô tả ở các bản demo cũ không phải bằng chứng cho thay đổi P1 hiện tại. Kết quả mới, phạm vi mock/browser và phần Cassandra thật chưa chạy được ghi riêng trong báo cáo P1. Các lệnh kiểm tra:

```powershell
npm run typecheck
npm run build
```
