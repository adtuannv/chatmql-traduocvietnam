# Chạy ChatMQL trên máy local (macOS)

Dựng ngày 03/09/2026. Chỉ dựng phần **ChatMQL** (Node backend + bản build frontend).
Phần CRM (`backend/` FastAPI) và FM chưa chạy được vì cần hai database
`crm_tdvn`, `fm_tdvn` mà repo không có dump.

## Thành phần đã dựng

| Thành phần | Cách chạy | Địa chỉ |
|---|---|---|
| PostgreSQL 18 (Postgres.app, có sẵn pgvector 0.8.1) | đã chạy sẵn trên máy | `localhost:5432`, db `bizcrm_local` |
| Redis 7.2.7 | biên dịch từ source, cài ở `~/.local/opt/redis` | `127.0.0.1:6379` |
| ChatMQL backend | `npm --prefix bizcrm_backend_source run dev` | `http://localhost:4520` |
| ChatMQL frontend (bản build) | `npx serve bizcrm_frontend_dist -l 3000` | `http://localhost:3000` |
| Bản mobile (tùy chọn) | `npm --prefix CRM-Mobile/app run dev` | `http://localhost:5180/m/` |

Ba lệnh chạy server đã khai báo trong `../.claude/launch.json` (ngoài repo) với tên
`chatmql-backend`, `chatmql-frontend`, `chatmql-mobile`.

## Dữ liệu

Database `bizcrm_local` được restore từ `bizcrm_backend_source/bizcrm_local_backup_20260619.dump`
(1 tổ chức "Default Org", 8 user, 90 hội thoại, 965 tin nhắn, 183 liên hệ — dữ liệu mẫu,
không phải khách thật). Sau khi restore đã chạy `prisma db push` để thêm 7 bảng và 6 cột
mới so với dump; không có cột nào bị xóa.

Tài khoản đã đặt lại mật khẩu cho bản local (mật khẩu chung `Admin@local123`):

| Email | Vai trò |
|---|---|
| `admin@bizcrm.vn` | owner |
| `manager@bizcrm.test` | manager |
| `member.chat@bizcrm.test` | member |

## Chạy lại từ đầu

```bash
# 1. Redis (nếu chưa chạy)
~/.local/bin/redis-server --port 6379 --bind 127.0.0.1 --daemonize yes \
  --dir ~/.local/var/redis --logfile ~/.local/var/redis/redis.log --save "" --appendonly no

# 2. Backend
cd bizcrm_backend_source && npm run dev

# 3. Frontend (terminal khác, ở gốc repo)
npx serve bizcrm_frontend_dist -l 3000
```

Backend đọc `bizcrm_backend_source/.env` (đã tạo, nằm trong `.gitignore`). Biến quan trọng:

```
DATABASE_URL=postgresql://macbook@localhost:5432/bizcrm_local
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<chuỗi dev>
PORT=4520
```

## Restore lại database nếu cần

```bash
PG=/Applications/Postgres.app/Contents/Versions/18/bin
$PG/dropdb -h localhost -U macbook bizcrm_local
$PG/createdb -h localhost -U macbook bizcrm_local
$PG/pg_restore -h localhost -U macbook -d bizcrm_local --no-owner --no-privileges \
  bizcrm_backend_source/bizcrm_local_backup_20260619.dump
cd bizcrm_backend_source && npx prisma db push
```

## Đã biết

- Docker Desktop trên máy này khởi động lỗi (`com.docker.backend` thoát mã 150), nên Redis
  không chạy bằng container mà biên dịch trực tiếp.
- Backend tự thử kết nối lại 1 tài khoản Zalo đã lưu phiên và thất bại — bình thường,
  phiên trong dump đã hết hạn. Không kết nối tài khoản Zalo thật khi test.
- Bản build frontend tự gọi `http://localhost:4520` khi mở bằng `localhost`; mở bằng IP LAN
  thì nó gọi API bản live cũ. Chỉ mở bằng `localhost`.
