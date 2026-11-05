# Báo cáo kiểm tra RideFlow — 13/10/2026

## Kết luận

RideFlow có backend truy vấn Cassandra thật, giao diện cho ba vai trò và phần lớn luồng nghiệp vụ demo. Dự án chưa hoàn chỉnh theo toàn bộ yêu cầu: thiếu quên mật khẩu, đăng ký/phê duyệt tài xế, cập nhật phương tiện và thanh toán thật; còn lỗi phân quyền và khóa ký phiên mặc định cần ưu tiên cao nhất.

Không sửa mã nguồn, schema hoặc dữ liệu Cassandra trong lần kiểm tra này. Chỉ tạo báo cáo, chạy kiểm tra build/typecheck, đọc database, đăng nhập/đăng xuất phiên kiểm thử và gửi yêu cầu chắc chắn không ghi nghiệp vụ (dữ liệu không hợp lệ). Không tạo/hủy chuyến, hoàn thành chuyến, tạo tài khoản hay khóa người dùng trên dữ liệu hiện có.

## Phạm vi và cách đọc trạng thái

- **H — Hoàn thành và có bằng chứng:** có triển khai cụ thể phù hợp phạm vi ghi trong hàng. Không đồng nghĩa đã chạy toàn bộ kiểm thử ghi end-to-end.
- **D — Đã làm nhưng chưa hoàn thiện:** có triển khai nhưng thiếu chức năng, có lỗi hoặc có giới hạn quan trọng.
- **C — Chưa có:** không tìm thấy luồng giao diện/backend tương ứng sau khi đọc mã nguồn.
- **X — Không thể xác minh:** thiếu kiểm thử trực quan hoặc thử nghiệm ghi/fault injection để kết luận.
- **P0:** xử lý ngay; **P1:** xử lý trước khi demo nghiệm thu/triển khai; **P2:** hoàn thiện chất lượng; **P3:** mở rộng sau.

Đã đọc các Route Handlers, repositories, services, xác thực, form đăng ký/đăng nhập, trang đặt xe, chi tiết chuyến, portal ba vai trò, CSS và script dữ liệu. Đối chiếu metadata Cassandra hiện tại; không dùng README hay tên file làm bằng chứng duy nhất. Không có bộ test tự động riêng hoặc script `test` trong package.json được tìm thấy. Chưa hoàn thành kiểm thử trực quan bằng browser trên desktop/mobile.

## Kết quả chạy thực tế

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| `npm.cmd run typecheck` | Qua | Kiểm tra kiểu, không chứng minh nghiệp vụ |
| `npm.cmd run build` | Qua sau dọn artifact preview cũ | Lần đầu lỗi Turbopack vì file session Chrome bị khóa trong `.tmp/booking-review`, là artifact từ lần làm việc trước của trợ lý. Đã đóng browser preview và xóa đúng thư mục tạm đó; không sửa source để build qua |
| Cassandra | Kết nối được; 19 bảng, 144 cột metadata | Cấu hình mặc định `dat_xe_cong_nghe`, `datacenter1`, `127.0.0.1:9042` |
| `/api/health` | HTTP 200 | Chứng minh truy vấn database được |
| Đăng nhập Customer/Driver demo | HTTP 200 với `RideFlow@123` | Không kiểm thử khóa tài khoản bằng thao tác ghi |
| Đăng xuất phiên kiểm thử | HTTP 200, cookie hết hạn | Không có thu hồi token đã sao chép phía server |
| Không có phiên: auth/me, admin/customers, đặt chuyến | HTTP 401 | Các cổng này chặn khách chưa đăng nhập |
| Đăng nhập sai mật khẩu Admin | HTTP 401 | JSON vẫn có `success: true` do dùng helper `success` cho lỗi |
| Email sai, mật khẩu yếu ở đăng ký | HTTP 400 | Không tạo tài khoản mới |
| Tọa độ ngoài phạm vi, trạng thái `INVALID` | HTTP 400 | Không thay đổi chuyến |
| Đăng nhập nhanh cũ | HTTP 410 | Endpoint demo đã tắt |
| `/forgot-password` | HTTP 404 | Kết hợp tìm kiếm mã nguồn xác nhận thiếu luồng reset |
| Tài xế đọc thanh toán khách không liên quan | HTTP 200, trả 2 bản ghi trong lần thử | Lỗi phân quyền đã tái hiện, không ghi dữ liệu |
| Tài xế đọc khiếu nại khách không liên quan | HTTP 200 | Partition được thử rỗng; quyền truy cập vẫn được chấp nhận |
| Khách đọc doanh thu tài xế | HTTP 200, trả 3 bản ghi trong lần thử | Lỗi phân quyền đã tái hiện |
| Khách đọc thanh toán khách khác / trang API Admin | HTTP 401 | Có chặn cùng vai trò và chặn Customer vào Admin |
| Phiên ADMIN được ký bằng secret fallback trong source | GET admin/customers HTTP 200 | Chỉ thử đọc. Xác nhận cấu hình hiện tại có thể bị giả mạo phiên |
| Tìm địa chỉ Photon `Ben Thanh` | HTTP 503, timeout/phản hồi lỗi mạng | Chưa xác nhận hoạt động tìm địa chỉ trong môi trường hiện tại; không suy luận provider ngừng hoạt động toàn bộ |
| OSRM giữa hai tọa độ TP.HCM | HTTP 200: 1,6 km, 3 phút | Tuyến `driving`, không phải thời gian tài xế đến đón |
| JSON hỏng gửi tới đăng ký | HTTP 500 | Nên trả 400 cho lỗi nội dung yêu cầu |

