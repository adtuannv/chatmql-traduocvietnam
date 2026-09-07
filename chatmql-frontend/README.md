# ChatMQL Frontend — Trà Dược Việt Nam

Giao diện web viết lại cho ChatMQL, thay cho bản build cũ ở `../bizcrm_frontend_dist`
(bản đó không còn mã nguồn React, mọi tính năng TDVN phải vá bằng script chèn DOM).

## Nguồn gốc

Fork từ mã nguồn frontend eCDP (`/Users/macbook/social-app-main/frontend`, repo
`EvoTechGroup/bizcrm`) — cùng dòng backend, đã chạy đúng với hợp đồng API và socket.
Cẩm nang gốc: `/Users/macbook/social-app-main/docs/CHUYEN-GIAO-DEV-FRONTEND.md`.
Phần §5 (API/token), §6 (socket), §9 (quy ước code), §12 (bẫy đã gặp) vẫn còn hiệu lực.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5174
```

Backend phải chạy trước ở cổng 4520 — xem `../docs/chay-local.md`.

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Dev server có HMR (cổng 5174) |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run lint` | Kiểm kiểu toàn bộ |

Biến môi trường duy nhất: `VITE_API_URL` (gốc backend, **không** kèm `/api/v1`).
Để trống khi build production nghĩa là **cùng origin** — đúng với cấu hình nginx
đã có (`deploy/nginx-chatmql-dev.conf` proxy `/api`, `/uploads`, `/socket.io`).
Đây là điểm khác bản cũ: không còn nhúng cứng `localhost:4520`, bỏ hẳn
`scripts/build-dev-site.sh`.

## Khác biệt so với bản eCDP gốc

### Thương hiệu
- Màu chính `#0D6838` = `hsl(148.4 77.8% 22.9%)` trong `src/index.css`.
- Khóa localStorage: `token` / `refreshToken` — **cố ý trùng bản build cũ** để nhân
  viên chuyển qua lại giữa hai bản không phải đăng nhập lại. Khóa platform:
  `platform_token` / `platform_refreshToken`. Khóa giao diện: `chatmql_*`.
- Branding đọc từ `GET /platform/branding` như cũ (`window.__CHATMQL_BRANDING__`).

### Cờ tính năng — `src/lib/features.ts`
Backend TDVN là một fork khác của backend eCDP và **thiếu khoảng 40 endpoint** mà
frontend gốc gọi (ghim hội thoại, thả cảm xúc, chuyển tiếp, nhắc hẹn, danh thiếp,
thẻ ngân hàng, tin nhanh, bot AI, roles/permissions, widget live chat…).
Mỗi nhóm là một cờ `false` → giao diện **ẩn** nút/menu/tab tương ứng, hook không gọi API.
Backend bổ sung route thì chỉ cần bật cờ, không phải viết lại giao diện.

### Tính năng riêng TDVN (port từ script vá)
| Nguồn | Đã port thành |
|---|---|
| `order-ui-bridge.js` (5.884 dòng) | `pages/conversations/crm-panel.tsx` (cột phải 4 tab), `order-form.tsx`, `customer-profile-drawer.tsx`, `customer-360-dialog.tsx`, `pages/promotions/`, `pages/dashboard/overview-cards.tsx` |
| `zalo-history-bridge.js` | `pages/settings/zalo-sync-section.tsx`, `pages/conversations/backfill-button.tsx` |
| `inject-schedule-ui.js` | `pages/ai/ai-schedule-card.tsx` |
| `train-ai-bridge.js` + `train-ai.html` | `pages/ai/train-ai-page.tsx` + `public/train-ai.html` |

Cột phải màn Hội thoại giữ nguyên nghiệp vụ bản cũ: 4 tab **Thông tin · Ghi chú nhanh ·
Tạo đơn · Tài liệu bán hàng**, gọi thẳng nhóm API `/api/v1/orders/*` (cầu nối sang CRM
và FM). Tab đang mở nằm ở `src/stores/crm-panel-store.ts` để nút "Lên đơn" trên thanh
soạn tin mở được tab Tạo đơn.

### Trang thêm mới
`pages/cdp/` (thuộc tính, segment, preset, sự kiện, vòng đời) và
`pages/appointments/` — hai màn bản eCDP chưa có nhưng backend TDVN đã có API.

## Quy ước code

Giữ nguyên của bản tham chiếu:
- `pages/` chỉ UI; mọi lời gọi API nằm ở `hooks/use-<domain>.ts`.
- `api` (`@/lib/api-client`) + TanStack Query. Lỗi qua `apiError(err)` + `toast.error`.
- Mutation xong phải `invalidateQueries` đủ key.
- Text UI tiếng Việt. Màu qua token Tailwind, **không hardcode hex**.
- Export named. `import type` cho kiểu (bật `verbatimModuleSyntax`).
- Hook gọi trước mọi `return` sớm.

## Trước khi giao một thay đổi

```bash
npm run lint && npm run build
```

Rồi thử bằng cả tài khoản `owner` và `member`, bật chế độ tối, thu hẹp cửa sổ dưới
1280px (cột phải Hội thoại ẩn, không cuộn ngang toàn trang).
