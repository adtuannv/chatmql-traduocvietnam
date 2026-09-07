/**
 * use-ai.ts — Hook & kiểu dữ liệu cho nhóm trang "AI" (eCDP).
 * Bọc các endpoint backend dưới /api/v1/ai (base client đã có /api/v1).
 * Chỉ dùng lại `api` + TanStack Query + `useApiQuery` (không sửa file chung).
 */
import { api } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { useApiQuery } from '@/hooks/use-api'

// ── Query keys ──────────────────────────────────────────────────────
export const aiKeys = {
  config: ['ai', 'config'] as unknown[],
  usage: (days: number): unknown[] => ['ai', 'usage', days],
  replyRuns: (limit: number): unknown[] => ['ai', 'reply-runs', limit],
  trace: (runId: string | null): unknown[] => ['ai', 'trace', runId],
  scenarios: ['ai', 'scenarios'] as unknown[],
  knowledgeGaps: (status: string): unknown[] => ['ai', 'knowledge-gaps', status],
  channelOverrides: ['ai', 'channel-overrides'] as unknown[],
  customModels: ['ai', 'custom-models'] as unknown[],
  bots: ['ai', 'bots'] as unknown[],
}

// ── Kiểu dữ liệu ────────────────────────────────────────────────────
export interface ProviderModel {
  title: string
  value: string
}
export interface ProviderDef {
  id: string
  name: string
  baseUrl: string
  models: ProviderModel[]
  supportsCaching: boolean
  primary: boolean
}

export type AiMode = 'manual' | 'suggest' | 'auto'

export type TaskOverride = { provider?: string | null; model?: string | null }
export type TaskOverrides = Record<string, TaskOverride>

export interface AiConfig {
  orgId: string
  provider: string
  model: string
  maxDaily: number
  enabled: boolean
  taskOverrides?: TaskOverrides | null
  defaultAiMode: AiMode
  autoReplyEnabled: boolean
  debounceSeconds: number
  prefilterKeywords: string | null
  /** Nhóm: chỉ trả lời khi được nhắc tên. */
  groupRequireMention: boolean
  /** Tên gọi coi là được nhắc, cách nhau bằng dấu phẩy. */
  mentionNames: string | null
  verifyBeforeSend?: boolean
  hasOpenaiKey: boolean
  hasMinimaxKey: boolean
  hasAnthropicKey: boolean
  hasGeminiKey: boolean
  availableProviders: ProviderDef[]
  isAfterHours: boolean
}

export interface AiUsage {
  callsToday: number
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
  maxDaily: number
  remaining: number
  enabled: boolean
  byType: Record<string, number>
  days: number
}

export interface ReplyRun {
  id: string
  conversationId: string | null
  mode: string | null
  status: string | null
  handoff: boolean | null
  confidence: number | null
  latencyMs: number | null
  createdAt: string
}

export interface AiTrace {
  id: string
  conversationId: string | null
  aiReplyRunId: string | null
  step: string
  level: string
  payload: unknown
  latencyMs: number | null
  createdAt: string
  expiresAt: string | null
}

export interface ScenarioMeta {
  id: string
  key: string
  name: string
  description: string
  loadMode: string
  enabled: boolean
  priority: number
  version: number
  updatedAt: string
}

export interface ScenarioDetail extends ScenarioMeta {
  content: string
  triggerHints: string | null
  updatedBy: string | null
  createdAt: string
}

export interface ScenarioInput {
  key?: string
  name: string
  description: string
  content: string
  loadMode?: string
  triggerHints?: string | null
  priority?: number
  enabled?: boolean
}

export type GapStatus = 'open' | 'resolved' | 'dismissed'

