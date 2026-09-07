/**
 * role-routes.ts — Đọc danh mục quyền và vai trò (RBAC giai đoạn 1).
 *
 * Các chốt trong route đã đọc quyền từ đây (giai đoạn 2), nên sửa ở màn này là
 * có hiệu lực ngay — chỉ chờ hết 30 giây cache, hoặc lập tức vì mọi endpoint ghi
 * đều gọi `invalidateRolePermissionCache()`.
 *
 * Ba chốt an toàn, cả ba đều nhằm chống tự khoá cửa:
 *   1. Không sửa/xoá được vai trò `owner`
 *   2. Không xoá vai trò còn người đang giữ
 *   3. Không tự gỡ quyền `roles.update` của chính vai trò mình đang mang
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import {
  userHasPermission,
  getUserPermissions,
  invalidateRolePermissionCache, getUserPermissionsFresh } from '../../shared/permission-service.js'
import { PERMISSION_KEYS } from '../../shared/permission-registry.js'
import { logger } from '../../shared/logger.js'

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // GET /me/permissions — tập quyền HIỆU LỰC của chính người đang đăng nhập.
  // FE dùng để ẩn/hiện hành động (vd nút "Xoá hội thoại"); chốt thật vẫn nằm ở
  // từng endpoint qua userHasPermission.
  app.get('/api/v1/me/permissions', async (request) => {
    // Đọc roleId TƯƠI từ DB: admin vừa gán vai trò là lần tải trang kế tiếp
    // của nhân viên đã thấy đúng quyền, không phải chờ đăng nhập lại.
    const user = request.user as { id: string; role: string }
    const keys = await getUserPermissionsFresh(user.id, user.role)
    return { keys: [...keys] }
  })

  // GET /me/org-members — danh bạ nội bộ để @mention trong tin nhắn nội bộ.
  // Mọi thành viên tổ chức đều gọi được (khác /settings/team vốn chỉ admin);
  // chỉ trả tên + avatar, không lộ email/role/phân quyền.
  app.get('/api/v1/me/org-members', async (request) => {
    const user = request.user as { id: string; orgId: string }
    const members = await prisma.user.findMany({
      where: { orgId: user.orgId, isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, avatarUrl: true },
    })
    return { members }
  })

  // GET /permissions — danh mục quyền hệ thống, gom sẵn theo nhóm để dựng ma trận
  app.get('/api/v1/permissions', async (request, reply) => {
    const user = request.user as { role: string }
    if (!(await userHasPermission(user, 'roles.view'))) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem cấu hình phân quyền', code: 'PERMISSION_DENIED' })
    }
    const rows = await prisma.permission.findMany({ orderBy: { sortOrder: 'asc' } })

    // Giữ thứ tự sortOrder khi gom nhóm — Map bảo toàn thứ tự chèn.
    const groups = new Map<string, typeof rows>()
    for (const p of rows) {
      const list = groups.get(p.group) ?? []
      list.push(p)
      groups.set(p.group, list)
    }
    return {
      total: rows.length,
      groups: [...groups.entries()].map(([group, permissions]) => ({ group, permissions })),
    }
  })

  // GET /roles — vai trò của tổ chức + số người đang giữ + số quyền
  app.get('/api/v1/roles', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!(await userHasPermission(user, 'roles.view'))) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem cấu hình phân quyền', code: 'PERMISSION_DENIED' })
    }
    const roles = await prisma.role.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true, name: true, description: true, isSystem: true,
        systemKey: true, dataScope: true,
        _count: { select: { users: true, permissions: true } },
      },
    })
    return {
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        systemKey: r.systemKey,
        dataScope: r.dataScope,
        userCount: r._count.users,
        permissionCount: r._count.permissions,
      })),
    }
  })

  // GET /roles/:id/permissions — khoá quyền của một vai trò (để tick sẵn ma trận)
  app.get<{ Params: { id: string } }>('/api/v1/roles/:id/permissions', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!(await userHasPermission(user, 'roles.view'))) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem cấu hình phân quyền', code: 'PERMISSION_DENIED' })
    }
    const role = await prisma.role.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true },
    })
    if (!role) return reply.status(404).send({ error: 'Vai trò không tồn tại' })

    const rows = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionKey: true },
    })
    return { keys: rows.map((r) => r.permissionKey) }
  })

  // ── Ghi ────────────────────────────────────────────────────────────────

  type Actor = { id: string; orgId: string; role: string; roleId?: string | null }

  /** Lọc bỏ khoá không có trong registry và khử trùng. */
  function cleanKeys(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    return [...new Set(input.filter((k): k is string => typeof k === 'string' && PERMISSION_KEYS.has(k)))]
  }

  const SCOPES = ['all', 'team', 'own']

  // POST /roles — tạo vai trò mới
  app.post<{ Body: { name?: string; description?: string; dataScope?: string; permissionKeys?: string[] } }>(
    '/api/v1/roles',
    async (request, reply) => {
      const user = request.user as Actor
      if (!(await userHasPermission(user, 'roles.create'))) {
        return reply.status(403).send({ error: 'Bạn không có quyền tạo vai trò', code: 'PERMISSION_DENIED' })
      }
      const name = (request.body.name ?? '').trim()
      if (!name) return reply.status(400).send({ error: 'Cần tên vai trò' })

      const dataScope = SCOPES.includes(request.body.dataScope ?? '') ? request.body.dataScope! : 'own'
      const dup = await prisma.role.findFirst({ where: { orgId: user.orgId, name }, select: { id: true } })
      if (dup) return reply.status(400).send({ error: `Đã có vai trò tên "${name}"` })

      const keys = cleanKeys(request.body.permissionKeys)
      const role = await prisma.role.create({
        data: {
          orgId: user.orgId, name,
          description: request.body.description?.trim() || null,
          dataScope, isSystem: false,
          permissions: { create: keys.map((permissionKey) => ({ permissionKey })) },
        },
      })
      logger.info({ roleId: role.id, name, keys: keys.length }, '[rbac] tạo vai trò')
      return reply.status(201).send({ id: role.id })
    },
  )

  // PUT /roles/:id — sửa tên, mô tả, phạm vi dữ liệu
  app.put<{ Params: { id: string }; Body: { name?: string; description?: string; dataScope?: string } }>(
    '/api/v1/roles/:id',
    async (request, reply) => {
      const user = request.user as Actor
      if (!(await userHasPermission(user, 'roles.update'))) {
        return reply.status(403).send({ error: 'Bạn không có quyền sửa vai trò', code: 'PERMISSION_DENIED' })
      }
      const role = await prisma.role.findFirst({ where: { id: request.params.id, orgId: user.orgId } })
      if (!role) return reply.status(404).send({ error: 'Vai trò không tồn tại' })
      if (role.systemKey === 'owner') {
        return reply.status(400).send({ error: 'Không thể sửa vai trò Chủ sở hữu' })
      }

      const data: Record<string, unknown> = {}
      const name = request.body.name?.trim()
      if (name) {
        const dup = await prisma.role.findFirst({
          where: { orgId: user.orgId, name, id: { not: role.id } }, select: { id: true },
        })
        if (dup) return reply.status(400).send({ error: `Đã có vai trò tên "${name}"` })
        data.name = name
      }
      if (request.body.description !== undefined) data.description = request.body.description?.trim() || null
      if (request.body.dataScope && SCOPES.includes(request.body.dataScope)) data.dataScope = request.body.dataScope

      if (Object.keys(data).length === 0) return { ok: true }
      await prisma.role.update({ where: { id: role.id }, data })
      return { ok: true }
    },
  )

  // PUT /roles/:id/permissions — thay toàn bộ tập quyền của vai trò
  app.put<{ Params: { id: string }; Body: { permissionKeys?: string[] } }>(
    '/api/v1/roles/:id/permissions',
    async (request, reply) => {
      const user = request.user as Actor
      if (!(await userHasPermission(user, 'roles.update'))) {
        return reply.status(403).send({ error: 'Bạn không có quyền sửa quyền vai trò', code: 'PERMISSION_DENIED' })
      }
      const role = await prisma.role.findFirst({ where: { id: request.params.id, orgId: user.orgId } })
      if (!role) return reply.status(404).send({ error: 'Vai trò không tồn tại' })
      if (role.systemKey === 'owner') {
        return reply.status(400).send({ error: 'Vai trò Chủ sở hữu luôn có toàn quyền, không sửa được' })
      }

      const keys = cleanKeys(request.body.permissionKeys)

      // Chống tự khoá cửa: đang mang vai trò này mà gỡ quyền sửa vai trò thì
      // không còn đường quay lại — trừ khi bản thân là chủ sở hữu.
      if (user.roleId === role.id && user.role !== 'owner' && !keys.includes('roles.update')) {
        return reply.status(400).send({
          error: 'Không thể tự gỡ quyền "Sửa quyền vai trò" khỏi vai trò bạn đang mang',
        })
      }

      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        prisma.rolePermission.createMany({
          data: keys.map((permissionKey) => ({ roleId: role.id, permissionKey })),
          skipDuplicates: true,
        }),
      ])
      invalidateRolePermissionCache(role.id)
      logger.info({ roleId: role.id, keys: keys.length }, '[rbac] cập nhật quyền vai trò')
      return { ok: true, count: keys.length }
    },
  )

  // DELETE /roles/:id
  app.delete<{ Params: { id: string } }>('/api/v1/roles/:id', async (request, reply) => {
    const user = request.user as Actor
    if (!(await userHasPermission(user, 'roles.delete'))) {
      return reply.status(403).send({ error: 'Bạn không có quyền xoá vai trò', code: 'PERMISSION_DENIED' })
    }
    const role = await prisma.role.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true, name: true, isSystem: true, _count: { select: { users: true } } },
    })
    if (!role) return reply.status(404).send({ error: 'Vai trò không tồn tại' })
    if (role.isSystem) return reply.status(400).send({ error: 'Không thể xoá vai trò gốc của hệ thống' })
    if (role._count.users > 0) {
      return reply.status(400).send({
        error: `Còn ${role._count.users} người đang giữ vai trò "${role.name}". Chuyển họ sang vai trò khác trước.`,
      })
    }
    await prisma.role.delete({ where: { id: role.id } })
    invalidateRolePermissionCache(role.id)
    return { ok: true }
  })
}
