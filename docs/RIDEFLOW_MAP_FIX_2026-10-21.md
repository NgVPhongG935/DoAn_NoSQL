# Sửa tải nền bản đồ — 21/10/2026

Máy kiểm tra phân giải tile.openstreetmap.org về 127.0.0.1/::1, yêu cầu ảnh trả lỗi ECONNREFUSED. Đây là lỗi truy cập riêng nguồn nền, không chứng minh kết nối Internet nói chung bị hỏng. Không thay DNS, hosts hoặc cấu hình hệ thống trong đợt này.

RideMap tự chuyển một lần sang https://tile.openstreetmap.de/{z}/{x}/{y}.png khi nguồn chính lỗi. Giữ tọa độ, điểm A/B, tuyến đường và mức zoom hiện tại. Giữ ghi công OpenStreetMap/FOSSGIS; nút thử lại tải lại nguồn đang chọn. Nếu cả hai nguồn lỗi vẫn hiển thị thông báo, không giả ảnh nền thành công. Giới hạn mức zoom ảnh gốc 18 để tránh yêu cầu mức zoom quá cao.

Nguồn dự phòng dành cho đồ án phi thương mại quy mô nhỏ, theo [điều kiện nhà cung cấp](https://openstreetmap.de/germanstyle/). Không tải hàng loạt hoặc lưu bản đồ offline; không dùng cấu hình demo này như cam kết dịch vụ cho triển khai thương mại.

File sửa: src/components/booking/RideMap.tsx. Kiểm thử mới: tests/browser-map.test.mjs.

Kiểm tra:

- npm run typecheck và npm run build: đạt.
- npm test: 261/261 đạt.
- node --test tests/browser-map.test.mjs: đạt. Chrome thật chặn nguồn chính qua CDP, tự chuyển sang nguồn dự phòng, tải đủ 6 ảnh nền trong khung đang hiển thị, có hai marker và tuyến, không có exception JavaScript. Trình duyệt/server test đều dừng sau kiểm thử.
- Ảnh nền tải thật từ FOSSGIS; địa chỉ/tuyến là fixture và Cassandra là mock. Không kiểm tra độ chính xác tuyến đường thực tế trong ca này; không ghi dữ liệu Cassandra thật.

Bằng chứng: [ảnh chụp](evidence/MAP_FALLBACK_2026-10-21.png), [kết quả](evidence/MAP_FALLBACK_2026-10-21.json).

Tải lại trang bằng Ctrl+F5 để nạp code mới. Nếu chạy next start thì cần khởi động lại server sau build.
