# README — Phiên bản 2026-09: Viết lại FE ChatMQL + loạt tính năng port từ eCDP

> Tài liệu này tổng hợp toàn bộ thay đổi trong nhánh này để anh Thắng (thangvmtpn) review trước khi merge vào `main`. Chi tiết bối cảnh/kế hoạch ban đầu xem thêm [`docs/plans/2026-09-03-viet-lai-frontend-chatmql.md`](plans/2026-09-03-viet-lai-frontend-chatmql.md); hướng dẫn chạy local xem [`docs/chay-local.md`](chay-local.md).

## 1. Tổng quan

FE cũ của ChatMQL (`bizcrm_frontend_dist/`) chỉ tồn tại ở dạng build đã minify, không có source, được vá bằng các bridge-script DOM-injection (`order-ui-bridge.js`, `zalo-history-bridge.js`, `inject-schedule-ui.js`...). Phiên bản này thêm **`chatmql-frontend/`** — FE mới viết bằng React 19 + TypeScript strict, fork từ source của sản phẩm anh em "eCDP" (cùng họ backend, đã chạy ổn định), rồi:

- Rebrand sang ChatMQL (màu chính `#0068FF`, logo, các khoá localStorage giữ nguyên `token`/`refreshToken` để phiên đăng nhập cũ/mới dùng chung).
- Giữ nguyên 100% tính năng cốt lõi của bản cũ: kết nối API `/api/v1/orders/*`, cột chat bên phải (4 tab: Thông tin CRM · Ghi chú nhanh · Tạo đơn · Tài liệu bán hàng).
- Port thêm một loạt tính năng bên eCDP mà backend TDVN chưa từng dùng tới, xem mục 3.
- Những endpoint eCDP có mà backend TDVN chưa có được **ẩn qua feature flag** (`src/lib/features.ts`), không xoá code — bật lại chỉ cần lật flag khi backend bổ sung.

**Không đụng vào** `bizcrm_frontend_dist/` (bản cũ, giữ lại để đối chiếu/rollback) hay hệ thống "CRM TDVN" (`frontend/`, `backend/` — ứng dụng FastAPI+React độc lập, không liên quan ChatMQL).

## 2. Backend (`bizcrm_backend_source/`) — tính năng mới/port từ eCDP

