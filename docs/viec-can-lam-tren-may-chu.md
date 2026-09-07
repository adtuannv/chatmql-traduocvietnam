# Việc cần làm trên máy chủ prod

Gửi anh Thắng. Ba việc, xếp theo mức gấp. Việc 1 và 2 độc lập nhau, làm việc nào
trước cũng được. Toàn bộ thao tác nằm trên máy chủ, **không cần deploy lại mã**.

Máy chủ: `160.191.160.53`, cổng SSH `2299`.

---

## Việc 1 — Ảnh trong hệ thống không hiển thị được (đang hỏng trên prod)

### Triệu chứng

Tải ảnh lên Tài liệu bán hàng thì lưu thành công, tệp nằm trên đĩa đủ dung lượng,
nhưng khi hiển thị thì vỡ ảnh. Không chỉ tài liệu bán hàng — **mọi ảnh do hệ
thống mình lưu đều hỏng**: ảnh chat, ảnh sản phẩm. Ảnh chat lâu nay vẫn hiện là
vì chúng lấy từ CDN của Zalo, không đi qua `/uploads/`.

### Nguyên nhân

nginx nuốt mất request ảnh trước khi nó tới được backend. Đo từ ngoài vào, cùng
một thư mục, chỉ khác phần đuôi tệp:

| Đường dẫn | Mã | Content-Type | Ai trả lời |
|---|---|---|---|
| `/uploads/doc-assets/test.jpg` | 404 | `text/html` | **nginx** |
| `/uploads/doc-assets/test.png` | 404 | `text/html` | **nginx** |
| `/uploads/chat-media/test.jpg` | 404 | `text/html` | **nginx** |
| `/uploads/doc-assets/test.pdf` | 404 | `application/json` | backend |
| `/uploads/doc-assets/test` (không đuôi) | 404 | `application/json` | backend |

`.pdf` và không-đuôi thì tới được backend, `.jpg`/`.png` thì không. Đó là dấu vân
tay của một khối `location ~* \.(png|jpg|...)$` bắt tệp tĩnh — kiểu khối aaPanel
tự sinh — đang thắng khối `/uploads/`. Trong nginx **regex thắng prefix**, trừ
khi prefix có dấu `^~`.

Nhiều khả năng prod **chưa từng có** khối `/uploads/` nào, vì cấu hình prod dựng
riêng qua panel chứ không dùng tệp `deploy/nginx-chatmql-dev.conf` trong kho mã.

### Cách làm

**Bước 1 — tìm tệp cấu hình đang chạy:**

```bash
nginx -T 2>&1 | grep -iE "configuration file|server_name|uploads"
```

**Bước 2 — trong khối `server` của `chatmql.traduocvietnam.com`, thêm khối này.
Đặt TRƯỚC mọi khối `location ~*` bắt tệp tĩnh:**

```nginx
location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:4520;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 50m;
}
```

Dấu `^~` là phần quan trọng nhất, không phải cho gọn: thiếu nó thì khối regex
tệp tĩnh lại cướp request ảnh và mọi thứ y như cũ.

Nếu đã có sẵn khối `location /uploads/` thì chỉ cần thêm `^~` vào là đủ.

**Bước 3 — kiểm tra cú pháp rồi mới nạp lại:**

```bash
nginx -t && nginx -s reload
```

### Nghiệm thu

Chạy từ máy bất kỳ, phải ra `application/json`:

```bash
curl -s -o /dev/null -w "%{http_code} | %{content_type}\n" https://chatmql.traduocvietnam.com/uploads/doc-assets/test.jpg
```

- `404 | application/json` → **đạt**. Request đã tới backend; 404 chỉ vì tệp
  `test.jpg` không có thật. Vào giao diện xem ảnh thật là thấy hiện.
- `404 | text/html` → chưa ăn, nginx vẫn chặn. Gửi lại nội dung tệp cấu hình để
  soi xem khối nào đang thắng.

### Lùi lại nếu hỏng

Sao lưu trước khi sửa, và khôi phục bằng chính bản đó:

```bash
cp /đường/dẫn/tệp.conf /đường/dẫn/tệp.conf.bak
```

Thay đổi này chỉ đụng nginx, không đụng mã, không đụng cơ sở dữ liệu.

---

## Việc 2 — Mật khẩu root đã lộ công khai, và hiện cũng không đăng nhập được

### Đã lộ

Tệp `.ssh_inspect.exp` ghi thẳng mật khẩu root dạng chữ thường, kèm IP và cổng
SSH. Tệp này được git theo dõi, nằm trong commit `6aaaccd`, và kho
`thangvmtpn/chatmql-traduocvietnam` để **public**.

Đã xoá tệp khỏi HEAD, nhưng **xoá ở HEAD không gỡ được khỏi lịch sử** — commit cũ
vẫn moi ra được bằng `git log -S`. Phải coi như mật khẩu đó đã mất hẳn.

### Hiện không vào được

Thử SSH bằng mật khẩu đó thì máy chủ trả `Permission denied, please try again`.
Máy chủ vẫn bật đăng nhập bằng mật khẩu (nó chịu hỏi), nên không phải bị chặn —
chỉ là chuỗi đó không còn đúng. Có thể anh đã đổi rồi.

