/**
 * ai-train-page.tsx — Màn TRAIN AI độc lập cho một bot (phong cách SMAX GenAI):
 *   TRÁI  = Editor tài liệu đang chọn (prompt/kịch bản — kịch bản có đủ trường động)
 *   GIỮA  = Cấu trúc bộ não (tài liệu bot + tài liệu nền + kịch bản + NGUỒN TRI THỨC)
 *   PHẢI  = Chat thử (sandbox thật — chạy đúng pipeline router → tool → generator)
 *
 * Nguồn tri thức = module động: chọn danh mục Sản phẩm/Kiến thức từ DB cấp cho bot
 * (guardrail của công cụ, enforce trong code), và thêm tài nguyên mới (Text/Product/
 * Google Sheets/CSV — chạy trên API import sẵn có của BE).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { platformLabel } from '@/pages/conversations/lib'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, Save, SendHorizonal, MessageSquareText, BookOpenText, Radio, ChevronDown,
  Plus, Trash2, Database,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch, Separator } from '@/components/ui/misc'
import { Loading, ErrorState } from '@/components/shared/feedback'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from '@/components/ui/dropdown-menu'
import { api, apiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { useProductCategories } from '@/hooks/use-products'
import { useKnowledgeCategories } from '@/hooks/use-knowledge'
import { useZaloAccounts } from '@/hooks/use-integrations'
import { CreateKnowledgeDialog } from './ai-knowledge-tab'
import { useContextBudgets, budgetForDocType, budgetCounterText } from '@/hooks/use-ai-budgets'
import { useLogicProposals } from '@/hooks/use-ai-improve'
import { LearnHistoryDialog } from './learn-history-dialog'
import {
  aiKeys, useAiConfig, useAiScenarios,
  updateAiBot, fetchScenario, createScenario, updateScenario, deleteScenario,
  createSandboxConversation, simulateBotReply,
  type AiBot, type AiBotInput,
} from '@/hooks/use-ai'

// Bảng cũ chỉ có 3 kênh nên kênh Pancake/Facebook hiện ra "#30" — dùng lại bảng
// nhãn đầy đủ của màn Hội thoại để mọi nền tảng đều có tên đọc được.
const platformName = (p?: number | null) => platformLabel(p)
const DEFAULT_EMOJI = '🤖'

// Tài liệu nền của org (AiLogicDoc) — nhãn theo màn train của hệ thống gốc
const ORG_DOCS: Array<{ type: string; label: string }> = [
  { type: 'criteria', label: 'Quy tắc trả lời (guardrails)' },
  { type: 'handoff_rules', label: 'Khi nào chuyển nhân viên' },
  { type: 'index', label: 'Vai trò & nhiệm vụ (tổng quan)' },
  { type: 'mechanism', label: 'Cách AI vận hành' },
  { type: 'persona', label: 'Tính cách & xưng hô' },
  { type: 'playbook', label: 'Kịch bản bán hàng nền' },
]

type DocSel =
  | { kind: 'bot'; field: 'personaPrompt' | 'playbookPrompt'; label: string }
  | { kind: 'org'; type: string; label: string }
  | { kind: 'scenario'; id: string; label: string }
  | { kind: 'scenario-new'; label: string }

type ScenarioForm = { name: string; description: string; loadMode: string; enabled: boolean; triggerHints: string }
const EMPTY_SC: ScenarioForm = { name: '', description: '', loadMode: 'auto', enabled: true, triggerHints: '' }

export function AiTrainPage() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const canEdit = role === 'owner' || role === 'admin'
  const [learnHistoryOpen, setLearnHistoryOpen] = useState(false)
  // Đề xuất persona sinh từ học lịch sử đang chờ duyệt — hiện badge trên tile.
  const pendingQ = useLogicProposals(canEdit ? 'pending' : undefined)
  const pendingLearn = (pendingQ.data?.items ?? []).filter((p) =>
    p.source === 'learn_history' || p.source === 'learn_history_file').length

  const { data: config } = useAiConfig()
  const { data: budgetData } = useContextBudgets()
  // Backend TDVN không có /ai/channel-overrides — danh sách kênh lấy từ /zalo-accounts.
  const { data: channelAccounts } = useZaloAccounts()
  const { data: scenarioData } = useAiScenarios()
  const { data: prodCats } = useProductCategories()
  const { data: kbCats } = useKnowledgeCategories()

  const [bot, setBot] = useState<AiBot | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  const [form, setForm] = useState<AiBotInput>({})
  const [saving, setSaving] = useState(false)
  const [docVersions, setDocVersions] = useState<Record<string, number>>({})

  // ── Editor state (cột trái) ──
  const [sel, setSel] = useState<DocSel>({ kind: 'bot', field: 'personaPrompt', label: 'Tính cách & xưng hô của bot (riêng)' })
  const [docContent, setDocContent] = useState('')
  const [docMeta, setDocMeta] = useState<string>('')
  const [docLoading, setDocLoading] = useState(false)
  const [docSaving, setDocSaving] = useState(false)
  const [scForm, setScForm] = useState<ScenarioForm>(EMPTY_SC)

  // ── Dialog nguồn tri thức ──
  const [resourceOpen, setResourceOpen] = useState<null | 'products' | 'knowledge'>(null)
  const [addKnowledgeOpen, setAddKnowledgeOpen] = useState(false)

  useEffect(() => {
    if (!botId) return
    api.get(`/ai/bots/${botId}`)
      .then(({ data }) => {
        const b = data.bot as AiBot
        setBot(b)
        setForm({
          name: b.name, avatarEmoji: b.avatarEmoji, description: b.description,
          enabled: b.enabled, provider: b.provider, model: b.model,
          toolsJson: b.toolsJson, channelAccountIds: b.channelAccountIds,
          personaPrompt: b.personaPrompt, playbookPrompt: b.playbookPrompt,
        })
        setDocContent(b.personaPrompt ?? '')
        setDocMeta('Chỉ áp dụng cho bot này — bỏ trống để dùng tài liệu nền chung.')
      })
      .catch(() => setLoadErr(true))
    api.get('/ai/logic-docs')
      .then(({ data }) => {
        const map: Record<string, number> = {}
        for (const d of data.docs ?? []) map[d.type] = d.version
        setDocVersions(map)
      })
      .catch(() => { /* badge là phụ, lỗi bỏ qua */ })
  }, [botId])

  // Nạp nội dung tài liệu khi đổi lựa chọn
  useEffect(() => {
    let alive = true
    if (sel.kind === 'bot') {
      setDocContent((form[sel.field] as string) ?? '')
      setDocMeta('Chỉ áp dụng cho bot này — bỏ trống để dùng tài liệu nền chung.')
      return
    }
    if (sel.kind === 'scenario-new') {
      setScForm(EMPTY_SC)
      setDocContent('')
      setDocMeta('Kịch bản mới — điền tên, mô tả (khi nào dùng) và nội dung xử lý.')
      return
    }
    setDocLoading(true)
    setDocContent('')
    setDocMeta('')
    const load = sel.kind === 'org'
      ? api.get(`/ai/logic-docs/${sel.type}`).then(({ data }) => ({
          content: data.doc?.content ?? '',
          meta: `Tài liệu nền dùng chung mọi bot · v${data.doc?.version ?? 1}`,
        }))
      : fetchScenario(sel.id).then((res) => {
          if (alive) {
            setScForm({
              name: res.scenario.name,
              description: res.scenario.description,
              loadMode: res.scenario.loadMode,
              enabled: res.scenario.enabled,
              triggerHints: res.scenario.triggerHints ?? '',
            })
          }
          return {
            content: res.scenario.content,
            meta: `Kịch bản dùng chung mọi bot · v${res.scenario.version}`,
          }
        })
    load
      .then((r) => { if (alive) { setDocContent(r.content); setDocMeta(r.meta) } })
      .catch((err) => { if (alive) { setDocMeta(''); toast.error(apiError(err)) } })
      .finally(() => { if (alive) setDocLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  if (loadErr) return <ErrorState message="Không tải được bot." />
  if (!bot || !config) return <Loading label="Đang tải màn train AI..." />

  const providers = config.availableProviders
  const channels = channelAccounts ?? []
  const scenarios = scenarioData?.scenarios ?? []
  const models = providers.find((p) => p.id === form.provider)?.models ?? []
  const set = (patch: AiBotInput) => setForm((f) => ({ ...f, ...patch }))

  const toolEnabled = (name: string) => (form.toolsJson?.[name]?.enabled ?? true)
  const guardrailIds = (name: string) => form.toolsJson?.[name]?.guardrail?.categoryIds ?? []
  const patchTool = (name: string, patch: { enabled?: boolean; categoryIds?: string[] }) => {
    const base = form.toolsJson ?? {
      search_products: { enabled: true, guardrail: { categoryIds: [] } },
      search_knowledge: { enabled: true, guardrail: { categoryIds: [] } },
    }
    const cur = base[name] ?? { enabled: true, guardrail: { categoryIds: [] } }
    const next = {
      ...base,
      [name]: {
        enabled: patch.enabled ?? cur.enabled,
        guardrail: { categoryIds: patch.categoryIds ?? cur.guardrail.categoryIds },
      },
    }
    set({ toolsJson: next })
    return next
  }

  const selectedChannels = form.channelAccountIds ?? []
  const toggleChannel = (id: string) => {
    set({ channelAccountIds: selectedChannels.includes(id) ? selectedChannels.filter((c) => c !== id) : [...selectedChannels, id] })
  }

  async function saveConfig() {
    setSaving(true)
    try {
      await updateAiBot(bot!.id, form)
      await qc.invalidateQueries({ queryKey: aiKeys.bots })
      toast.success('Đã lưu cấu hình bot')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function saveDoc() {
    setDocSaving(true)
    try {
      if (sel.kind === 'bot') {
        const patch = { [sel.field]: docContent } as AiBotInput
        set(patch)
        await updateAiBot(bot!.id, patch)
        toast.success('Đã lưu prompt của bot')
      } else if (sel.kind === 'org') {
        const docType = sel.type
        await api.put(`/ai/logic-docs/${docType}`, { content: docContent, changeNote: 'Sửa từ màn Train AI' })
        setDocVersions((m) => ({ ...m, [docType]: (m[docType] ?? 1) + 1 }))
        toast.success('Đã lưu tài liệu nền (áp dụng mọi bot)')
      } else if (sel.kind === 'scenario') {
        if (!scForm.name.trim() || !scForm.description.trim()) { toast.error('Kịch bản cần Tên và Mô tả'); return }
        await updateScenario(sel.id, {
          name: scForm.name, description: scForm.description, content: docContent,
          loadMode: scForm.loadMode, triggerHints: scForm.triggerHints || null, enabled: scForm.enabled,
        })
        await qc.invalidateQueries({ queryKey: aiKeys.scenarios })
        toast.success('Đã lưu kịch bản')
      } else {
        // Kịch bản mới — báo đích danh trường còn thiếu
        if (!scForm.name.trim()) { toast.error('Thiếu Tên kịch bản'); return }
        if (!scForm.description.trim()) { toast.error('Thiếu Mô tả — khi nào dùng'); return }
        if (!docContent.trim()) { toast.error('Thiếu Nội dung — hướng dẫn xử lý (khung soạn thảo lớn bên dưới)'); return }
        const res = await createScenario({
          name: scForm.name, description: scForm.description, content: docContent,
          loadMode: scForm.loadMode, triggerHints: scForm.triggerHints || null, enabled: scForm.enabled,
        })
        await qc.invalidateQueries({ queryKey: aiKeys.scenarios })
        setSel({ kind: 'scenario', id: res.scenario.id, label: `Kịch bản: ${res.scenario.name}` })
        toast.success('Đã tạo kịch bản mới')
      }
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setDocSaving(false)
    }
  }

  async function handleDeleteScenario() {
    if (sel.kind !== 'scenario') return
    if (!window.confirm(`Xoá kịch bản "${scForm.name}"? Áp dụng cho mọi bot.`)) return
    try {
      await deleteScenario(sel.id)
      await qc.invalidateQueries({ queryKey: aiKeys.scenarios })
      setSel({ kind: 'bot', field: 'personaPrompt', label: 'Tính cách & xưng hô của bot (riêng)' })
      toast.success('Đã xoá kịch bản')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const selKey = sel.kind === 'bot' ? `bot:${sel.field}`
    : sel.kind === 'org' ? `org:${sel.type}`
    : sel.kind === 'scenario' ? `sc:${sel.id}` : 'sc:new'
  const isScenario = sel.kind === 'scenario' || sel.kind === 'scenario-new'

  // Bộ đếm ký tự theo ngân sách prompt của backend — cảnh báo trước khi bị CẮT NGẦM.
  // Persona/playbook (bot lẫn org) có hạn mức riêng; các doc nền khác map theo
  // đúng cách backend cắt; kịch bản dùng ngân sách CHUNG nên nêu tổng cho trung thực.
  const budgetCounter = (() => {
    const b = budgetData?.budgets
    if (!b) return null
    if (sel.kind === 'bot') {
      return budgetCounterText(docContent.length, sel.field === 'personaPrompt' ? b.persona : b.playbook)
    }
    if (sel.kind === 'org') {
      return budgetCounterText(docContent.length, budgetForDocType(b, sel.type))
    }
    // Kịch bản: always + auto chia sẻ chung l0bScenarios mỗi lượt trả lời
    return budgetCounterText(docContent.length, b.l0bScenarios, { shared: true, sharedLabel: 'Tổng kịch bản vào prompt mỗi lượt' })
  })()

  const brainItem = (key: string, label: string, icon: string, docSel: DocSel, badge?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setSel(docSel)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        selKey === key ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'
      }`}
    >
      <span>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">{badge}</Badge>}
    </button>
  )

  const prodCatList = prodCats ?? []
  const kbCatList = kbCats ?? []
  const prodGuardCount = guardrailIds('search_products').length
  const kbGuardCount = guardrailIds('search_knowledge').length

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[560px] flex-col gap-3">
      {/* Header — tên bot + bật/tắt sửa trực tiếp tại đây */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/ai')}><ArrowLeft className="h-4 w-4" /></Button>
        <Input
          className="w-14 text-center text-xl" value={form.avatarEmoji ?? ''}
          onChange={(e) => set({ avatarEmoji: e.target.value.slice(0, 4) })} disabled={!canEdit}
          placeholder={DEFAULT_EMOJI}
        />
        <Input
          className="w-56 font-semibold" value={form.name ?? ''}
          onChange={(e) => set({ name: e.target.value })} disabled={!canEdit}
          placeholder="Tên bot"
        />
        <div className="flex items-center gap-1.5">
          <Switch checked={form.enabled ?? true} onCheckedChange={(v) => set({ enabled: v })} disabled={!canEdit} />
          <span className="text-xs text-muted-foreground">{form.enabled ?? true ? 'Đang bật' : 'Đang tắt'}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={!canEdit}>
                <Radio className="h-4 w-4" /> Kênh áp dụng
                {selectedChannels.length > 0 && <Badge variant="secondary">{selectedChannels.length}</Badge>}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-2">
              <p className="px-1 pb-2 text-xs text-muted-foreground">
                Mỗi kênh chỉ thuộc 1 bot — gán ở đây sẽ gỡ khỏi bot khác. Nhớ bấm "Lưu cấu hình".
              </p>
              {channels.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">Chưa có kênh nào được kết nối.</p>
              ) : channels.map((ch) => (
                <label key={ch.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox" checked={selectedChannels.includes(ch.id)}
                    onChange={() => toggleChannel(ch.id)} disabled={!canEdit}
                  />
                  <span className="truncate">{ch.displayName || 'Kênh chưa đặt tên'}</span>
                  <Badge variant="outline" className="ml-auto shrink-0">{platformName(ch.platform)}</Badge>
                </label>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={saveConfig} disabled={!canEdit || saving}>
            <Save className="h-4 w-4" /> {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ══ TRÁI: Editor tài liệu / kịch bản ══ */}
        <div className="flex min-h-0 flex-col gap-2 rounded-lg border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="flex min-w-0 items-center gap-2">
              <BookOpenText className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{sel.label}</span>
            </Label>
            <div className="flex shrink-0 items-center gap-1">
              {sel.kind === 'scenario' && (
                <Button variant="ghost" size="icon" title="Xoá kịch bản" onClick={handleDeleteScenario} disabled={!canEdit}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
              <Button size="sm" onClick={saveDoc} disabled={!canEdit || docSaving || docLoading}>
                <Save className="h-3.5 w-3.5" /> {docSaving ? 'Đang lưu...' : sel.kind === 'scenario-new' ? 'Tạo kịch bản' : 'Lưu tài liệu'}
              </Button>
            </div>
          </div>
          {docMeta && <p className="text-xs text-muted-foreground">{docMeta}</p>}

          {/* Trường cấu hình động của kịch bản */}
          {isScenario && !docLoading && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tên kịch bản *</Label>
                  <Input value={scForm.name} onChange={(e) => setScForm((f) => ({ ...f, name: e.target.value }))} disabled={!canEdit} placeholder="vd: Tư vấn theo ngân sách" />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label className="text-xs">Chế độ tải</Label>
                    <Select value={scForm.loadMode} onValueChange={(v) => setScForm((f) => ({ ...f, loadMode: v }))} disabled={!canEdit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Theo ngữ cảnh</SelectItem>
                        <SelectItem value="always">Luôn tải</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1.5 pb-2">
                    <Switch checked={scForm.enabled} onCheckedChange={(v) => setScForm((f) => ({ ...f, enabled: v }))} disabled={!canEdit} />
                    <span className="text-xs">{scForm.enabled ? 'Bật' : 'Tắt'}</span>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs">Mô tả — khi nào dùng * <span className="font-normal text-muted-foreground">(để AI tự chọn kịch bản đúng chủ đề)</span></Label>
                <Input value={scForm.description} onChange={(e) => setScForm((f) => ({ ...f, description: e.target.value }))} disabled={!canEdit} placeholder="vd: Khách hỏi giá theo ngân sách, so sánh gói..." />
              </div>
              <div>
                <Label className="text-xs">Cách hỏi khác / từ đồng nghĩa <span className="font-normal text-muted-foreground">(giúp khớp ngữ cảnh chính xác hơn)</span></Label>
                <Input value={scForm.triggerHints} onChange={(e) => setScForm((f) => ({ ...f, triggerHints: e.target.value }))} disabled={!canEdit} placeholder="vd: tầm giá, khoảng bao nhiêu tiền, budget" />
              </div>
            </div>
          )}

          {docLoading ? (
            <Loading label="Đang tải tài liệu..." />
          ) : (
            <>
              {isScenario && (
                <Label className="text-xs">
                  Nội dung — hướng dẫn xử lý <span className="text-destructive">*</span>
                </Label>
              )}
              <textarea
                className="min-h-0 w-full flex-1 resize-none rounded-md border bg-transparent p-3 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                placeholder={isScenario ? 'Nội dung — hướng dẫn xử lý khi kịch bản khớp...' : 'Nội dung markdown...'}
                disabled={!canEdit}
              />
              {budgetCounter && (
                <p className={`shrink-0 text-[11px] ${budgetCounter.over ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {budgetCounter.text}
                </p>
              )}
            </>
          )}
        </div>

        {/* ══ GIỮA: Cấu trúc bộ não + cấu hình chế độ ══ */}
        <div className="min-h-0 space-y-3 overflow-y-auto rounded-lg border bg-background p-3">
          <Input
            placeholder="Mô tả ngắn" value={form.description ?? ''}
            onChange={(e) => set({ description: e.target.value })} disabled={!canEdit}
          />

          <Separator />

          <div>
            <p className="mb-1 text-[11px] font-bold tracking-wide text-muted-foreground">TÀI LIỆU BOT (RIÊNG)</p>
            {brainItem('bot:personaPrompt', 'Tính cách & xưng hô của bot', '🎭', { kind: 'bot', field: 'personaPrompt', label: 'Tính cách & xưng hô của bot (riêng)' })}
            {brainItem('bot:playbookPrompt', 'Kịch bản bán hàng của bot', '📋', { kind: 'bot', field: 'playbookPrompt', label: 'Kịch bản bán hàng của bot (riêng)' })}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold tracking-wide text-muted-foreground">TÀI LIỆU NỀN (DÙNG CHUNG)</p>
            {ORG_DOCS.map((d) =>
              brainItem(`org:${d.type}`, d.label, '📚', { kind: 'org', type: d.type, label: `${d.label} · nền` },
                docVersions[d.type] ? `v${docVersions[d.type]}` : undefined),
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-bold tracking-wide text-muted-foreground">KỊCH BẢN AI ({scenarios.length})</p>
              <button
                type="button" title="Thêm kịch bản mới" disabled={!canEdit}
                className="rounded p-0.5 text-primary hover:bg-primary/10"
                onClick={() => setSel({ kind: 'scenario-new', label: 'Kịch bản mới' })}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {scenarios.map((s) =>
              brainItem(`sc:${s.id}`, s.name, s.enabled ? '🟢' : '⚪', { kind: 'scenario', id: s.id, label: `Kịch bản: ${s.name}` }, `v${s.version}`),
            )}
            {sel.kind === 'scenario-new' && (
              <div className="rounded-md bg-primary/10 px-2 py-1.5 text-sm font-semibold text-primary">＋ Kịch bản mới (chưa lưu)</div>
            )}
            {scenarios.length === 0 && sel.kind !== 'scenario-new' && (
              <p className="px-2 text-xs text-muted-foreground">Chưa có kịch bản nào — bấm + để thêm.</p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-bold tracking-wide text-muted-foreground">NGUỒN TRI THỨC</p>
              <button
                type="button" title="Thêm tài nguyên tri thức mới" disabled={!canEdit}
                className="rounded p-0.5 text-primary hover:bg-primary/10"
                onClick={() => setAddKnowledgeOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setResourceOpen('products')}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span>🛒</span>
              <span className="min-w-0 flex-1 truncate">Sản phẩm (từ DB)</span>
              <span className="flex items-center gap-1">
                <Switch checked={toolEnabled('search_products')} onCheckedChange={(v) => patchTool('search_products', { enabled: v })} disabled={!canEdit} />
                <Badge variant="outline" className="px-1.5 text-[10px]">
                  {prodGuardCount === 0 ? 'tất cả' : `${prodGuardCount} nhóm`}
                </Badge>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setResourceOpen('knowledge')}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span>📚</span>
              <span className="min-w-0 flex-1 truncate">Kiến thức / FAQ (từ DB)</span>
              <span className="flex items-center gap-1">
                <Switch checked={toolEnabled('search_knowledge')} onCheckedChange={(v) => patchTool('search_knowledge', { enabled: v })} disabled={!canEdit} />
                <Badge variant="outline" className="px-1.5 text-[10px]">
                  {kbGuardCount === 0 ? 'tất cả' : `${kbGuardCount} nhóm`}
                </Badge>
              </span>
            </button>
            {/* Học giọng điệu nhân viên thật từ hội thoại cũ — BE learn-history đã có,
                kết quả là ĐỀ XUẤT sửa persona nằm chờ duyệt (không tự áp). */}
            {canEdit && (
              <button
                type="button"
                onClick={() => setLearnHistoryOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span>💬</span>
                <span className="min-w-0 flex-1 truncate">Lịch sử tin nhắn</span>
                {pendingLearn > 0 ? (
                  <Badge variant="warning" className="px-1.5 text-[10px]">{pendingLearn} đề xuất chờ duyệt</Badge>
                ) : (
                  <Badge variant="outline" className="px-1.5 text-[10px]">học giọng điệu</Badge>
                )}
              </button>
            )}
            <p className="px-2 pt-1 text-[11px] text-muted-foreground">
              Bấm vào từng nguồn để giới hạn danh mục bot được tra cứu (guardrail — enforce trong code).
            </p>
          </div>

          <Separator />

          <Label>Mô hình</Label>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={form.provider ?? '__default__'}
              onValueChange={(v) => {
                if (v === '__default__') set({ provider: null, model: null })
                else set({ provider: v, model: providers.find((p) => p.id === v)?.models[0]?.value ?? null })
              }}
              disabled={!canEdit}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Theo cấu hình chung</SelectItem>
                {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.model ?? ''} onValueChange={(v) => set({ model: v })} disabled={!canEdit || !form.provider}>
              <SelectTrigger><SelectValue placeholder="Mặc định" /></SelectTrigger>
              <SelectContent>
                {models.map((m) => <SelectItem key={m.value} value={m.value}>{m.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ══ PHẢI: Chat thử ══ */}
        <div className="flex min-h-0 flex-col rounded-lg border bg-background p-3">
          <DemoChat botId={bot.id} botName={form.name || 'Bot'} botEmoji={form.avatarEmoji || DEFAULT_EMOJI} />
        </div>
      </div>

      {/* ── Dialog: chọn danh mục nguồn tri thức từ DB ── */}
      {resourceOpen && (
        <ResourcePickerDialog
          kind={resourceOpen}
          categories={resourceOpen === 'products'
            ? prodCatList.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
            : kbCatList.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))}
          selected={guardrailIds(resourceOpen === 'products' ? 'search_products' : 'search_knowledge')}
          canEdit={canEdit}
          onClose={() => setResourceOpen(null)}
          onSave={async (ids) => {
            const tool = resourceOpen === 'products' ? 'search_products' : 'search_knowledge'
            const nextTools = patchTool(tool, { categoryIds: ids })
            try {
              await updateAiBot(bot.id, { toolsJson: nextTools })
              toast.success('Đã lưu nguồn tri thức của bot')
            } catch (err) {
              toast.error(apiError(err))
            }
            setResourceOpen(null)
          }}
        />
      )}

      {/* ── Dialog: học từ lịch sử tin nhắn (nguồn tri thức 💬) ── */}
      <LearnHistoryDialog open={learnHistoryOpen} onOpenChange={setLearnHistoryOpen} />

      {/* ── Dialog: thêm mới knowledge (Text / Product / Sheets / CSV) ── */}
      {addKnowledgeOpen && (
        <CreateKnowledgeDialog onClose={() => setAddKnowledgeOpen(false)} />
      )}
    </div>
  )
}

// ── Dialog chọn danh mục từ DB cho bot (guardrail) ─────────────────
function ResourcePickerDialog({ kind, categories, selected, canEdit, onClose, onSave }: {
  kind: 'products' | 'knowledge'
  categories: Array<{ id: string; name: string }>
  selected: string[]
  canEdit: boolean
  onClose: () => void
  onSave: (ids: string[]) => void
}) {
  const [ids, setIds] = useState<string[]>(selected)
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Nguồn {kind === 'products' ? 'Sản phẩm' : 'Kiến thức/FAQ'} của bot
          </DialogTitle>
          <DialogDescription>
            Chọn danh mục (từ DB) bot được phép tra cứu. Không chọn gì = toàn bộ. Guardrail được enforce trong code — bot không thể vượt phạm vi.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
          {categories.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Chưa có danh mục nào trong DB.</p>
          ) : categories.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} disabled={!canEdit} />
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => setIds([])} disabled={!canEdit || ids.length === 0}>Chọn tất cả (bỏ giới hạn)</Button>
          <Button onClick={() => onSave(ids)} disabled={!canEdit}><Save className="h-4 w-4" /> Lưu nguồn</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Chat thử (sandbox thật, chạy đúng pipeline) ─────────────────────
type ChatMsg = { role: 'user' | 'bot' | 'system'; text: string }

function DemoChat({ botId, botName, botEmoji }: { botId: string; botName: string; botEmoji: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const convRef = useRef<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const canSend = useMemo(() => !!input.trim() && !busy, [input, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text }])
    setBusy(true)
    try {
      if (!convRef.current) {
        const conv = await createSandboxConversation(`Demo — ${botName}`)
        convRef.current = conv.conversationId
      }
      const res = await simulateBotReply(convRef.current, text, botId)
      if (res.handoff?.should) {
        setMsgs((m) => [...m, { role: 'system', text: `↪ Bot chuyển nhân viên: ${res.handoff?.reason || ''}` }])
      } else if (res.reply) {
        setMsgs((m) => [...m, { role: 'bot', text: res.reply! }])
      } else {
        setMsgs((m) => [...m, { role: 'system', text: '(Bot quyết định không trả lời lượt này)' }])
      }
    } catch (err) {
      setMsgs((m) => [...m, { role: 'system', text: `Lỗi: ${apiError(err)}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Label className="mb-2 flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-primary" /> Demo &amp; Review
      </Label>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-3">
        {msgs.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Sandbox thật — chạy đúng bộ não đang soạn bên trái.<br />Mỗi tin nhắn tốn phí AI thật.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'system' ? (
              <span className="mx-auto text-center text-xs italic text-muted-foreground">{m.text}</span>
            ) : (
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border bg-background'
              }`}>
                {m.role === 'bot' && <span className="mr-1">{botEmoji}</span>}{m.text}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-xs italic text-muted-foreground">{botEmoji} đang soạn trả lời...</p>}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          placeholder="Nhập tin thử như khách hàng..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          disabled={busy}
        />
        <Button onClick={() => void send()} disabled={!canSend}><SendHorizonal className="h-4 w-4" /></Button>
      </div>
    </>
  )
}