## Dữ liệu Cassandra đã đọc

Mỗi bảng kiểm tra được đọc với giới hạn 5.000 bản ghi; tất cả số bản ghi dưới đây thấp hơn giới hạn và kết quả truy vấn trả đủ số hàng trong mẫu này. Đây là ảnh chụp dữ liệu tại thời điểm kiểm tra, không phải kiểm thử tải hoặc cluster nhiều replica.

| Bảng/nhóm | Số bản ghi đọc |
|---|---:|
| customers | 26 |
| drivers | 12 |
| trips_by_id, trips_by_customer, trips_by_driver, trips_by_status | 60 mỗi bảng |
| payments_by_trip, payments_by_customer | 43 mỗi bảng |
| reviews_by_trip, reviews_by_driver | 43 mỗi bảng |
| driver_revenue_by_month, customer_spending_by_month | 43 mỗi bảng |
| customer_vouchers | 53 |

Trạng thái chuyến: 43 COMPLETED, 7 CANCELLED, 5 BOOKED, 2 ACCEPTED, 1 ARRIVING, 2 IN_PROGRESS.

- Không phát hiện thiếu/trùng bản sao chuyến hoặc lệch status/driver_id giữa bảng chính và ba bảng tra cứu trong mẫu đã đọc.
- Bản sao payment khớp payment_id/amount/customer_id; bản sao review khớp review_id/rating; 43 chuyến hoàn thành có bản ghi revenue/spending tương ứng, giá trị khớp final_fare trong các kiểm tra đã chạy.
- Không thấy email trùng sau chuẩn hóa trên 26 khách và 12 tài xế.
- Các trường password của khách/tài xế hiện có đều mang định dạng thuật toán `scrypt`; kiểm tra đăng nhập demo chứng minh hai tài khoản mẫu xác thực được. Không công bố hash trong báo cáo.
- **Có 2 tài xế cùng lúc gắn với 2 chuyến hoạt động mỗi người. Có 6 tài xế được lưu AVAILABLE nhưng vẫn có ít nhất một chuyến hoạt động.** Chưa xác định nguồn phát sinh là seed, thao tác trước đây hay một luồng ghi cụ thể. Bộ dữ liệu hiện chưa thỏa quy tắc “mỗi tài xế một chuyến hoạt động”.
- Metadata keyspace thực tế là SimpleStrategy RF=3, trong khi CQL nguồn khai báo RF=1. Kết nối thành công ở `localOne` không xác nhận mọi replica đều khỏe hoặc quorum khả dụng.
- `trips_by_id` hiện không có cột tọa độ, geometry hoặc duration; khó dựng lại bản đồ chính xác sau reload chỉ từ bản ghi chuyến.

## Bảng đánh giá chức năng khách hàng

