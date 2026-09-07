/**
 * ai-eval-service.ts — Bộ câu hỏi vàng (regression eval) cho AI ChatMQL.
 *
 * Admin giữ một bộ câu hỏi chuẩn (AiEvalCase) kèm tiêu chí chấm; mỗi lượt chạy
 * (AiEvalRun) sinh trả lời cho TỪNG câu qua runHarness — đúng đường đi mà
 * POST /ai/simulate/reply dùng — rồi gọi thêm MỘT lời gọi LLM "giám khảo"
 * chấm đạt/trượt theo tiêu chí. Kết quả từng câu lưu ở AiEvalResult.
 *
 * AN TOÀN: mọi lời gọi AI trong runner này đều nằm TRONG đường simulate
 * (runHarness + lời gọi giám khảo thuần LLM). KHÔNG có gì được gửi tới khách
 * hàng hay Zalo — không sendMessage, không orchestrator, không persist tin nhắn.
 */
import { prisma } from '../../shared/prisma-client.js'
import { logger } from '../../shared/logger.js'
import { runHarness } from './harness/reply-generator.js'
import { getProviderConfig } from './provider-registry.js'
import { generateWithOpenai } from './providers/openai.js'
import { generateWithAnthropic } from './providers/anthropic.js'
import { generateWithGemini } from './providers/gemini.js'
import { getAiConfig, getEffectiveConfigForTask, getProviderApiKey } from './ai-config-service.js'
import { logUsage } from './ai-service.js'
import type { GenerateRaw } from './ai-pricing.js'

// ── Khoá "mỗi org một lượt chạy" ─────────────────────────────────────
// GIỚI HẠN: Map trong bộ nhớ tiến trình — chỉ đúng khi backend chạy MỘT
// process (đúng với TDVN hiện tại). Nếu sau này scale nhiều process/máy,
// phải chuyển sang khoá DB (vd. UPDATE ... WHERE status='running').
const activeRuns = new Map<string, string>() // orgId → runId

export class EvalBusyError extends Error {}

export type EvalCaseInput = {
  name?: string
  question?: string
  criteria?: string
  conversationId?: string | null
  botId?: string | null
  enabled?: boolean
  sortOrder?: number
}

// ── CRUD case ────────────────────────────────────────────────────────

