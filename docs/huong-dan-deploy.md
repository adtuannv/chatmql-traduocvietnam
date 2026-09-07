# Hướng dẫn deploy ChatMQL lên máy chủ

Làm theo thứ tự từ trên xuống. Mỗi giai đoạn có bước kiểm tra — **kiểm tra không
đạt thì dừng lại**, đừng chạy tiếp, vì bước sau dựa trên bước trước.

Máy chủ: `160.191.160.53`, cổng SSH `2299`.

Toàn bộ quá trình mất khoảng 15–20 phút. Trong lúc khởi động lại backend thì tin
nhắn đến sẽ gián đoạn chừng 10–30 giây, nên chọn lúc ít khách.

---

## Giai đoạn 0 — Xem hiện trạng (chỉ đọc, không sửa gì)

Cần biết mã nguồn nằm ở đâu và backend chạy bằng gì. Đừng đoán.

```bash
ssh -p 2299 root@160.191.160.53
```

**Tìm thư mục mã nguồn:**

```bash
ls -d /www/wwwroot/*/ 2>/dev/null; find / -maxdepth 4 -name "bizcrm_backend_source" -type d 2>/dev/null
```

**Xem backend đang chạy bằng gì:**

```bash
pm2 list 2>/dev/null; systemctl list-units --type=service --state=running | grep -iE "chatmql|bizcrm|node"
```

Ghi lại **tên tiến trình** (pm2) hoặc **tên service** (systemd) — bước khởi động
lại cần đúng tên này.

**Xem đang ở commit nào** — số này là đường lui của anh, chép ra chỗ nào đó:

```bash
cd <thư-mục-mã-nguồn> && git log --oneline -1 && git status --short | head
```

Nếu `git status` có tệp bị sửa tay trên máy chủ thì **dừng lại** và xem kỹ —
kéo mã mới sẽ đè lên chúng.

---

## Giai đoạn 1 — Sao lưu

Bước này không được bỏ. Giai đoạn 3 có thao tác đổi cấu trúc cơ sở dữ liệu.

```bash
cd <thư-mục-mã-nguồn>/bizcrm_backend_source
source .env 2>/dev/null || export $(grep -E "^DATABASE_URL=" .env | xargs)
pg_dump "$DATABASE_URL" -Fc -f ~/chatmql-truoc-deploy-$(date +%F-%H%M).dump
ls -lh ~/chatmql-truoc-deploy-*.dump
```

Thấy tệp vài chục MB trở lên là được. Ra 0 byte thì `DATABASE_URL` sai — dừng lại.

⚠️ **Tệp dump này chứa dữ liệu khách hàng thật.** Để yên trên máy chủ, đừng tải
về máy cá nhân và tuyệt đối đừng đưa vào thư mục mã nguồn — kho mã này đang công
khai.

---

## Giai đoạn 2 — Kéo mã mới

```bash
cd <thư-mục-mã-nguồn>
git fetch origin
git checkout main
git pull origin main
git log --oneline -1
```

Dòng cuối phải hiện commit gộp:

```
3d38db9 Merge PR #1: tài liệu bán hàng, nguồn sản phẩm FM, Mini App, luật nhắc tên AI
```

Không ra đúng commit này thì remote đang trỏ sai kho. Kiểm tra `git remote -v`,
phải là `adtuannv/chatmql-traduocvietnam`.

---

## Giai đoạn 3 — Backend

### 3.1. Cài thư viện

```bash
cd <thư-mục-mã-nguồn>/bizcrm_backend_source
npm ci
```

### 3.2. Bổ sung biến môi trường

Bản này thêm nguồn sản phẩm chính thức. Xem `.env` đã có chưa:

```bash
grep -E "CRM_PRODUCT_SOURCE|FM_PRODUCT_API" .env
```

Thiếu thì thêm vào cuối `.env` (khoá lấy từ máy phát triển):

```
CRM_PRODUCT_SOURCE=official
FM_PRODUCT_API_URL=https://apifm.traduoc.vn
FM_PRODUCT_API_KEY=<khoá>
```

`ZALO_MINIAPP_PRODUCT_URL` **không cần** nữa — mã đã có mẫu mặc định sẵn.

### 3.3. Cập nhật cơ sở dữ liệu

```bash
npx prisma generate
npx prisma db push
```

Toàn bộ thay đổi là **thêm cột và thêm bảng**, không xoá, không đổi kiểu.

### 3.4. Tạo lại ba chỉ mục vector — BẮT BUỘC

`prisma db push` vừa **xoá ba chỉ mục HNSW** vì lược đồ Prisma không khai báo
chúng. Mất chúng thì hệ thống vẫn chạy, chỉ là tìm kiếm ngữ nghĩa của AI chuyển
sang quét tuần tự — chậm dần theo lượng dữ liệu và **không có lỗi nào báo ra**.
Đây là kiểu hỏng khó phát hiện nhất, nên làm ngay:

```bash
psql "$DATABASE_URL" -c "
CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_embedding_hnsw ON knowledge_entries USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ai_scenarios_embedding_hnsw ON ai_scenarios USING hnsw (embedding vector_cosine_ops);"
```

**Kiểm tra — phải ra đúng `3`:**

