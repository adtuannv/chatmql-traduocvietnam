/**
 * ai-bot-routes.ts — CRUD cho AI Bot ("con AI") — mỗi bot một bộ cấu hình
 * (persona, playbook, model, tools, kênh áp dụng). Xem ai-bot-service.ts.
 *
 * Route GHI đọc quyền động `ai.update` qua `userHasPermission` — giống eCDP.
 * Route ĐỌC mở cho mọi user đã đăng nhập trong tổ chức.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { userHasPermissionFresh } from '../../shared/permission-service.js'
import { listBots, getBot, createBot, updateBot, deleteBot, type AiBotInput } from './ai-bot-service.js'

function sendError(reply: FastifyReply, err: unknown, fallback: string) {
  const msg = err instanceof Error && err.message ? err.message : fallback
  const status = /không tồn tại/i.test(msg) ? 404 : /bắt buộc|để trống|Unknown provider/i.test(msg) ? 400 : 500
  return reply.status(status).send({ error: msg })
}

export async function aiBotRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  app.get('/api/v1/ai/bots', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      return { bots: await listBots(user.orgId) }
    } catch (err) {
      app.log.error({ err }, '[ai-bot] list failed')
      return sendError(reply, err, 'Failed to list AI bots')
    }
  })

  app.get<{ Params: { id: string } }>('/api/v1/ai/bots/:id', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const bot = await getBot(user.orgId, request.params.id)
      if (!bot) return reply.status(404).send({ error: 'Bot không tồn tại' })
      return { bot }
    } catch (err) {
      app.log.error({ err }, '[ai-bot] get failed')
      return sendError(reply, err, 'Failed to get AI bot')
    }
  })

  app.post<{ Body: AiBotInput }>('/api/v1/ai/bots', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      if (!(await userHasPermissionFresh(user.id, user.role, 'ai.update'))) {
        return reply.status(403).send({ error: 'Bạn không có quyền quản lý AI bot', code: 'PERMISSION_DENIED' })
      }
      const bot = await createBot(user.orgId, request.body ?? {})
      return reply.status(201).send({ bot })
    } catch (err) {
      app.log.error({ err }, '[ai-bot] create failed')
      return sendError(reply, err, 'Failed to create AI bot')
    }
  })

  app.put<{ Params: { id: string }; Body: AiBotInput }>('/api/v1/ai/bots/:id', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      if (!(await userHasPermissionFresh(user.id, user.role, 'ai.update'))) {
        return reply.status(403).send({ error: 'Bạn không có quyền quản lý AI bot', code: 'PERMISSION_DENIED' })
      }
      const bot = await updateBot(user.orgId, request.params.id, request.body ?? {})
      return { bot }
    } catch (err) {
      app.log.error({ err }, '[ai-bot] update failed')
      return sendError(reply, err, 'Failed to update AI bot')
    }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/ai/bots/:id', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      if (!(await userHasPermissionFresh(user.id, user.role, 'ai.update'))) {
        return reply.status(403).send({ error: 'Bạn không có quyền quản lý AI bot', code: 'PERMISSION_DENIED' })
      }
      return await deleteBot(user.orgId, request.params.id)
    } catch (err) {
      app.log.error({ err }, '[ai-bot] delete failed')
      return sendError(reply, err, 'Failed to delete AI bot')
    }
  })
}