| Chức năng | Trạng thái | Bằng chứng trong code | Lỗi hoặc thiếu sót | Mức độ ưu tiên |
|---|---|---|---|---|
| Đăng ký khách hàng | D | [A1], [A2], [A3]: parse schema, scrypt salt ngẫu nhiên, INSERT customers | Chỉ khóa trong một tiến trình; chưa có email partition/LWT; chưa xác minh email. Chưa chạy đăng ký thành công để giữ nguyên dữ liệu | P1 |
| Email và mật khẩu đăng ký | H | [A3]: email chuẩn hóa; mật khẩu 8–128, hoa/thường/số/ký tự đặc biệt, không khoảng trắng, xác nhận khớp | Đã thử dữ liệu sai; ràng buộc định dạng không chứng minh quyền sở hữu email | P2 |
| Đăng nhập | D | [A4], [A5], [A6]: tìm account, so hash, kiểm tra ACTIVE, tạo JWT | Đăng nhập demo qua; thiếu giới hạn thử sai; secret fallback; quét hai bảng theo email | P0 |
| Đăng xuất | H | [A7], [A6]: xóa cookie HttpOnly | Đã thử cookie hết hạn; token bị sao chép chưa bị thu hồi phía server | P2 |
| Quên/đổi mật khẩu | C | Route auth chỉ có register/login/logout/me/demo; không có reset/change password | Thiếu token reset, thời hạn, dùng một lần và UI; `/forgot-password` 404 | P1 |
| Hồ sơ, họ tên, số điện thoại | D | [A8], [A9]: PATCH gọi updateCustomer | Regex cập nhật cho phép chuỗi chỉ gồm dấu gạch; khác đăng ký; chưa kiểm tra tồn tại trước UPDATE; tên JWT không tự đổi theo hồ sơ | P1 |
| Nhập/chọn điểm đón và điểm đến | D | [A10], [A11], [A12]: debounce, gợi ý Photon, chọn tọa độ | API tìm địa chỉ trả 503 trong lần thử; chưa có chọn điểm bằng click map; chưa có thao tác bàn phím cho danh sách gợi ý | P1 |
| Vị trí hiện tại | D | [A10], [A12]: geolocation, reverse geocode, xử lý denied/timeout | Chưa xác minh quyền vị trí trên thiết bị; reverse API có thể ép query param thiếu thành số 0 | P2 |
| Khoảng cách, thời gian và giá dự kiến | H | [A12], [A13]: OSRM driving; server tính lại theo base_fare + distance × price_per_km | Đã thử OSRM; thời gian là thời gian di chuyển, không phải ETA đón. Chưa mô hình riêng xe máy | P2 |
| Chọn loại xe | H | [A10], [A13]: đọc ACTIVE services, supportsService kiểm loại/số chỗ | Chọn tài xế ngẫu nhiên trong ứng viên, chưa xét vị trí gần nhất; giới hạn 100 hồ sơ/xe | P2 |
| Đặt chuyến | D | [A13], [A14]: CUSTOMER-only, giá server, ghi bốn bảng + history | Ghi tuần tự, không chống gửi lặp theo idempotency key; lỗi giữa chừng chưa bù dữ liệu đã ghi | P1 |
| Hủy chuyến / đổi hành trình | D | [A15], [A16], [A13]: PATCH CANCELLED, đổi hành trình mở form mới | Cho hủy cả IN_PROGRESS; voucher đã USED không hoàn lại; chưa có chính sách phí hủy | P1 |
| Theo dõi trạng thái | D | [A16]: GET chi tiết + lịch sử | Chỉ tải khi mount hoặc thao tác nội bộ; không polling/SSE/WebSocket, dễ hiển thị trạng thái cũ | P1 |
| Vị trí tài xế thời gian thực | C | Không thấy lưu/truyền GPS hoặc vị trí trên bản đồ chuyến | Chỉ có trạng thái, không theo dõi xe di chuyển | P3 |
| Thông tin tài xế và phương tiện | H | [A17], [A16]: trả driver/vehicle/service; UI tên, phone, model, biển số | Đọc dữ liệu Cassandra thật; cần thu hẹp các API hồ sơ tổng quát | P1 |
| Thanh toán | D | [A13]: COMPLETED tự ghi PAID vào hai bảng | Tiền mặt cũng không có xác nhận thu; CARD/WALLET không gateway, callback hay refund; vẫn là mô phỏng | P1 |
| Voucher | D | [A13], [A18]: kiểm cấp phát, trạng thái, ngày, min/max giảm | Không trừ quantity; không đặt chỗ dùng duy nhất; không hoàn voucher khi hủy; thiếu luồng cấp voucher từ Admin | P1 |
| Lịch sử chuyến / thanh toán | H | [A18], [A9]: truy vấn partition tài khoản, lọc danh sách | Chỉ 50/100 bản ghi, chưa phân trang; quyền đọc chéo vai trò có lỗi ở API | P1 |
| Đánh giá | D | [A19]: chỉ khách sở hữu chuyến COMPLETED, rating 1–5, ghi hai bảng | Check rồi INSERT không nguyên tử; hai yêu cầu có thể lệch hai bảng; rating tính trên 100 review gần nhất | P1 |
| Khiếu nại | D | [A20], [A9]: INSERT complaints_by_customer, liệt kê/cập nhật trạng thái | Chỉ kiểm tripId là UUID, không kiểm chuyến thuộc người gửi; reset form sau await có lỗi; quyền GET quá rộng | P1 |
| Thông báo và đánh dấu đọc | D | [A21], [A9]: truy vấn own partition, PATCH is_read | UI không cập nhật badge topbar sau đánh dấu; không push; UPDATE ID không tồn tại có thể tạo hàng rỗng | P2 |

