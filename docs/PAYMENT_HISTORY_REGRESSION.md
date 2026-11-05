# Kiểm tra lịch sử thanh toán cũ — 24/10/2026

## Kết luận và giới hạn

Chưa thể đưa lại giao dịch 58.350đ / #2BE76152 trên database thật: tại thời điểm kiểm tra, không tìm thấy mã chuyến bắt đầu bằng `2be76152` hoặc số tiền 58350 trong hai bảng thanh toán và bảng chuyến chính thuộc keyspace đang cấu hình `dat_xe_cong_nghe`. Cũng không có mã/giá trị tương ứng trong ba bảng chuyến phi chuẩn hóa.

Không có đủ bằng chứng xác định vì sao giao dịch từng thấy trước đây không xuất hiện trong nguồn dữ liệu hiện tại. Không kết luận đã bị xóa, reset hoặc do đổi tài khoản. Cần URL và customer_id của phiên trình duyệt người dùng để đối chiếu chính xác phiên đang báo lỗi; không cần mật khẩu, cookie hoặc JWT.

## Đối chiếu code

Thư mục hiện không có `.git`, nên không thể dùng Git working-tree diff. Đã dùng `git diff --no-index` so sánh với bản sao lưu `.backups/payments-reviews-20261024-172217` trước lần sửa thanh toán/đánh giá.

- `src/app/api/customers/[id]/payments/route.ts` không thay đổi.
- `getPaymentsForCustomer` trong `src/repositories/ride-data.ts` không thay đổi trước lượt sửa này: đọc `payments_by_customer` theo đúng customer_id, LIMIT 50.
- Không có điều kiện mới lọc CASH/PAID, không thay Partition Key, không chuyển phương thức lịch sử sang enum đặt chuyến mới.
- Thay đổi tổng chi tiêu chỉ loại khoản chưa xác nhận khỏi phép cộng; không loại dòng khỏi danh sách.
- Nhãn tiếng Việt thay cách hiển thị CASH/BANK_TRANSFER, không sửa giá trị đã lưu.

## Đọc Cassandra thật

Chỉ thực hiện SELECT, bao gồm metadata danh sách bảng để kiểm tra các keyspace có bảng thanh toán. Kết quả ở nguồn cấu hình hiện tại:

| Đối tượng | Kết quả |
|---|---|
| payments_by_customer | 43 dòng |
| payments_by_trip | 43 dòng |
| trips_by_id | 59 dòng |
| Mã chuyến bắt đầu bằng 2be76152 | Không tìm thấy |
| Khoản thanh toán có amount = 58350 | Không tìm thấy |
| Bản sao chuyến liên quan trong trips_by_customer / trips_by_driver / trips_by_status | Không tìm thấy |
| Bản ghi theo chuyến thiếu bản sao theo khách | 0 trong dữ liệu hiện có |

Đã gọi chính GET handler lịch sử thanh toán với Cassandra thật trong CLI riêng, cung cấp session Customer được kiểm soát để kiểm tra route và phân quyền theo chủ partition. Không đăng nhập hộ trên website, không tạo/đổi JWT hoặc cookie của người dùng. Đây không phải kiểm tra phiên đăng nhập thật đang mở trong trình duyệt.

- 27 partition Customer được đối chiếu; tất cả trả HTTP 200, `success: true`, `data` là mảng.
- Số dòng từng phản hồi khớp dữ liệu của chính customer_id đó.
- Có 2 Customer không có dữ liệu thanh toán, API trả `[]` đúng với partition trống.
- Thực hiện 30 SELECT, 0 truy vấn ghi trong lần kiểm tra route này.

Health online chỉ phản ánh trạng thái dịch vụ, không chứng minh một partition có giao dịch.

## Sửa trong lượt này

1. `src/repositories/ride-data.ts`: lịch sử mặc định đọc đủ các trang Cassandra, bỏ giới hạn ngầm 50 dòng. Vẫn chỉ đọc Partition Key của Customer; không thêm lọc phương thức/trạng thái/tháng. Giữ tương thích tham số limit nếu có caller truyền rõ.
2. `src/components/portal/PortalSection.tsx`: riêng lịch sử thanh toán Customer, phản hồi sai kiểu dữ liệu phải hiện lỗi API, không tự chuyển thành danh sách trống. Giữ danh sách đã tải nếu lần tải lại lỗi.
3. `tests/payment-history.test.mjs`: thêm 6 bài kiểm thử hồi quy cho CASH/PAID, dữ liệu cũ ngoài tháng hiện tại, phân trang, CARD/WALLET cũ, quyền chủ partition, partition trống và lỗi transport.
4. `tests/ui-transport.mjs`, `tests/browser-business.test.mjs`: thêm fixture chỉ trong Cassandra in-memory để tái hiện #2BE76152/58.350đ, kiểm tra hiển thị và lỗi sai định dạng. Không đưa fixture vào source ứng dụng, seed hoặc database thật.
5. `package.json`: thêm file test mới vào `npm test`. Không thay dependency hoặc lockfile.
6. `docs/PAYMENT_HISTORY_REGRESSION.md`: báo cáo này.

Giới hạn 50 dòng và việc nuốt sai định dạng là hai điểm yếu đã sửa. Chưa có bằng chứng chúng là nguyên nhân làm giao dịch cụ thể đang phản ánh biến mất, vì bản ghi đó không có trong nguồn Cassandra đã đọc.

## Kết quả kiểm thử

- TypeScript: thành công.
- ESLint các file liên quan: thành công, dùng công cụ tạm trong `.tmp`.
- `npm test`: 366 bài thành công.
- Chrome + Cassandra in-memory: giao dịch cũ của đúng Customer được hiển thị với mã #2BE76152, số tiền 58.350đ, Tiền mặt, Đã thanh toán. Cố ý trả API sai định dạng phải hiện lỗi; tải lại phản hồi hợp lệ hiển thị lịch sử trở lại.
- CASH/BANK_TRANSFER, đánh giá và các kiểm thử trình duyệt hiện có tiếp tục qua.
- Build thành công trong `.tmp/payment-history-preview`; không ghi đè `.next` của web đang chạy.

Source trước lượt sửa nằm ở `.backups/payment-history-20261024-190940`. Không seed, reset, sửa/xóa thanh toán cũ, tạo giao dịch thật, sửa `.env.local`, đổi tài khoản hoặc JWT. Không tự tái tạo bản ghi từ số tiền hay mã rút gọn của người dùng.
