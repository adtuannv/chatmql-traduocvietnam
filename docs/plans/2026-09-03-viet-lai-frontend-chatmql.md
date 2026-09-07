# Viết lại frontend ChatMQL — hiện trạng và việc còn lại

Cập nhật: 03/09/2026. Thay thế bản kế hoạch 7 đợt viết cùng ngày (hướng đó giả định
phải dựng frontend từ số không).

## Vì sao đổi hướng

Bản kế hoạch đầu ước lượng 14–16 tuần vì cho rằng phải viết lại toàn bộ giao diện.
Sau khi đọc `/Users/macbook/social-app-main/docs/CHUYEN-GIAO-DEV-FRONTEND.md`, phát
hiện **đã có sẵn mã nguồn frontend đầy đủ** của eCDP (`~/social-app-main/frontend`,
129 file, ~30.000 dòng) — cùng dòng backend, đã đi qua hết các bẫy, đã phủ toàn bộ
nghiệp vụ. ChatMQL chính là bản build của dòng sản phẩm đó.

Nên: **fork mã nguồn eCDP → `chatmql-frontend/`**, đổi thương hiệu, bịt phần backend
TDVN không có, rồi port các tính năng riêng của TDVN từ script vá sang React.
Không viết lại từ đầu.

## Đã làm

### Nền
- `chatmql-frontend/` = fork mã nguồn eCDP. Dev ở cổng 5174.
- Thương hiệu: màu `#0D6838`, logo TDVN, tiêu đề, chuỗi văn bản.
- Khóa localStorage `token` / `refreshToken` **giữ trùng bản build cũ** → nhân viên
  chuyển qua lại hai bản không phải đăng nhập lại.
- `VITE_API_URL` để trống = cùng origin. Bỏ hẳn nhu cầu chạy `scripts/build-dev-site.sh`.

### Cờ tính năng — `src/lib/features.ts`
Backend TDVN thiếu khoảng 40 endpoint mà frontend eCDP gọi. Mỗi nhóm là một cờ:
ghim hội thoại, đánh dấu chưa đọc, đọc hết, thả cảm xúc, chuyển tiếp, xóa tin,
xóa thành viên nhóm, nhắc hẹn, bình chọn, danh thiếp, thẻ ngân hàng, gửi link,
tin nhắn nhanh, tin nội bộ, lọc theo nhãn, gửi nhiều ảnh một lượt, bot AI,
override theo kênh, model tùy chỉnh, roles/permissions, widget live chat,
kho module, config-status kênh. Cờ `false` → **ẩn**, không disable. Backend thêm
route thì bật cờ, không phải sửa giao diện.

### Tính năng riêng TDVN đã port sang React
| Nguồn (script vá) | Thành |
|---|---|
| `order-ui-bridge.js` 5.884 dòng | `crm-panel.tsx` (cột phải 4 tab), `order-form.tsx` (1.075 dòng), `customer-profile-drawer.tsx`, `customer-360-dialog.tsx`, `pages/promotions/`, `dashboard/overview-cards.tsx` |
| `zalo-history-bridge.js` 690 dòng | `settings/zalo-sync-section.tsx`, `conversations/backfill-button.tsx` |
| `inject-schedule-ui.js` | `ai/ai-schedule-card.tsx` |
| `train-ai-bridge.js` + `train-ai.html` | `ai/train-ai-page.tsx` + `public/train-ai.html` |

Cột phải màn Hội thoại **giữ nguyên nghiệp vụ**: 4 tab Thông tin · Ghi chú nhanh ·
Tạo đơn · Tài liệu bán hàng, gọi thẳng nhóm `/api/v1/orders/*` (cầu nối CRM và FM).

### Trang bổ sung
`pages/cdp/` (thuộc tính, segment, preset, sự kiện, vòng đời) và
`pages/appointments/` — backend đã có API, bản eCDP chưa có màn.

### Đã kiểm chứng trên trình duyệt với dữ liệu thật
Đăng nhập, Tổng quan (KPI + khối doanh số), Quản trị ưu đãi, Đồng bộ & Lịch sử Zalo,
Train AI nhúng, Lịch hẹn.

## Việc còn lại

| Việc | Ghi chú |
|---|---|
| Chạy CRM backend local | Repo không có dump `crm_tdvn` và `fm_tdvn`; thiếu nó thì tab Thông tin, Tạo đơn, Ưu đãi báo lỗi kết nối |
| Kiểm tra tay toàn bộ màn Hội thoại | Gửi tin, ảnh, sticker, thu hồi, chế độ AI, cột phải 4 tab, lên đơn thật |
| Ảnh Zalo | Dùng `GET /api/v1/media/proxy?url=` khi CDN Zalo chặn hotlink |
| Bốn quyết định nghiệp vụ | Điểm Lá, bảng ưu đãi, tên kho, luật form đơn — xem `design/ban-do-tinh-nang-chatmql.html` |
| Thêm `@fastify/swagger` vào backend | Sinh kiểu TypeScript thay vì gõ tay |
| Dọn bí mật khỏi repo | Dump production `bcrm_prod_dump.dump` và 4 file khóa service account Google đang nằm trong repo công khai — **làm trước mọi thứ khác** |
| Bản mobile | `CRM-Mobile/app` hiện là vanilla JS; sau khi desktop ổn nên dùng lại `hooks/` của bản mới |

## Chuyển đổi

Chạy song song: bản cũ ở địa chỉ live, bản mới ở `chatmql-dev`. Hai bản dùng chung
khóa phiên và chung API nên nhân viên chuyển qua lại được. Khi bản mới đủ tin cậy,
xóa `bizcrm_frontend_dist/`, `dist/`, `dist-dev/`, ba file bridge,
`inject-schedule-ui.js`, `scripts/build-dev-site.sh`.