## Bảng đánh giá chức năng tài xế

| Chức năng | Trạng thái | Bằng chứng trong code | Lỗi hoặc thiếu sót | Mức độ ưu tiên |
|---|---|---|---|---|
| Đăng ký tài xế | C | [A1] chỉ INSERT customers; không có POST tạo hồ sơ tài xế từ đăng ký | Không có thông tin bằng lái, xe, giấy tờ, trạng thái PENDING và nộp hồ sơ | P1 |
| Đăng nhập tài xế | D | [A4], [A5]: drivers, password, account_status | Đã thử HTTP 200; rủi ro phiên/secret và chống brute force chung | P0 |
| Quản lý hồ sơ | D | [A22], [A9]: PATCH họ tên/phone trên drivers | Không cập nhật bằng lái/email/mật khẩu; validation phone yếu | P2 |
| Quản lý phương tiện | D | [A23], [A9]: GET vehicle + DriverVehicleCard | Chỉ xem; không có POST/PATCH đăng ký hoặc sửa xe cho tài xế | P1 |
| Bật/tắt hoạt động | D | [A24], [A25]: AVAILABLE/OFFLINE, chặn BUSY, khóa trong process | Database hiện có AVAILABLE trong khi có chuyến; không kiểm active trips khi đổi trạng thái, không kiểm tồn tại/ACTIVE account tại đây | P1 |
| Nhận chuyến | H | [A15], [A9]: BOOKED → ACCEPTED, chỉ driver được gán | Có luồng trong code; chưa chạy thao tác nhận trên dữ liệu hiện có | P2 |
| Từ chối chuyến | D | [A9], [A13]: nút Báo sự cố, đổi tài xế hoặc hủy | Chưa có từ chối riêng, timeout nhận hoặc lý do; báo sự cố đưa tài xế OFFLINE; cho đổi tài xế cả khi IN_PROGRESS | P1 |
| Điểm đón/đến và khách hàng | D | Driver trips API trả customer_name, customer_phone; [A9] có cột địa chỉ/tên | customer_phone được API trả nhưng chưa được chọn làm cột hay có nút gọi; không có trang/map chi tiết chuyến cho driver | P2 |
| Đến đón, bắt đầu, hoàn thành | D | [A13], [A15], [A9]: bảng transitions và DriverTripAction | Chuyển trạng thái tuần tự được kiểm soát; concurrent requests chưa bị CAS/lock theo trip chặn, có thể tạo payment trùng | P1 |
| Lịch sử và doanh thu | D | [A18], revenue API, [A26] | Cassandra thật; tháng mặc định 2026-09; giới hạn đọc; customer đang đọc được revenue của driver | P1 |

## Bảng đánh giá chức năng Admin

| Chức năng | Trạng thái | Bằng chứng trong code | Lỗi hoặc thiếu sót | Mức độ ưu tiên |
|---|---|---|---|---|
| Khách hàng | D | [A27], [A28], [A9]: danh sách, ACTIVE/BLOCKED | Không đủ CRUD; UPDATE không kiểm tồn tại; khóa không vô hiệu phiên đang có | P1 |
| Tài xế | D | [A27], [A28], [A9]: danh sách, ACTIVE/BLOCKED | Không tạo tài xế từ UI; không quy trình hồ sơ/duyệt; khóa phiên có cùng vấn đề | P1 |
| Phê duyệt tài xế | C | Schema/status chỉ có ACTIVE/BLOCKED; không có nộp/duyệt hồ sơ | Bật ACTIVE không phải quy trình phê duyệt | P1 |
| Phương tiện | D | [A28] PATCH vehicles; [A9] AdminStatusAction | Lấy khóa sai: ưu tiên row.driver_id trước row.vehicle_id; thao tác có thể UPDATE nhầm UUID và tạo xe thiếu dữ liệu | P1 |
| Chuyến và trạng thái | D | [A27] GET trips; [A15] cho ADMIN cập nhật trạng thái | Trang Admin trips chỉ liệt kê, chưa có nút cập nhật/chi tiết; giới hạn tháng/100 chuyến | P1 |
| Thanh toán | D | [A27] GET payment theo các chuyến COMPLETED đã đọc | Chỉ xem, chưa xử lý sai lệch/refund/đối soát; dữ liệu thanh toán mô phỏng | P2 |
| Voucher | D | [A27], [A28], [A9]: tạo, API sửa, bật/tắt | UI thiếu chỉnh toàn bộ thuộc tính; không cấp cho khách; mã trùng dùng INSERT có thể ghi đè; không kiểm start ≤ end, PERCENT ≤ 100 | P1 |
| Khiếu nại | H | [A20], admin complaints PATCH, [A9]: OPEN → PROCESSING → RESOLVED | Có luồng giải quyết; chưa có nội dung phản hồi cho khách hoặc lịch sử người xử lý | P2 |
| Thống kê doanh thu/chuyến | D | [A26], [A18], [A29]: tổng hợp Cassandra, chart | Lấy tối đa 100 chuyến mới nhất nên bỏ sót dữ liệu lớn; doanh thu theo tháng booked_at khác revenue driver theo completed_at; mặc định 2026-09 | P1 |
| Phân quyền/bảo mật | D | [A6], [A27], các layout role | Đã tái hiện giả mạo ADMIN với fallback secret và đọc chéo vai trò | P0 |
| Thông báo | D | [A27], [A9]: POST và form gửi | Danh sách người nhận lấy từ thông báo đã có, không từ danh sách người dùng; không gửi được thông báo đầu tiên cho người chưa có notification; reset sau await | P2 |

