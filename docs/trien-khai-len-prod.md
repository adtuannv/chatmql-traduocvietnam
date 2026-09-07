# Đưa bản mới lên prod — những gì cần biết trước

Tài liệu này trả lời một câu hỏi: **gộp nhánh này vào main rồi deploy thì cái gì
có thể vỡ?**

Xếp theo mức rủi ro giảm dần. Phần "Cần thao tác" là việc bắt buộc; bỏ qua là
hỏng.

---

## 1. CẦN THAO TÁC — không làm là hỏng

### 1.1. Ba chỉ mục vector biến mất sau `prisma db push`

Lược đồ Prisma **không khai báo** ba chỉ mục HNSW dưới đây, nên mỗi lần chạy
`prisma db push` là Prisma xoá chúng đi vì thấy "thừa so với lược đồ":

```
idx_products_embedding_hnsw
idx_knowledge_entries_embedding_hnsw
idx_ai_scenarios_embedding_hnsw
```

Mất chúng thì hệ thống **vẫn chạy**, chỉ là tìm kiếm ngữ nghĩa của AI chuyển sang
quét tuần tự — chậm dần theo lượng dữ liệu, và không có thông báo lỗi nào. Đây là
kiểu hỏng khó phát hiện nhất.

**Chạy ngay sau mỗi lần `db push` hoặc `migrate`:**

```bash
psql "$DATABASE_URL" -c "
CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_embedding_hnsw ON knowledge_entries USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ai_scenarios_embedding_hnsw ON ai_scenarios USING hnsw (embedding vector_cosine_ops);"
```

Kiểm tra lại phải ra đúng `3`:

```bash
psql "$DATABASE_URL" -t -c "select count(*) from pg_indexes where indexname like 'idx_%_embedding_hnsw';"
```

### 1.2. Cập nhật lược đồ cơ sở dữ liệu

Toàn bộ là **thêm mới**, không xoá và không đổi kiểu cột nào, nên bản cũ vẫn chạy
được trong lúc chuyển giao.

Cột thêm vào bảng đã có — tất cả đều cho phép rỗng hoặc có giá trị mặc định:

| Bảng | Cột | Ghi chú |
|---|---|---|
| `ai_configs` | `group_require_mention` | mặc định `true` — ĐỔI HÀNH VI, xem mục 2.1 |
| `ai_configs` | `mention_names` | rỗng |
| `conversations` | `require_mention` | rỗng = theo cài đặt chung |
| `product_docs` | `mini_app_id` | rỗng |
| `products` | `video_urls` | mảng rỗng |
| `users` | `role_id` | rỗng |

Bảng thêm mới: `website_widgets`, `permissions`, `roles`, `role_permissions`,
`ai_bots`, `ai_eval_cases`, `ai_eval_runs`, `ai_eval_results`, `product_docs`,
`doc_folders`, `doc_assets`.

### 1.3. nginx phải để `location ^~ /uploads/`

Kiểm tra nhanh trên máy chủ đang chạy:

```bash
curl -s -o /dev/null -w "%{content_type}\n" https://<tên-miền>/uploads/doc-assets/test.jpg
```

- Trả `application/json` → đúng, request tới được backend.
- Trả `text/html` → **SAI**: nginx đang tự trả 404, backend không hề thấy
  request. Mọi ảnh do hệ thống lưu sẽ hỏng: tài liệu bán hàng, ảnh chat, ảnh
  sản phẩm.

Nguyên nhân là trong nginx **regex thắng prefix**. Chỉ cần ở đâu đó trong cấu
hình có một khối kiểu `location ~* \.(png|jpg|css|js)$` là nó cướp mất mọi
request ảnh, kể cả `/uploads/`. Dấu `^~` khiến prefix thắng và chặn regex xen vào:

