/**
 * ai-bots-tab.tsx — Tab "Đội AI": danh sách bot (card kiểu GenAI). Bấm card
 * hoặc "Thêm bot" sẽ mở màn TRAIN AI độc lập (/ai/train/:botId) — trái là
 * prompt, giữa là cấu hình & kiến thức, phải là chat thử.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Plus, GraduationCap, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch, Separator } from '@/components/ui/misc'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { aiKeys, useAiBots, createAiBot, updateAiBot, deleteAiBot } from '@/hooks/use-ai'
import { useZaloAccounts } from '@/hooks/use-integrations'

const DEFAULT_EMOJI = '🤖'

export function AiBotsTab({ canEdit }: { canEdit: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading, isError } = useAiBots()
  // Backend TDVN không có /ai/channel-overrides — lấy kênh từ /zalo-accounts.
  // KHÔNG lọc `connectedOnly` vì còn phải tra tên cho kênh đã gán mà đang rớt kết nối.
  const { data: channelAccounts } = useZaloAccounts()
  const [creating, setCreating] = useState(false)

  if (isLoading) return <Loading label="Đang tải đội AI..." />
  if (isError || !data) return <ErrorState message="Không tải được danh sách AI bot." />

  const bots = data.bots
  const channels = channelAccounts ?? []
  const channelName = (id: string) => channels.find((c) => c.id === id)?.displayName || 'Kênh đã gỡ'

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await createAiBot({ name: `Bot mới ${bots.length + 1}`, avatarEmoji: DEFAULT_EMOJI, enabled: true })
      await qc.invalidateQueries({ queryKey: aiKeys.bots })
      navigate(`/ai/train/${res.bot.id}`)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setCreating(false)
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    try {
      await updateAiBot(id, { enabled })
      await qc.invalidateQueries({ queryKey: aiKeys.bots })
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Xoá bot "${name}"? Kênh đang gán sẽ quay về cấu hình chung.`)) return
    try {
      await deleteAiBot(id)
      await qc.invalidateQueries({ queryKey: aiKeys.bots })
      toast.success('Đã xoá bot')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Mỗi bot là một "con AI" được train riêng — prompt, model, công cụ và kênh riêng. Kênh chưa gán bot dùng cấu hình chung.
          <br />
          <span className="font-medium text-foreground">
            Kho tri thức, kịch bản và tài liệu logic dùng CHUNG cho mọi Agent; chỉ persona, playbook, model và kênh là riêng.
          </span>
        </p>
        <Button onClick={handleCreate} disabled={!canEdit || creating}>
          <Plus className="h-4 w-4" /> {creating ? 'Đang tạo...' : 'Thêm bot'}
        </Button>
      </div>

      {bots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Bot className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Chưa có bot nào</p>
            <p className="text-xs text-muted-foreground">Tạo bot đầu tiên để train AI riêng cho từng kênh/nghiệp vụ.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => (
            <Card
              key={bot.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/ai/train/${bot.id}`)}
            >
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-2xl">
                    {bot.avatarEmoji || DEFAULT_EMOJI}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${bot.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="truncate text-sm font-semibold">{bot.name}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {bot.description || 'Chưa có mô tả'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={bot.enabled}
                      onCheckedChange={(v) => void toggleEnabled(bot.id, v)}
                      disabled={!canEdit}
                    />
                    <Button
                      variant="ghost" size="icon" title="Xoá bot" disabled={!canEdit}
                      onClick={() => void handleDelete(bot.id, bot.name)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Text Model</span>
                    <span className="font-medium">
                      {bot.provider ? `${bot.provider} · ${bot.model || 'mặc định'}` : 'Theo cấu hình chung'}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Kênh áp dụng</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {bot.channelAccountIds.length === 0 ? (
                        <span className="text-muted-foreground">Chưa gán</span>
                      ) : (
                        bot.channelAccountIds.map((id) => (
                          <Badge key={id} variant="outline" className="max-w-36 truncate">{channelName(id)}</Badge>
                        ))
                      )}
                    </span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full">
                  <GraduationCap className="h-4 w-4" /> Train AI
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
