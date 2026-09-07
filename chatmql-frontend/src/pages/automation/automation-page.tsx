import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Workflow, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/misc'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { formatNumber } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import {
  TRIGGERS,
  triggerLabel,
  ruleStatusVariant,
  useAutomationRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  emptyFlowConfig,
  type AutomationRule,
} from '@/hooks/use-automation'

export function AutomationPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useAutomationRules()
  const createRule = useCreateRule()
  const updateRule = useUpdateRule()
  const deleteRule = useDeleteRule()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<string>(TRIGGERS[0])
  const [priority, setPriority] = useState('0')
  const [visualFlow, setVisualFlow] = useState(true)

  const [toDelete, setToDelete] = useState<AutomationRule | null>(null)

  const rules = data?.rules ?? []

  function resetForm() {
    setName('')
    setTrigger(TRIGGERS[0])
    setPriority('0')
    setVisualFlow(true)
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Vui lòng nhập tên quy tắc')
      return
    }
    try {
      const created = await createRule.mutateAsync({
        name: name.trim(),
        trigger,
        priority: Number(priority) || 0,
        enabled: true,
        ...(visualFlow
          ? { flowVersion: 2, flowConfig: emptyFlowConfig(trigger) }
          : {}),
      })
      toast.success('Đã tạo quy tắc tự động hóa')
      setCreateOpen(false)
      resetForm()
      if (visualFlow && created?.id) navigate(`/automation/flow/${created.id}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleToggle(rule: AutomationRule, enabled: boolean) {
    try {
      await updateRule.mutateAsync({ id: rule.id, data: { enabled } })
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    try {
      await deleteRule.mutateAsync(toDelete.id)
      toast.success('Đã xóa quy tắc')
      setToDelete(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const columns: Column<AutomationRule>[] = [
    {
      key: 'name',
      header: 'Quy tắc',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          {r.description && (
            <p className="truncate text-xs text-muted-foreground">{r.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'trigger',
      header: 'Kích hoạt bởi',
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{triggerLabel(r.trigger)}</span>
        </div>
      ),
    },
    {
      key: 'flowVersion',
      header: 'Loại',
      cell: (r) => (
        <Badge variant={r.flowVersion === 2 ? 'default' : 'outline'}>
          {r.flowVersion === 2 ? 'Flow trực quan' : 'Tuyến tính'}
        </Badge>
      ),
    },
    {
      key: 'runCount',
      header: 'Số lần chạy',
      align: 'right',
      cell: (r) => <span className="font-semibold tabular-nums">{formatNumber(r.runCount)}</span>,
    },
    {
      key: 'priority',
      header: 'Ưu tiên',
      align: 'right',
      cell: (r) => <span className="tabular-nums text-muted-foreground">{r.priority}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (r) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={r.enabled}
            onCheckedChange={(v) => handleToggle(r, v)}
            disabled={updateRule.isPending}
          />
          <Badge variant={ruleStatusVariant(r.enabled)}>
            {r.enabled ? 'Đang bật' : 'Đã tắt'}
          </Badge>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.flowVersion === 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/automation/flow/${r.id}`)}
            >
              <Workflow className="h-4 w-4" />
              Mở flow
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={() => setToDelete(r)}
            aria-label="Xóa quy tắc"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tự động hóa"
        description="Thiết lập quy tắc tự động phản hồi và chăm sóc khách hàng."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Tạo quy tắc
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={rules}
        loading={isLoading}
        rowKey={(r) => r.id}
        emptyTitle={isError ? 'Không tải được dữ liệu' : 'Chưa có quy tắc tự động hóa nào'}
      />

      {/* Dialog tạo quy tắc */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o)
          if (!o) resetForm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tạo quy tắc tự động hóa</DialogTitle>
            <DialogDescription>
              Đặt tên, chọn sự kiện kích hoạt và loại quy tắc.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">Tên quy tắc</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Chào mừng khách mới"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Kích hoạt bởi</Label>
              <Select value={trigger} onValueChange={setTrigger}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn sự kiện" />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {triggerLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-priority">Độ ưu tiên</Label>
              <Input
                id="rule-priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Flow trực quan</p>
                <p className="text-xs text-muted-foreground">
                  Dựng luồng kéo-thả bằng nhiều bước (điều kiện, chờ, hành động).
                </p>
              </div>
              <Switch checked={visualFlow} onCheckedChange={setVisualFlow} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleCreate} disabled={createRule.isPending}>
              {createRule.isPending ? 'Đang tạo...' : 'Tạo quy tắc'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận xóa */}
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa quy tắc?</DialogTitle>
            <DialogDescription>
              Bạn có chắc muốn xóa quy tắc "{toDelete?.name}"? Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteRule.isPending}
            >
              {deleteRule.isPending ? 'Đang xóa...' : 'Xóa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
