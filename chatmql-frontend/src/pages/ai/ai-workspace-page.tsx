/**
 * AiWorkspacePage — Trang AI chính (route mong muốn: /ai).
 * Tabs: Cấu hình · Sử dụng · Nhật ký AI.
 * Chỉ dùng lại UI/shared có sẵn. Ghi cấu hình yêu cầu quyền owner/admin.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Sparkles, KeyRound, Trash2, Save, Coins, Hash, ArrowDownToLine, Activity, ScrollText,
  Radio, ListPlus, Plus,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch, Separator } from '@/components/ui/misc'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { apiError } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { formatNumber } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { AiScheduleCard } from '@/pages/ai/ai-schedule-card'
import {
  aiKeys, useAiConfig, useAiUsage, useReplyRuns, fetchTrace,
  saveApiKey, deleteApiKey, updateAiConfig,
  useChannelOverrides, saveChannelOverrides,
  useCustomModels, saveCustomModels,
  type AiConfig, type AiMode, type ReplyRun, type AiTrace,
  type ChannelOverrides, type CustomModels, type TaskOverrides,
} from '@/hooks/use-ai'
import { AiBotsTab } from './ai-bots-tab'
import { AiKnowledgeTab } from './ai-knowledge-tab'

const MODE_LABELS: Record<AiMode, string> = {
  manual: 'Thủ công',
  suggest: 'Gợi ý',
  auto: 'Tự động',
}

const KEY_FLAG: Record<string, keyof AiConfig> = {
  openai: 'hasOpenaiKey',
  minimax: 'hasMinimaxKey',
  anthropic: 'hasAnthropicKey',
  gemini: 'hasGeminiKey',
}

import { AiEvalTab } from './ai-eval-tab'

export function AiWorkspacePage() {
  const role = useAuthStore((s) => s.user?.role)
  const canEdit = role === 'owner' || role === 'admin'

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI"
        description="Cấu hình trợ lý AI, theo dõi mức sử dụng và xem nhật ký phản hồi."
        actions={
          <Button asChild variant="outline">
            <Link to="/ai/improve">Cải thiện AI (học &amp; đề xuất)</Link>
          </Button>
        }
      />
      {/* "Đội AI" (/ai/bots) — backend TDVN ĐÃ CÓ → tab mở mặc định (cờ AI_BOTS) */}
      <Tabs defaultValue={FEATURES.AI_BOTS ? 'bots' : 'config'}>
        <TabsList>
          {FEATURES.AI_BOTS && <TabsTrigger value="bots">Đội AI</TabsTrigger>}
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="config">Cấu hình</TabsTrigger>
          <TabsTrigger value="usage">Sử dụng</TabsTrigger>
          <TabsTrigger value="logs">Nhật ký AI</TabsTrigger>
          <TabsTrigger value="eval">Kiểm định</TabsTrigger>
        </TabsList>
        {FEATURES.AI_BOTS && (
          <TabsContent value="bots">
            <AiBotsTab canEdit={canEdit} />
          </TabsContent>
        )}
        <TabsContent value="knowledge">
          <AiKnowledgeTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="config">
          <ConfigTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="usage">
          <UsageTab />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab />
        </TabsContent>
        <TabsContent value="eval">
          <AiEvalTab canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ══════════════════════════ Tab: Cấu hình ══════════════════════════
// Card "Cấu hình theo tác vụ": mỗi card có thể ghi đè MỘT NHÓM task key
// (vd Phân tích hội thoại = summary+sentiment+lead_score; Auto-reply gồm cả
// router). Giá trị select gộp "provider:model".
const TASK_CARDS: Array<{ key: string; keys?: string[]; icon: string; name: string; desc: string }> = [
  { key: 'reply_draft', icon: '💬', name: 'Gợi ý trả lời', desc: 'Soạn câu trả lời gợi ý cho từng hội thoại' },
  { key: 'summary', keys: ['summary', 'sentiment', 'lead_score'], icon: '📄', name: 'Phân tích hội thoại', desc: 'Tóm tắt + sentiment + lead score (1 call)' },
  { key: 'ai_cdp', icon: '🧠', name: 'Customer 360 AI (CDP)', desc: 'Phân tích khách hàng 360° trong automation — summary, pain points, competitors, signals' },
  { key: 'auto_reply', keys: ['auto_reply', 'ai_router'], icon: '⚡', name: 'Phản hồi khách hàng (Auto-reply)', desc: 'AI tự trả lời khách trên chat — gồm định tuyến + soạn phản hồi. Kênh đã gán bot sẽ dùng model của bot (ghi đè mục này).' },
  { key: 'ai_master', icon: '✨', name: 'Cải thiện AI (Master)', desc: 'Phân tích góp ý & đề xuất chỉnh logic — nên dùng model mạnh' },
]

