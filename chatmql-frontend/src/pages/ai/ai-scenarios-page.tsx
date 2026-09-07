/**
 * AiScenariosPage — Quản lý kịch bản AI (route mong muốn: /ai/scenarios).
 * CRUD scenarios: key, name, description, content, loadMode, priority, enabled.
 * Đọc: mọi user. Ghi (tạo/sửa/xoá): owner/admin.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Save, Workflow } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch, Textarea } from '@/components/ui/misc'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { apiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  aiKeys, useAiScenarios, fetchScenario, createScenario, updateScenario, deleteScenario,
  type ScenarioMeta, type ScenarioInput,
} from '@/hooks/use-ai'

const LOAD_MODE_LABEL: Record<string, string> = {
  always: 'Luôn tải',
  auto: 'Tự động',
}

const EMPTY: ScenarioInput = {
  key: '', name: '', description: '', content: '',
  loadMode: 'auto', priority: 0, enabled: true,
}

export function AiScenariosPage() {
  const role = useAuthStore((s) => s.user?.role)
  const canEdit = role === 'owner' || role === 'admin'
  const qc = useQueryClient()
  const { data, isLoading, isError } = useAiScenarios()

  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [form, setForm] = useState<ScenarioInput>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ScenarioMeta | null>(null)

  const set = <K extends keyof ScenarioInput>(k: K, v: ScenarioInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function openCreate() {
    setForm(EMPTY)
    setEditing({ id: null })
  }

  async function openEdit(row: ScenarioMeta) {
    try {
      const { scenario } = await fetchScenario(row.id)
      setForm({
        key: scenario.key,
        name: scenario.name,
        description: scenario.description,
        content: scenario.content,
        loadMode: scenario.loadMode,
        triggerHints: scenario.triggerHints,
        priority: scenario.priority,
        enabled: scenario.enabled,
      })
      setEditing({ id: row.id })
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.description.trim() || !form.content.trim()) {
      toast.error('Tên, mô tả và nội dung là bắt buộc')
      return
    }
    setSaving(true)
    try {
      if (editing?.id) {
        await updateScenario(editing.id, form)
        toast.success('Đã cập nhật kịch bản')
      } else {
        await createScenario(form)
        toast.success('Đã tạo kịch bản')
      }
      await qc.invalidateQueries({ queryKey: aiKeys.scenarios })
      setEditing(null)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(row: ScenarioMeta, enabled: boolean) {
    try {
      await updateScenario(row.id, { enabled })
      await qc.invalidateQueries({ queryKey: aiKeys.scenarios })
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await deleteScenario(confirmDelete.id)
      await qc.invalidateQueries({ queryKey: aiKeys.scenarios })
      toast.success('Đã xoá kịch bản')
      setConfirmDelete(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const cols: Column<ScenarioMeta>[] = [
    {
      key: 'name', header: 'Kịch bản',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>
        </div>
      ),
    },
    { key: 'key', header: 'Key', cell: (r) => <code className="text-xs text-muted-foreground">{r.key}</code> },
    {
      key: 'loadMode', header: 'Chế độ tải',
      cell: (r) => <Badge variant="outline">{LOAD_MODE_LABEL[r.loadMode] ?? r.loadMode}</Badge>,
    },
    { key: 'priority', header: 'Ưu tiên', align: 'right', cell: (r) => r.priority },
    {
      key: 'enabled', header: 'Bật', align: 'center',
      cell: (r) => (
        <Switch checked={r.enabled} onCheckedChange={(v) => handleToggle(r, v)} disabled={!canEdit} />
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Sửa">
            <Pencil className="h-4 w-4" />
          </Button>
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(r)} title="Xoá">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kịch bản AI"
        description="Các khối logic (skill) được nạp vào phản hồi của AI."
        actions={
          canEdit ? (
            <Button onClick={openCreate}><Plus className="h-4 w-4" /> Thêm kịch bản</Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isError ? (
            <DataTable columns={cols} rows={[]} rowKey={(r) => r.id} emptyTitle="Không tải được danh sách kịch bản" />
          ) : (
            <DataTable
              columns={cols} rows={data?.scenarios ?? []} rowKey={(r) => r.id}
              loading={isLoading} emptyTitle="Chưa có kịch bản nào"
            />
          )}
        </CardContent>
      </Card>

      {/* Dialog tạo/sửa */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-primary" />
              {editing?.id ? 'Sửa kịch bản' : 'Thêm kịch bản'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Tên *</Label>
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!canEdit} />
              </div>
              <div className="grid gap-2">
                <Label>Key</Label>
                <Input
                  value={form.key ?? ''} onChange={(e) => set('key', e.target.value)}
                  placeholder="tự sinh nếu để trống" disabled={!canEdit || !!editing?.id}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Mô tả *</Label>
              <Input value={form.description} onChange={(e) => set('description', e.target.value)} disabled={!canEdit} />
            </div>
            <div className="grid gap-2">
              <Label>Nội dung *</Label>
              <Textarea
                className="min-h-[160px] font-mono text-xs"
                value={form.content} onChange={(e) => set('content', e.target.value)} disabled={!canEdit}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Chế độ tải</Label>
                <Select value={form.loadMode} onValueChange={(v) => set('loadMode', v)} disabled={!canEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">Luôn tải</SelectItem>
                    <SelectItem value="auto">Tự động</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Ưu tiên</Label>
                <Input
                  type="number" value={form.priority ?? 0}
                  onChange={(e) => set('priority', Number(e.target.value))} disabled={!canEdit}
                />
              </div>
              <div className="grid gap-2">
                <Label>Bật</Label>
                <div className="flex h-9 items-center">
                  <Switch checked={form.enabled ?? true} onCheckedChange={(v) => set('enabled', v)} disabled={!canEdit} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Huỷ</Button>
            {canEdit && (
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu...' : 'Lưu'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận xoá */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xoá kịch bản?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bạn có chắc muốn xoá kịch bản <b className="text-foreground">{confirmDelete?.name}</b>? Hành động này không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Huỷ</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" /> Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
