from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
import copy
import re

root = Path(__file__).resolve().parents[1]
source = root / 'word/Detai17_PhamNguyenKhanhDong.docx'
backup = source.with_name(source.stem + '_ban_goc.docx')
if not backup.exists():
    backup.write_bytes(source.read_bytes())
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with zipfile.ZipFile(backup) as z:
    files = {name: z.read(name) for name in z.namelist()}
for _, pair in ET.iterparse(__import__('io').BytesIO(files['word/document.xml']), events=['start-ns']):
    prefix, uri = pair
    if prefix not in ('xml',) and not prefix.startswith('ns'):
        ET.register_namespace(prefix, uri)
doc = ET.fromstring(files['word/document.xml'])
body = doc.find(W+'body')
def text(p):
    return ''.join(t.text or '' for t in p.iter(W+'t'))
def settext(p, value):
    nodes = list(p.iter(W+'t'))
    if nodes:
        nodes[0].text = value
        for node in nodes[1:]: node.text = ''
def paragraph(value):
    p = ET.Element(W+'p'); r = ET.SubElement(p,W+'r'); ET.SubElement(r,W+'t').text = value
    return p
def before(target, lines):
    for p in list(body):
        if p.tag == W+'p' and text(p) == target:
            index = list(body).index(p)
            for line in lines:
                body.insert(index, paragraph(line)); index += 1
            return

seen_explorer = False
for p in list(body.iter(W+'p')):
    value = text(p)
    if 'NoSQL Manager for Cassandra' in value:
        settext(p, value.replace('NoSQL Manager for Cassandra','DBeaver'))
    if value == 'Giao diện Database Explorer':
        if not seen_explorer: seen_explorer = True
        else:
            settext(p, 'Database Explorer hiển thị keyspace, danh sách bảng, cột và khóa. Người dùng chọn bảng để kiểm tra cấu trúc và mở trình xem dữ liệu.')
            if seen_explorer == 'replaced': settext(p, '')
            seen_explorer = 'replaced'
    if value.startswith('Do Cassandra là cơ sở dữ liệu NoSQL'):
        settext(p, 'Cassandra không có ràng buộc khóa ngoại và không tự kiểm soát toàn vẹn tham chiếu giữa các bảng. DbSchema có thể biểu diễn quan hệ ảo phục vụ tài liệu hóa; các quan hệ này không phải ràng buộc được Cassandra thực thi. Việc thiết kế vẫn cần dựa trên Partition Key, Clustering Column và nhu cầu truy vấn.')
    if value.startswith('Partition Key xác định cách dữ liệu được phân phối'):
        settext(p, '')
    if 'Hình 1. 2..' in value: settext(p, value.replace('Hình 1. 2..','Hình 1.2. '))
    if value == 'Bảng 1.So sánh': settext(p, 'Bảng 1. So sánh DbSchema với DBeaver và công cụ dòng lệnh cqlsh')

