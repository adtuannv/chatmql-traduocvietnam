/**
 * features.ts — Cờ bật/tắt tính năng theo backend đang chạy.
 *
 * Frontend này fork từ eCDP; backend TDVN (ChatMQL) là một fork khác của cùng
 * backend nhưng KHÔNG có một số route. Mỗi cờ dưới đây tương ứng với một nhóm
 * endpoint: `false` = backend không có → giao diện phải ẨN (không disable) mọi
 * nút/menu/dialog/hook gọi tới, để không phát sinh 404.
 *
 * Đã đối chiếu với `bizcrm_backend_source/src/modules/**\/*-routes.ts`.
 * Khi backend bổ sung route, chỉ cần bật cờ — code giao diện vẫn giữ nguyên.
 */
export const FEATURES = {
  // ── Hội thoại ─────────────────────────────────────────────────────
  /** POST/DELETE /conversations/:id/pin + lọc "Đã ghim". */
  CHAT_PIN: false,
  /** POST /conversations/:id/mark-unread. */
  CHAT_MARK_UNREAD: false,
  /** POST /conversations/mark-all-read. */
  CHAT_MARK_ALL_READ: false,
  /**
   * POST /conversations/:id/messages/:msgId/reaction — TDVN ĐÃ CÓ
   * (chat-routes.ts). Body `{ icon }`, chuỗi rỗng = gỡ. Backend ghi DB rồi
   * đẩy sang Zalo dạng best-effort; phản hồi kèm `forwarded`/`reason`.
   */
  CHAT_REACTIONS: true,
  /** POST /conversations/:id/messages/:msgId/forward. */
  CHAT_FORWARD: false,
  /** DELETE /conversations/:id/messages/:msgId. (Thu hồi qua /undo vẫn có.) */
  CHAT_DELETE_MESSAGE: false,
  /** POST /conversations/:id/remove-member. */
  CHAT_REMOVE_MEMBER: false,
  /** CRUD /conversations/:id/reminders. */
  CHAT_REMINDERS: false,
  /** POST /conversations/:id/polls. */
  CHAT_POLL: false,
  /** POST /conversations/:id/messages/card. */
  CHAT_SEND_CARD: false,
  /** POST /conversations/:id/messages/bank-card + GET /zalo/bank-list. */
  CHAT_SEND_BANK_CARD: false,
  /** POST /conversations/:id/messages/link + POST /link/parse. */
  CHAT_SEND_LINK: false,
  /** CRUD /zalo-accounts/:id/quick-messages. */
  CHAT_QUICK_MESSAGES: false,
  /**
   * Tin nội bộ / riêng tư (`visibility`, `mentionUserIds`) + GET /me/org-members.
   * Backend TDVN bỏ qua `visibility` → tin sẽ đi THẲNG ra kênh khách, nên bắt buộc ẩn.
   */
  CHAT_INTERNAL_NOTES: false,
  /** Lọc danh sách hội thoại theo nhãn (`?tag=`) — backend TDVN không đọc tham số này. */
  CHAT_TAG_FILTER: false,
  /** Gửi nhiều ảnh trong MỘT request multipart — backend TDVN giới hạn `files: 1`. */
  CHAT_MULTI_IMAGE_UPLOAD: false,

  // ── Zalo cá nhân ──────────────────────────────────────────────────
  /** GET /zalo-accounts/:id/friends/find + POST .../friends/requests — TDVN CÓ (friend-routes.ts). */
  ZALO_ADD_FRIEND: true,

  // ── AI ────────────────────────────────────────────────────────────
  /**
   * CRUD /ai/bots + màn /ai/train/:botId — TDVN ĐÃ CÓ (ai-bot-routes.ts, port
   * từ eCDP). Nhiều Agent AI dùng CHUNG bộ train của tổ chức (kho tri thức,
   * kịch bản, logic docs); mỗi Agent chỉ riêng persona/playbook/model/kênh.
   * Mỗi kênh chỉ do MỘT bot phục vụ (gán kênh cho bot này sẽ gỡ khỏi bot khác).
   */
  AI_BOTS: true,
  /** GET/PUT /ai/channel-overrides. */
  AI_CHANNEL_OVERRIDES: false,
  /** GET/PUT /ai/custom-models. */
  AI_CUSTOM_MODELS: false,

  // ── Cài đặt / hệ thống ────────────────────────────────────────────
  /**
   * /roles, /permissions, /me/permissions (RBAC động) — TDVN ĐÃ CÓ (port từ
   * eCDP: role-routes.ts + rbac-seed.ts + permission-service.ts). Ma trận
   * quyền, vai trò tuỳ chỉnh và gán `roleId` cho thành viên qua
   * PATCH /settings/team/:id đều hoạt động.
   */
  ROLES_PERMISSIONS: true,
  /**
   * /widgets (quản trị) + /widget/:siteKey/* (công khai) + GET /widget.js —
   * TDVN ĐÃ CÓ (src/modules/widget/, port từ eCDP). Widget là lớp nhúng công
   * khai đứng trước kênh Web Chat sẵn có: tin của khách đi qua
   * `deliverWebVisitorMessage` nên vào thẳng màn Hội thoại như mọi kênh khác.
   * Route ghi chỉ owner/admin (TDVN chưa có RBAC động).
   */
  WEBSITE_WIDGETS: true,
  /** GET /modules (kho lưu trữ module). Tắt → coi mọi module là BẬT. */
  MODULES_API: false,
  /** GET /zalo-oa/config-status, /facebook-page/config-status. Tắt → coi như đã cấu hình. */
  CHANNEL_CONFIG_STATUS: false,
} as const

export type FeatureKey = keyof typeof FEATURES
