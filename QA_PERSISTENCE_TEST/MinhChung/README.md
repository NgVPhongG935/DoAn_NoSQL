# Bằng chứng thực tế

## Mới nhất — demo độc lập và restart Cassandra

[Isolated_20261102](Isolated_20261102/) là run mới nhất: cluster riêng 127.0.0.2:9142, keyspace rideflow_qa_demo, RF=1/durable_writes=true. Có luồng UI đặt/nhận/hoàn thành/payment/review, negative guard và lỗi ngưỡng100. comparison_after-cassandra.json xác nhận335/335 row không đổi sau restart sạch; original_comparison.json xác nhận902 row/schema/cấu hình keyspace gốc không đổi. Isolated_TestResults.json là bảng kết quả hiện tại.

SELECT_compact_comparison.png được tạo sau kiểm thử từ JSON timestamp gốc trước/sau để dễ chèn báo cáo; screenshot SELECT nguyên bản trước restart và sau restart được giữ riêng. Không phải ảnh cqlsh. Bộ nội dung/8 ảnh cho Word nằm ở ../BoSung_Word_Muc_3_6/, chưa chỉnh .docx.

## Giai đoạn trước — UI thật trên keyspace cũ và Next restart

Xem [Run_20261102](Run_20261102/): có screenshot thật (46 PNG), JSON response API, SELECT theo UUID/khóa đầy đủ, manifest QA_IDs.json, bằng chứng PID trước/sau Next restart và so sánh 898 bản ghi cũ. TestResults.json là kết quả mới nhất. Không có restart Cassandra.

Screenshot `_SELECT.png` chụp một trình xem bằng chứng cục bộ hiển thị kết quả SELECT thật thu từ Cassandra; không giả là cửa sổ cqlsh hay màn RideFlow. JSON cùng tên có CQL, parameters và rows đầy đủ. Các PNG hồ sơ/complaints/login/registration là screenshot ứng dụng thật trong Edge headless qua CDP, không mock.

## Bằng chứng giai đoạn chỉ đọc ban đầu

- SELECT_Baseline.json: 18 SELECT thật, timestamp UTC, parameters, rows, check và inventory SHA256 src. Dữ liệu cũ, không có QA_TEST_ mới; chưa có restart.
- ClusterStatus.txt, Snapshots.txt: đầu ra nodetool chỉ đọc.
- ListeningPorts.txt: cổng 3000/3001/9042/7199 tại lúc kiểm tra.
- Config_KhongBiMat.txt: chỉ các biến CASSANDRA_/RIDEFLOW_, không có mật khẩu/JWT secret.

Giai đoạn chỉ đọc ban đầu chưa có screenshot. Giới hạn đó đã được mở khóa trong Run_20261102; không dùng trạng thái BLOCKED của giai đoạn cũ cho kết quả browser hiện tại. Ảnh sau restart trong run là restart Next.js, tuyệt đối không coi là đã restart Cassandra.

Để tái chạy baseline chỉ đọc: từ root dự án chạy `node QA_PERSISTENCE_TEST/audit-readonly.cjs`. Lệnh sẽ ghi đè SELECT_Baseline.json; phải lưu bản cũ ở tên riêng trước nếu cần đối chiếu. Script này chọn mẫu hiện hữu, không thay cho script SELECT cố định ID QA sau restart.
