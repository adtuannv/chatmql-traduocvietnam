/**
 * permission-service.ts — Giải tập quyền hiệu lực của một người dùng.
 *
 * GIAI ĐOẠN 2 — chuyển tiếp có dự phòng hai lớp:
 *   1. Có `roleId` → đọc quyền từ bảng `role_permissions` (nguồn thật)
 *   2. Chưa có     → suy từ cột `User.role` cũ qua SYSTEM_ROLES trong registry
 *
 * Lớp 2 bắt buộc phải có: người dùng tạo trước khi RBAC ra đời, hoặc seed chưa
 * kịp chạy, vẫn phải vào được hệ thống đúng như trước. Không có nó, một lần
 * seed lỗi là khoá cửa toàn bộ tổ chức.
 */
import { prisma } from './prisma-client.js'
import { SYSTEM_ROLES, permissionsOf } from './permission-registry.js'

/**
 * Chỉ khai đúng hai trường hàm này thực sự đọc. Đòi thêm `id`/`orgId` sẽ bắt
 * mọi handler phải nới kiểu ép của `request.user` — thừa và dễ gây lỗi biên dịch
 * ở những chỗ không liên quan.
 */
export interface PermissionUser {
  role: string
  roleId?: string | null
}

/** Quyền của vai trò hệ thống, dựng sẵn từ registry — không cần chạm DB. */
const FALLBACK_BY_ROLE = new Map<string, Set<string>>(
  SYSTEM_ROLES.map((r) => [r.systemKey, new Set(permissionsOf(r))]),
)

/**
 * Cache quyền theo roleId. Vai trò đổi rất hiếm nhưng mọi request đều đọc, nên
 * không cache thì mỗi request tốn một truy vấn join.
 */
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { keys: Set<string>; at: number }>()

/** Gọi sau khi sửa quyền của vai trò để lần đọc kế tiếp lấy bản mới. */
export function invalidateRolePermissionCache(roleId?: string): void {
  if (roleId) cache.delete(roleId)
  else cache.clear()
}

async function permissionsOfRoleId(roleId: string): Promise<Set<string>> {
  const hit = cache.get(roleId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.keys

  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permissionKey: true },
  })
  const keys = new Set(rows.map((r) => r.permissionKey))
  cache.set(roleId, { keys, at: Date.now() })
  return keys
}

/** Tập quyền hiệu lực. Không bao giờ ném lỗi — hỏng thì lùi về vai trò cũ. */
export async function getUserPermissions(user: PermissionUser): Promise<Set<string>> {
  if (user.roleId) {
    try {
      const keys = await permissionsOfRoleId(user.roleId)
      // Vai trò rỗng gần như chắc chắn là seed lỗi chứ không phải chủ ý → lùi
      // về vai trò cũ thay vì chặn sạch mọi thao tác của người dùng.
      if (keys.size > 0) return keys
    } catch {
      /* rơi xuống dự phòng bên dưới */
    }
  }
  return FALLBACK_BY_ROLE.get(user.role) ?? new Set()
}

export async function userHasPermission(user: PermissionUser, key: string): Promise<boolean> {
  return (await getUserPermissions(user)).has(key)
}

// ── Tra cứu TƯƠI theo userId ─────────────────────────────────────────
// Token chỉ mang roleId tại thời điểm đăng nhập. Admin gán vai trò xong mà
// quyền vẫn tính theo token thì người đang đăng nhập giữ quyền cũ tới khi
// đăng nhập lại — đúng lỗi "gán rồi vẫn thấy full chức năng". Các chỗ quyết
// định quyền (GET /me/permissions, guard ghi) phải đọc roleId hiện tại từ DB.
const userRoleCache = new Map<string, { role: string; roleId: string | null; at: number }>()

/** Gọi sau khi PATCH đổi vai trò của một thành viên. */
export function invalidateUserRoleCache(userId?: string): void {
  if (userId) userRoleCache.delete(userId)
  else userRoleCache.clear()
}

async function resolveUserRole(userId: string, fallbackRole: string): Promise<PermissionUser> {
  const hit = userRoleCache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, roleId: true, orgId: true },
    })
    let roleId = row?.roleId ?? null
    // User chưa nối vai trò động (tạo qua mời, hoặc dữ liệu cũ): nối theo vai
    // trò HỆ THỐNG của tổ chức thay vì rơi thẳng về hằng số trong registry —
    // admin sửa quyền vai trò "Nhân viên" trên ma trận thì người mang vai trò
    // đó phải chịu bản ĐÃ SỬA trong DB, không phải bản mặc định trong code.
    if (!roleId && row?.orgId) {
      const sysRole = await prisma.role.findFirst({
        where: { orgId: row.orgId, isSystem: true, systemKey: row.role },
        select: { id: true },
      })
      roleId = sysRole?.id ?? null
    }
    const val = { role: row?.role ?? fallbackRole, roleId, at: Date.now() }
    userRoleCache.set(userId, val)
    return val
  } catch {
    // DB trục trặc thì dùng claim trong token — thà quyền cũ vài chục giây
    // còn hơn chặn sạch mọi request.
    return { role: fallbackRole, roleId: null }
  }
}

/** Tập quyền hiệu lực theo trạng thái HIỆN TẠI trong DB (không tin roleId trong token). */
export async function getUserPermissionsFresh(userId: string, fallbackRole: string): Promise<Set<string>> {
  return getUserPermissions(await resolveUserRole(userId, fallbackRole))
}

export async function userHasPermissionFresh(userId: string, fallbackRole: string, key: string): Promise<boolean> {
  return (await getUserPermissionsFresh(userId, fallbackRole)).has(key)
}
