/**
 * permission-registry.ts — NGUỒN DUY NHẤT khai báo mọi quyền của hệ thống.
 *
 * Bảng `permissions` trong DB chỉ là bản sao của file này (seed lại mỗi lần khởi
 * động). Muốn thêm quyền → sửa ở đây, không INSERT tay vào DB.
 *
 * Quy ước khoá: `<module>.<action>`, ví dụ `contacts.delete`.
 * Nhóm (`group`) bám đúng menu chính để người dùng nhìn ma trận thấy quen thuộc.
 *
 * ⚠️ GIAI ĐOẠN 1: danh mục + vai trò đã dựng nhưng CHƯA có hiệu lực. 74 chỗ
 * `if (!['owner','admin'])` trong route vẫn đang quyết định. Việc thay chúng
 * bằng `requirePermission()` là giai đoạn 2.
 */

/** Hành động chuẩn. Không phải module nào cũng có đủ. */
export const Action = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  IMPORT: 'import',
  EXPORT: 'export',
  APPROVE: 'approve',
  SEND: 'send',
  MONITOR: 'monitor',
  IMPERSONATE: 'impersonate',
} as const
export type ActionKey = (typeof Action)[keyof typeof Action]

export const ACTION_LABEL: Record<ActionKey, string> = {
  view: 'Xem',
  create: 'Thêm',
  update: 'Chỉnh sửa',
  delete: 'Xoá',
  import: 'Nhập',
  export: 'Xuất',
  approve: 'Duyệt',
  send: 'Gửi',
  monitor: 'Giám sát',
  impersonate: 'Xem hộ',
}

interface ModuleDef {
  module: string
  group: string
  /** Hành động module này thực sự có endpoint hỗ trợ. */
  actions: ActionKey[]
  /** Nhãn riêng cho vài hành động có nghĩa đặc thù. */
  labels?: Partial<Record<ActionKey, string>>
}

/**
 * Khai báo theo đúng những gì backend ĐANG có endpoint. Không khai quyền cho
 * tính năng chưa tồn tại — ma trận sẽ hứa những thứ hệ thống không làm được.
 */
const MODULES: ModuleDef[] = [
  { module: 'dashboard', group: 'Tổng quan', actions: ['view'] },

  {
    module: 'conversations', group: 'Hội thoại',
    actions: ['view', 'create', 'update', 'delete'],
    labels: { create: 'Trả lời khách', update: 'Gán / ghim / đổi chế độ AI', delete: 'Xoá hội thoại' },
  },

  { module: 'contacts', group: 'Khách hàng', actions: ['view', 'create', 'update', 'delete', 'import', 'export'] },
  { module: 'companies', group: 'Khách hàng', actions: ['view', 'create', 'update', 'delete'],
    labels: { view: 'Xem doanh nghiệp', create: 'Thêm doanh nghiệp', update: 'Sửa doanh nghiệp', delete: 'Xoá doanh nghiệp' } },

  { module: 'automation', group: 'Tự động hóa', actions: ['view', 'create', 'update', 'delete'] },

  { module: 'analytics', group: 'CDP & Phân tích', actions: ['view', 'export'] },
  { module: 'cdp', group: 'CDP & Phân tích', actions: ['view', 'create', 'update', 'delete'],
    labels: { view: 'Xem thuộc tính & phân khúc', create: 'Thêm thuộc tính / phân khúc' } },

  { module: 'products', group: 'Sản phẩm & Tri thức', actions: ['view', 'create', 'update', 'delete', 'import'] },
  { module: 'knowledge', group: 'Sản phẩm & Tri thức', actions: ['view', 'create', 'update', 'delete', 'approve'],
    labels: { view: 'Xem kho tri thức', approve: 'Duyệt nội dung tri thức' } },

  { module: 'quotes', group: 'Báo giá', actions: ['view', 'create', 'update', 'delete'] },

  { module: 'ai', group: 'AI', actions: ['view', 'update'],
    labels: { view: 'Xem cấu hình AI', update: 'Sửa cấu hình & kịch bản AI' } },

  { module: 'zns', group: 'Chiến dịch ZNS', actions: ['view', 'create', 'update', 'delete', 'send'] },

  { module: 'integrations', group: 'Tích hợp', actions: ['view', 'create', 'update', 'delete', 'monitor'],
    labels: { create: 'Kết nối kênh mới', delete: 'Ngắt kết nối kênh',
              monitor: 'Xem trạng thái kết nối & log kênh' } },

  { module: 'settings', group: 'Cài đặt', actions: ['view', 'update'],
    labels: { view: 'Xem thông tin công ty', update: 'Sửa thông tin công ty' } },
  { module: 'tags', group: 'Cài đặt', actions: ['view', 'create', 'update', 'delete'],
    labels: { view: 'Xem nhãn', create: 'Thêm nhãn', update: 'Sửa nhãn', delete: 'Xoá nhãn' } },

  { module: 'employees', group: 'Quản lý nhân viên',
    actions: ['view', 'create', 'update', 'delete', 'impersonate'],
    labels: { create: 'Thêm nhân viên', delete: 'Xoá nhân viên',
              impersonate: 'Xem hệ thống dưới quyền nhân viên' } },
  { module: 'account_access', group: 'Quản lý nhân viên', actions: ['view', 'update'],
    labels: { view: 'Xem tài khoản phụ trách', update: 'Giao / gỡ tài khoản giao tiếp' } },
  { module: 'roles', group: 'Quản lý nhân viên', actions: ['view', 'create', 'update', 'delete'],
    labels: { view: 'Xem vai trò', create: 'Tạo vai trò', update: 'Sửa quyền vai trò', delete: 'Xoá vai trò' } },

  // ── Riêng TDVN (ChatMQL) — không có bên eCDP ──────────────────────
  { module: 'orders', group: 'Đơn hàng & Ưu đãi', actions: ['view', 'create'],
    labels: { view: 'Xem đơn hàng & sản phẩm CRM', create: 'Lên đơn cho khách' } },
  { module: 'promotions', group: 'Đơn hàng & Ưu đãi', actions: ['view', 'update'],
    labels: { view: 'Xem ưu đãi & khách được gán', update: 'Quản trị ưu đãi' } },
  { module: 'ai_eval', group: 'AI', actions: ['view', 'update'],
    labels: { view: 'Xem bộ kiểm định AI', update: 'Quản trị bộ kiểm định AI' } },
]