before('Triển khai kết nối với ứng dụng', [
    'Ví dụ CQL kiểm tra theo nhu cầu truy vấn (thay UUID mẫu bằng mã thực tế trong database):',
    'SELECT * FROM customers WHERE customer_id = 4bae3c1f-2dce-4210-bd2d-829f0bf4a7ef;',
    'SELECT * FROM trips_by_customer WHERE customer_id = 4bae3c1f-2dce-4210-bd2d-829f0bf4a7ef LIMIT 10;',
    "SELECT * FROM driver_revenue_by_month WHERE driver_id = dde73e75-5100-4169-8593-9cf8b9c7df83 AND year_month = '2026-09';",
    'Truy vấn lịch sử giới hạn theo partition khách hàng. Truy vấn doanh thu cung cấp đủ hai thành phần khóa phân vùng là driver_id và year_month. Kết quả thực tế cần được chụp khi Cassandra hoạt động; báo cáo không giả định UUID mẫu luôn có dữ liệu.'
])
before('DEMO ỨNG DỤNG', [
    'Đăng ký khách hàng được thực hiện qua POST /api/auth/register. Email được kiểm tra định dạng, chuẩn hóa chữ thường và kiểm tra trùng với tài khoản khách hàng, tài xế và email quản trị. Mật khẩu dài 8–128 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt, không có khoảng trắng; mật khẩu xác nhận phải khớp. Máy chủ băm mật khẩu bằng scrypt với salt ngẫu nhiên trước khi lưu customers.',
    'Giới hạn triển khai: kiểm tra email hiện quét bảng và tuần tự hóa đăng ký trong một tiến trình Next.js, phù hợp bộ demo một máy chủ. Khi chạy nhiều instance cần bảng tra cứu theo email và cơ chế đặt chỗ duy nhất phân tán trên cluster Cassandra đủ quorum. Hệ thống chưa xác minh quyền sở hữu email bằng OTP.',
    'CASH, CARD và WALLET là phương thức thanh toán mô phỏng, chưa kết nối cổng thanh toán. Dữ liệu demo được seed vào Cassandra và được ứng dụng đọc/ghi thật; điều này không đồng nghĩa mọi dữ liệu đều là giao dịch ngoài thực tế.'
])
before('Chức năng thông tin cá nhân', ['Người dùng đăng ký tài khoản khách hàng, đăng nhập bằng email và mật khẩu. Vai trò được xác định phía máy chủ; đăng ký công khai không cho phép tự cấp quyền quản trị hoặc tài xế. Khi Cassandra tạm ngưng, hệ thống trả thông báo dịch vụ dữ liệu chưa khả dụng.'])
before('Chức năng đặt chuyến xe', ['Khách hàng xem hồ sơ cá nhân và cập nhật họ tên, số điện thoại. API lọc trường password trước khi trả dữ liệu về trình duyệt.'])
before('Chức năng quản lý chuyến đi', ['Khách hàng chọn điểm đón, điểm đến, dịch vụ và voucher. Backend lấy tuyến đường, tính giá và chọn tài xế khả dụng có phương tiện phù hợp; ghi chuyến vào các bảng phục vụ tra cứu theo mã, khách hàng, tài xế và trạng thái.'])
before('Chức năng thanh toán và đánh giá', ['Lịch sử và chi tiết chuyến được đọc từ Cassandra. Trạng thái được cập nhật theo luồng BOOKED → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED; thao tác hủy và đổi tài xế được kiểm soát phía máy chủ.'])
before('Trang Admin', ['Khi hoàn thành chuyến, hệ thống lưu bản ghi thanh toán mô phỏng và dữ liệu doanh thu, chi tiêu. Khách hàng có thể gửi đánh giá, xem voucher, khiếu nại và thông báo.', 'Trang Tài xế', 'Tài xế đăng nhập bằng tài khoản đã được cấp, quản lý trạng thái hoạt động và phương tiện, xem chuyến được phân công, cập nhật tiến trình chuyến, xem doanh thu theo tháng và đánh giá.'])
before('TÀI LIỆU THAM KHẢO', ['Quản trị viên xem dashboard và quản lý dữ liệu khách hàng, tài xế, phương tiện, dịch vụ, chuyến đi và các nghiệp vụ liên quan. Báo cáo admin có giới hạn số bản ghi phục vụ demo, không phải thống kê toàn bộ cluster.', 'Minh chứng cần hoàn thiện: ảnh đăng ký, thông báo email/mật khẩu sai, email trùng, đăng nhập, đặt xe, tiến trình tài xế, thanh toán mô phỏng và dashboard admin. Chỉ chèn kết quả đã thực hiện khi Cassandra hoạt động.', 'Lưu ý hoàn thiện báo cáo: cập nhật mục lục và danh mục hình trong Word; bổ sung công việc thực tế của từng thành viên trong bảng phân công.'])
refs = [
    '[3]. Apache Cassandra Documentation: https://cassandra.apache.org/doc/latest/ — truy cập 13/10/2026.',
    '[4]. DBeaver Cassandra Documentation: https://dbeaver.com/docs/dbeaver/Cassandra/ — truy cập 13/10/2026.',
    '[5]. Next.js Documentation: https://nextjs.org/docs/app — tài liệu tham khảo; API triển khai được đối chiếu với tài liệu đi kèm phiên bản Next.js trong dự án.',
    '[6]. DbSchema Foreign Keys and Relationships: https://dbschema.com/documentation/foreign-keys.html — truy cập 13/10/2026.'
]
for p in body.iter(W+'p'):
    value = text(p)
    if value.startswith('[1].'): settext(p, value + ' https://dbschema.com/documentation/ — truy cập 13/10/2026.')
    if value.startswith('[2].'): settext(p, '[2]. DbSchema, Database Design Tool for SQL and NoSQL Databases (bao gồm Cassandra): https://dbschema.com/database-design-tool.html — truy cập 13/10/2026.')
index = len(body) - (1 if body[-1].tag == W+'sectPr' else 0)
for value in refs: body.insert(index, paragraph(value)); index += 1
def serialize(element, original):
    output = ET.tostring(element, encoding='utf-8', xml_declaration=True).decode('utf-8')
    # Preserve declarations used by mc:Ignorable and other namespace-valued attributes.
    original_tag = re.search(r'<[\w:]+\b[^>]*>', original.decode('utf-8')).group(0)
    tag = re.search(r'<[\w:]+\b[^>]*>', output).group(0)
    missing = ''.join(' ' + declaration for declaration in re.findall(r'xmlns(?::[\w]+)?="[^"]+"', original_tag) if declaration.split('=')[0] + '=' not in tag)
    output = output.replace(tag, tag[:-1] + missing + '>', 1)
    return output.encode('utf-8')
files['word/document.xml'] = serialize(doc, files['word/document.xml'])
# Ask Word to refresh fields when opening; retain every image and other package part.
settings = ET.fromstring(files['word/settings.xml'])
update = settings.find(W+'updateFields')
if update is None: update = ET.SubElement(settings, W+'updateFields')
update.set(W+'val', 'true')
files['word/settings.xml'] = serialize(settings, files['word/settings.xml'])
temp = source.with_suffix('.updated.docx')
with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, data in files.items(): z.writestr(name, data)
temp.replace(source)
print('Updated:', source)
print('Backup:', backup)
