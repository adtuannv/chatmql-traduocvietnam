/**
 * settings-routes.ts — App settings and integration management.
 * Ported from ZaloCRM integration-routes.ts + app settings.
 */
import type { FastifyInstance } from 'fastify'
import { invalidateUserRoleCache } from '../../shared/permission-service.js'
import { randomBytes } from 'node:crypto'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // ── App Settings (KV store) ─────────────────────────────────────────

  app.get('/api/v1/settings', async (request) => {
    const user = request.user as { orgId: string }
    const settings = await prisma.appSetting.findMany({
      where: { orgId: user.orgId },
      select: { settingKey: true, valuePlain: true, createdAt: true, updatedAt: true },
    })
    // Convert to key-value map for easy consumption
    const map: Record<string, string | null> = {}
    for (const s of settings) map[s.settingKey] = s.valuePlain
    return { settings: map }
  })

  app.put<{ Body: { key: string; value: string } }>('/api/v1/settings', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can modify settings' })
    }

    const { key, value } = request.body
    if (!key) return reply.status(400).send({ error: 'key is required' })

    await prisma.appSetting.upsert({
      where: { orgId_settingKey: { orgId: user.orgId, settingKey: key } },
      update: { valuePlain: value },
      create: { orgId: user.orgId, settingKey: key, valuePlain: value },
    })
    return { success: true, key, value }
  })

  // ── Integrations ────────────────────────────────────────────────────

  app.get('/api/v1/integrations', async (request) => {
    const user = request.user as { orgId: string }
    const integrations = await prisma.integration.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return { integrations }
  })

  app.post<{ Body: { type: string; name?: string; config?: any; enabled?: boolean } }>(
    '/api/v1/integrations',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can manage integrations' })
      }

      const { type, name = '', config = {}, enabled = true } = request.body
      if (!type) return reply.status(400).send({ error: 'type is required' })

      const integration = await prisma.integration.create({
        data: { orgId: user.orgId, type, name, config, enabled },
      })
      return reply.status(201).send(integration)
    },
  )

  app.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/v1/integrations/:id',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can manage integrations' })
      }

      const { id } = request.params
      const existing = await prisma.integration.findFirst({ where: { id, orgId: user.orgId } })
      if (!existing) return reply.status(404).send({ error: 'Integration not found' })

      const body = request.body
      const integration = await prisma.integration.update({
        where: { id },
        data: {
          name: body.name,
          config: body.config,
          enabled: body.enabled,
        },
      })
      return integration
    },
  )

  app.delete<{ Params: { id: string } }>('/api/v1/integrations/:id', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can manage integrations' })
    }

    const { id } = request.params
    const existing = await prisma.integration.findFirst({ where: { id, orgId: user.orgId } })
    if (!existing) return reply.status(404).send({ error: 'Integration not found' })

    await prisma.integration.delete({ where: { id } })
    return { success: true }
  })

  // ── Sync logs ───────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/api/v1/integrations/:id/logs', async (request, reply) => {
    const user = request.user as { orgId: string }
    const existing = await prisma.integration.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!existing) return reply.status(404).send({ error: 'Integration not found' })

    const logs = await prisma.syncLog.findMany({
      where: { integrationId: request.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return { logs }
  })

  // ── Teams ───────────────────────────────────────────────────────────

  app.get('/api/v1/teams', async (request) => {
    const user = request.user as { orgId: string }
    const teams = await prisma.team.findMany({
      where: { orgId: user.orgId },
      include: {
        users: { select: { id: true, fullName: true, email: true, role: true } },
      },
      orderBy: { name: 'asc' },
    })
    return { teams }
  })

  app.post<{ Body: { name: string } }>('/api/v1/teams', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can manage teams' })
    }

    const { name } = request.body
    if (!name) return reply.status(400).send({ error: 'name is required' })

    const team = await prisma.team.create({
      data: { orgId: user.orgId, name },
    })
    return reply.status(201).send(team)
  })

  app.delete<{ Params: { id: string } }>('/api/v1/teams/:id', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can manage teams' })
    }

    const existing = await prisma.team.findFirst({ where: { id: request.params.id, orgId: user.orgId } })
    if (!existing) return reply.status(404).send({ error: 'Team not found' })

    await prisma.team.delete({ where: { id: request.params.id } })
    return { success: true }
  })

  // ── Team Member Management (Settings → Nhân sự) ──────────────────

  app.get('/api/v1/settings/team', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    // Per Phân quyền matrix: Nhân sự = "—" for members; manager has "Xem".
    if (user.role === 'member') {
      return reply.status(403).send({ error: 'Bạn không có quyền truy cập danh sách nhân sự' })
    }
    const rows = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true, fullName: true, email: true, role: true, roleId: true, isActive: true, createdAt: true, avatarUrl: true,
        roleRef: { select: { id: true, name: true, dataScope: true } },
        managers: { select: { managerId: true } },
        managedMembers: { select: { memberId: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    const members = rows.map(r => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      role: r.role,
      roleId: r.roleId,
      roleName: r.roleRef?.name ?? null,
      avatarUrl: r.avatarUrl,
      status: r.isActive ? 'active' : 'inactive',
      createdAt: r.createdAt,
      managerIds: r.managers.map(m => m.managerId),
      subordinateIds: r.managedMembers.map(m => m.memberId),
    }))
    return { members }
  })

  // Generate a readable random password (e.g. "bz-9f4a7c2b") — short enough
  // for the admin to copy/paste-share with the new member.
  function generateTempPassword(): string {
    const bytes = randomBytes(4)
    return 'bz-' + bytes.toString('hex')
  }

  app.post<{ Body: { email: string; role?: string; fullName?: string; password?: string } }>(
    '/api/v1/settings/team/invite',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can invite members' })
      }

      const { email, role = 'member', fullName, password } = request.body
      if (!email) return reply.status(400).send({ error: 'email is required' })
      if (password && password.length < 8) {
        return reply.status(400).send({ error: 'password must be at least 8 characters' })
      }

      const existing = await prisma.user.findFirst({ where: { email, orgId: user.orgId } })
      if (existing) return reply.status(409).send({ error: 'User already in organization' })

      // Generate a fresh random password if admin didn't supply one; return it
      // in the response so admin can share with the new member.
      const tempPlain = password?.trim() || generateTempPassword()
      const bcrypt = await import('bcryptjs')
      const passwordHash = await bcrypt.hash(tempPlain, 10)

      // Nối luôn vai trò động HỆ THỐNG tương ứng — không nối thì user mới rơi
      // về bộ quyền mặc định trong code, mọi chỉnh sửa trên ma trận bị bỏ qua.
      const sysRole = await prisma.role.findFirst({
        where: { orgId: user.orgId, isSystem: true, systemKey: role },
        select: { id: true },
      })

      const created = await prisma.user.create({
        data: {
          orgId: user.orgId,
          email,
          fullName: fullName?.trim() || email.split('@')[0],
          passwordHash,
          role,
          roleId: sysRole?.id ?? null,
          isActive: true,
        },
        select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
      })
      return reply.status(201).send({
        id: created.id,
        fullName: created.fullName,
        email: created.email,
        role: created.role,
        status: created.isActive ? 'active' : 'inactive',
        createdAt: created.createdAt,
        // Only echoed when admin didn't supply one — so they can copy/share once.
        generatedPassword: password ? undefined : tempPlain,
      })
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { role?: string; fullName?: string; password?: string; isActive?: boolean; roleId?: string | null }
  }>(
    '/api/v1/settings/team/:id',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can modify members' })
      }

      const target = await prisma.user.findFirst({ where: { id: request.params.id, orgId: user.orgId } })
      if (!target) return reply.status(404).send({ error: 'User not found' })

      const { role, fullName, password, isActive, roleId } = request.body

      // Owner is protected from demotion, deactivation, and password reset by
      // an admin. The owner changes their own password via /auth/change-password.
      if (target.role === 'owner') {
        if (role && role !== 'owner') return reply.status(400).send({ error: 'Cannot change owner role' })
        if (isActive === false) return reply.status(400).send({ error: 'Cannot deactivate owner' })
        if (password) return reply.status(400).send({ error: 'Owner password must be changed via Account Security' })
      }

      const data: {
        role?: string; fullName?: string; passwordHash?: string; isActive?: boolean; roleId?: string | null
      } = {}
      if (role !== undefined) data.role = role

      // Gán vai trò động. Chỉ nhận vai trò thuộc chính tổ chức này — nếu không
      // một id đoán được sẽ kéo quyền từ tổ chức khác sang.
      if (roleId !== undefined) {
        if (roleId === null) {
          data.roleId = null
        } else {
          const targetRole = await prisma.role.findFirst({
            where: { id: roleId, orgId: user.orgId }, select: { id: true, systemKey: true },
          })
          if (!targetRole) return reply.status(400).send({ error: 'Vai trò không tồn tại trong tổ chức' })
          if (target.role === 'owner' && targetRole.systemKey !== 'owner') {
            return reply.status(400).send({ error: 'Không thể đổi vai trò của chủ sở hữu' })
          }
          data.roleId = targetRole.id
        }
      }
      if (fullName !== undefined && fullName.trim()) data.fullName = fullName.trim()
      if (isActive !== undefined) data.isActive = isActive
      if (password !== undefined && password.length > 0) {
        if (password.length < 8) return reply.status(400).send({ error: 'password must be at least 8 characters' })
        const bcrypt = await import('bcryptjs')
        data.passwordHash = await bcrypt.hash(password, 10)
      }

      const updated = await prisma.user.update({
        where: { id: request.params.id },
        data,
        select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
      })
      // Đổi vai trò có hiệu lực NGAY với người đang đăng nhập — không bắt đăng
      // nhập lại (cache quyền theo userId trong permission-service).
      if (roleId !== undefined || role !== undefined) invalidateUserRoleCache(updated.id)
      return {
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        role: updated.role,
        status: updated.isActive ? 'active' : 'inactive',
        createdAt: updated.createdAt,
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/v1/settings/team/:id', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can remove members' })
    }

    const target = await prisma.user.findFirst({ where: { id: request.params.id, orgId: user.orgId } })
    if (!target) return reply.status(404).send({ error: 'User not found' })
    if (target.role === 'owner') return reply.status(400).send({ error: 'Cannot remove owner' })

    await prisma.user.delete({ where: { id: request.params.id } })
    return { success: true }
  })

  // ── Manager Hierarchy ───────────────────────────────────────────────

  // GET /settings/team/tree — org hierarchy tree with accounts per user
  app.get('/api/v1/settings/team/tree', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (user.role === 'member') {
      return reply.status(403).send({ error: 'Không có quyền xem sơ đồ tổ chức' })
    }

    const users = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true, fullName: true, email: true, role: true, avatarUrl: true, isActive: true,
        channelAccounts: {
          where: { deletedAt: null },
          select: { id: true, displayName: true, platform: true, status: true, avatarUrl: true },
        },
        channelAccess: {
          select: {
            channelAccount: {
              select: { id: true, displayName: true, platform: true, status: true, avatarUrl: true },
            },
          },
        },
        managedMembers: { select: { memberId: true } },
        managers: { select: { managerId: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })

    // Build user map with merged accounts (owned + accessible)
    const userMap = new Map(users.map(u => {
      // Merge owned + accessible accounts, dedupe by id
      const accountMap = new Map<string, any>()
      for (const a of u.channelAccounts) accountMap.set(a.id, a)
      for (const ac of u.channelAccess) accountMap.set(ac.channelAccount.id, ac.channelAccount)
      return [u.id, {
        id: u.id, fullName: u.fullName, email: u.email, role: u.role,
        avatarUrl: u.avatarUrl, isActive: u.isActive,
        accounts: Array.from(accountMap.values()),
        managerIds: u.managers.map(m => m.managerId),
        subordinateIds: u.managedMembers.map(m => m.memberId),
      }]
    }))

    // Categorize users
    const owners: any[] = []
    const admins: any[] = []
    const managers: any[] = []
    const assignedMembers = new Set<string>()

    for (const u of userMap.values()) {
      if (u.role === 'owner') owners.push(u)
      else if (u.role === 'admin') admins.push(u)
      else if (u.role === 'manager') {
        const subs = u.subordinateIds.map((id: string) => userMap.get(id)).filter(Boolean)
        subs.forEach((s: any) => assignedMembers.add(s.id))
        managers.push({ ...u, subordinates: subs })
      }
    }

    // Unassigned members = members with no manager
    const unassigned = Array.from(userMap.values())
      .filter(u => u.role === 'member' && !assignedMembers.has(u.id))

    return { tree: [...owners, ...admins, ...managers], unassigned }
  })

  // GET /settings/team/subordinates — manager's own subordinates + their accounts
  app.get('/api/v1/settings/team/subordinates', async (request) => {
    const user = request.user as { id: string; orgId: string; role: string }

    const relations = await prisma.userManager.findMany({
      where: { managerId: user.id },
      select: {
        member: {
          select: {
            id: true, fullName: true, email: true, avatarUrl: true, role: true,
            channelAccounts: {
              where: { deletedAt: null },
              select: { id: true, displayName: true, platform: true, status: true },
            },
            channelAccess: {
              select: {
                channelAccount: {
                  select: { id: true, displayName: true, platform: true, status: true },
                },
              },
            },
          },
        },
      },
    })

    const subordinates = relations.map(r => {
      const accountMap = new Map<string, any>()
      for (const a of r.member.channelAccounts) accountMap.set(a.id, a)
      for (const ac of r.member.channelAccess) accountMap.set(ac.channelAccount.id, ac.channelAccount)
      return {
        id: r.member.id,
        fullName: r.member.fullName,
        email: r.member.email,
        avatarUrl: r.member.avatarUrl,
        role: r.member.role,
        accounts: Array.from(accountMap.values()),
      }
    })
    return { subordinates }
  })

  // POST /settings/team/:id/managers — assign managers to a member
  app.post<{ Params: { id: string }; Body: { managerIds: string[] } }>(
    '/api/v1/settings/team/:id/managers',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can manage hierarchy' })
      }

      const { id } = request.params
      const { managerIds = [] } = request.body

      // Validate target exists and is a member
      const target = await prisma.user.findFirst({ where: { id, orgId: user.orgId } })
      if (!target) return reply.status(404).send({ error: 'User not found' })

      // Validate all managerIds are valid managers in the same org
      if (managerIds.length > 0) {
        const validManagers = await prisma.user.findMany({
          where: { id: { in: managerIds }, orgId: user.orgId, role: 'manager' },
          select: { id: true },
        })
        const validIds = new Set(validManagers.map(m => m.id))
        const invalidIds = managerIds.filter(mid => !validIds.has(mid))
        if (invalidIds.length > 0) {
          return reply.status(400).send({ error: `Invalid manager IDs: ${invalidIds.join(', ')}` })
        }
      }

      // Replace all manager assignments for this member
      await prisma.$transaction([
        prisma.userManager.deleteMany({ where: { memberId: id } }),
        ...managerIds.map(managerId =>
          prisma.userManager.create({ data: { managerId, memberId: id } }),
        ),
      ])

      return { success: true, memberId: id, managerIds }
    },
  )

  // POST /settings/team/:memberId/managers/add — add ONE manager (additive, race-safe)
  app.post<{ Params: { memberId: string }; Body: { managerId: string } }>(
    '/api/v1/settings/team/:memberId/managers/add',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can manage hierarchy' })
      }

      const { memberId } = request.params
      const { managerId } = request.body
      if (!managerId) return reply.status(400).send({ error: 'managerId is required' })

      // Validate member exists in same org
      const member = await prisma.user.findFirst({ where: { id: memberId, orgId: user.orgId } })
      if (!member) return reply.status(404).send({ error: 'Member not found' })

      // Validate manager exists and has role 'manager'
      const manager = await prisma.user.findFirst({
        where: { id: managerId, orgId: user.orgId, role: 'manager' },
      })
      if (!manager) return reply.status(400).send({ error: 'Invalid manager ID' })

      // Upsert — idempotent, no race condition
      await prisma.userManager.upsert({
        where: { managerId_memberId: { managerId, memberId } },
        update: {},
        create: { managerId, memberId },
      })

      return { success: true, memberId, managerId }
    },
  )

  // DELETE /settings/team/:id/managers/:managerId — remove one manager relation
  app.delete<{ Params: { id: string; managerId: string } }>(
    '/api/v1/settings/team/:id/managers/:managerId',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can manage hierarchy' })
      }

      const { id, managerId } = request.params
      await prisma.userManager.deleteMany({
        where: { memberId: id, managerId },
      })
      return { success: true }
    },
  )

  // ── Tag Definitions (org-level) ─────────────────────────────────────
  // Tags are stored as JSON array in AppSetting with key 'org.tags'
  // Each tag: { id: string, name: string, color: string }

  const TAG_KEY = 'org.tags'

  /** Helper: load tag definitions for the org */
  async function loadTags(orgId: string): Promise<{ id: string; name: string; color: string }[]> {
    const row = await prisma.appSetting.findUnique({
      where: { orgId_settingKey: { orgId, settingKey: TAG_KEY } },
    })
    if (!row?.valuePlain) return []
    try { return JSON.parse(row.valuePlain) } catch { return [] }
  }

  /** Helper: save tag definitions for the org */
  async function saveTags(orgId: string, tags: { id: string; name: string; color: string }[]) {
    await prisma.appSetting.upsert({
      where: { orgId_settingKey: { orgId, settingKey: TAG_KEY } },
      update: { valuePlain: JSON.stringify(tags) },
      create: { orgId, settingKey: TAG_KEY, valuePlain: JSON.stringify(tags) },
    })
  }

  // GET — list all tag definitions
  app.get('/api/v1/tags', async (request) => {
    const user = request.user as { orgId: string }
    const tags = await loadTags(user.orgId)
    return { tags }
  })

  // POST — create a new tag definition
  app.post<{ Body: { name: string; color: string } }>('/api/v1/tags', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can manage tags' })
    }

    const name = (request.body.name || '').trim().slice(0, 50)
    const color = request.body.color || '#3b82f6'
    if (!name) return reply.status(400).send({ error: 'name is required' })
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return reply.status(400).send({ error: 'color must be a valid hex (e.g. #3b82f6)' })
    }

    const tags = await loadTags(user.orgId)
    // Prevent duplicates
    if (tags.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      return reply.status(409).send({ error: 'Tag name already exists' })
    }

    const newTag = { id: crypto.randomUUID(), name, color }
    tags.push(newTag)
    await saveTags(user.orgId, tags)
    return reply.status(201).send(newTag)
  })

  // PUT — update a tag definition
  app.put<{ Params: { id: string }; Body: { name?: string; color?: string } }>(
    '/api/v1/tags/:id',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Only admin/owner can manage tags' })
      }

      const tags = await loadTags(user.orgId)
      const idx = tags.findIndex(t => t.id === request.params.id)
      if (idx === -1) return reply.status(404).send({ error: 'Tag not found' })

      const oldName = tags[idx].name
      const newName = request.body.name ? request.body.name.trim().slice(0, 50) : null
      const newColor = request.body.color || null

      if (newColor && !/^#[0-9a-fA-F]{6}$/.test(newColor)) {
        return reply.status(400).send({ error: 'color must be a valid hex' })
      }

      if (newName) tags[idx].name = newName
      if (newColor) tags[idx].color = newColor
      await saveTags(user.orgId, tags)

      // Cascade rename to contacts if name changed — uses raw SQL to avoid N+1
      if (newName && newName !== oldName) {
        // C1-FIX: Use parameterized jsonb cast instead of Prisma.raw() to prevent SQL injection.
        // The ::jsonb cast on a parameterized string is safe — Prisma sends the value as $N.
        const oldTagJson = JSON.stringify([oldName])
        await prisma.$executeRaw`
          UPDATE "Contact"
          SET "tags" = (
            SELECT jsonb_agg(
              CASE WHEN elem #>> '{}' = ${oldName} THEN to_jsonb(${newName}::text) ELSE elem END
            )
            FROM jsonb_array_elements("tags") AS elem
          )
          WHERE "orgId" = ${user.orgId}
            AND "tags"::jsonb @> ${oldTagJson}::jsonb
        `
      }

      return tags[idx]
    },
  )

  // DELETE — remove a tag definition (also removes from all contacts)
  app.delete<{ Params: { id: string } }>('/api/v1/tags/:id', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only admin/owner can manage tags' })
    }

    const tags = await loadTags(user.orgId)
    const tag = tags.find(t => t.id === request.params.id)
    if (!tag) return reply.status(404).send({ error: 'Tag not found' })

    // Remove from definitions
    const remaining = tags.filter(t => t.id !== request.params.id)
    await saveTags(user.orgId, remaining)

    // Strip this tag name from all contacts that have it — uses raw SQL to avoid N+1
    // C1-FIX: Use parameterized jsonb cast instead of Prisma.raw() to prevent SQL injection.
    const tagJson = JSON.stringify([tag.name])
    await prisma.$executeRaw`
      UPDATE "Contact"
      SET "tags" = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements("tags") AS elem
        WHERE elem #>> '{}' != ${tag.name}
      )
      WHERE "orgId" = ${user.orgId}
        AND "tags"::jsonb @> ${tagJson}::jsonb
    `

    return { success: true }
  })

  // ── Contact Tag Assignment ──────────────────────────────────────────
  // PATCH — update a contact's tags (add/remove from conversation page)

  app.patch<{ Params: { id: string }; Body: { tags: string[] } }>(
    '/api/v1/contacts/:id/tags',
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const contact = await prisma.contact.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      })
      if (!contact) return reply.status(404).send({ error: 'Contact not found' })

      const updated = await prisma.contact.update({
        where: { id: request.params.id },
        data: { tags: request.body.tags ?? [] },
        select: { id: true, tags: true },
      })
      return updated
    },
  )
}
