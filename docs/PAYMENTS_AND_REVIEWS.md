# Thanh toán và đánh giá chuyến đi RideFlow

## Chức năng đã triển khai

### Thanh toán

- `/customer/booking` có hai lựa chọn: **Tiền mặt (CASH)** và **Chuyển khoản (BANK_TRANSFER)**. Tiền mặt là mặc định; có thể đổi trước khi đặt chuyến. API cũng mặc định CASH nếu không truyền phương thức. CARD/WALLET chỉ còn được đọc từ dữ liệu cũ, không dùng cho đặt chuyến mới.
- Tiền mặt: khách thanh toán cho tài xế khi kết thúc chuyến. Dialog hoàn thành nhắc tài xế đã thu tiền; API hoàn thành chuyến CASH yêu cầu `cashReceived: true`. Khi đó backend ghi PAID và đồng bộ hai bảng thanh toán/thống kê.
- Chuyển khoản: hoàn thành chuyến tạo bản ghi PENDING trong hai bảng thanh toán, trả Driver về trạng thái khả dụng và chưa ghi doanh thu/chi tiêu của khoản chưa xác nhận.
- Customer mở chi tiết chuyến đã hoàn thành và gửi yêu cầu **Tôi đã chuyển khoản**. Hệ thống ghi PENDING_CONFIRMATION vào Cassandra, không tự đánh dấu đã thanh toán.
- Chi tiết hiển thị mã chuyến, số tiền và nội dung chuyển khoản `RIDEFLOW <mã chuyến>`. Không hiển thị thông tin tài khoản ngân hàng hoặc QR.
- Tài xế được gán chuyến vào `/driver/trips`, mở **Xem thanh toán** và bấm **Xác nhận đã nhận tiền**. Chỉ tài xế đúng chuyến có quyền xác nhận; Admin có thể từ chối yêu cầu đang chờ trong `/admin/payments`. Xác nhận ghi PAID_DEMO cùng thời điểm xác nhận; từ chối ghi FAILED.
- Lịch sử thanh toán dùng nhãn tiếng Việt, hiển thị trạng thái và chỉ hiển thị thời điểm thanh toán/xác nhận khi đã được xác nhận. Tổng chi tiêu loại các khoản còn chờ.
- Driver có nút **Xem thanh toán** ở chuyến hoàn thành để tra cứu; nút xác nhận chuyển khoản chỉ xuất hiện với Admin.

### Cơ chế lưu thanh toán

Hệ thống không thực hiện chuyển tiền hoặc xác minh ngân hàng. Không yêu cầu biến môi trường ngân hàng, số tài khoản, QR, cổng thanh toán hay API bên ngoài. Customer gửi yêu cầu nhiều lần vẫn giữ nguyên payment_id và không tạo bản ghi thanh toán thứ hai. Admin có thể từ chối; Customer thấy trạng thái bị từ chối và có thể gửi lại yêu cầu.

### Đánh giá

- Trong `/customer/trips/{tripId}`, chuyến COMPLETED chưa có đánh giá hiển thị **Đánh giá tài xế**. Khách mở form, chọn 1–5 sao, nhập nhận xét và bấm **Gửi đánh giá**.
- API xác thực chủ chuyến, trạng thái hoàn thành, số sao nguyên 1–5 và giới hạn 1.000 ký tự nhận xét. Không chấp nhận đánh giá chuyến của người khác hoặc chưa hoàn thành.
- Lưu đồng bộ `reviews_by_trip`, `reviews_by_driver` và cập nhật `drivers.rating`. Gửi lại cùng nội dung là retry idempotent, không tạo đánh giá thứ hai; gửi nội dung khác cho chuyến đã đánh giá bị từ chối.
- Chi tiết chuyến hiển thị sao/nhận xét đã gửi. Không còn nút xác nhận đánh giá lặp khi dữ liệu đã đồng bộ. Nếu phát hiện thiếu bản sao hoặc sai điểm trung bình sau lỗi ghi, có nút **Thử đồng bộ đánh giá** dùng lại nội dung đã lưu.
- Driver xem tại `/driver/reviews`; Admin xem tại `/admin/reviews` theo tháng của chuyến và quyền hiện có.

## Schema và đồng bộ

Không thêm bảng hoặc cột. Đã đọc metadata trực tiếp từ Cassandra để đối chiếu:

- `payments_by_trip`: partition `trip_id`; clustering `payment_id`.
- `payments_by_customer`: partition `customer_id`; clustering `paid_at`, `payment_id`.
- `reviews_by_trip`: partition `trip_id`.
- `reviews_by_driver`: partition `driver_id`; clustering `created_at`, `review_id`.
- Hai bảng thống kê theo tháng giữ nguyên khóa hiện có.

`paid_at` là thành phần khóa bắt buộc của `payments_by_customer`, nên bản ghi **chưa thanh toán** dùng thời điểm hoàn thành chuyến làm khóa tạm. Giao diện không hiển thị thời điểm này là thời điểm đã thanh toán. Khi tài xế xác nhận, backend chuyển bản ghi theo khách sang thời điểm xác nhận và xóa khóa tạm. Hai bản sao có cùng payment_id, phương thức, số tiền, trạng thái và thời điểm sau xác nhận.

Kế hoạch ghi được giữ để thử lại khi Cassandra trả kết quả không chắc chắn; payment_id ổn định theo chuyến. Khi mất cache tiến trình, retry dựa trên bản ghi theo chuyến để giữ ID/thời điểm và dọn bản sao theo khách còn ở khóa tạm. Phát hiện nhiều bản ghi theo chuyến, số tiền hoặc chủ khoản không khớp sẽ báo đối chiếu thay vì tự ghi đè.

