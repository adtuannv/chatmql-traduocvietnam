# Deploy ChatMQL lên máy chủ

Viết lại sau lần deploy thật ngày 08/09/2026. Bản trước đoán sai kiến trúc
(tưởng chạy `git pull` + `pm2 restart`), nên đừng dùng lại bản đó.

## Kiến trúc thật

| Thành phần | Thực tế |
|---|---|
| Backend | Container Docker **`bizcrm2_api`**, ảnh `bizcrm-backend:full` |
| Nguồn mã backend | `/www/wwwroot/bizcrm_backend_source` — **không phải repo git**, chép tay lên |
| Frontend | Tệp tĩnh ở `/www/wwwroot/crm_biz/frontend/dist`, build ở máy dev rồi chép lên |
| Cơ sở dữ liệu | PostgreSQL **18** trên host, database `tra_crm` |
| Redis | Container `bizcrm2_redis` |
| Mạng Docker | `tra-crm_default` |
| Volume ảnh | `bizcrm2_uploads` → `/app/uploads` trong container |
| SSH | `root@160.191.160.53` **cổng 22** (từng là 2299) |

**Không có `docker-compose`.** Container tạo bằng `docker run` thủ công, nên muốn
dựng lại phải tự dựng lệnh — mục 3 bên dưới có sẵn.

Máy chủ này còn chạy ~37 site khác của công ty (CRM, FM, HRM, hoá đơn, portal,
mini app). Mọi thao tác phải nhắm đúng container `bizcrm2_api`.

---

## ⚠️ Điều nguy hiểm nhất: container tự đổi lược đồ khi khởi động

`docker-entrypoint.sh` chạy **`prisma db push --accept-data-loss`** mỗi lần
container lên. Nghĩa là **khởi động lại container là tự động đổi cơ sở dữ liệu
thật**, kể cả xoá cột và xoá bảng, không hỏi ai.

Lần deploy 08/09 nếu không soi trước thì đã mất:

- Hai cột `channel_accounts.is_business` và `business_tier` — **7 tài khoản đang
  ở hạng `pro`**. Chúng thuộc một tính năng có trên bản thật mà nhánh mình không
  có, nên Prisma coi là thừa. Đã sửa bằng cách khai báo chúng vào `schema.prisma`.
- Ba bảng sao lưu vừa tạo trước đó — Prisma xoá **mọi bảng không có trong lược
  đồ**, kể cả bảng mình cố ý tạo để phòng thân.

**Nên: sao lưu bằng `pg_dump` ra tệp, đừng sao lưu bằng cách tạo bảng mới.**

Bắt buộc chạy trước mỗi lần deploy — nó in ra đúng SQL sẽ được áp:

```bash
cd /www/wwwroot/bizcrm_backend_source && DB=$(docker inspect bizcrm2_api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2- | sed 's/host.docker.internal/127.0.0.1/') && npx prisma migrate diff --from-url "$DB" --to-schema-datamodel prisma/schema.prisma --script
```

Thấy `DROP COLUMN` hoặc `DROP TABLE` nào ngoài ba chỉ mục HNSW → **dừng lại**,
khai báo thứ đó vào `schema.prisma` rồi soi lại.

---

## 1. Chuẩn bị (chạy ở máy dev)

```bash
rsync -az --delete --exclude node_modules --exclude dist --exclude uploads --exclude .env --exclude '*.dump' bizcrm_backend_source/ root@160.191.160.53:/www/wwwroot/bizcrm_backend_source/
```

`.env` trên máy chủ là tệp cũ của máy dev (`apple@localhost/bizcrm2`) và **không
được dùng** — cấu hình thật nằm trong biến môi trường của container. Luôn loại
trừ nó khi đồng bộ.

## 2. Sao lưu (trên máy chủ)

`pg_dump` của hệ thống là bản 16, còn máy chủ chạy Postgres 18 → phải dùng đúng
đường dẫn này, nếu không nó báo lỗi lệch phiên bản:

```bash
mkdir -p /root/chatmql-deploy && cd /root/chatmql-deploy && DB=$(docker inspect bizcrm2_api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2- | sed 's/host.docker.internal/127.0.0.1/') && /www/server/pgsql/bin/pg_dump "$DB" -Fc -f truoc-deploy-$(date +%F-%H%M).dump && ls -lh *.dump
```

Rồi lưu cấu hình container và gắn nhãn ảnh cũ để lui về:

```bash
cd /root/chatmql-deploy && docker inspect bizcrm2_api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION)=' | grep . > env.list && chmod 600 env.list && docker tag bizcrm-backend:full bizcrm-backend:rollback-$(date +%Y%m%d) && wc -l < env.list
```

## 3. Dựng ảnh và đổi container

```bash
cd /www/wwwroot/bizcrm_backend_source && docker build -t bizcrm-backend:full .
```

