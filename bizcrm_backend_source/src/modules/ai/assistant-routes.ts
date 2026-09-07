/**
 * assistant-routes.ts — HTTP layer cho "AI Trợ lý" nội bộ (assistant-service.ts).
 * Mọi nhân viên đã đăng nhập trong org đều dùng được — không giới hạn theo
 * quyền truy cập kênh/hội thoại vì công cụ này không đọc dữ liệu khách hàng.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { askAssistant, type AssistantTurn } from './assistant-service.js'

function statusFromError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : ''
  const lower = raw.toLowerCase()
  if (lower.includes('quota exceeded')) {
    return { status: 429, message: 'Đã vượt hạn mức AI hôm nay. Tăng giới hạn ở Cài đặt → AI hoặc thử lại ngày mai.' }
  }
  if (lower.includes('not configured')) {
    return { status: 400, message: 'Provider AI chưa được cấu hình API key. Vào Cài đặt → AI để thêm key.' }
  }
  if (lower.includes('disabled')) {
    return { status: 400, message: 'AI đang tắt cho tổ chức của bạn. Bật ở Cài đặt → AI.' }
  }
  if (lower.includes('message is required')) {
    return { status: 400, message: 'Vui lòng nhập câu hỏi.' }
  }
  return { status: 500, message: raw ? `Không hỏi được AI Trợ lý: ${raw.slice(0, 200)}` : 'Không hỏi được AI Trợ lý' }
}

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  app.post<{ Body: { message: string; botId?: string | null; history?: AssistantTurn[] } }>(
    '/api/v1/ai/assistant/ask',
    async (request, reply) => {
      try {
        const user = request.user as { id: string; orgId: string }
        const { message, botId, history } = request.body ?? {}
        if (!message || !message.trim()) return reply.status(400).send({ error: 'Vui lòng nhập câu hỏi.' })

        return await askAssistant({ orgId: user.orgId, userId: user.id, message, botId, history })
      } catch (err) {
        app.log.error({ err }, '[ai] assistant ask failed')
        const { status, message: msg } = statusFromError(err)
        return reply.status(status).send({ error: msg })
      }
    },
  )
}