Tiếp tục sử dụng hàng đợi ghi hiện có cho một máy chủ và hỗ trợ đường xử lý business journal vốn có. Không bật journal, chạy migration hoặc bổ sung cơ chế giao dịch mới.

## Cách thử trên web

Các bước dưới đây là thao tác người dùng chủ động; chúng tạo/cập nhật bản ghi khi chạy với database thật. Agent chưa thực hiện các thao tác ghi này trên Cassandra thật.

1. **Tiền mặt:** Customer đặt chuyến với Tiền mặt; Driver nhận, đến điểm đón, bắt đầu, thu tiền rồi xác nhận hoàn thành. Customer kiểm tra `/customer/payments`: Tiền mặt, Đã thanh toán, đúng số tiền và thời điểm.
2. **Yêu cầu chuyển khoản:** Customer chọn Chuyển khoản, đặt chuyến; Driver hoàn thành. Customer mở chi tiết và bấm **Tôi đã chuyển khoản**. Trạng thái chuyển sang chờ tài xế xác nhận.
3. **Tài xế xác nhận nhận tiền:** tài xế được gán chuyến mở `/driver/trips`, xem thanh toán và bấm **Xác nhận đã nhận tiền**. Customer tải lại lịch sử để kiểm tra trạng thái; thử gửi lại không tạo payment_id/bản ghi mới. Admin có thể từ chối yêu cầu đang chờ.
4. **Đánh giá:** Customer mở chuyến hoàn thành, bấm Đánh giá tài xế, chọn sao/nhận xét và gửi. Tải lại trang vẫn thấy đánh giá, không còn form đánh giá mới. Driver/Admin xem được nội dung tương ứng.
5. **Trường hợp bị từ chối:** mở chuyến chưa hoàn thành không có nút đánh giá; tài khoản khác không đánh giá/xác nhận hộ; Customer/Admin không thể xác nhận đã nhận tiền thay tài xế; Admin không thể từ chối khi chưa có yêu cầu đang chờ.

## Kiểm thử đã chạy

- `npm run typecheck`: thành công.
- ESLint các file nguồn và test thay đổi: thành công bằng công cụ tạm có sẵn trong `.tmp`; không thêm dependency ứng dụng.
- `npm test`: **385/385 bài thành công**. Bộ thanh toán/lịch sử chạy riêng: **31/31 bài thành công**, gồm xác nhận bởi đúng tài xế, từ chối bởi Admin, Customer đọc lại API chi tiết/lịch sử và giữ giao dịch CASH 58.350đ.
- Build production thành công trong workspace preview cô lập `.tmp/payment-demo-preview`; không ghi đè `.next` đang được Next dev sử dụng.
- Browser Chrome đã qua luồng Customer gửi yêu cầu → tài xế xác nhận → Customer/Admin xem trạng thái thanh toán. Bài browser tổng thể còn lỗi ở bước kiểm tra phân công chuyến Driver (assignment poll), ngoài luồng thanh toán.
- Schema Cassandra `payments_by_customer` và `payments_by_trip` được giữ nguyên. Kiểm thử ghi dùng Cassandra in-memory; lượt này không thực hiện ghi/xóa/seed hoặc kiểm tra thao tác ghi trên Cassandra thật.

## Các file thay đổi

- `src/lib/payment-values.ts`: nhãn tiếng Việt và trạng thái đã xác nhận.
- `src/services/payments.ts`: ghi yêu cầu PENDING_CONFIRMATION, giới hạn xác nhận cho tài xế đúng chuyến, xác nhận PAID_DEMO, từ chối FAILED và đồng bộ thống kê.
- `src/services/demo-trip-status.ts`, `src/services/trip-plans.ts`: hoàn thành chuyến dùng kế hoạch thanh toán chung.
- `src/services/trips.ts`: kiểm tra phương thức đặt chuyến.
- `src/services/dashboard.ts`: tổng chi tiêu chỉ tính khoản đã xác nhận.
- `src/app/api/trips/route.ts`: CASH/BANK_TRANSFER và mặc định CASH.
- `src/app/api/trips/[id]/payment/route.ts`: đọc thanh toán, gửi yêu cầu, xác nhận/từ chối theo quyền; không trả cấu hình ngân hàng.
- `src/app/api/trips/[id]/status/route.ts`: xác nhận thu tiền mặt trước khi hoàn thành.
- `src/app/api/trips/[id]/review/route.ts`: thông báo rõ lỗi quyền/trạng thái/UUID.
- `src/app/api/trips/[id]/route.ts`: phát hiện đánh giá ghi thiếu bản sao hoặc điểm trung bình.
- `src/components/booking/BookingForm.tsx`: lựa chọn phương thức và hướng dẫn.
- `src/components/trips/TripPaymentPanel.tsx`, `src/app/trip-payments.css`: chi tiết thanh toán, xác nhận đã nhận tiền của tài xế và từ chối của Admin.
- `src/components/trips/TripDetail.tsx`: nút đánh giá, sao/nhận xét, hiển thị và retry đồng bộ thật.
- `src/components/portal/PortalSection.tsx`: nhãn lịch sử tiếng Việt và trạng thái thanh toán.
- `tests/payments-reviews.test.mjs`, `tests/browser-business.test.mjs`: kiểm thử nghiệp vụ và giao diện thanh toán mô phỏng.
- `docs/PAYMENTS_AND_REVIEWS.md`: tài liệu này.

Source trước khi sửa nằm tại `.backups/payments-reviews-20261024-172217`. Không có Git trong thư mục hiện tại. Không thay đổi tài khoản demo, mật khẩu, JWT, `.env.local`, Word, schema hoặc dữ liệu Cassandra thật. Nếu chạy Next dev, tải lại trang; nếu chạy production, build và khởi động lại Next.js để dùng bản mới.
