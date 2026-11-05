# Đăng ký và duyệt tài xế RideFlow

## Trạng thái tài khoản

RideFlow dùng `drivers.account_status` cho xét duyệt (`PENDING`, `ACTIVE`, `REJECTED`, `BLOCKED`) và `drivers.driver_status` cho khả năng nhận chuyến (`OFFLINE`, `AVAILABLE`, `BUSY`). Hồ sơ mới bắt đầu ở `PENDING` và `OFFLINE`. `vehicles.driver_id` liên kết phương tiện với tài xế. Luồng này dùng các bảng hiện có, không yêu cầu DDL hay seed dữ liệu.

## Demo thủ công

1. Mở `/register`, chọn **Đăng ký tài xế** và điền thông tin cá nhân, giấy phép lái xe cùng phương tiện. Email, điện thoại và biển số phải chưa được dùng.
2. Gửi form; tài khoản và phương tiện được ghi vào Cassandra. Đăng nhập bằng email/mật khẩu vừa tạo. Tài xế `PENDING` thấy thông báo chờ xét duyệt, không thấy dashboard tác nghiệp.
3. Đăng nhập bằng tài khoản quản trị được cấu hình sẵn, mở **Tài xế** (`/admin/drivers`), kiểm tra giấy phép và thông tin xe, rồi chọn **Duyệt** hoặc **Từ chối**.
4. Sau khi duyệt, tài xế đăng nhập lại (hoặc tải lại trang) và bật nhận chuyến trên dashboard. Trạng thái trực tuyến chỉ đổi giữa `OFFLINE` và `AVAILABLE`; không thay đổi trạng thái phê duyệt.
5. Tài xế bị từ chối vẫn đăng nhập được để xem trạng thái và hướng dẫn liên hệ quản trị viên. Schema hiện tại không có cột lưu lý do từ chối.

## Kiểm tra dữ liệu và test

Sau khi đăng ký trong môi trường Cassandra cần kiểm tra `drivers` theo `driver_id`, rồi kiểm tra `vehicles` theo `driver_id` tương ứng. Các test hồi quy có thể chạy bằng:

```powershell
npm run typecheck
npm test
```

Test đăng ký dùng transport Cassandra giả lập của repository; chúng không tạo dữ liệu thử trong keyspace thật.