export async function listCases(orgId: string) {
  return prisma.aiEvalCase.findMany({
    where: { orgId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

function normalizeCaseInput(input: EvalCaseInput) {
  const name = input.name?.trim()
  const question = input.question?.trim()
  const criteria = input.criteria?.trim()
  if (!name || !question || !criteria) {
    throw new Error('Tên, câu hỏi của khách và tiêu chí chấm là bắt buộc (không được để trống)')
  }
  return {
    name,
    question,
    criteria,
    conversationId: input.conversationId?.trim() || null,
    botId: input.botId?.trim() || null,
    enabled: input.enabled ?? true,
    sortOrder: Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder as number) : 0,
  }
}

export async function createCase(orgId: string, input: EvalCaseInput) {
  const data = normalizeCaseInput(input)
  return prisma.aiEvalCase.create({ data: { orgId, ...data } })
}

export async function updateCase(orgId: string, id: string, input: EvalCaseInput) {
  const existing = await prisma.aiEvalCase.findFirst({ where: { id, orgId }, select: { id: true } })
  if (!existing) throw new Error('Câu hỏi kiểm định không tồn tại')
  const data = normalizeCaseInput(input)
  return prisma.aiEvalCase.update({ where: { id }, data })
}

export async function deleteCase(orgId: string, id: string) {
  const existing = await prisma.aiEvalCase.findFirst({ where: { id, orgId }, select: { id: true } })
  if (!existing) throw new Error('Câu hỏi kiểm định không tồn tại')
  await prisma.aiEvalCase.delete({ where: { id } })
  return { deleted: true }
}

// ── Truy vấn run ─────────────────────────────────────────────────────

export async function listRuns(orgId: string, limit = 20) {
  return prisma.aiEvalRun.findMany({
    where: { orgId },
    orderBy: { startedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  })
}

export async function getRun(orgId: string, id: string) {
  const run = await prisma.aiEvalRun.findFirst({ where: { id, orgId } })
  if (!run) return null
  const results = await prisma.aiEvalResult.findMany({
    where: { runId: id },
    orderBy: { createdAt: 'asc' },
  })
  return { run, results }
}

// ── Hội thoại sandbox cho case KHÔNG có ngữ cảnh ─────────────────────
// Dùng chung kênh 🧪 sandbox của simulate-routes (tìm theo externalUid);
// hội thoại eval là MỘT hội thoại cố định theo org, KHÔNG persist tin nhắn
// nên lịch sử luôn rỗng → mô phỏng "khách mới nhắn câu đầu tiên".
const sandboxUid = (orgId: string) => `ai-sandbox-${orgId}`
const EVAL_THREAD_PREFIX = 'ai-eval-'

async function getOrCreateEvalConversation(orgId: string, ownerUserId: string): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: { orgId, externalThreadId: `${EVAL_THREAD_PREFIX}${orgId}` },
    select: { id: true },
  })
  if (existing) return existing.id

  // Kênh sandbox (tạo nếu simulate chưa từng tạo)
  let channel = await prisma.channelAccount.findFirst({
    where: { orgId, externalUid: sandboxUid(orgId) },
    select: { id: true },
  })
  if (!channel) {
    channel = await prisma.channelAccount.create({
      data: {
        orgId,
        ownerUserId,
        externalUid: sandboxUid(orgId),
        displayName: '🧪 AI Sandbox',
        platform: 2, // kênh ảo kiểu cá nhân (Int); không bao giờ kết nối thật
        status: 'disconnected',
      },
      select: { id: true },
    })
  }
  const contact = await prisma.contact.create({
    data: { orgId, fullName: '🧪 Khách ảo (kiểm định)' },
    select: { id: true },
  })
  const conv = await prisma.conversation.create({
    data: {
      orgId,
      channelAccountId: channel.id,
      contactId: contact.id,
      threadType: 'user',
      externalThreadId: `${EVAL_THREAD_PREFIX}${orgId}`,
      displayName: '🧪 Kiểm định AI (bộ câu hỏi vàng)',
      aiMode: 'suggest',
      lastMessageAt: new Date(),
    },
    select: { id: true },
  })
  return conv.id
}

// ── Giám khảo LLM ────────────────────────────────────────────────────

async function dispatchProvider(
  provider: string,
  apiKey: string,
  model: string,
  system: string,
  userPrompt: string,
): Promise<GenerateRaw> {
  const def = getProviderConfig(provider)
  if (!def?.baseUrl) throw new Error(`Unknown provider: ${provider}`)
  if (provider === 'openai' || provider === 'minimax') {
    return generateWithOpenai(def.baseUrl, apiKey, model, system, userPrompt, { jsonMode: true, maxTokens: 800 })
  }
  if (provider === 'anthropic') {
    return generateWithAnthropic(def.baseUrl, apiKey, model, system, userPrompt, { enableCaching: false, maxTokens: 800 })
  }
  if (provider === 'gemini') {
    return generateWithGemini(def.baseUrl, apiKey, model, system, userPrompt, { jsonMode: true, maxTokens: 800 })
  }
  throw new Error(`Unsupported provider: ${provider}`)
}

const JUDGE_SYSTEM = [
  'Bạn là giám khảo chấm chất lượng trả lời của một trợ lý AI bán hàng tiếng Việt.',
  'Nhiệm vụ: đối chiếu CÂU TRẢ LỜI của AI với TIÊU CHÍ CHẤM do quản trị viên đặt ra.',
  'Chấm NGHIÊM KHẮC: chỉ "pass" khi câu trả lời thoả ĐẦY ĐỦ các tiêu chí.',
  'Chỉ trả về đúng MỘT đối tượng JSON, không kèm chữ nào khác, dạng:',
  '{"pass": true|false, "reason": "giải thích ngắn gọn bằng tiếng Việt"}',
].join('\n')

function buildJudgePrompt(question: string, reply: string, criteria: string): string {
  return [
    '## Câu hỏi của khách hàng',
    question,
    '',
    '## Câu trả lời của AI cần chấm',
    reply,
    '',
    '## Tiêu chí chấm (rubric)',
    criteria,
    '',
    'Hãy chấm và trả về JSON {"pass": boolean, "reason": string}.',
  ].join('\n')
}

/** Bóc đối tượng JSON đầu tiên khỏi output LLM (chấp nhận text bọc quanh). */
function parseJudgeVerdict(text: string): { pass: boolean; reason: string } | null {
  const match = text.match(/\{[\s\S]*?\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as { pass?: unknown; reason?: unknown }
    if (typeof obj.pass !== 'boolean') return null
    return { pass: obj.pass, reason: typeof obj.reason === 'string' ? obj.reason : '' }
  } catch {
    return null
  }
}

// ── Chạy eval ────────────────────────────────────────────────────────

export type RunEvalOptions = { trigger: 'manual' | 'proposal'; proposalId?: string | null }

/**
 * Tạo run + khởi động runner ở chế độ fire-and-forget.
 * Trả về row AiEvalRun ngay (client poll GET /runs/:id để xem tiến độ).
 */
export async function runEval(orgId: string, userId: string, opts: RunEvalOptions) {
  if (activeRuns.has(orgId)) {
    throw new EvalBusyError('Đang có một lượt kiểm định chạy — vui lòng chờ hoàn tất rồi chạy lại.')
  }

  const cases = await prisma.aiEvalCase.findMany({
    where: { orgId, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  if (cases.length === 0) {
    throw new Error('Chưa có câu hỏi kiểm định nào được bật — thêm câu hỏi trước khi chạy.')
  }

  if (opts.proposalId) {
    const proposal = await prisma.aiLogicProposal.findFirst({
      where: { id: opts.proposalId, orgId },
      select: { id: true },
    })
    if (!proposal) throw new Error('Đề xuất (proposal) không tồn tại trong tổ chức')
  }

  const run = await prisma.aiEvalRun.create({
    data: {
      orgId,
      trigger: opts.trigger,
      proposalId: opts.proposalId ?? null,
      status: 'running',
      total: cases.length,
    },
  })

  activeRuns.set(orgId, run.id)
  // Fire-and-forget: KHÔNG await — route trả run.id ngay, client poll status.
  void executeRun(orgId, userId, run.id, cases)
    .catch((err) => logger.error({ err, runId: run.id }, '[ai-eval] runner crashed'))
    .finally(() => activeRuns.delete(orgId))

  return run
}

type EvalCaseRow = Awaited<ReturnType<typeof listCases>>[number]

async function executeRun(orgId: string, userId: string, runId: string, cases: EvalCaseRow[]): Promise<void> {
  // Run "failed" CHỈ khi cả lượt không thể tiến hành (vd. thiếu API key) —
  // lỗi từng câu được ghi verdict 'error' và lượt chạy vẫn tiếp tục.
  const failRun = async (note: string) => {
    await prisma.aiEvalRun.update({
      where: { id: runId },
      data: { status: 'failed', note, finishedAt: new Date() },
    })
  }

  let judgeProvider: string
  let judgeModel: string
  let judgeKey: string
  try {
    const cfg = await getAiConfig(orgId)
    if (!cfg.enabled) {
      await failRun('AI đang tắt cho tổ chức này — bật AI trong tab Cấu hình trước khi chạy kiểm định.')
      return
    }
    const eff = getEffectiveConfigForTask(cfg, 'ai_master')
    judgeProvider = eff.provider
    judgeModel = eff.model
    judgeKey = await getProviderApiKey(orgId, judgeProvider)
    if (!judgeKey) {
      await failRun(`Chưa cấu hình API key cho nhà cung cấp AI "${judgeProvider}" — vào tab Cấu hình để nhập key rồi chạy lại.`)
      return
    }
  } catch (err) {
    await failRun('Không đọc được cấu hình AI: ' + (err as Error).message)
    return
  }

  await prisma.aiEvalRun.update({ where: { id: runId }, data: { model: judgeModel } })

  let passed = 0
  let failed = 0
  let errored = 0
  let sharedConvId: string | null = null

  // Tuần tự từng câu (concurrency 1) — đơn giản và không dồn tải AI.
  for (const c of cases) {
    const started = Date.now()
    let reply: string | null = null
    let verdict: 'pass' | 'fail' | 'error' = 'error'
    let reason = ''
    try {
      // 1) Ngữ cảnh: hội thoại thật (nếu case chỉ định) hoặc hội thoại eval rỗng.
      let convId: string
      if (c.conversationId) {
        const conv = await prisma.conversation.findFirst({
          where: { id: c.conversationId, orgId },
          select: { id: true },
        })
        if (!conv) throw new Error('Hội thoại ngữ cảnh không tồn tại trong tổ chức')
        convId = conv.id
      } else {
        sharedConvId ??= await getOrCreateEvalConversation(orgId, userId)
        convId = sharedConvId
      }

      // 2) Sinh trả lời qua đúng đường simulate (mode 'suggest', KHÔNG persist,
      //    KHÔNG gửi đi đâu). forceBotId khi case ép một Agent cụ thể.
      const result = await runHarness(orgId, convId, c.question, 'suggest', {
        forceBotId: c.botId ?? undefined,
      })
      reply = result.reply

      // 3) Giám khảo chấm theo tiêu chí.
      const replyForJudge = reply ?? '(AI quyết định KHÔNG trả lời — có thể do chuyển người thật hoặc bộ lọc)'
      const raw = await dispatchProvider(
        judgeProvider, judgeKey, judgeModel,
        JUDGE_SYSTEM, buildJudgePrompt(c.question, replyForJudge, c.criteria),
      )
      await logUsage({
        orgId, provider: judgeProvider, model: judgeModel,
        type: 'ai_master', raw, feature: 'ai_eval',
      }).catch(() => {})

      const parsed = parseJudgeVerdict(raw.text)
      if (!parsed) {
        verdict = 'error'
        reason = 'Không đọc được kết quả chấm từ giám khảo: ' + raw.text.slice(0, 300)
      } else {
        verdict = parsed.pass ? 'pass' : 'fail'
        reason = parsed.reason
      }
    } catch (err) {
      verdict = 'error'
      reason = (err as Error).message || 'Lỗi không xác định'
    }

    if (verdict === 'pass') passed++
    else if (verdict === 'fail') failed++
    else errored++

    await prisma.aiEvalResult.create({
      data: {
        runId,
        caseId: c.id,
        caseName: c.name,
        question: c.question,
        reply,
        verdict,
        reason,
        latencyMs: Date.now() - started,
      },
    }).catch((err) => logger.error({ err, runId }, '[ai-eval] không lưu được kết quả case'))

    // Cập nhật bộ đếm sau MỖI câu để client poll thấy tiến độ.
    await prisma.aiEvalRun.update({
      where: { id: runId },
      data: { passed, failed, errored },
    }).catch(() => {})
  }

  await prisma.aiEvalRun.update({
    where: { id: runId },
    data: { status: 'done', passed, failed, errored, finishedAt: new Date() },
  })
}