### Cần làm

1. Đặt mật khẩu root mới — qua console VPS hoặc aaPanel nếu SSH không vào được.
2. Đừng đưa mật khẩu mới vào bất kỳ tệp nào trong kho mã.
3. Nên tắt hẳn đăng nhập root bằng mật khẩu, chuyển sang khoá SSH:
   `PermitRootLogin prohibit-password` trong `/etc/ssh/sshd_config`.

### Nhân tiện — các khoá khác cũng đang nằm công khai trong kho mã

Bốn tệp khoá dịch vụ Google đã commit vào kho public từ trước, cần thu hồi trong
Google Cloud Console:

```
traf-452002-f2de6789897f.json
backend/hoadon-461206-23b8550fd085.json
backend/tacvu1356-1c8559c32013.json
backend/TPN.json
```

Và `bizcrm_backend_source/bcrm_prod_dump.dump` là bản dump cơ sở dữ liệu thật,
cũng đang công khai.

---

## Việc 3 — Deploy nhánh mới (khi nào tiện)

Nhánh `feat/chatmql-frontend-rewrite` đã sẵn sàng gộp. Chi tiết rủi ro, thay đổi
lược đồ cơ sở dữ liệu và những chỗ đổi hành vi nằm ở
[trien-khai-len-prod.md](trien-khai-len-prod.md) — đọc mục 1 trước khi chạy
`prisma db push`, có ba chỉ mục vector bị xoá mỗi lần push và phải tạo lại tay.

Việc 1 ở trên **không phụ thuộc** vào lần deploy này. Sửa nginx được ngay, không
cần chờ gộp nhánh.

---

## Việc 4 — Chạy script dựng cây tài liệu bán hàng trên prod

Script `scripts/backfill-doc-library.ts` đọc danh mục sản phẩm từ hệ thống nguồn
rồi dựng cây thư mục tài liệu bán hàng hai tầng (thương hiệu → loại), và tạo
tài liệu cho từng sản phẩm.

Chạy trên local đã ra: 25 thư mục, 51 tài liệu mới, 33 tài liệu bổ sung.

### Tính chất cần biết trước khi chạy

- **Chỉ thêm, không bao giờ xoá.** Không có lệnh delete nào trong script.
- **Không ghi đè nội dung người thật đã soạn.** Mô tả, ảnh, mã Mini App đã có
  thì giữ nguyên; chỉ điền vào ô đang trống.
- **Chạy lại bao nhiêu lần cũng được.** Lần hai trở đi không đổi gì.
- **Mặc định là xem trước.** Không có `--apply` thì không ghi một dòng nào.

### Các bước

**1. Kiểm tra `.env` có cấu hình nguồn sản phẩm.** Thiếu là script lấy nhầm
nguồn và dựng ra cây sai:

```bash
grep -E "CRM_PRODUCT_SOURCE|FM_PRODUCT_API" .env
```

Cần thấy `CRM_PRODUCT_SOURCE=official` cùng `FM_PRODUCT_API_URL` và
`FM_PRODUCT_API_KEY`. Thiếu thì lấy từ máy phát triển sang.

**2. Lấy id tổ chức.** Prod có thể nhiều tổ chức; không truyền `--org` thì
script lấy tổ chức tạo sớm nhất, chưa chắc đúng cái mình muốn:

```bash
psql "$DATABASE_URL" -c "select id, name from organizations order by created_at;"
```

**3. Sao lưu hai bảng sẽ bị ghi.** Rẻ và cho phép quay lui:

```bash
psql "$DATABASE_URL" -c "create table product_docs_bak as select * from product_docs; create table doc_folders_bak as select * from doc_folders;"
```

**4. Chạy xem trước — chưa ghi gì:**

```bash
npx tsx scripts/backfill-doc-library.ts --org=<id-tổ-chức>
```

Đọc kỹ phần tổng kết ở cuối. Số "Tài liệu tạo mới" phải xấp xỉ số sản phẩm bên
hệ thống nguồn. Nếu ra 0 hết thì nguồn sản phẩm đang sai — quay lại bước 1.

**5. Ghi thật:**

```bash
npx tsx scripts/backfill-doc-library.ts --org=<id-tổ-chức> --apply
```

### Nghiệm thu

Mở giao diện **Tài liệu bán hàng**, phải thấy cây thư mục theo thương hiệu:
Trà · Trà cụ & phụ kiện trà · Bánh ăn cùng trà · Trà dược. Bấm vào một thư mục
con phải thấy sản phẩm bên trong.

### Quay lui nếu cần

```bash
psql "$DATABASE_URL" -c "truncate product_docs; insert into product_docs select * from product_docs_bak; truncate doc_folders cascade; insert into doc_folders select * from doc_folders_bak;"
```

Xong việc và thấy ổn thì xoá hai bảng sao lưu:

```bash
psql "$DATABASE_URL" -c "drop table product_docs_bak, doc_folders_bak;"
```