| Tính năng | Tóm tắt |
|---|---|
| **Đa AI Agent** (`ai-bot-routes.ts`, `ai-bot-service.ts`) | Tạo nhiều "Agent" AI, mỗi Agent override persona/playbook/provider/model/tools riêng, gắn với danh sách kênh cụ thể (1 kênh chỉ thuộc 1 Agent). |
| **Widget chat website** (`widget/*`) | CRUD site-key, danh sách domain được phép nhúng, `widget.js` public + preview trong trang admin (dùng `data-preview-config` để qua được giới hạn `Origin: null` của iframe `srcdoc` mà không nới lỏng kiểm tra domain thật). |
| **Reaction 2 chiều** (`chat-routes.ts`, `zalo-event-handlers.ts`) | Thả cảm xúc từ CRM → đẩy sang Zalo thật; Zalo thả cảm xúc → đồng bộ ngược vào CRM (có chặn Zalo echo lại reaction do chính CRM gửi). Kèm fix lỗi gửi trùng 2 icon sticker cùng lúc (`message-handler.ts`, do so khớp sai định dạng ID sticker CRM tạo ra so với JSON Zalo echo về). |
| **Phân quyền động (RBAC)** (`settings/rbac-seed.ts`, `role-routes.ts`, `permission-service.ts`) | Model `Permission`/`Role`/`RolePermission`, seed sẵn 4 vai trò hệ thống mỗi org, màn quản lý phân quyền theo từng chức năng. **Đã fix bug**: đổi vai trò nhân viên không có hiệu lực ngay (JWT giữ `roleId` cũ tới khi refresh token) và nhân viên mới mời không được gắn `roleId` nên rơi về quyền mặc định — nay đọc quyền "tươi" từ DB (cache 30s theo userId) + tự invalidate cache khi đổi vai trò. |
| **Ngân sách ngữ cảnh theo model AI** (`harness/budgets.ts`) | Model nhỏ/lớn có giới hạn ký tự khác nhau cho persona/playbook/kiến thức, tránh cắt ngầm dữ liệu train khi đổi model. |
| **Kiểm định AI (AI Eval)** (`ai-eval-routes.ts`) | Bộ test hồi quy cho câu trả lời AI, chạy qua đường mô phỏng (`simulate`), không bao giờ gửi tin thật. |
| **Học từ lịch sử tin nhắn + Cải thiện AI** (`learn-history-routes.ts` có sẵn, nay có UI gọi tới) | Phân tích hội thoại cũ (theo kênh/khoảng ngày, hoặc upload file export chat) → sinh đề xuất cập nhật persona, người dùng duyệt mới áp dụng. |
| **Báo cáo "Hiệu quả Chat → Đơn hàng"** (`dashboard/report-routes.ts`) | Viết mới theo tài liệu bàn giao, có scoping theo vai trò (member chỉ thấy kênh được cấp, manager thấy kênh của cấp dưới, owner/admin thấy toàn bộ). Đã sửa 2 lỗi phát hiện khi audit số liệu: (a) "154 kết bạn" sai vì `channel_contacts.createdAt` là thời điểm đồng bộ chứ không phải thời điểm kết bạn thật — đổi chỉ số này thành "Số liên hệ" (snapshot tổng liên hệ trong danh bạ) thay vì đếm sự kiện theo kỳ; (b) một kênh test "AI Sandbox" đã xoá vẫn lẫn vào số liệu — thêm điều kiện lọc tài khoản còn hoạt động ở mọi câu truy vấn liên quan. |
| **Sự kiện CDP** (`cdp_events`) | Bắt đầu ghi sự kiện `order_created` (lúc tạo đơn thành công, có gắn nguồn `ai`/`staff`) và `friend_added` (lúc Zalo báo kết bạn) theo thời gian thực, thay vì cố suy ra lịch sử từ dữ liệu không đáng tin cậy — dùng cho các báo cáo/CDP về sau. |
| **Trang CDP** (`pages/cdp/` — FE) | Thuộc tính khách hàng, phân khúc, preset, dòng đời, sự kiện — port từ eCDP. |

## 3. Frontend (`chatmql-frontend/`) — tính năng port + sửa lỗi