export interface KnowledgeGap {
  id: string
  conversationId: string | null
  contactId: string | null
  aiReplyRunId: string | null
  gapType: string
  question: string
  suggestion: string | null
  status: GapStatus
  occurrences: number
  resolvedBy: string | null
  notes: string | null
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

// Kênh (channel account) + override AI theo kênh
export interface ChannelInfo {
  id: string
  displayName: string | null
  platform: number
  status: string
}
export interface ChannelOverride {
  provider?: string
  model?: string
}
export type ChannelOverrides = Record<string, ChannelOverride>

// Model tuỳ chỉnh theo provider (catalog dạng dữ liệu — thêm không cần restart)
export type CustomModels = Record<string, ProviderModel[]>

// AI Bot ("con AI") — mỗi bot một bộ cấu hình riêng, gán theo kênh
export interface ToolConfigEntry {
  enabled: boolean
  guardrail: { categoryIds: string[] }
}
export interface AiBot {
  id: string
  name: string
  avatarEmoji: string | null
  description: string | null
  enabled: boolean
  provider: string | null
  model: string | null
  personaPrompt: string | null
  playbookPrompt: string | null
  toolsJson: Record<string, ToolConfigEntry> | null
  channelAccountIds: string[]
  createdAt: string
  updatedAt: string
}
export type AiBotInput = Partial<Omit<AiBot, 'id' | 'createdAt' | 'updatedAt'>>

// ── Query hooks ─────────────────────────────────────────────────────
export function useAiConfig() {
  return useApiQuery<AiConfig>(aiKeys.config, '/ai/config')
}

// Ba nhóm dưới đây backend TDVN chưa có → không gọi (UI đã ẩn theo cờ).
export function useChannelOverrides() {
  return useApiQuery<{ overrides: ChannelOverrides; channels: ChannelInfo[] }>(
    aiKeys.channelOverrides,
    '/ai/channel-overrides',
    undefined,
    { enabled: FEATURES.AI_CHANNEL_OVERRIDES },
  )
}

export function useCustomModels() {
  return useApiQuery<{ customModels: CustomModels }>(
    aiKeys.customModels,
    '/ai/custom-models',
    undefined,
    { enabled: FEATURES.AI_CUSTOM_MODELS },
  )
}

export function useAiBots() {
  return useApiQuery<{ bots: AiBot[] }>(aiKeys.bots, '/ai/bots', undefined, { enabled: FEATURES.AI_BOTS })
}

export function useAiUsage(days: number) {
  return useApiQuery<AiUsage>(aiKeys.usage(days), '/ai/usage', { days })
}

export function useReplyRuns(limit = 50) {
  return useApiQuery<{ runs: ReplyRun[] }>(aiKeys.replyRuns(limit), '/ai/reply-runs', { limit })
}

export function useAiScenarios() {
  return useApiQuery<{ scenarios: ScenarioMeta[] }>(aiKeys.scenarios, '/ai/scenarios')
}

export function useKnowledgeGaps(status: GapStatus) {
  return useApiQuery<{ data: KnowledgeGap[]; total: number }>(
    aiKeys.knowledgeGaps(status),
    '/ai/knowledge-gaps',
    { status },
  )
}

// ── Mutation helpers (gọi trực tiếp qua `api`) ──────────────────────
export async function saveApiKey(provider: string, apiKey: string, skipVerify?: boolean) {
  const { data } = await api.put('/ai/api-key', { provider, apiKey, skipVerify })
  return data as { ok: boolean; verified: boolean }
}

export async function deleteApiKey(provider: string) {
  const { data } = await api.delete(`/ai/api-key/${provider}`)
  return data as { ok: boolean }
}

export async function updateAiConfig(body: Partial<{
  provider: string
  model: string
  maxDaily: number
  enabled: boolean
  taskOverrides: TaskOverrides
  defaultAiMode: AiMode
  autoReplyEnabled: boolean
  debounceSeconds: number
  prefilterKeywords: string | null
  /** Nhóm: chỉ trả lời khi được nhắc tên. */
  groupRequireMention: boolean
  /** Tên gọi coi là được nhắc, cách nhau bằng dấu phẩy. */
  mentionNames: string | null
  verifyBeforeSend: boolean
}>) {
  const { data } = await api.put('/ai/config', body)
  return data as AiConfig
}

export async function saveChannelOverrides(overrides: ChannelOverrides) {
  const { data } = await api.put('/ai/channel-overrides', { overrides })
  return data as { overrides: ChannelOverrides }
}

export async function saveCustomModels(customModels: CustomModels) {
  const { data } = await api.put('/ai/custom-models', { customModels })
  return data as { customModels: CustomModels }
}

export async function createAiBot(input: AiBotInput) {
  const { data } = await api.post('/ai/bots', input)
  return data as { bot: AiBot }
}

export async function updateAiBot(id: string, input: AiBotInput) {
  const { data } = await api.put(`/ai/bots/${id}`, input)
  return data as { bot: AiBot }
}

export async function deleteAiBot(id: string) {
  const { data } = await api.delete(`/ai/bots/${id}`)
  return data as { deleted: boolean }
}

// Demo chat cho bot: tạo hội thoại sandbox rồi mô phỏng trả lời với botId
export async function createSandboxConversation(name: string) {
  const { data } = await api.post('/ai/simulate/conversation', { name, aiMode: 'suggest' })
  return data as { conversationId: string }
}

export async function simulateBotReply(conversationId: string, customerText: string, botId: string) {
  const { data } = await api.post('/ai/simulate/reply', { conversationId, customerText, botId, includeTrace: false })
  return data as { reply: string | null; runId?: string; handoff?: { should: boolean; reason?: string } | null }
}

export async function fetchScenario(id: string) {
  const { data } = await api.get(`/ai/scenarios/${id}`)
  return data as { scenario: ScenarioDetail }
}

export async function createScenario(input: ScenarioInput) {
  const { data } = await api.post('/ai/scenarios', input)
  return data as { scenario: ScenarioDetail }
}

export async function updateScenario(id: string, input: Partial<ScenarioInput>) {
  const { data } = await api.put(`/ai/scenarios/${id}`, input)
  return data as { scenario: ScenarioDetail }
}

export async function deleteScenario(id: string) {
  const { data } = await api.delete(`/ai/scenarios/${id}`)
  return data as { deleted: boolean }
}

export async function fetchTrace(runId: string) {
  const { data } = await api.get('/ai/trace', { params: { runId } })
  return data as { traces: AiTrace[]; nextCursor: string | null }
}

export async function dismissGap(id: string) {
  const { data } = await api.post(`/ai/knowledge-gaps/${id}/dismiss`)
  return data as { success: boolean }
}

export async function resolveGap(id: string, content: string, title?: string) {
  const { data } = await api.post(`/ai/knowledge-gaps/${id}/resolve`, { content, title })
  return data as { success: boolean; entryId?: string }
}
