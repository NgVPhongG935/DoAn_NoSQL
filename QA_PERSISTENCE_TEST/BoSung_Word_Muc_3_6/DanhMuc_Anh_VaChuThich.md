# Ảnh và chú thích đề xuất cho mục3.6

Chưa chèn vào Word. Chỉ dùng ảnh run demo độc lập. Có thể đánh số lại theo quy ước tài liệu sau khi người dùng xác nhận.

- [01_DatChuyen.png](Anh/01_DatChuyen.png): Hình3.6.1. Chuyến mới được tạo qua giao diện Customer trong môi trường demo riêng. Nguồn: ../MinhChung/Isolated_20261102/booking_created.png

- [02_Driver_HoanThanh.png](Anh/02_Driver_HoanThanh.png): Hình3.6.2. Driver đọc lại lịch sử chuyến COMPLETED sau restart Cassandra demo. Nguồn: ../MinhChung/Isolated_20261102/driver_after_db_restart_trips.png

- [03_ThanhToan_DanhGia_SauRestart.png](Anh/03_ThanhToan_DanhGia_SauRestart.png): Hình3.6.3. Customer đọc cùng chuyến, thanh toán18000đ và đánh giá5 sao sau restart. Nguồn: ../MinhChung/Isolated_20261102/check-after-cassandra_trip.png

- [04_SELECT_TruocSauRestart.png](Anh/04_SELECT_TruocSauRestart.png): Hình3.6.4. Bảng đối chiếu từ SELECT thật trước/sau restart demo, cùng UUID/trạng thái và335 row không đổi. Đây là trình xem bằng chứng, không phải cqlsh. Nguồn: ../MinhChung/Isolated_20261102/SELECT_compact_comparison.png

- [05_DoanhThu_Driver.png](Anh/05_DoanhThu_Driver.png): Hình3.6.5. Doanh thu Driver vẫn18000đ sau restart Cassandra demo. Nguồn: ../MinhChung/Isolated_20261102/driver_after_db_restart_revenue.png

- [06_Admin_Dashboard.png](Anh/06_Admin_Dashboard.png): Hình3.6.6. Admin đọc1 chuyến hoàn thành, doanh thu18000đ và điểm trung bình5; số actor bị giới hạn100 được ghi rõ. Nguồn: ../MinhChung/Isolated_20261102/admin_after_db_restart_dashboard.png

- [07_Loi_GioiHan100.png](Anh/07_Loi_GioiHan100.png): Hình3.6.7. Lỗi Driver không thấy xe do global LIMIT100, dù SELECT theo vehicle_id có row. Nguồn: ../MinhChung/Isolated_20261102/limit_driver_own_vehicle_missing.png

- [08_Guard_AVAILABLE.png](Anh/08_Guard_AVAILABLE.png): Hình3.6.8. Ứng dụng chặn đổi availability khi canonical trip đang hoạt động; trạng thái sai được tạo có chủ đích chỉ trên demo. Nguồn: ../MinhChung/Isolated_20261102/negative_available_active_rejected.png

Ảnh04 là bản trình bày gọn từ JSON có timestamp gốc trước/sau. Screenshot SELECT nguyên bản và JSON CQL/parameters vẫn ở MinhChung/Isolated_20261102; không gọi ảnh04 là cửa sổ cqlsh hoặc ảnh UI chụp trước restart.