- **Đổi màu thương hiệu** sang `#0068FF` (đồng bộ với brand Zalo/ZBS của TDVN).
- **Nút gửi icon cảm xúc**: sửa lỗi bấm 1 lần gửi ra 2 icon liên tiếp.
- **Reaction 2 chiều** trên khung chat + **tab lọc theo loại tài khoản** (Zalo cá nhân / OA / Facebook / Sàn TMĐT) khi chuyển tài khoản kênh (`src/lib/channel-groups.ts`).
- **Đa AI Agent**: giao diện tạo/sửa/xoá Agent, gắn kênh, chọn giữa 2–4 Agent cùng ngành hàng dùng chung 1 hệ thống (không tách ngành khác nhau trong cùng 1 Agent).
- **Tích hợp widget website**: trang quản trị widget + xem trước trực tiếp.
- **Trang "Cải thiện AI"**: hộp thoại "💬 Học từ lịch sử tin nhắn" (chọn kênh/khoảng ngày hoặc upload file chat) gắn vào trang Train AI, danh sách đề xuất chờ duyệt/áp dụng/từ chối. Đổi tên 2 nhãn tài liệu cho dễ hiểu: "Persona của bot" → "Tính cách & xưng hô của bot", "Playbook của bot" → "Kịch bản bán hàng của bot".
- **Phân quyền động**: menu điều hướng và route tự ẩn/hiện theo quyền thật của tài khoản đăng nhập (`nav-config.ts`, `guards.tsx`).
- **Popup "Tài liệu bán hàng"**: tách khỏi tab thứ 4 của cột phải (cột chỉ rộng 365px nên lưới ảnh bị bó nhỏ) ra popup riêng rộng hơn, mở từ nút thư mục trên thanh soạn tin, đổi nút này từ chỉ-icon sang icon + chữ.
- **Danh sách thành viên nhóm**: hiển thị avatar, tên, nhãn "Trưởng nhóm" và nút đồng bộ lại (⟳) khi mở hội thoại nhóm, thay cho khung trống trước đây.
- **Bỏ mặc định "Evotech" ở mục Kết nối nền tảng**: `DEFAULT_MINI_APPS` nay là mảng rỗng, để trống cho phép thêm bất kỳ nền tảng nào về sau thay vì hard-code sẵn 1 app mẫu.
- **Xoá module "Lịch hẹn"** (menu, route, trang) theo yêu cầu — **không đụng** tới tính năng đặt lịch hẹn cho từng khách hàng trong trang chi tiết khách hàng/panel liên hệ (`use-contacts.ts`'s `useAppointments`), vẫn giữ nguyên vì dùng chung hook nhưng khác màn hình.
- **Báo cáo Chat → Đơn hàng**: 2 dropdown lọc theo kênh/tài khoản, cảnh báo phạm vi dữ liệu khi tài khoản không có quyền xem kênh nào (`scopeNote`).
- **78 sản phẩm thật** thay thế toàn bộ sản phẩm mẫu ở local (ảnh hiện đang trỏ về URL production, chưa tải về local).

## 4. Cách chạy thử local

Xem [`docs/chay-local.md`](chay-local.md) (Postgres.app `bizcrm_local`, Redis build từ source, cấu hình `.claude/launch.json`, tài khoản test).

- FE mới: `chatmql-frontend/` → `npm run dev` (cổng 5174).
- Backend: `bizcrm_backend_source/` → `npm run dev` (cổng 4520, `tsx watch`).
- Kiểm tra kiểu dữ liệu trước khi merge: `npx tsc --noEmit -p tsconfig.json` (backend), `npx tsc -b --noEmit` (frontend). Build production: `npm run build` trong `chatmql-frontend/`.

## 5. ⚠️ Lưu ý an toàn khi chạy local

Backend "local" này đang giữ **phiên đăng nhập Zalo thật** của tài khoản kinh doanh ("Ngô Tuấn Cco Tdvn") và **API key OpenAI thật đang hoạt động** (lưu ở `app_settings.value_plain`, chưa mã hoá). Mọi endpoint gửi tin/sticker/reaction hoặc gọi AI sinh câu trả lời (`/conversations/:id/messages*`, `/ai/suggest`, `/ai/simulate/*`...) đều chạm vào tài khoản thật và khách hàng thật — cần hết sức cẩn trọng khi test, kiểm tra `GET /api/v1/zalo/pool/status` trước khi thử bất kỳ đường gửi tin nào.

## 6. Vấn đề tồn đọng (đã báo, chưa xử lý — không nằm trong phạm vi phiên bản này)

- Repo đã **public** và có sẵn secret bị commit từ trước (không phải do phiên bản này thêm mới): các file service-account dạng JSON (`traf-452002-f2de6789897f.json`, `backend/hoadon-461206-23b8550fd085.json`, `backend/model/hoadon-461206-23b8550fd085.json`, `backend/tacvu1356-1c8559c32013.json`, `backend/TPN.json`) và 2 file dump database (`bizcrm_backend_source/bcrm_prod_dump.dump`, `bizcrm_backend_source/bizcrm_local_backup_20260619.dump`). Đề xuất: xoá khỏi lịch sử git + xoay vòng (rotate) toàn bộ key/credential liên quan khi có thời gian.
- Trang "Cải thiện AI" mới có hộp thoại học từ lịch sử (trong Train AI), **chưa có trang danh sách đầy đủ** các đề xuất đang chờ duyệt (route `/ai/improve` với UI riêng) — hook `use-ai-improve.ts` đã sẵn sàng, còn thiếu phần trang.
- Ảnh của 78 sản phẩm import đang trỏ thẳng về URL production, chưa tải bản sao về local.
- Còn 7 dòng sticker trùng trong DB local từ trước khi có bản vá dedup — chưa dọn.
- Chưa quyết định có ngắt 3 kết nối Zalo pool thật đang chạy trên máy local hay không.

## 7. Gợi ý review

- Diff chính nằm ở `bizcrm_backend_source/src/**` (15 file sửa + ~14 file mới, liệt kê ở mục 2) và toàn bộ thư mục mới `chatmql-frontend/` (fork từ eCDP, ~30k dòng gốc + phần chỉnh sửa).
- Có thể chạy song song FE cũ (`bizcrm_frontend_dist`, đang phục vụ production) và FE mới (`chatmql-frontend`, cổng 5174) để so sánh trực tiếp trước khi quyết định chuyển hẳn.
