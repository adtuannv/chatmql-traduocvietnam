import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { authMiddleware } from './auth-middleware.js'
import { checkSetupStatus, setup, login, getProfile } from './auth-service.js'
import { prisma } from '../../shared/prisma-client.js'
import { isOrgUsable } from '../platform/org-license.js'
import {
  ACCESS_TOKEN_EXPIRY,
  createRefreshToken,
  rotateRefreshToken,
  revokeAllUserTokens,
  cleanupExpiredTokens,
  TokenError,
} from './token-service.js'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Fastify ném 400 khi POST có Content-Type: application/json mà body rỗng.
  // impersonate và stop-impersonation đều không cần body, nhưng client dùng
  // header dùng chung nên vẫn đính Content-Type — coi body rỗng là {}.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body) return done(null, {})
      try {
        done(null, JSON.parse(body))
      } catch (err: any) {
        err.statusCode = 400
        done(err, undefined)
      }
    },
  )

  // C2-FIX: Rate limit auth endpoints — 10 attempts per minute per IP.
  // /auth/me is a frequent profile fetch (page loads, tab opens) — excluded.
  // The global rate-limiter (1000 dev / 200 prod per minute) still covers it.
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: (req) => req.url?.startsWith('/api/v1/auth/me') ?? false,
  })

  // ── Helper: issue access + refresh token pair ───────────────────
  async function issueTokenPair(payload: {
    id: string; email: string; fullName: string; role: string; orgId: string
    impersonatedBy?: string
  }) {
    const accessToken = app.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_EXPIRY })
    const refreshToken = await createRefreshToken(payload.id)
    return { accessToken, refreshToken }
  }

  // GET /api/v1/setup/status
  app.get('/api/v1/setup/status', async () => {
    return checkSetupStatus()
  })

  // POST /api/v1/setup — create org + owner user, return JWT
  app.post<{
    Body: { orgName: string; fullName: string; email: string; password: string }
  }>('/api/v1/setup', async (request, reply) => {
    const { orgName, fullName, email, password } = request.body
    if (!orgName || !fullName || !email || !password) {
      return reply.status(400).send({ error: 'Missing required fields' })
    }
    const payload = await setup(orgName, fullName, email, password)
    // W5-FIX: Short-lived access + long-lived refresh
    const { accessToken, refreshToken } = await issueTokenPair(payload)
    return { token: accessToken, refreshToken, user: payload }
  })

  // POST /api/v1/auth/login
  app.post<{
    Body: { email: string; password: string }
  }>('/api/v1/auth/login', async (request, reply) => {
    const { email, password } = request.body
    if (!email || !password) {
      return reply.status(400).send({ error: 'Missing email or password' })
    }
    const payload = await login(email, password)
    // W5-FIX: Short-lived access + long-lived refresh
    const { accessToken, refreshToken } = await issueTokenPair(payload)
    return { token: accessToken, refreshToken, user: payload }
  })

  // POST /api/v1/auth/refresh — rotate refresh token, issue new access token
  app.post<{
    Body: { refreshToken: string }
  }>('/api/v1/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body ?? {}
    if (!refreshToken) {
      return reply.status(400).send({ error: 'refreshToken is required' })
    }

    try {
      const { newToken, userId } = await rotateRefreshToken(refreshToken)

      // Fetch user profile for the new access token payload
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, fullName: true, role: true, roleId: true, orgId: true, isActive: true,
          org: { select: { status: true, expiresAt: true } },
        },
      })
      if (!user || !user.isActive) {
        await revokeAllUserTokens(userId)
        return reply.status(401).send({ error: 'User no longer active', code: 'TOKEN_INVALID' })
      }

      // License gate on refresh: cut the session if the company became unusable.
      const usable = isOrgUsable(user.org)
      if (!usable.ok) {
        await revokeAllUserTokens(userId)
        return reply.status(403).send({
          error: usable.reason === 'EXPIRED'
            ? 'Tài khoản công ty đã hết hạn sử dụng. Vui lòng liên hệ để gia hạn.'
            : 'Tài khoản công ty đang bị tạm khóa.',
          code: usable.reason === 'EXPIRED' ? 'ORG_EXPIRED' : 'ORG_SUSPENDED',
        })
      }

      const payload = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        // roleId theo DB tại thời điểm refresh — vai trò động vừa gán có mặt
        // trong token mới mà không phải đăng nhập lại.
        roleId: user.roleId ?? null,
        orgId: user.orgId,
      }
      const accessToken = app.jwt.sign(payload, { expiresIn: ACCESS_TOKEN_EXPIRY })
      return { token: accessToken, refreshToken: newToken, user: payload }
    } catch (err) {
      if (err instanceof TokenError) {
        return reply.status(401).send({ error: err.message, code: err.code })
      }
      throw err
    }
  })

  // POST /api/v1/auth/logout — revoke all refresh tokens for user
  app.post('/api/v1/auth/logout', { preHandler: authMiddleware }, async (request) => {
    const user = request.user as { id: string }
    await revokeAllUserTokens(user.id)
    return { success: true }
  })

  // GET /api/v1/auth/me — return current user (requires auth)
  app.get('/api/v1/auth/me', { preHandler: authMiddleware }, async (request) => {
    const user = request.user as { id: string; impersonatedBy?: string; platformActorId?: string }
    const profile = await getProfile(user.id)
    // Surface impersonation context so the frontend can render the banners:
    // - impersonatedBy: same-org "Đang xem dưới quyền"
    // - platformActorId: super-admin "đang vào company" (return-to-console)
    return {
      ...profile,
      impersonatedBy: user.impersonatedBy ?? null,
      platformActorId: user.platformActorId ?? null,
    }
  })

  // POST /api/v1/auth/impersonate/:userId — owner/admin "view as" another member.
  // Returns a JWT for the target user with `impersonatedBy` claim so the
  // frontend can offer a "Quay lại tài khoản gốc" button.
  app.post<{ Params: { userId: string } }>(
    '/api/v1/auth/impersonate/:userId',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const actor = request.user as { id: string; orgId: string; role: string }
      if (actor.role !== 'owner' && actor.role !== 'admin') {
        return reply.status(403).send({ error: 'Chỉ owner/admin mới có thể xem dưới quyền' })
      }
      if (request.params.userId === actor.id) {
        return reply.status(400).send({ error: 'Không thể xem dưới quyền của chính bạn' })
      }
      const target = await prisma.user.findFirst({
        where: { id: request.params.userId, orgId: actor.orgId },
        select: { id: true, email: true, fullName: true, role: true, orgId: true, isActive: true },
      })
      if (!target) return reply.status(404).send({ error: 'User not found in org' })
      if (!target.isActive) return reply.status(400).send({ error: 'User is inactive' })
      // Admins cannot impersonate owners or other admins (only manager / member).
      // Owner can impersonate anyone except themselves.
      if (actor.role === 'admin' && (target.role === 'owner' || target.role === 'admin')) {
        return reply.status(403).send({ error: 'Admin chỉ có thể xem dưới quyền manager hoặc nhân viên' })
      }

      const payload = {
        id: target.id,
        email: target.email,
        fullName: target.fullName,
        role: target.role,
        orgId: target.orgId,
        impersonatedBy: actor.id,
      }
      const accessToken = app.jwt.sign(payload, { expiresIn: '4h' })

      // Kiểm toán BẮT BUỘC: từ lúc này mọi thao tác mang danh tính người khác,
      // nên phải có dấu vết ai thực sự đứng sau. Thiếu log thì sau này không
      // trả lời được câu "ai đã sửa đơn của khách này".
      prisma.activityLog.create({
        data: {
          orgId: actor.orgId,
          userId: actor.id,
          action: 'auth.impersonation_started',
          entityType: 'User',
          entityId: target.id,
          details: {
            actorRole: actor.role,
            targetEmail: target.email,
            targetName: target.fullName,
            targetRole: target.role,
            expiresInHours: 4,
          },
        },
      }).catch(err => app.log.error({ err }, '[auth] không ghi được log xem dưới quyền'))

      app.log.warn(
        { actorId: actor.id, targetId: target.id, targetEmail: target.email },
        '[auth] Bắt đầu xem dưới quyền nhân viên khác',
      )

      return { token: accessToken, user: payload }
    },
  )

  // POST /api/v1/auth/stop-impersonation — return to the original admin.
  app.post('/api/v1/auth/stop-impersonation', { preHandler: authMiddleware }, async (request, reply) => {
    const current = request.user as { id: string; orgId: string; impersonatedBy?: string }
    if (!current.impersonatedBy) {
      return reply.status(400).send({ error: 'Bạn không đang xem dưới quyền' })
    }
    const admin = await prisma.user.findFirst({
      where: { id: current.impersonatedBy, orgId: current.orgId },
      select: { id: true, email: true, fullName: true, role: true, orgId: true, isActive: true },
    })
    if (!admin || !admin.isActive) {
      return reply.status(404).send({ error: 'Tài khoản gốc không còn khả dụng' })
    }
    if (admin.role !== 'owner' && admin.role !== 'admin') {
      return reply.status(403).send({ error: 'Tài khoản gốc không còn quyền quản trị' })
    }
    const payload = {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      orgId: admin.orgId,
    }
    const { accessToken, refreshToken } = await issueTokenPair(payload)

    prisma.activityLog.create({
      data: {
        orgId: admin.orgId,
        userId: admin.id,
        action: 'auth.impersonation_ended',
        entityType: 'User',
        entityId: current.id,
        details: { returnedTo: admin.email },
      },
    }).catch(err => app.log.error({ err }, '[auth] không ghi được log thoát xem dưới quyền'))
    return { token: accessToken, refreshToken, user: payload }
  })

  // POST /api/v1/auth/change-password
  app.post<{
    Body: { currentPassword: string; newPassword: string }
  }>('/api/v1/auth/change-password', { preHandler: authMiddleware }, async (request, reply) => {
    const user = request.user as { id: string }
    const { currentPassword, newPassword } = request.body
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'Missing required fields' })
    }
    if (newPassword.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' })
    }

    const bcrypt = await import('bcryptjs')
    const { prisma } = await import('../../shared/prisma-client.js')

    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
    if (!dbUser) return reply.status(404).send({ error: 'User not found' })

    const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Mật khẩu hiện tại không đúng' })

    const hash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } })
    // Revoke all existing refresh tokens after password change
    await revokeAllUserTokens(user.id)
    return { success: true }
  })

  // ── Expired token cleanup (daily) ─────────────────────────────────
  setInterval(async () => {
    try {
      const count = await cleanupExpiredTokens()
      if (count > 0) app.log.info(`[auth] Cleaned up ${count} expired refresh tokens`)
    } catch (err) {
      app.log.error(`[auth] Token cleanup error: ${err}`)
    }
  }, 24 * 60 * 60 * 1000) // every 24h
}