## Backend, database và giao diện

| Chức năng | Trạng thái | Bằng chứng trong code | Lỗi hoặc thiếu sót | Mức độ ưu tiên |
|---|---|---|---|---|
| Đọc Cassandra thật | H | [A30] execute prepared; repositories SELECT; health và metadata đã chạy | Không có mock fallback ở repositories | P2 |
| Ghi Cassandra theo bảng nghiệp vụ | H | INSERT/UPDATE trong [A2], [A13], [A19], [A20], [A27], [A28] | Có câu lệnh thật; không khẳng định E2E mọi luồng ghi đã chạy trong audit | P2 |
| Bản sao denormalized hiện tại | H | Đọc so sánh trip/payment/review/revenue/spending nêu trên | Chỉ các trường đã kiểm tra tại thời điểm đọc, không chứng minh an toàn trước fault/concurrency | P1 |
| An toàn ghi nhiều bảng | D | [A13], [A19]: nhiều await query độc lập | Không rollback/bù/reconcile/outbox; xóa index trạng thái trước update chính; ghi dở dang có thể mất danh sách hoặc lệch dữ liệu | P1 |
| Đồng thời và idempotency | D | [A31] khóa gán driver; [A2] khóa đăng ký | Khóa RAM chỉ một process; thay đổi trip/review/voucher không có đặt chỗ nguyên tử; paymentId random khi hoàn thành | P1 |
| Băm mật khẩu | H | [A2], [A5], script seed/set-demo-passwords | scrypt + salt ngẫu nhiên cho đăng ký, timingSafeEqual; bộ demo cùng hash/password, không phù hợp tài khoản thật | P1 |
| Validation API | D | Zod ở các routes; prepared values trong [A30] | UUID path không kiểm đồng nhất; JSON hỏng trả 500; một số lỗi success:true; reverse thiếu param thành 0 | P2 |
| Kiểm tra tài khoản bị khóa | D | [A4] chỉ kiểm khi login; [A6] chỉ verify JWT | Các API sau login không kiểm trạng thái hiện tại; tài khoản bị khóa vẫn dùng phiên đến hết hạn | P1 |
| Cluster/consistency | X | Live RF=3; [A30] mặc định localOne; CQL RF=1 | Chưa kiểm replica/quorum/khả năng chịu lỗi; không khẳng định môi trường đủ cho LWT | P1 |
| Hardcode và mô phỏng | D | [A5] Admin hash; demo-users; [A26] tháng; LandingPage; script seed | Admin hardcode; trang chủ bản đồ minh họa/18 phút; payment mô phỏng. Seed là dữ liệu mẫu ghi Cassandra, khác mock trả cố định từ API | P2 |
| Responsive desktop/mobile | X | globals.css, pink-theme.css, booking-layout.css có media queries | Có triển khai CSS, chưa hoàn tất kiểm thử trực quan nhiều viewport/thiết bị; không kết luận giao diện đã đạt | P2 |
| Điều hướng / bảo vệ trang | H | Layout ba vai trò, allowlist sections, Link và redirect | Có allowlist/notFound; quên mật khẩu/đăng ký driver không có trang; chưa click-test toàn bộ menu | P2 |
| Loading, lỗi, trạng thái rỗng | D | RideLoader, [A9], [A10], [A16], [A29] | Có UI; nút Thử lại dashboard dùng setMonth với chính giá trị hiện tại nên không kích hoạt effect | P1 |
| Form tạo và gửi khiếu nại | D | [A9] currentTarget.reset sau await tại dòng 129/253/322/339 | currentTarget của event không được giữ sau dispatch; nguy cơ báo lỗi sau khi database đã ghi thành công, không reload danh sách | P1 |
| Hiện mật khẩu đăng ký | D | RegisterForm .remember-check; CSS ẩn input và vẽ ô bằng span | JSX thiếu span nên mất ô check trực quan; label vẫn có thể click nhưng trạng thái không nhìn thấy | P2 |
| Giá chuyến miễn phí | D | [A16] `final_fare || estimated_fare || 0` | final_fare=0 bị thay bởi giá trước giảm; số trên chi tiết không khớp thanh toán | P1 |
| Test tự động / hồi quy | C | package.json không có test; không tìm thấy bộ unit/integration/E2E riêng | Cần kiểm thử quyền, concurrency, lỗi từng bước ghi, giá/voucher và UI | P1 |

