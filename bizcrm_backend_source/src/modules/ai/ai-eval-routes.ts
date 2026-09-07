/**
 * ai-eval-routes.ts — API cho bộ câu hỏi vàng (regression eval).
 *
 * Đọc (danh sách câu hỏi / lịch sử chạy) mở cho mọi user đã đăng nhập;
 * ghi (CRUD câu hỏi, chạy kiểm định) chỉ owner/admin — theo đúng pattern
 * ai-bot-routes.ts (TDVN chưa có RBAC động).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import {
  listCases, createCase, updateCase, deleteCase,
  listRuns, getRun, runEval, EvalBusyError,
  type EvalCaseInput,
} from './ai-eval-service.js'

function ownerAdminOnly(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user as { role: string }
  if (!['owner', 'admin'].includes(user.role)) {
    reply.status(403).send({ error: 'Chỉ owner/admin được quản lý bộ kiểm định AI' })
    return false
  }
  return true
}

function sendError(reply: FastifyReply, err: unknown, fallback: string) {
  const msg = err instanceof Error && err.message ? err.message : fallback
  const status = /không tồn tại/i.test(msg) ? 404 : /bắt buộc|để trống|Chưa có câu hỏi/i.test(msg) ? 400 : 500
  return reply.status(status).send({ error: msg })
}

export async function aiEvalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // ── Câu hỏi (cases) ────────────────────────────────────────────────
  app.get('/api/v1/ai/eval/cases', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      return { cases: await listCases(user.orgId) }
    } catch (err) {
      app.log.error({ err }, '[ai-eval] list cases failed')
      return sendError(reply, err, 'Không tải được danh sách câu hỏi kiểm định')
    }
  })

  app.post<{ Body: EvalCaseInput }>('/api/v1/ai/eval/cases', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    try {
      const user = request.user as { orgId: string }
      const evalCase = await createCase(user.orgId, request.body ?? {})
      return reply.status(201).send({ case: evalCase })
    } catch (err) {
      app.log.error({ err }, '[ai-eval] create case failed')
      return sendError(reply, err, 'Không tạo được câu hỏi kiểm định')
    }
  })

  app.put<{ Params: { id: string }; Body: EvalCaseInput }>('/api/v1/ai/eval/cases/:id', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    try {
      const user = request.user as { orgId: string }
      const evalCase = await updateCase(user.orgId, request.params.id, request.body ?? {})
      return { case: evalCase }
    } catch (err) {
      app.log.error({ err }, '[ai-eval] update case failed')
      return sendError(reply, err, 'Không cập nhật được câu hỏi kiểm định')
    }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/ai/eval/cases/:id', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    try {
      const user = request.user as { orgId: string }
      return await deleteCase(user.orgId, request.params.id)
    } catch (err) {
      app.log.error({ err }, '[ai-eval] delete case failed')
      return sendError(reply, err, 'Không xoá được câu hỏi kiểm định')
    }
  })

  // ── Lượt chạy (runs) ───────────────────────────────────────────────
  app.post<{ Body: { proposalId?: string } }>('/api/v1/ai/eval/runs', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    try {
      const user = request.user as { orgId: string; id: string }
      const { proposalId } = request.body ?? {}
      const run = await runEval(user.orgId, user.id, {
        trigger: proposalId ? 'proposal' : 'manual',
        proposalId: proposalId ?? null,
      })
      return reply.status(201).send({ run })
    } catch (err) {
      if (err instanceof EvalBusyError) {
        return reply.status(409).send({ error: err.message })
      }
      app.log.error({ err }, '[ai-eval] start run failed')
      return sendError(reply, err, 'Không khởi động được lượt kiểm định')
    }
  })

  app.get<{ Querystring: { limit?: string } }>('/api/v1/ai/eval/runs', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const limit = Number(request.query.limit) || 20
      return { runs: await listRuns(user.orgId, limit) }
    } catch (err) {
      app.log.error({ err }, '[ai-eval] list runs failed')
      return sendError(reply, err, 'Không tải được lịch sử kiểm định')
    }
  })

  app.get<{ Params: { id: string } }>('/api/v1/ai/eval/runs/:id', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const data = await getRun(user.orgId, request.params.id)
      if (!data) return reply.status(404).send({ error: 'Lượt kiểm định không tồn tại' })
      return data
    } catch (err) {
      app.log.error({ err }, '[ai-eval] get run failed')
      return sendError(reply, err, 'Không tải được lượt kiểm định')
    }
  })
}