export interface PermissionDef {
  key: string
  module: string
  action: ActionKey
  label: string
  group: string
  sortOrder: number
}

/** Bung khai báo module thành danh sách quyền phẳng. */
export const PERMISSIONS: PermissionDef[] = MODULES.flatMap((m, mi) =>
  m.actions.map((action, ai) => ({
    key: `${m.module}.${action}`,
    module: m.module,
    action,
    label: m.labels?.[action] ?? `${ACTION_LABEL[action]} ${m.group.toLowerCase()}`,
    group: m.group,
    sortOrder: mi * 100 + ai,
  })),
)

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key))

/** Phạm vi dữ liệu gắn vào vai trò (khớp DataScope ở shared/data-scope.ts). */
export type RoleDataScope = 'all' | 'team' | 'own'

export interface SystemRoleDef {
  /** Khớp giá trị `User.role` cũ để chuyển tiếp không gãy. */
  systemKey: 'owner' | 'admin' | 'manager' | 'member'
  name: string
  description: string
  dataScope: RoleDataScope
  /** '*' = toàn bộ quyền. Ngược lại là danh sách khoá cụ thể. */
  permissions: '*' | string[]
}

const ALL_VIEW = PERMISSIONS.filter((p) => p.action === 'view').map((p) => p.key)

/**
 * Quyền XEM mà hiện tại backend chỉ cho owner/admin. Phải trừ ra khỏi vai trò
 * Quản lý, nếu không lúc chuyển route sang `requirePermission()` sẽ vô tình mở
 * thêm quyền cho họ — đúng kiểu lỗi âm thầm khó phát hiện nhất.
 *   GET /roles, /permissions              → owner/admin  (role-routes.ts)
 *   GET /zalo-accounts/:id/access         → owner/admin  (zalo-routes.ts)
 */
// TDVN: GET /ai/eval/* mở cho mọi user nhưng màn quản trị là việc của
// owner/admin — không tự mở cho Quản lý khi chuyển route sang requirePermission.
const ADMIN_ONLY_VIEWS = ['roles.view', 'account_access.view', 'ai_eval.view']
const MANAGER_VIEWS = ALL_VIEW.filter((k) => !ADMIN_ONLY_VIEWS.includes(k))

/**
 * 4 vai trò gốc — seed cho mọi tổ chức, `isSystem = true` nên không xoá được.
 * Quyền ở đây phản ánh ĐÚNG hành vi hiện tại của 74 chỗ kiểm tra trong route,
 * để giai đoạn 2 thay thế mà không đổi hành vi.
 */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    systemKey: 'owner', name: 'Chủ sở hữu',
    description: 'Toàn quyền trên mọi tính năng và dữ liệu. Không thể sửa hoặc xoá.',
    dataScope: 'all', permissions: '*',
  },
  {
    systemKey: 'admin', name: 'Quản trị',
    description: 'Toàn quyền vận hành. Khác chủ sở hữu ở chỗ không xoá được vai trò gốc.',
    dataScope: 'all', permissions: '*',
  },
  {
    systemKey: 'manager', name: 'Quản lý',
    description: 'Xem và xử lý dữ liệu của bản thân và nhân viên cấp dưới.',
    dataScope: 'team',
    permissions: [
      ...MANAGER_VIEWS,
      'conversations.create', 'conversations.update',
      'contacts.create', 'contacts.update', 'contacts.export',
      'companies.create', 'companies.update',
      'quotes.create', 'quotes.update',
      'orders.create',
      'zns.send',
      // GET /zalo/pool/status cho manager vào nhưng chặn member — không action
      // sẵn có nào diễn tả đúng ranh giới đó, nên phải thêm `monitor`.
      'integrations.monitor',
    ],
  },
  {
    systemKey: 'member', name: 'Nhân viên',
    description: 'Chỉ thấy hội thoại và khách hàng được giao.',
    dataScope: 'own',
    permissions: [
      'dashboard.view', 'conversations.view', 'conversations.create', 'conversations.update',
      'contacts.view', 'contacts.create', 'contacts.update',
      'companies.view',
      'products.view', 'knowledge.view',
      'quotes.view', 'quotes.create',
      'orders.view', 'orders.create',
      'zns.view', 'integrations.view', 'settings.view', 'tags.view',
      // KHÔNG có account_access.view / roles.view: GET /zalo-accounts/:id/access
      // và GET /roles hiện chỉ owner/admin vào được.
    ],
  },
]

/** Quyền thực tế của một vai trò gốc (bung '*' thành danh sách đầy đủ). */
export function permissionsOf(role: SystemRoleDef): string[] {
  return role.permissions === '*' ? PERMISSIONS.map((p) => p.key) : role.permissions
}