```nginx
location ^~ /uploads/ {
    proxy_pass http://127.0.0.1:4520;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Sửa xong chạy `nginx -t` rồi `systemctl reload nginx`.

---

## 2. ĐỔI HÀNH VI — chạy được nhưng khác trước

### 2.1. Luật "chỉ trả lời khi được nhắc tên" trong nhóm

Tính năng mới, **mặc định BẬT** theo yêu cầu vận hành: trong nhóm thì AI im lặng
an toàn hơn là chen ngang hội thoại của người thật.

**Hệ quả cần chuẩn bị trước:** sau khi deploy, AI thôi trả lời trong mọi nhóm cho
tới khi có người nhắc tên. Nếu chưa đặt tên nhận biết thì luật tự bỏ qua và AI
trả lời như cũ — nhưng đừng dựa vào đó.

Việc cần làm ngay sau deploy: vào **AI → Trả lời tự động**, đặt **tên gọi để nhận
biết** (thường là tên tài khoản Zalo của công ty, ví dụ `Ngô Tuấn Cco Tdvn`), rồi
nhắn đội sale rằng trong nhóm phải tag tên thì AI mới trả lời.

Nhóm nào muốn AI đáp mọi câu như cũ thì mở menu **Chế độ AI** của nhóm đó chọn
*Tắt cho nhóm này* — đặt tại nhóm thắng cài đặt chung.

### 2.2. Tin chữ khi gửi tài liệu bán hàng nay THỰC SỰ ra Zalo

Bản cũ ghi thẳng vào bảng tin nhắn với `senderType` không hợp lệ, hậu quả là tin
hiển thị sang phía khách và **chưa bao giờ đi ra Zalo** — khách chỉ nhận được ảnh
trần, không có tên và giá.

Sau khi deploy, tin chữ đi ra kênh thật. Đây là sửa lỗi, nhưng cần báo đội sale
biết: từ nay gửi tài liệu là khách nhận đủ chữ lẫn ảnh.

Dữ liệu cũ trong bảng vẫn còn những tin hiển thị sai phía. Muốn dọn:

```sql
-- Xem trước
SELECT count(*) FROM messages WHERE sender_type = 'user';
-- Xoá (những tin này khách chưa từng nhận)
DELETE FROM messages WHERE sender_type = 'user';
```

### 2.3. Không còn nhãn "Hết hàng"

Nguồn trả tồn âm cho phần lớn danh mục vì bán gối vụ và đặt trước. Nay chỉ hiện
số tồn khi lớn hơn 0; còn lại im lặng và vẫn bán bình thường. Bộ lọc "Còn hàng"
đã bỏ.

Màn Tạo đơn **giữ nguyên** cảnh báo vượt tồn — chỗ đó dùng để soát khi lên đơn
thật, khác với việc quyết định có chào hàng hay không.

### 2.4. Nút "Kéo lịch sử" chuyển chỗ

Từ thanh công cụ hội thoại sang màn **Tích hợp**, đặt trên từng tài khoản và kéo
cho cả tài khoản thay vì một khách. Cần báo đội sale kẻo họ tìm không thấy.

---

## 3. AN TOÀN — bật bằng cấu hình, không bật thì không đổi gì

Các biến dưới đây **để trống là hệ thống chạy y như cũ**. Không cần đặt gì khi
deploy nếu chưa muốn dùng.

| Biến | Để trống thì sao |
|---|---|
| `CRM_PRODUCT_SOURCE` | Dùng cầu nối CRM như trước |
| `FM_PRODUCT_API_URL` / `FM_PRODUCT_API_KEY` | Không dùng nguồn sản phẩm chính thức |
| `ZALO_MINIAPP_PRODUCT_URL` | Đặt được trong giao diện, không cần biến này |
| `CRM_DASHBOARD_TOKEN` | Không dùng nguồn dashboard |
| `AI_CONTEXT_BUDGET_TIER` | Dùng mức ngân sách mặc định |

Nguồn sản phẩm **và mẫu link Mini App** đều đặt được ngay trong giao diện: trang
Sản phẩm → **Nguồn dữ liệu**. Giá trị đặt ở đó thắng biến môi trường và bỏ được
để quay lại. Nhờ vậy bên vận hành tự đổi mà không cần sửa tệp rồi khởi động lại
máy chủ — đây chính là lý do bản prod từng bị khoá hết nút gửi link.

Các module hoàn toàn mới, không có thì không ai đụng tới: Tài liệu bán hàng, tab
Sản phẩm trong hội thoại, HDSD và tour tương tác, trợ lý AI nội bộ.

---

## 4. Thứ tự triển khai

1. Gộp nhánh vào `main`
2. Kéo mã mới, `npm ci`
3. `npx prisma db push` (hoặc `migrate deploy`)
4. **Tạo lại ba chỉ mục vector** — mục 1.1
5. Build lại frontend, khởi động lại backend
6. Kiểm tra nhanh: mở một hội thoại, gửi thử một tin vào **Web Chat thử nghiệm**
   (đừng thử trên hội thoại Zalo thật)
7. Vào trang Sản phẩm xem danh sách có lên không

## 5. Nếu phải quay lui

Không có thay đổi nào phá dữ liệu cũ: chỉ thêm cột và bảng, không xoá, không đổi
kiểu. Nên quay về bản cũ chỉ cần deploy lại mã cũ — dữ liệu mới nằm ở cột mà bản
cũ không đọc tới, để nguyên cũng không sao.