```bash
psql "$DATABASE_URL" -t -c "select count(*) from pg_indexes where indexname like 'idx_%_embedding_hnsw';"
```

### 3.5. Biên dịch và khởi động lại

```bash
npm run build
```

Rồi khởi động lại theo đúng cách máy chủ đang chạy (tên lấy ở giai đoạn 0):

```bash
pm2 restart <tên-tiến-trình> && pm2 logs <tên-tiến-trình> --lines 40
```

hoặc:

```bash
systemctl restart <tên-service> && journalctl -u <tên-service> -n 40 --no-pager
```

**Kiểm tra:** nhật ký không có dòng lỗi, và:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4520/api/v1/auth/me
```

Ra `401` là **đúng** — backend sống và đang đòi đăng nhập. Ra `000` là backend
chưa lên, đọc nhật ký để tìm nguyên nhân.

---

## Giai đoạn 4 — Frontend

```bash
cd <thư-mục-mã-nguồn>/chatmql-frontend
npm ci
npm run build
```

Kết quả nằm ở `chatmql-frontend/dist`. Chép vào thư mục nginx đang phục vụ —
xem đường dẫn đó bằng:

```bash
nginx -T 2>/dev/null | grep -A3 "server_name chatmql" | grep root
```

Rồi chép (đổi `<thư-mục-web>` cho đúng):

```bash
cp -r dist/* <thư-mục-web>/
```

**Kiểm tra:** mở `https://chatmql.traduocvietnam.com`, tải lại cứng
(`Ctrl+Shift+R`). Vào trang **Sản phẩm**, phải thấy nút **Nguồn dữ liệu** — nút
này chỉ có ở bản mới, nên thấy nó là chắc chắn frontend đã lên đúng.

---

## Giai đoạn 5 — Nghiệm thu

Bốn thứ, làm lần lượt:

**1. Ảnh hiển thị được** (nginx đã sửa từ trước, kiểm tra lại cho chắc):

```bash
curl -s -o /dev/null -w "%{content_type}\n" https://chatmql.traduocvietnam.com/uploads/doc-assets/test.jpg
```

Phải ra `application/json`. Ra `text/html` là nginx lại chặn.

**2. Danh sách sản phẩm lên được.** Vào trang **Sản phẩm**, phải thấy 84 sản
phẩm. Trống trơn thì `.env` thiếu khoá FM — quay lại 3.2.

**3. Gửi thử tin nhắn.** ⚠️ **Chỉ thử trên hội thoại Web Chat thử nghiệm.**
Đừng thử trên hội thoại Zalo thật — máy chủ đang giữ phiên đăng nhập của tài
khoản công ty, gửi nhầm là khách nhận thật.

**4. Đặt tên nhận biết cho AI — làm ngay, đừng để sau.**

Bản này bật mặc định luật *"chỉ trả lời khi được nhắc tên"* trong nhóm. Từ lúc
deploy xong, **AI im lặng trong mọi nhóm** cho tới khi có tên để nhận biết.

Vào **AI → Trả lời tự động**, đặt tên gọi (thường là tên tài khoản Zalo công ty,
ví dụ `Ngô Tuấn Cco Tdvn`), lưu lại. Rồi báo đội sale: trong nhóm phải tag tên
thì AI mới trả lời.

Nhóm nào muốn AI đáp mọi câu như cũ thì mở menu **Chế độ AI** của nhóm đó, chọn
*Tắt cho nhóm này* — đặt tại nhóm thắng cài đặt chung.

---

## Giai đoạn 6 — Dựng cây tài liệu bán hàng

Làm sau khi giai đoạn 5 đã đạt. Chi tiết ở
[viec-can-lam-tren-may-chu.md](viec-can-lam-tren-may-chu.md) mục 4. Tóm tắt:

```bash
cd <thư-mục-mã-nguồn>/bizcrm_backend_source
psql "$DATABASE_URL" -c "create table product_docs_bak as select * from product_docs; create table doc_folders_bak as select * from doc_folders;"
psql "$DATABASE_URL" -c "select id, name from organizations order by created_at;"
npx tsx scripts/backfill-doc-library.ts --org=<id>            # xem trước
npx tsx scripts/backfill-doc-library.ts --org=<id> --apply    # ghi thật
```

Bước xem trước phải báo khoảng 84 tài liệu. Ra 0 là nguồn sản phẩm sai.

---

## Nếu phải quay lui

Không có thay đổi nào phá dữ liệu cũ — chỉ thêm cột và bảng. Nên quay lui chỉ
cần trả mã về commit cũ:

```bash
cd <thư-mục-mã-nguồn>
git checkout <commit-cũ-ghi-ở-giai-đoạn-0>
cd bizcrm_backend_source && npm ci && npm run build
pm2 restart <tên-tiến-trình>
cd ../chatmql-frontend && npm ci && npm run build && cp -r dist/* <thư-mục-web>/
```

Cột và bảng mới cứ để nguyên — bản cũ không đọc tới chúng.

Chỉ khi cơ sở dữ liệu thật sự hỏng mới cần phục hồi từ dump, và thao tác này
**xoá mọi tin nhắn đến sau lúc sao lưu**:

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists ~/chatmql-truoc-deploy-<...>.dump
```
