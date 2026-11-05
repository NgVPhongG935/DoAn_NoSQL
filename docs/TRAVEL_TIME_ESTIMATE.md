# Khoảng thời gian di chuyển tham khảo

Giao diện dùng quãng đường của bản đồ và định mức theo yêu cầu để hiển thị một khoảng thời gian cho từng loại xe:

| Loại xe | Định mức giả định | Ví dụ 6 km |
|---|---|---|
| Xe máy | 1–4 phút/km | 6–24 phút |
| Ô tô 4 chỗ, 7 chỗ và xe cao cấp | 10–15 phút/km | 60–90 phút |

Mức ô tô 10–15 phút/km là giả định mô phỏng theo ảnh tham khảo được yêu cầu, không phải tốc độ phổ biến hay dữ liệu giao thông thực tế. Cả hai đầu khoảng được làm tròn lên theo phút, tối thiểu 1 phút. Không cộng thời gian chờ tài xế. Đổi loại xe hoặc quãng đường sẽ tính lại khoảng thời gian.

Định mức tập trung tại `src/lib/travel-time.ts`. Giao diện đặt xe và kết quả API đặt chuyến dùng chung hàm; API trả khoảng trong `travelTimeEstimate`. Trường `durationMinutes` của tuyến đường vẫn là số phút ước tính từ bộ định tuyến và không được dùng thay khoảng thời gian trên giao diện.

Khoảng thời gian này không làm thay đổi cách tính quãng đường, giá cước hoặc giảm giá, và không sửa các chuyến đã lưu.
