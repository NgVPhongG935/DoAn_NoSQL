# Vận hành demo độc lập đã kiểm thử

Các lệnh dưới đây chỉ dành cho demo `RideFlow_QA_20261102`, CQL `127.0.0.2:9142`, JMX `7299`. Không dùng chúng cho node gốc `127.0.0.1:9042/7199`.

Demo hiện được giữ chạy để xem tại `http://127.0.0.1:3200`. Database gốc và Next gốc ở3100 giữ nguyên. Data, commitlog, config, snapshot backup và credentials demo nằm trong `Private/isolated/`; không xóa hoặc đưa thư mục này vào báo cáo chia sẻ. `.gitignore` đã loại Private.

Nếu demo đã dừng, từ thư mục dự án chạy:

```powershell
node QA_PERSISTENCE_TEST/Private/isolated/Start-CassandraDemo.cjs
```

Chờ SELECT/nodetool trạng thái UN, rồi chạy terminal riêng:

```powershell
node QA_PERSISTENCE_TEST/Private/isolated/Start-NextDemo.cjs
```

Không chạy lại `isolated-setup.cjs prepare/create-schema`: các lệnh đó dành cho lần chuẩn bị đầu tiên và được thiết kế từ chối ghi đè môi trường đã có. Không chạy seed cũ. Script `.ps1` chuẩn bị ban đầu bị PowerShell chặn execution policy; đã chạy Java trực tiếp mà không thay policy. Launcher `.cjs` mới dùng cùng Java args để người dùng vận hành sau này, chưa khởi chạy thêm instance.

Để dừng an toàn khi cần: ngừng ghi/mở browser demo, dùng nodetool chỉ tới JMX7299 và chờ DRAINED, sau đó Ctrl+C tại đúng console Cassandra demo. Ctrl+C riêng console Next demo khi cần dừng app. Không taskkill/Stop-Process/force kill; không nhầm JMX7199. Không dùng shutdown Windows làm thay thế bài test restart sạch đã thực hiện.

Thông tin đăng nhập Admin demo nằm trong `Private/isolated/demo-env.json` (admin). Customer/Driver demo nằm trong `Private/isolated/isolated-run.json`. Các credential đều được tạo mới, không lấy từ dữ liệu gốc; không ghi ra ảnh/Word. Source nguyên bản không được sửa để né lỗi100; lỗi vẫn còn để tái hiện.

Backup: `Private/isolated/backup-before-restart/`, snapshot tag `QA_TEST_BEFORE_RESTART`, kèm schema-only.166 file đã được đối chiếu checksum, **chưa rehearsal restore**. Nếu thử restore sau này, dùng instance thứ ba trống và quy trình được review; không import vào database gốc.