```bash
docker stop bizcrm2_api && docker rm bizcrm2_api && docker run -d --name bizcrm2_api --restart unless-stopped --network tra-crm_default -p 4520:4520 --add-host host.docker.internal:host-gateway --env-file /root/chatmql-deploy/env.list -v bizcrm2_uploads:/app/uploads bizcrm-backend:full
```

Gián đoạn khoảng 30–60 giây. `--add-host host.docker.internal:host-gateway` là
bắt buộc — thiếu nó container không nối được vào Postgres trên host.

## 4. Tạo lại ba chỉ mục vector

`db push` xoá chúng vì `schema.prisma` không khai báo. Mất thì hệ thống **vẫn
chạy**, chỉ là tìm kiếm ngữ nghĩa của AI chuyển sang quét tuần tự — chậm dần và
không báo lỗi gì. Đây là kiểu hỏng khó phát hiện nhất.

```bash
DB=$(docker inspect bizcrm2_api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2- | sed 's/host.docker.internal/127.0.0.1/') && psql "$DB" -c "CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops); CREATE INDEX IF NOT EXISTS idx_knowledge_entries_embedding_hnsw ON knowledge_entries USING hnsw (embedding vector_cosine_ops); CREATE INDEX IF NOT EXISTS idx_ai_scenarios_embedding_hnsw ON ai_scenarios USING hnsw (embedding vector_cosine_ops);" && psql "$DB" -t -c "select count(*) from pg_indexes where indexname like 'idx_%_embedding_hnsw';"
```

Phải ra đúng **3**.

## 5. Frontend

Ở máy dev:

```bash
cd chatmql-frontend && npm run build && rsync -az --delete dist/ root@160.191.160.53:/www/wwwroot/crm_biz/frontend/dist/
```

Rồi trên máy chủ (nginx chạy dưới user `www`, sai quyền là trả 403):

```bash
chown -R www:www /www/wwwroot/crm_biz/frontend/dist
```

## 6. Nghiệm thu

```bash
for p in / /api/v1/auth/me "/socket.io/?EIO=4&transport=polling"; do printf "%-46s " "$p"; curl -s -o /dev/null -m 15 -w "HTTP %{http_code}\n" "https://chatmql.traduocvietnam.com$p"; done
```

- `/` → 200 · `/api/v1/auth/me` → **401** (đúng: backend sống, đang đòi đăng
  nhập) · socket.io → 200.
- Ảnh: `curl -sI https://chatmql.traduocvietnam.com/uploads/doc-assets/<tên>.jpg`
  phải ra `image/jpeg`. Ra `text/html` là nginx lại chặn — xem `location ^~ /uploads/`.
- Bản frontend đang phục vụ có khớp bản vừa build không:
  `curl -s https://chatmql.traduocvietnam.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'`
- Tài khoản kênh kết nối lại chưa:

```bash
DB=$(docker inspect bizcrm2_api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2- | sed 's/host.docker.internal/127.0.0.1/') && psql "$DB" -c "select platform, status, count(*) from channel_accounts where deleted_at is null and is_disabled = false group by 1,2 order by 1;"
```

Vài dòng `[zalo-pool] Reconnect failed` ngay sau khi khởi động là **bình thường**
— lần thử đầu trong lúc container còn đang lên, vài giây sau nối lại được. Chỉ lo
khi sau 2 phút mà `status` vẫn không về `connected`.

## 7. Lui về

Ảnh cũ vẫn còn ở nhãn `bizcrm-backend:rollback-<ngày>`:

```bash
docker stop bizcrm2_api && docker rm bizcrm2_api && docker run -d --name bizcrm2_api --restart unless-stopped --network tra-crm_default -p 4520:4520 --add-host host.docker.internal:host-gateway --env-file /root/chatmql-deploy/env.list -v bizcrm2_uploads:/app/uploads bizcrm-backend:rollback-<ngày>
```

Frontend lui bằng bản sao ở `/root/chatmql-deploy/dist-cu-<ngày>`.

Phục hồi cơ sở dữ liệu là phương án cuối, vì nó **xoá mọi tin nhắn đến sau lúc
sao lưu**:

```bash
/www/server/pgsql/bin/pg_restore -d "$DB" --clean --if-exists /root/chatmql-deploy/truoc-deploy-<...>.dump
```

## 8. Sau khi deploy

1. Vào **AI → Trả lời tự động**, đặt **tên gọi để nhận biết**. Luật "chỉ trả lời
   khi được nhắc tên" mặc định BẬT, nên trước khi đặt tên thì AI im trong mọi nhóm.
2. Gửi thử một tin — **chỉ trên hội thoại Web Chat thử nghiệm**. Máy chủ đang giữ
   phiên đăng nhập Zalo của 16 tài khoản thật; gửi nhầm là khách nhận thật.
3. Vài ngày sau, dọn tệp sao lưu trong `/root/chatmql-deploy` cho nhẹ đĩa.
