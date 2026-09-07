/**
 * use-ai-eval.ts — Bộ câu hỏi vàng (regression eval) cho AI.
 *
 * Backend: ai-eval-routes.ts / ai-eval-service.ts. Mỗi lượt chạy tốn 2 lời gọi
 * AI cho mỗi câu (sinh trả lời qua đường mô phỏng + chấm bằng LLM); mọi thứ đi
 * trong sandbox mô phỏng, KHÔNG có gì gửi ra khách.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { BadgeProps } from '@/components/ui/badge'

export interface EvalCase {
  id: string
  name: string
  question: string
  criteria: string
  conversationId?: string | null
  botId?: string | null
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type EvalCaseInput = Partial<
  Pick<EvalCase, 'name' | 'question' | 'criteria' | 'conversationId' | 'botId' | 'enabled' | 'sortOrder'>
>

export type EvalRunStatus = 'running' | 'done' | 'failed'
export type EvalVerdict = 'pass' | 'fail' | 'error'

export interface EvalRun {
  id: string
  trigger: 'manual' | 'proposal'
  proposalId?: string | null
  model?: string | null
  status: EvalRunStatus
  total: number
  passed: number
  failed: number
  errored: number
  note?: string | null
  startedAt: string
  finishedAt?: string | null
}

export interface EvalResult {
  id: string
  runId: string
  caseId: string
  caseName: string
  question: string
  reply: string
  verdict: EvalVerdict
  reason: string
  latencyMs?: number | null
  createdAt: string
}

export const EVAL_STATUS_LABELS: Record<EvalRunStatus, string> = {
  running: 'Đang chạy',
  done: 'Hoàn tất',
  failed: 'Thất bại',
}

export const EVAL_VERDICT_LABELS: Record<EvalVerdict, string> = {
  pass: 'Đạt',
  fail: 'Trượt',
  error: 'Lỗi',
}

export function evalVerdictVariant(v: EvalVerdict): BadgeProps['variant'] {
  return v === 'pass' ? 'success' : v === 'fail' ? 'destructive' : 'warning'
}

export const evalKeys = {
  cases: ['ai', 'eval', 'cases'] as const,
  runs: ['ai', 'eval', 'runs'] as const,
  run: (id: string) => ['ai', 'eval', 'run', id] as const,
}

export function useEvalCases() {
  return useQuery({
    queryKey: evalKeys.cases,
    queryFn: async () => (await api.get<{ cases: EvalCase[] }>('/ai/eval/cases')).data,
  })
}

export function useCreateEvalCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: EvalCaseInput) => (await api.post('/ai/eval/cases', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases }),
  })
}

export function useUpdateEvalCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & EvalCaseInput) =>
      (await api.put(`/ai/eval/cases/${id}`, input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases }),
  })
}

export function useDeleteEvalCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/ai/eval/cases/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases }),
  })
}

/** Lịch sử chạy. Chỉ poll khi đang có lượt `running` để không gọi API vô ích. */
export function useEvalRuns(pollWhileRunning = true) {
  return useQuery({
    queryKey: evalKeys.runs,
    queryFn: async () => (await api.get<{ runs: EvalRun[] }>('/ai/eval/runs', { params: { limit: 20 } })).data,
    refetchInterval: (query) =>
      pollWhileRunning && query.state.data?.runs.some((r) => r.status === 'running') ? 4000 : false,
  })
}

export function useEvalRunDetail(id: string | null) {
  return useQuery({
    queryKey: evalKeys.run(id ?? ''),
    enabled: !!id,
    queryFn: async () => (await api.get<{ run: EvalRun; results: EvalResult[] }>(`/ai/eval/runs/${id}`)).data,
    refetchInterval: (query) => (query.state.data?.run.status === 'running' ? 4000 : false),
  })
}

export function useStartEvalRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { proposalId?: string } = {}) =>
      (await api.post<{ run: EvalRun }>('/ai/eval/runs', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.runs }),
  })
}