## Lỗi ưu tiên và bằng chứng

### P0-01 — Có thể giả mạo phiên Admin

[A6] có secret fallback cố định trong source. Khi thiếu AUTH_SECRET, người có source biết khóa và có thể ký JWT với role ADMIN. Đã thử một token kiểm tra có hạn ngắn, chỉ gọi GET admin/customers: HTTP 200. Không công bố token hoặc dùng để thay đổi dữ liệu.

Khuyến nghị: bắt buộc secret ngẫu nhiên đủ mạnh, không có fallback dùng cho môi trường thật; xoay khóa để làm hết hiệu lực token cũ; không nhận user/role chỉ dựa vào secret đã lộ; bổ sung quản lý tài khoản Admin và phiên. Đây là lỗi đang xác nhận trong cấu hình hiện tại, không chỉ giả thuyết triển khai.

### P0-02 — Kiểm tra quyền đọc thiếu vai trò/phạm vi

Ví dụ customer payments chỉ từ chối khi người gọi CUSTOMER và userId khác id. DRIVER không rơi vào điều kiện đó nên được đọc thanh toán khách tùy ý. Tương tự driver revenue chỉ kiểm người gọi DRIVER, nên CUSTOMER được đọc revenue. Nhiều route hồ sơ/trips/reviews/vouchers/complaints có mẫu tương tự. `/api/drivers` cũng trả hồ sơ rộng cho mọi phiên đăng nhập.

Khuyến nghị: ma trận quyền rõ cho từng API, mặc định từ chối; khách chỉ tài khoản mình, tài xế chỉ hồ sơ/chuyến được phân công và thông tin khách tối thiểu của chuyến đó, Admin theo quyền cụ thể. Không xem bảo vệ layout là thay thế bảo vệ API.

### P1-01 — Trạng thái chuyến, payment và gán tài xế chưa an toàn khi đồng thời/lỗi

changeTripStatus đọc trạng thái rồi ghi thường, không CAS. Hai yêu cầu đều đọc IN_PROGRESS có thể cùng ghi COMPLETED và tạo hai paymentId. Nếu ghi payment thất bại sau khi trip thành COMPLETED, retry bị bảng transitions từ chối, khiến payment thiếu mà không có đường phục hồi. Nếu một bước đặt chuyến lỗi, catch chỉ release driver, không dọn các bản sao đã ghi. Đổi tài xế có rủi ro tương tự. Đây là kết luận từ code; không chạy fault injection trên dữ liệu hiện có.

Khuyến nghị: idempotency key, payment key ổn định theo trip, điều kiện phiên bản trạng thái, cơ chế ghi có thể retry và bù/đối soát; thiết kế lại lease gán tài xế cho multi-instance. Dữ liệu hiện đã có tài xế gắn nhiều active trips và availability lệch, cần đối soát riêng thay vì quy kết một nguyên nhân chưa chứng minh.

Không coi thêm BATCH là đủ để tạo transaction có isolation giữa mọi partition; chọn LWT/điều kiện cho một số ràng buộc và thiết kế phục hồi cho denormalization. Tham khảo [Cassandra CQL DML](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html).

### P1-02 — Admin thao tác phương tiện dùng sai khóa

AdminStatusAction lấy `customer_id || driver_id || vehicle_id ...`. Hàng vehicles có cả driver_id lẫn vehicle_id nên chọn driver_id. API lại `UPDATE vehicles ... WHERE vehicle_id = id`. Có thể báo thành công nhưng xe gốc không đổi và một row chỉ có khóa/trạng thái được tạo. Không thử PATCH để tránh tạo dữ liệu sai.