function ConfigTab({ canEdit }: { canEdit: boolean }) {
  const { data: config, isLoading, isError } = useAiConfig()

  if (isLoading) return <Loading label="Đang tải cấu hình..." />
  if (isError || !config) return <ErrorState message="Không tải được cấu hình AI." />

  const showOverrides = FEATURES.AI_CHANNEL_OVERRIDES
  const showCustomModels = FEATURES.AI_CUSTOM_MODELS

  return (
    <div className="space-y-6">
      {/* TDVN: lịch AI ngày/đêm (GET/PUT /ai/schedule) đặt đầu tab để thấy ngay */}
      <AiScheduleCard />
      <ModelProviderBox config={config} canEdit={canEdit} />
      <AutoReplyBox config={config} canEdit={canEdit} />
      {/* AI theo kênh / model tuỳ chỉnh — backend TDVN chưa có route */}
      {(showOverrides || showCustomModels) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {showOverrides && <ChannelOverridesCard config={config} canEdit={canEdit} />}
          {showCustomModels && <CustomModelsCard config={config} canEdit={canEdit} />}
        </div>
      )}
    </div>
  )
}

// ── Box: Model & nhà cung cấp (kích hoạt, provider card, API key, hạn mức, tác vụ) ──
function ModelProviderBox({ config, canEdit }: { config: AiConfig; canEdit: boolean }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(config.enabled)
  const [provider, setProvider] = useState(config.provider)
  const [model, setModel] = useState(config.model)
  const [maxDaily, setMaxDaily] = useState(config.maxDaily)
  const [overrides, setOverrides] = useState<TaskOverrides>({ ...(config.taskOverrides ?? {}) })
  const [saving, setSaving] = useState(false)
  // API key state (theo provider đang chọn)
  const [keyEditing, setKeyEditing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  useEffect(() => {
    setEnabled(config.enabled)
    setProvider(config.provider)
    setModel(config.model)
    setMaxDaily(config.maxDaily)
    setOverrides({ ...(config.taskOverrides ?? {}) })
  }, [config])

  const providers = config.availableProviders
  const hasKey = (id: string) => {
    const flag = KEY_FLAG[id]
    return flag ? Boolean(config[flag]) : false
  }
  // Options cho select gộp: chỉ provider đã có key (tránh chọn model không chạy được);
  // nếu chưa có key nào thì hiện tất cả.
  const keyed = providers.filter((p) => hasKey(p.id))
  const selectable = keyed.length > 0 ? keyed : providers

  const ovValue = (card: (typeof TASK_CARDS)[number]) => {
    const o = overrides[card.key]
    return o?.provider && o?.model ? `${o.provider}:${o.model}` : ''
  }
  const setOv = (card: (typeof TASK_CARDS)[number], v: string) => {
    const keys = card.keys ?? [card.key]
    setOverrides((cur) => {
      const next = { ...cur }
      for (const k of keys) {
        if (!v) delete next[k]
        else {
          const [pv, ...rest] = v.split(':')
          next[k] = { provider: pv, model: rest.join(':') }
        }
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateAiConfig({ enabled, provider, model, maxDaily, taskOverrides: overrides })
      await qc.invalidateQueries({ queryKey: aiKeys.config })
      toast.success('Đã lưu model & hạn mức')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveKey() {
    if (!apiKey.trim()) return
    setKeyBusy(true)
    try {
      const res = await saveApiKey(provider, apiKey.trim())
      await qc.invalidateQueries({ queryKey: aiKeys.config })
      setApiKey('')
      setKeyEditing(false)
      toast.success(res.verified ? 'Đã lưu & xác thực API key' : 'Đã lưu API key')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setKeyBusy(false)
    }
  }

  async function handleDeleteKey() {
    if (!window.confirm(`Xoá API key của ${providers.find((p) => p.id === provider)?.name}?`)) return
    setKeyBusy(true)
    try {
      await deleteApiKey(provider)
      await qc.invalidateQueries({ queryKey: aiKeys.config })
      toast.success('Đã xoá API key')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setKeyBusy(false)
    }
  }

  const modelSelect = (value: string, onChange: (v: string) => void, emptyLabel?: string) => (
    <select
      className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={!canEdit}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {selectable.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.models.map((m) => (
            <option key={m.value} value={`${p.id}:${m.value}`}>{m.title} — {m.value}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Model &amp; nhà cung cấp
        </CardTitle>
        <CardDescription>
          Kích hoạt AI, provider/model, hạn mức và model theo tác vụ. Lưu bằng nút cuối khung. (API key có nút lưu riêng theo từng provider.)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Kích hoạt AI */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Kích hoạt AI</Label>
            <p className="text-xs text-muted-foreground">Bật/tắt toàn bộ tính năng AI cho tổ chức (gợi ý, tóm tắt, sentiment, lead score)</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
        </div>

        {/* Provider mặc định — card grid */}
        <div className="space-y-2">
          <Label>
            ✨ Provider mặc định{' '}
            <span className="text-xs font-normal text-muted-foreground">(dùng khi task chưa cấu hình riêng — chọn 1 provider đã có key)</span>
          </Label>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  setProvider(p.id)
                  const cur = model && p.models.some((m) => m.value === model)
                  if (!cur) setModel(p.models[0]?.value ?? '')
                  setKeyEditing(false)
                  setApiKey('')
                }}
                className={`relative rounded-lg border p-3 text-left transition-colors ${
                  provider === p.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'
                }`}
              >
                <span className="absolute right-2 top-2">
                  {hasKey(p.id)
                    ? <Badge variant="success">OK</Badge>
                    : <Badge variant="outline">Cần key</Badge>}
                </span>
                <p className="pr-14 text-sm font-semibold">
                  {p.name}
                  {p.primary && <Badge variant="secondary" className="ml-1.5 px-1.5 text-[10px]">Primary</Badge>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.models.length} models{p.supportsCaching ? ' · prompt caching' : ''}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* API key của provider đang chọn */}
        <div className="space-y-2">
          <Label>
            🔑 API key <span className="text-xs font-normal text-muted-foreground">({providers.find((p) => p.id === provider)?.name})</span>
          </Label>
          {hasKey(provider) && !keyEditing ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-900 dark:bg-green-950/30">
              <span className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                ✓ Key đã được cấu hình
              </span>
              <div className="ml-auto flex gap-1.5">
                <Button variant="outline" size="sm" disabled={!canEdit || keyBusy} onClick={() => setKeyEditing(true)}>Cập nhật key</Button>
                <Button variant="outline" size="sm" disabled={!canEdit || keyBusy} onClick={() => void handleDeleteKey()}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" /> Xóa
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                type="password" placeholder="Dán API key..." value={apiKey}
                onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit}
              />
              <Button onClick={() => void handleSaveKey()} disabled={!canEdit || keyBusy || !apiKey.trim()}>
                <Save className="h-4 w-4" /> {keyBusy ? 'Đang lưu...' : 'Lưu key'}
              </Button>
              {keyEditing && <Button variant="ghost" onClick={() => { setKeyEditing(false); setApiKey('') }}>Huỷ</Button>}
            </div>
          )}
        </div>

        {/* Giới hạn hàng ngày */}
        <div className="space-y-2">
          <Label>
            ⚡ Giới hạn hàng ngày{' '}
            <span className="text-xs font-normal text-muted-foreground">(số lượt gọi AI tối đa mỗi ngày)</span>
          </Label>
          <div className="flex items-center gap-3">
            <Input
              type="number" min={1} max={10000} value={maxDaily}
              onChange={(e) => setMaxDaily(Number(e.target.value))}
              className="max-w-36" disabled={!canEdit}
            />
            <span className="text-sm text-muted-foreground">lượt / ngày</span>
          </div>
        </div>

        {/* Cấu hình theo tác vụ */}
        <div className="space-y-2">
          <Label>
            ✨ Cấu hình theo tác vụ{' '}
            <span className="text-xs font-normal text-muted-foreground">(model mặc định cho mọi task, hoặc ghi đè cho từng tác vụ riêng)</span>
          </Label>
          <div className="space-y-3">
            {/* Card mặc định */}
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span>🗄️</span>
                <span className="text-sm font-semibold">Mặc định (mọi task)</span>
                <Badge variant="secondary" className="ml-auto">Áp dụng cho mọi tác vụ</Badge>
              </div>
              {modelSelect(
                provider && model ? `${provider}:${model}` : '',
                (v) => { const [pv, ...rest] = v.split(':'); setProvider(pv); setModel(rest.join(':')) },
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">Model nền — dùng khi tác vụ bên dưới không có ghi đè riêng.</p>
            </div>
            {/* Cards ghi đè từng tác vụ */}
            {TASK_CARDS.map((card) => {
              const overridden = !!ovValue(card)
              return (
                <div key={card.key} className={`rounded-lg border p-3 ${overridden ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20' : ''}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <span>{card.icon}</span>
                    <span className="text-sm font-semibold">{card.name}</span>
                    {overridden ? (
                      <button
                        type="button"
                        className="ml-auto text-xs font-medium text-primary hover:underline"
                        onClick={() => setOv(card, '')}
                        disabled={!canEdit}
                      >
                        Dùng mặc định
                      </button>
                    ) : (
                      <Badge variant="outline" className="ml-auto">Theo mặc định</Badge>
                    )}
                  </div>
                  {modelSelect(ovValue(card), (v) => setOv(card, v), `— Dùng mặc định (${provider} / ${model}) —`)}
                  <p className="mt-1.5 text-xs text-muted-foreground">{card.desc}</p>
                </div>
              )
            })}
          </div>
        </div>

        {!canEdit && <p className="text-xs text-muted-foreground">Chỉ owner/admin được chỉnh cấu hình AI.</p>}
        <Button onClick={() => void handleSave()} disabled={!canEdit || saving}>
          <Save className="h-4 w-4" /> {saving ? 'Đang lưu...' : 'Lưu model & hạn mức'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Box: Trả lời tự động ──
function AutoReplyBox({ config, canEdit }: { config: AiConfig; canEdit: boolean }) {
  const qc = useQueryClient()
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(config.autoReplyEnabled)
  const [defaultAiMode, setDefaultAiMode] = useState<AiMode>(config.defaultAiMode)
  const [debounceSeconds, setDebounceSeconds] = useState(config.debounceSeconds)
  const [verifyBeforeSend, setVerifyBeforeSend] = useState(Boolean(config.verifyBeforeSend))
  const [groupRequireMention, setGroupRequireMention] = useState(config.groupRequireMention !== false)
  const [mentionNames, setMentionNames] = useState(config.mentionNames ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAutoReplyEnabled(config.autoReplyEnabled)
    setDefaultAiMode(config.defaultAiMode)
    setDebounceSeconds(config.debounceSeconds)
    setVerifyBeforeSend(Boolean(config.verifyBeforeSend))
    setGroupRequireMention(config.groupRequireMention !== false)
    setMentionNames(config.mentionNames ?? '')
  }, [config])

  async function handleSave() {
    setSaving(true)
    try {
      await updateAiConfig({
        autoReplyEnabled, defaultAiMode, debounceSeconds, verifyBeforeSend,
        groupRequireMention, mentionNames: mentionNames.trim() || null,
      })
      await qc.invalidateQueries({ queryKey: aiKeys.config })
      toast.success('Đã lưu trả lời tự động')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" /> Trả lời tự động (AI auto-reply)
        </CardTitle>
        <CardDescription>Cách AI tham gia hội thoại với khách. Lưu bằng nút trong khung này.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Label>Tự động trả lời khách</Label>
            <p className="text-xs text-muted-foreground">Bật để AI gợi ý / tự trả lời khách trong chat. Khi TẮT, mọi hội thoại đều ở chế độ Thủ công.</p>
          </div>
          <Switch checked={autoReplyEnabled} onCheckedChange={setAutoReplyEnabled} disabled={!canEdit} />
        </div>

        <div className="space-y-2">
          <Label>Chế độ mặc định cho hội thoại mới</Label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(MODE_LABELS) as AiMode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!canEdit}
                onClick={() => setDefaultAiMode(m)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  defaultAiMode === m ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary' : 'hover:bg-muted/50'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Lịch ngày/đêm và lựa chọn tay trong từng hội thoại có thể ghi đè. Nên bắt đầu với "Gợi ý" (AI soạn, nhân viên bấm gửi) cho an toàn.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label>Kiểm duyệt trước khi gửi (Critic)</Label>
            <p className="text-xs text-muted-foreground">AI kiểm tra câu trả lời (bám dữ liệu, không bịa) trước khi gửi; không đạt → chuyển nhân viên. Thêm 1 lượt gọi AI.</p>
          </div>
          <Switch checked={verifyBeforeSend} onCheckedChange={setVerifyBeforeSend} disabled={!canEdit} />
        </div>

        <div className="flex items-center justify-between">
          <div className="min-w-0 pr-3">
            <Label>Trong nhóm, chỉ trả lời khi được nhắc tên</Label>
            <p className="text-xs text-muted-foreground">
              Nhóm có nhiều người nói với nhau; AI đáp mọi câu là chen ngang. Bật thì AI
              ngồi im tới khi có người gọi đích danh. Hội thoại một-một không bị ảnh hưởng.
            </p>
          </div>
          <Switch checked={groupRequireMention} onCheckedChange={setGroupRequireMention} disabled={!canEdit} />
        </div>

        {groupRequireMention && (
          <div className="grid gap-2">
            <Label>Tên gọi để nhận biết</Label>
            <Input
              value={mentionNames}
              onChange={(e) => setMentionNames(e.target.value)}
              placeholder="Trợ lý, Bot Trà, AI — cách nhau bằng dấu phẩy"
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              Để trống thì lấy tên các bot đang bật. Nhận cả kiểu tag @Tên lẫn gọi tên
              trần trong câu, và không phân biệt dấu.
            </p>
          </div>
        )}

        <div className="grid max-w-xs gap-2">
          <Label>Debounce (giây)</Label>
          <Input
            type="number" min={0} max={60} value={debounceSeconds}
            onChange={(e) => setDebounceSeconds(Number(e.target.value))}
            disabled={!canEdit}
          />
        </div>

        <Button onClick={() => void handleSave()} disabled={!canEdit || saving}>
          <Save className="h-4 w-4" /> {saving ? 'Đang lưu...' : 'Lưu trả lời tự động'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Card: AI theo từng kênh ─────────────────────────────────────────
const PLATFORM_LABELS: Record<number, string> = { 1: 'Zalo OA', 2: 'Zalo cá nhân' }

function ChannelOverridesCard({ config, canEdit }: { config: AiConfig; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useChannelOverrides()
  const [overrides, setOverrides] = useState<ChannelOverrides>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setOverrides(data.overrides)
  }, [data])

  const providers = config.availableProviders

  function setChannel(channelId: string, patch: { provider?: string; model?: string } | null) {
    setOverrides((prev) => {
      const next = { ...prev }
      if (patch === null) delete next[channelId]
      else next[channelId] = { ...next[channelId], ...patch }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveChannelOverrides(overrides)
      await qc.invalidateQueries({ queryKey: aiKeys.channelOverrides })
      toast.success('Đã lưu AI theo kênh')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" /> AI theo từng kênh
        </CardTitle>
        <CardDescription>
          Mỗi kênh có thể chạy một AI khác nhau. Kênh không chọn gì sẽ dùng cấu hình chung.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loading label="Đang tải danh sách kênh..." />
        ) : isError || !data ? (
          <ErrorState message="Không tải được danh sách kênh." />
        ) : data.channels.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Chưa có kênh nào được kết nối.</p>
        ) : (
          <div className="space-y-3">
            {data.channels.map((ch) => {
              const o = overrides[ch.id]
              const models = providers.find((p) => p.id === o?.provider)?.models ?? []
              return (
                <div key={ch.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ch.displayName || 'Kênh chưa đặt tên'}</span>
                      <Badge variant="outline">{PLATFORM_LABELS[ch.platform] ?? `Kênh #${ch.platform}`}</Badge>
                      {ch.status !== 'connected' && <Badge variant="secondary">{ch.status}</Badge>}
                    </div>
                    {o && (
                      <Button
                        variant="ghost" size="sm" disabled={!canEdit}
                        onClick={() => setChannel(ch.id, null)}
                      >
                        Dùng mặc định
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={o?.provider ?? ''}
                      onValueChange={(v) => {
                        const first = providers.find((p) => p.id === v)?.models[0]?.value
                        setChannel(ch.id, { provider: v, model: first ?? '' })
                      }}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue placeholder="Nhà cung cấp (mặc định)" /></SelectTrigger>
                      <SelectContent>
                        {providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={o?.model ?? ''}
                      onValueChange={(v) => setChannel(ch.id, { model: v })}
                      disabled={!canEdit || !o?.provider}
                    >
                      <SelectTrigger><SelectValue placeholder="Model (mặc định)" /></SelectTrigger>
                      <SelectContent>
                        {models.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <Button onClick={handleSave} disabled={!canEdit || saving}>
          <Save className="h-4 w-4" /> {saving ? 'Đang lưu...' : 'Lưu AI theo kênh'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Card: Model tuỳ chỉnh ───────────────────────────────────────────
function CustomModelsCard({ config, canEdit }: { config: AiConfig; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useCustomModels()
  const [customModels, setCustomModels] = useState<CustomModels>({})
  const [provider, setProvider] = useState(config.provider)
  const [modelValue, setModelValue] = useState('')
  const [modelTitle, setModelTitle] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setCustomModels(data.customModels)
  }, [data])

  const providers = config.availableProviders

  async function persist(next: CustomModels) {
    setSaving(true)
    try {
      const res = await saveCustomModels(next)
      setCustomModels(res.customModels)
      await Promise.all([
        qc.invalidateQueries({ queryKey: aiKeys.customModels }),
        qc.invalidateQueries({ queryKey: aiKeys.config }), // dropdown model dùng availableProviders
      ])
      toast.success('Đã cập nhật danh sách model')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  function handleAdd() {
    const value = modelValue.trim()
    if (!value) return
    const list = customModels[provider] ?? []
    if (list.some((m) => m.value === value)) {
      toast.error('Model này đã có trong danh sách')
      return
    }
    const next = { ...customModels, [provider]: [...list, { title: modelTitle.trim() || value, value }] }
    setModelValue('')
    setModelTitle('')
    void persist(next)
  }

  function handleRemove(providerId: string, value: string) {
    const next = { ...customModels, [providerId]: (customModels[providerId] ?? []).filter((m) => m.value !== value) }
    void persist(next)
  }

  const entries = Object.entries(customModels).filter(([, list]) => list.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListPlus className="h-4 w-4 text-primary" /> Model tuỳ chỉnh
        </CardTitle>
        <CardDescription>
          Thêm model mới cho từng nhà cung cấp mà không cần cập nhật hệ thống — model sẽ xuất hiện trong mọi ô chọn model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loading label="Đang tải model tuỳ chỉnh..." />
        ) : isError ? (
          <ErrorState message="Không tải được model tuỳ chỉnh." />
        ) : entries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Chưa có model tuỳ chỉnh nào.</p>
        ) : (
          <div className="space-y-2">
            {entries.map(([providerId, list]) => (
              <div key={providerId} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {providers.find((p) => p.id === providerId)?.name ?? providerId}
                </p>
                {list.map((m) => (
                  <div key={m.value} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{m.title}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{m.value}</span>
                    </div>
                    <Button
                      variant="ghost" size="icon" disabled={!canEdit || saving}
                      onClick={() => handleRemove(providerId, m.value)} title="Xoá model"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="grid gap-2">
          <Label>Thêm model</Label>
          <Select value={provider} onValueChange={setProvider} disabled={!canEdit}>
            <SelectTrigger><SelectValue placeholder="Chọn nhà cung cấp" /></SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Mã model (vd: gpt-5.6-mini)" value={modelValue}
              onChange={(e) => setModelValue(e.target.value)} disabled={!canEdit}
            />
            <Input
              placeholder="Tên hiển thị (tuỳ chọn)" value={modelTitle}
              onChange={(e) => setModelTitle(e.target.value)} disabled={!canEdit}
            />
          </div>
        </div>
        <Button onClick={handleAdd} disabled={!canEdit || saving || !modelValue.trim()}>
          <Plus className="h-4 w-4" /> Thêm model
        </Button>
      </CardContent>
    </Card>
  )
}

function ApiKeyCard({ config, canEdit }: { config: AiConfig; canEdit: boolean }) {
  const qc = useQueryClient()
  const providers = config.availableProviders
  const [provider, setProvider] = useState(config.provider)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const hasKey = (id: string) => {
    const flag = KEY_FLAG[id]
    return flag ? Boolean(config[flag]) : false
  }

  async function handleSave() {
    if (!apiKey.trim()) return
    setBusy(true)
    try {
      const res = await saveApiKey(provider, apiKey.trim())
      await qc.invalidateQueries({ queryKey: aiKeys.config })
      setApiKey('')
      toast.success(res.verified ? 'Đã lưu & xác thực API key' : 'Đã lưu API key')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    setBusy(true)
    try {
      await deleteApiKey(id)
      await qc.invalidateQueries({ queryKey: aiKeys.config })
      toast.success('Đã xoá API key')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" /> API key
        </CardTitle>
        <CardDescription>Lưu key theo từng nhà cung cấp (key được xác thực trước khi lưu).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                {hasKey(p.id) ? (
                  <Badge variant="success">Đã cấu hình</Badge>
                ) : (
                  <Badge variant="outline">Chưa có key</Badge>
                )}
              </div>
              {hasKey(p.id) && (
                <Button
                  variant="ghost" size="icon" disabled={!canEdit || busy}
                  onClick={() => handleDelete(p.id)} title="Xoá key"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <Separator />

        <div className="grid gap-2">
          <Label>Thêm / cập nhật key</Label>
          <Select value={provider} onValueChange={setProvider} disabled={!canEdit}>
            <SelectTrigger><SelectValue placeholder="Chọn nhà cung cấp" /></SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="password" placeholder="Dán API key..." value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit}
          />
        </div>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">Chỉ owner/admin được quản lý API key.</p>
        )}
        <Button onClick={handleSave} disabled={!canEdit || busy || !apiKey.trim()}>
          <Save className="h-4 w-4" /> {busy ? 'Đang lưu...' : 'Lưu API key'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ══════════════════════════ Tab: Sử dụng ══════════════════════════
function UsageTab() {
  const [days, setDays] = useState(1)
  const { data, isLoading, isError } = useAiUsage(days)

  const byTypeRows = useMemo(
    () => Object.entries(data?.byType ?? {}).map(([type, count]) => ({ type, count })),
    [data],
  )

  const cols: Column<{ type: string; count: number }>[] = [
    { key: 'type', header: 'Loại tác vụ', cell: (r) => <span className="font-medium">{r.type}</span> },
    { key: 'count', header: 'Số lượt', align: 'right', cell: (r) => formatNumber(r.count) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Thống kê token & chi phí AI.</p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Hôm nay</SelectItem>
            <SelectItem value="7">7 ngày</SelectItem>
            <SelectItem value="30">30 ngày</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Loading label="Đang tải thống kê..." />
      ) : isError || !data ? (
        <ErrorState message="Không tải được thống kê sử dụng." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Lượt gọi hôm nay" value={data.callsToday} icon={Activity} hint={`Còn lại ${formatNumber(data.remaining)}/${formatNumber(data.maxDaily)}`} />
            <StatCard label="Token vào" value={data.tokensIn} icon={ArrowDownToLine} />
            <StatCard label="Token ra" value={data.tokensOut} icon={Hash} tone="success" />
            <StatCard label="Chi phí (USD)" value={`$${data.costUsd.toFixed(4)}`} icon={Coins} tone="warning" hint={`Cache đọc: ${formatNumber(data.cacheReadTokens)}`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Phân bổ theo loại tác vụ</CardTitle>
              <CardDescription>Số lượt gọi hôm nay theo từng loại.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={cols} rows={byTypeRows} rowKey={(r) => r.type}
                emptyTitle="Chưa có lượt gọi nào hôm nay"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ══════════════════════════ Tab: Nhật ký AI ══════════════════════════
function statusBadge(status: string | null) {
  const s = status ?? ''
  if (['sent', 'success', 'completed'].includes(s)) return <Badge variant="success">{s}</Badge>
  if (['failed', 'error'].includes(s)) return <Badge variant="destructive">{s}</Badge>
  if (['skipped', 'suppressed'].includes(s)) return <Badge variant="secondary">{s}</Badge>
  return <Badge variant="outline">{s || '—'}</Badge>
}

function LogsTab() {
  const { data, isLoading, isError } = useReplyRuns(50)
  const [selected, setSelected] = useState<ReplyRun | null>(null)

  const cols: Column<ReplyRun>[] = [
    {
      key: 'createdAt', header: 'Thời gian',
      cell: (r) => <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString('vi-VN')}</span>,
    },
    { key: 'mode', header: 'Chế độ', cell: (r) => MODE_LABELS[(r.mode ?? '') as AiMode] ?? r.mode ?? '—' },
    { key: 'status', header: 'Trạng thái', cell: (r) => statusBadge(r.status) },
    {
      key: 'handoff', header: 'Chuyển người', align: 'center',
      cell: (r) => (r.handoff ? <Badge variant="warning">Có</Badge> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'confidence', header: 'Độ tin cậy', align: 'right',
      cell: (r) => (r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'),
    },
    {
      key: 'latencyMs', header: 'Độ trễ', align: 'right',
      cell: (r) => (r.latencyMs != null ? `${formatNumber(r.latencyMs)} ms` : '—'),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" /> Lượt phản hồi gần đây
        </CardTitle>
        <CardDescription>Nhấp vào một dòng để xem chi tiết các bước xử lý (trace).</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loading label="Đang tải nhật ký..." />
        ) : isError ? (
          <ErrorState message="Không tải được nhật ký AI." />
        ) : (
          <DataTable
            columns={cols} rows={data?.runs ?? []} rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            emptyTitle="Chưa có lượt phản hồi nào"
          />
        )}
      </CardContent>
      <TraceDialog run={selected} onClose={() => setSelected(null)} />
    </Card>
  )
}

function TraceDialog({ run, onClose }: { run: ReplyRun | null; onClose: () => void }) {
  const [traces, setTraces] = useState<AiTrace[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!run) return
    let alive = true
    setLoading(true)
    setTraces([])
    fetchTrace(run.id)
      .then((res) => { if (alive) setTraces(res.traces) })
      .catch((err) => toast.error(apiError(err)))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [run])

  return (
    <Dialog open={!!run} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chi tiết lượt phản hồi</DialogTitle>
          <DialogDescription>
            {run ? `${MODE_LABELS[(run.mode ?? '') as AiMode] ?? run.mode ?? ''} · ${new Date(run.createdAt).toLocaleString('vi-VN')}` : ''}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Loading label="Đang tải trace..." />
        ) : traces.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Không có bước trace nào.</p>
        ) : (
          <div className="space-y-3">
            {traces.map((t) => (
              <div key={t.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t.step}</span>
                  <div className="flex items-center gap-2">
                    {t.latencyMs != null && (
                      <span className="text-xs text-muted-foreground">{formatNumber(t.latencyMs)} ms</span>
                    )}
                    <Badge variant={t.level === 'error' ? 'destructive' : 'outline'}>{t.level}</Badge>
                  </div>
                </div>
                {t.payload != null && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(t.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
