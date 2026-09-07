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
| `ai_configs` | `group_require_mention` | mặc định `false` — xem mục 2.1 |
| `ai_configs` | `mention_names` | rỗng |
| `conversations` | `require_mention` | rỗng = theo cài đặt chung |
| `product_docs` | `mini_app_id` | rỗng |
| `products` | `video_urls` | mảng rỗng |
| `users` | `role_id` | rỗng |

Bảng thêm mới: `website_widgets`, `permissions`, `roles`, `role_permissions`,
`ai_bots`, `ai_eval_cases`, `ai_eval_runs`, `ai_eval_results`, `product_docs`,
`doc_folders`, `doc_assets`.

---

## 2. ĐỔI HÀNH VI — chạy được nhưng khác trước

### 2.1. Luật "chỉ trả lời khi được nhắc tên" trong nhóm

Tính năng mới. **Mặc định TẮT**, đặt vậy có chủ ý: nếu để bật thì chỉ riêng việc
nâng cấp phiên bản đã làm AI im lặng trong mọi nhóm đang chạy, không ai bật mà
hành vi đổi.

Muốn dùng thì bật ở **AI → Trả lời tự động**, và đặt tên nhận biết (thường là tên
tài khoản Zalo của công ty). Từng nhóm ghi đè được trong menu Chế độ AI.

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
| `ZALO_MINIAPP_PRODUCT_URL` | Nút gửi link Mini App bị khoá, có ghi rõ lý do |
| `CRM_DASHBOARD_TOKEN` | Không dùng nguồn dashboard |
| `AI_CONTEXT_BUDGET_TIER` | Dùng mức ngân sách mặc định |

Nguồn sản phẩm còn đổi được ngay trong giao diện (trang Sản phẩm → **Nguồn dữ
liệu**), lựa chọn đó thắng biến môi trường và bỏ được để quay lại.

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