Khuyến nghị: chọn trường khóa theo resource và kiểm row tồn tại trước cập nhật. Cassandra UPDATE có thể upsert; tham khảo [Cassandra UPDATE](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html#update).

### P1-03 — Voucher và session khóa tài khoản

Voucher quantity được kiểm >0 nhưng không giảm. Một voucher có thể dùng đồng thời cho nhiều chuyến vì check AVAILABLE nằm ngoài đặt chỗ nguyên tử; bị USED ngay lúc đặt và không trả lại sau hủy. Admin khóa tài khoản chỉ ghi trạng thái, không thu hồi phiên đang có. Đăng ký email duy nhất hiện cũng chỉ được bảo vệ trong một process; nguồn ghi khác hoặc nhiều instance có thể vượt qua.

### P1-04 — Nút/form lỗi và báo cáo thiếu chính xác

- Retry dashboard dùng setMonth(month); React có thể bỏ qua cập nhật cùng giá trị, effect không chạy lại. [React useState](https://react.dev/reference/react/useState).
- Bốn form reset event.currentTarget sau await: cần giữ tham chiếu form ngay khi submit để tránh mất currentTarget và báo lỗi sau một lần ghi đã thành công.
- Chi tiết giá dùng `||` làm sai chuyến được giảm về 0.
- Dashboard tháng mặc định 2026-09 trong khi thời điểm audit là 13/10/2026. Driver/Customer dashboard không có bộ chọn tháng như Admin nên có thể tiếp tục xem tháng cũ.
- Thống kê Admin lấy 100 chuyến mới nhất của tháng, không toàn bộ; doanh thu theo booked_at khác thời điểm ghi revenue driver khi completed_at. Cần định nghĩa doanh thu nhất quán.

## Những chức năng có bằng chứng hoàn thành

Trong phạm vi demo: đăng nhập Customer/Driver đã chạy thành công; đăng xuất xóa cookie; validation đăng ký; client Cassandra và các truy vấn có prepared values; danh mục dịch vụ; OSRM khoảng cách/thời gian; giá được tính lại phía server; thông tin tài xế/xe trong chi tiết; đọc lịch sử chuyến/thanh toán; luồng xử lý khiếu nại và phân chia portal. Có code và dữ liệu cho đặt/hủy/cập nhật chuyến, thanh toán mô phỏng, review, doanh thu và chi tiêu; các luồng này vẫn có vấn đề liệt kê trong bảng nên không gọi là hoàn thiện toàn bộ.

## Những chức năng còn thiếu

Quên/đổi mật khẩu; xác minh email; đăng ký tài xế và phê duyệt hồ sơ; tạo/sửa phương tiện từ portal tài xế; thao tác trạng thái chuyến từ trang Admin; thanh toán thực và đối soát/refund; cấp voucher cho khách; cập nhật trạng thái tự động; GPS tài xế; phân trang; quản lý tài khoản Admin và thu hồi phiên; bộ test hồi quy.

## Kế hoạch cải thiện

| Giai đoạn | Việc cần làm | Điều kiện nghiệm thu |
|---|---|---|
| 1 — P0 | Secret bắt buộc, xoay khóa, ma trận quyền từng API, thu hẹp dữ liệu trả về | Token ký bằng khóa cũ bị từ chối; Customer/Driver không đọc tài nguyên ngoài phạm vi; test roles × endpoints pass |
| 2 — P1 dữ liệu | Sửa khóa vehicle; kiểm tồn tại trước UPDATE; đối soát availability/active trips; chống lặp/đồng thời trip/payment/review/voucher; thiết kế phục hồi ghi dở dang | Một driver tối đa một active trip; mỗi completed trip đúng một payment hợp lệ; lỗi ở từng bước ghi có retry/đối soát; voucher không dùng lặp |
| 3 — P1 trải nghiệm | Sửa currentTarget, retry, giá 0, tháng hiện tại; polling trạng thái; kiểm phạm vi complaint trip; thông báo khi map provider lỗi | Gửi form thành công không báo lỗi giả; retry gọi lại API; giá khớp; trạng thái mới xuất hiện tự động; test viewport 390/768/1440 |
| 4 — P1 đồ án | Reset password an toàn; đăng ký/duyệt driver; CRUD xe; Admin cập nhật chuyến; cấp voucher | Chạy end-to-end bằng bộ dữ liệu test riêng, có minh chứng Cassandra trước/sau từng luồng |
| 5 — P2/P3 | Phân trang và bảng query theo email/driver/aggregate ngày; quy ước thời gian Việt Nam; accessibility; thanh toán sandbox, GPS nếu phạm vi yêu cầu | Báo cáo đủ khi >100 chuyến, tra cứu không scan toàn bảng; kiểm bàn phím/mobile; phân biệt rõ tính năng demo và tích hợp thật |

Ưu tiên cho đồ án: hoàn tất giai đoạn 1–4 và ghi rõ payment demo. GPS/gateway thật có thể để phạm vi mở rộng nếu đề bài không bắt buộc, nhưng không trình bày là đã hoàn thành.

## Kiểm thử cần thực hiện tiếp trên database test riêng

1. Đăng ký mới → kiểm hash/row → email trùng → đăng nhập → cập nhật hồ sơ → logout; cùng email gửi đồng thời từ hai app instance.
2. Đặt chuyến đủ ba loại xe/voucher; cố gửi giá hoặc driverId giả; gửi lại request với cùng idempotency key.
3. Khách khác/tài xế khác gọi mọi API; tài khoản đã BLOCKED với cookie cũ; forged/expired/modified JWT.
4. Nhận → đến đón → bắt đầu → hoàn thành; thử bỏ bước; hai hoàn thành đồng thời; hoàn thành và hủy đồng thời.
5. Làm lỗi mỗi lần ghi Cassandra; kiểm bốn bản sao, history, payment, review, doanh thu, chi tiêu, availability và retry.
6. Voucher hết hạn/hết lượt/chưa cấp/đơn thiếu điều kiện; hai chuyến dùng cùng voucher; hủy/đổi chuyến và chính sách trả voucher.
7. Admin sửa trạng thái xe xác nhận đúng vehicle_id; ID không tồn tại không tạo hàng thiếu; mã voucher trùng không ghi đè ngoài ý muốn.
8. Viewport desktop/mobile, menu, địa chỉ dài, bàn phím, loading/rỗng/lỗi/timeout/offline, ảnh tile lỗi và quyền GPS bị từ chối.

## Bằng chứng mã nguồn

[A1]: D:/mongodb/DOAN_NOSQL/src/app/api/auth/register/route.ts
[A2]: D:/mongodb/DOAN_NOSQL/src/services/registration.ts:12
[A3]: D:/mongodb/DOAN_NOSQL/src/lib/registration-schema.ts
[A4]: D:/mongodb/DOAN_NOSQL/src/app/api/auth/login/route.ts
[A5]: D:/mongodb/DOAN_NOSQL/src/lib/demo-auth.ts
[A6]: D:/mongodb/DOAN_NOSQL/src/lib/auth.ts:7
[A7]: D:/mongodb/DOAN_NOSQL/src/app/api/auth/logout/route.ts
[A8]: D:/mongodb/DOAN_NOSQL/src/app/api/customers/[id]/route.ts
[A9]: D:/mongodb/DOAN_NOSQL/src/components/portal/PortalSection.tsx
[A10]: D:/mongodb/DOAN_NOSQL/src/components/booking/BookingForm.tsx
[A11]: D:/mongodb/DOAN_NOSQL/src/components/booking/AddressSearch.tsx
[A12]: D:/mongodb/DOAN_NOSQL/src/services/maps.ts
[A13]: D:/mongodb/DOAN_NOSQL/src/services/trips.ts
[A14]: D:/mongodb/DOAN_NOSQL/src/app/api/trips/route.ts
[A15]: D:/mongodb/DOAN_NOSQL/src/app/api/trips/[id]/status/route.ts
[A16]: D:/mongodb/DOAN_NOSQL/src/components/trips/TripDetail.tsx
[A17]: D:/mongodb/DOAN_NOSQL/src/app/api/trips/[id]/route.ts
[A18]: D:/mongodb/DOAN_NOSQL/src/repositories/ride-data.ts
[A19]: D:/mongodb/DOAN_NOSQL/src/app/api/trips/[id]/review/route.ts
[A20]: D:/mongodb/DOAN_NOSQL/src/app/api/customers/[id]/complaints/route.ts
[A21]: D:/mongodb/DOAN_NOSQL/src/app/api/users/[id]/notifications/[createdAt]/[notificationId]/route.ts
[A22]: D:/mongodb/DOAN_NOSQL/src/app/api/drivers/[id]/route.ts
[A23]: D:/mongodb/DOAN_NOSQL/src/app/api/drivers/[id]/vehicle/route.ts
[A24]: D:/mongodb/DOAN_NOSQL/src/app/api/drivers/[id]/status/route.ts
[A25]: D:/mongodb/DOAN_NOSQL/src/components/portal/DriverAvailability.tsx
[A26]: D:/mongodb/DOAN_NOSQL/src/services/dashboard.ts
[A27]: D:/mongodb/DOAN_NOSQL/src/app/api/admin/[resource]/route.ts
[A28]: D:/mongodb/DOAN_NOSQL/src/app/api/admin/[resource]/[id]/route.ts
[A29]: D:/mongodb/DOAN_NOSQL/src/components/portal/RoleDashboard.tsx
[A30]: D:/mongodb/DOAN_NOSQL/src/lib/cassandra.ts
[A31]: D:/mongodb/DOAN_NOSQL/src/lib/driver-assignment-lock.ts

Các mã A1–A31 trong bảng là liên kết trực tiếp tới tệp tương ứng. Các trường hợp không tìm thấy chức năng dựa trên tìm kiếm mã nguồn và kiểm tra routes, không phải suy luận từ tên màn hình.
