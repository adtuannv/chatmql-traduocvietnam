/**
 * use-ai-assistant.ts — "AI Trợ lý" nội bộ: nhân viên hỏi đáp/tra cứu tự do
 * (sản phẩm, kiến thức công ty), không gắn với hội thoại nào. Backend:
 * POST /ai/assistant/ask (assistant-routes.ts).
 */
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export interface AssistantTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface AskAssistantResult {
  reply: string
  usedSources: { kb: number; products: number }
}

export function useAskAssistant() {
  return useMutation({
    mutationFn: async (input: { message: string; botId?: string; history?: AssistantTurn[] }) =>
      (await api.post<AskAssistantResult>('/ai/assistant/ask', input)).data,
  })
}
