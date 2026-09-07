import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  Save,
  Zap,
  GitBranch,
  Clock,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Loading } from '@/components/shared/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiError } from '@/lib/api-client'
import {
  LIFECYCLE_STAGES,
  STAGE_LABELS,
} from '@/hooks/use-contacts'
import {
  TRIGGERS,
  triggerLabel,
  ACTION_TYPES,
  actionLabel,
  CONDITION_OPS,
  CONDITION_OP_LABELS,
  DELAY_UNITS,
  DELAY_UNIT_LABELS,
  genNodeId,
  useAutomationRule,
  useUpdateRule,
  type FlowConfig,
  type FlowNode,
  type FlowEdge,
} from '@/hooks/use-automation'

// ─── Kiểu dữ liệu node trên canvas ────────────────────────────────────

type BlockKind = 'trigger' | 'action' | 'condition' | 'delay'

interface BlockData extends Record<string, unknown> {
  kind: BlockKind
  label: string
  triggerType?: string
  actionType?: string
  status: 'active' | 'wip' | 'disabled'
  config: Record<string, unknown>
}

type BlockNode = Node<BlockData>

interface ConditionRule {
  field: string
  op: string
  value: string
}

// ─── Node components (custom) ─────────────────────────────────────────

const HANDLE_CLASS = '!h-2.5 !w-2.5 !border-2 !border-background !bg-primary'

function BlockShell({
  icon,
  badge,
  title,
  subtitle,
  selected,
}: {
  icon: React.ReactNode
  badge: string
  title: string
  subtitle?: string
  selected?: boolean
}) {
  return (
    <div
      className={`w-56 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-shadow ${
        selected ? 'ring-2 ring-ring' : ''
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {badge}
      </div>
      <p className="truncate text-sm font-medium text-card-foreground">{title}</p>
      {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as BlockData
  return (
    <>
      <BlockShell
        icon={<Zap className="h-3 w-3" />}
        badge="Kích hoạt"
        title={d.label}
        subtitle={triggerLabel(d.triggerType)}
        selected={selected}
      />
      <Handle type="source" position={Position.Bottom} className={HANDLE_CLASS} />
    </>
  )
}

function ActionNode({ data, selected }: NodeProps) {
  const d = data as BlockData
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_CLASS} />
      <BlockShell
        icon={<Play className="h-3 w-3" />}
        badge="Hành động"
        title={d.label}
        subtitle={actionLabel(d.actionType)}
        selected={selected}
      />
      <Handle type="source" position={Position.Bottom} className={HANDLE_CLASS} />
    </>
  )
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as BlockData
  const rules = (d.config?.rules as ConditionRule[]) ?? []
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_CLASS} />
      <BlockShell
        icon={<GitBranch className="h-3 w-3" />}
        badge="Điều kiện"
        title={d.label}
        subtitle={`${rules.length} quy tắc`}
        selected={selected}
      />
      <div className="pointer-events-none flex justify-between px-2 pt-0.5 text-[10px] font-medium">
        <span className="text-success">Đúng</span>
        <span className="text-destructive">Sai</span>
      </div>
      <Handle
        id="true"
        type="source"
        position={Position.Bottom}
        style={{ left: '25%' }}
        className={HANDLE_CLASS}
      />
      <Handle
        id="false"
        type="source"
        position={Position.Bottom}
        style={{ left: '75%' }}
        className={HANDLE_CLASS}
      />
    </>
  )
}

function DelayNode({ data, selected }: NodeProps) {
  const d = data as BlockData
  const dur = d.config?.duration
  const unit = d.config?.unit as string | undefined
  return (
    <>
      <Handle type="target" position={Position.Top} className={HANDLE_CLASS} />
      <BlockShell
        icon={<Clock className="h-3 w-3" />}
        badge="Chờ"
        title={d.label}
        subtitle={dur != null ? `${dur} ${DELAY_UNIT_LABELS[unit ?? 'seconds'] ?? unit}` : undefined}
        selected={selected}
      />
      <Handle type="source" position={Position.Bottom} className={HANDLE_CLASS} />
    </>
  )
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  delay: DelayNode,
}

// ─── Chuyển đổi flowConfig <-> React Flow ─────────────────────────────

function flowConfigToRF(fc: FlowConfig): { nodes: BlockNode[]; edges: Edge[] } {
  const nodes: BlockNode[] = []

  nodes.push({
    id: fc.trigger.id,
    type: 'trigger',
    position: fc.trigger.position ?? { x: 80, y: 40 },
    data: {
      kind: 'trigger',
      label: fc.trigger.label || triggerLabel(fc.trigger.type),
      triggerType: fc.trigger.type,
      status: 'active',
      config: fc.trigger.config ?? {},
    },
  })

  fc.nodes.forEach((n, i) => {
    nodes.push({
      id: n.id,
      type: n.type === 'note' ? 'action' : n.type,
      position: n.position ?? { x: 80 + (i % 2) * 300, y: 200 + i * 140 },
      data: {
        kind: (n.type === 'note' ? 'action' : n.type) as BlockKind,
        label: n.label,
        actionType: n.actionType,
        status: n.status ?? 'active',
        config: n.config ?? {},
      },
    })
  })

  const edges: Edge[] = fc.edges.map((e, i) => ({
    id: `e_${e.source}_${e.target}_${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.label === 'true' || e.label === 'false' ? e.label : undefined,
    label: e.label === 'true' ? 'Đúng' : e.label === 'false' ? 'Sai' : undefined,
  }))

  return { nodes, edges }
}

function rfToFlowConfig(nodes: BlockNode[], edges: Edge[], triggerFallback: string): FlowConfig {
  const triggerNode = nodes.find((n) => n.data.kind === 'trigger')
  const trigger = {
    id: triggerNode?.id ?? 'trigger',
    type: (triggerNode?.data.triggerType as string) ?? triggerFallback,
    label: triggerNode?.data.label ?? triggerLabel(triggerFallback),
    config: triggerNode?.data.config ?? {},
    position: triggerNode?.position ?? { x: 80, y: 40 },
  }

  const flowNodes: FlowNode[] = nodes
    .filter((n) => n.data.kind !== 'trigger')
    .map((n) => ({
      id: n.id,
      type: n.data.kind as FlowNode['type'],
      actionType: n.data.kind === 'action' ? n.data.actionType : undefined,
      label: n.data.label,
      config: n.data.config ?? {},
      status: n.data.status ?? 'active',
      position: n.position,
    }))

  const flowEdges: FlowEdge[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    label:
      e.sourceHandle === 'true' || e.sourceHandle === 'false'
        ? e.sourceHandle
        : undefined,
  }))

  return { version: '2', trigger, nodes: flowNodes, edges: flowEdges }
}

// ─── Trang chính ──────────────────────────────────────────────────────

export function AutomationFlowPage() {
  return (
    <ReactFlowProvider>
      <FlowEditor />
    </ReactFlowProvider>
  )
}

function FlowEditor() {
  const { ruleId } = useParams<{ ruleId: string }>()
  const navigate = useNavigate()
  const { data: rule, isLoading } = useAutomationRule(ruleId)
  const updateRule = useUpdateRule()

  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const initialized = useRef(false)

  // Khởi tạo canvas từ rule (hoặc canvas trống với 1 trigger)
  useEffect(() => {
    if (!rule || initialized.current) return
    initialized.current = true
    const fc =
      rule.flowConfig && rule.flowConfig.trigger
        ? rule.flowConfig
        : {
            version: '2',
            trigger: {
              id: 'trigger',
              type: rule.trigger,
              label: triggerLabel(rule.trigger),
              config: {},
              position: { x: 80, y: 40 },
            },
            nodes: [],
            edges: [],
          }
    const { nodes: n, edges: e } = flowConfigToRF(fc as FlowConfig)
    setNodes(n)
    setEdges(e)
  }, [rule, setNodes, setEdges])

  const onConnect = useCallback(
    (params: Connection) => {
      const label =
        params.sourceHandle === 'true'
          ? 'Đúng'
          : params.sourceHandle === 'false'
            ? 'Sai'
            : undefined
      setEdges((eds) => addEdge({ ...params, label }, eds))
    },
    [setEdges],
  )

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const updateNodeData = useCallback(
    (id: string, patch: Partial<BlockData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      )
    },
    [setNodes],
  )

  const updateNodeConfig = useCallback(
    (id: string, configPatch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, config: { ...n.data.config, ...configPatch } } }
            : n,
        ),
      )
    },
    [setNodes],
  )

  const addBlock = useCallback(
    (kind: Exclude<BlockKind, 'trigger'>) => {
      const id = genNodeId(kind)
      const y = 200 + nodes.length * 40
      const base: BlockData =
        kind === 'action'
          ? { kind, label: 'Gửi tin nhắn', actionType: 'send_message', status: 'active', config: {} }
          : kind === 'condition'
            ? {
                kind,
                label: 'Điều kiện mới',
                status: 'active',
                config: { logic: 'and', rules: [] },
              }
            : { kind, label: 'Chờ', status: 'active', config: { duration: 5, unit: 'minutes' } }
      const newNode: BlockNode = {
        id,
        type: kind,
        position: { x: 380, y },
        data: base,
      }
      setNodes((nds) => [...nds, newNode])
      setSelectedId(id)
    },
    [nodes.length, setNodes],
  )

  const deleteSelected = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind === 'trigger') return
    const id = selectedNode.id
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    setSelectedId(null)
  }, [selectedNode, setNodes, setEdges])

  const handleSave = useCallback(async () => {
    if (!ruleId || !rule) return
    const flowConfig = rfToFlowConfig(nodes as BlockNode[], edges, rule.trigger)
    try {
      await updateRule.mutateAsync({
        id: ruleId,
        data: { flowVersion: 2, flowConfig },
      })
      toast.success('Đã lưu flow')
    } catch (err) {
      toast.error(apiError(err))
    }
  }, [ruleId, rule, nodes, edges, updateRule])

  if (isLoading) return <Loading label="Đang tải flow..." />

  if (!rule) {
    return (
      <div className="space-y-6">
        <PageHeader title="Không tìm thấy quy tắc" />
        <Button variant="outline" onClick={() => navigate('/automation')}>
          <ArrowLeft className="h-4 w-4" />
          Về danh sách
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Flow: ${rule.name}`}
        description={`Kích hoạt bởi: ${triggerLabel(rule.trigger)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/automation')}>
              <ArrowLeft className="h-4 w-4" />
              Danh sách
            </Button>
            <Button onClick={handleSave} disabled={updateRule.isPending}>
              <Save className="h-4 w-4" />
              {updateRule.isPending ? 'Đang lưu...' : 'Lưu flow'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Thêm khối:</span>
        <Button variant="outline" size="sm" onClick={() => addBlock('condition')}>
          <GitBranch className="h-4 w-4" />
          Điều kiện
        </Button>
        <Button variant="outline" size="sm" onClick={() => addBlock('action')}>
          <Play className="h-4 w-4" />
          Hành động
        </Button>
        <Button variant="outline" size="sm" onClick={() => addBlock('delay')}>
          <Clock className="h-4 w-4" />
          Chờ
        </Button>
      </div>

      <div className="flex gap-4">
        <div
          className="h-[600px] flex-1 overflow-hidden rounded-xl border"
          style={{ minWidth: 0 }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            onLabel={(label) => updateNodeData(selectedNode.id, { label })}
            onTriggerType={(triggerType) =>
              updateNodeData(selectedNode.id, {
                triggerType,
                label: triggerLabel(triggerType),
              })
            }
            onActionType={(actionType) =>
              updateNodeData(selectedNode.id, {
                actionType,
                label: actionLabel(actionType),
                config: {},
              })
            }
            onConfig={(patch) => updateNodeConfig(selectedNode.id, patch)}
            onDelete={deleteSelected}
          />
        )}
      </div>
    </div>
  )
}

// ─── Panel cấu hình node ──────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onClose,
  onLabel,
  onTriggerType,
  onActionType,
  onConfig,
  onDelete,
}: {
  node: BlockNode
  onClose: () => void
  onLabel: (v: string) => void
  onTriggerType: (v: string) => void
  onActionType: (v: string) => void
  onConfig: (patch: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const d = node.data
  const cfg = d.config ?? {}

  return (
    <div className="w-80 shrink-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Cấu hình khối</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Đóng">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label>Tên hiển thị</Label>
        <Input value={d.label} onChange={(e) => onLabel(e.target.value)} />
      </div>

      {d.kind === 'trigger' && (
        <div className="space-y-1.5">
          <Label>Sự kiện kích hoạt</Label>
          <Select value={d.triggerType} onValueChange={onTriggerType}>
            <SelectTrigger>
              <SelectValue />
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
      )}

      {d.kind === 'action' && (
        <>
          <div className="space-y-1.5">
            <Label>Loại hành động</Label>
            <Select value={d.actionType} onValueChange={onActionType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {actionLabel(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ActionConfigFields actionType={d.actionType} config={cfg} onConfig={onConfig} />
        </>
      )}

      {d.kind === 'condition' && (
        <ConditionConfigFields config={cfg} onConfig={onConfig} />
      )}

      {d.kind === 'delay' && <DelayConfigFields config={cfg} onConfig={onConfig} />}

      {d.kind !== 'trigger' && (
        <Button variant="destructive" className="w-full" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          Xóa khối này
        </Button>
      )}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: unknown
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function ActionConfigFields({
  actionType,
  config,
  onConfig,
}: {
  actionType?: string
  config: Record<string, unknown>
  onConfig: (patch: Record<string, unknown>) => void
}) {
  switch (actionType) {
    case 'send_message':
      return (
        <div className="space-y-1.5">
          <Label>Nội dung tin nhắn</Label>
          <Textarea
            value={(config.text as string) ?? ''}
            onChange={(e) => onConfig({ text: e.target.value })}
            placeholder="Xin chào {{contact.fullName}}..."
          />
        </div>
      )
    case 'send_notification':
      return (
        <div className="space-y-1.5">
          <Label>Nội dung thông báo</Label>
          <Textarea
            value={(config.message as string) ?? ''}
            onChange={(e) => onConfig({ message: e.target.value })}
          />
        </div>
      )
    case 'send_template':
    case 'send_zalo_zns':
      return (
        <TextField
          label="Mã mẫu tin (templateId)"
          value={config.templateId}
          onChange={(v) => onConfig({ templateId: v })}
        />
      )
    case 'add_tag':
    case 'remove_tag':
      return (
        <TextField
          label="Nhãn"
          value={config.tag}
          onChange={(v) => onConfig({ tag: v })}
          placeholder="vd: vip"
        />
      )
    case 'change_status':
    case 'update_lifecycle':
      return (
        <div className="space-y-1.5">
          <Label>Giai đoạn vòng đời</Label>
          <Select
            value={(config.lifecycleStage as string) ?? ''}
            onValueChange={(v) => onConfig({ lifecycleStage: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Chọn giai đoạn" />
            </SelectTrigger>
            <SelectContent>
              {LIFECYCLE_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'assign_agent':
      return (
        <TextField
          label="Mã nhân viên (userId)"
          value={config.userId}
          onChange={(v) => onConfig({ userId: v })}
        />
      )
    case 'create_appointment':
      return (
        <>
          <TextField
            label="Tiêu đề lịch hẹn"
            value={config.title}
            onChange={(v) => onConfig({ title: v })}
          />
          <TextField
            label="Sau (giờ)"
            type="number"
            value={config.offsetHours}
            onChange={(v) => onConfig({ offsetHours: Number(v) || 0 })}
          />
        </>
      )
    case 'update_property':
    case 'increment_property':
      return (
        <>
          <TextField
            label="Khóa thuộc tính"
            value={config.key}
            onChange={(v) => onConfig({ key: v })}
          />
          <TextField
            label="Giá trị"
            value={config.value}
            onChange={(v) => onConfig({ value: v })}
          />
        </>
      )
    case 'track_event':
      return (
        <>
          <TextField
            label="Tên sự kiện"
            value={config.eventName}
            onChange={(v) => onConfig({ eventName: v })}
          />
          <TextField
            label="Giá trị sự kiện"
            value={config.eventValue}
            onChange={(v) => onConfig({ eventValue: v })}
          />
        </>
      )
    default:
      return (
        <p className="text-xs text-muted-foreground">
          Hành động này không cần cấu hình bổ sung.
        </p>
      )
  }
}

function ConditionConfigFields({
  config,
  onConfig,
}: {
  config: Record<string, unknown>
  onConfig: (patch: Record<string, unknown>) => void
}) {
  const rules = (config.rules as ConditionRule[]) ?? []
  const logic = (config.logic as string) ?? 'and'

  function setRule(i: number, patch: Partial<ConditionRule>) {
    const next = rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onConfig({ rules: next })
  }
  function addRule() {
    onConfig({ rules: [...rules, { field: 'contact.lifecycleStage', op: 'eq', value: '' }] })
  }
  function removeRule(i: number) {
    onConfig({ rules: rules.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Logic kết hợp</Label>
        <Select value={logic} onValueChange={(v) => onConfig({ logic: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">TẤT CẢ điều kiện (AND)</SelectItem>
            <SelectItem value="or">BẤT KỲ điều kiện (OR)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Điều kiện</Label>
          <Button variant="ghost" size="sm" onClick={addRule}>
            <Plus className="h-3.5 w-3.5" />
            Thêm
          </Button>
        </div>
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground">Chưa có điều kiện nào.</p>
        )}
        {rules.map((r, i) => {
          const noValue = r.op === 'exists' || r.op === 'not_exists'
          return (
            <div key={i} className="space-y-1.5 rounded-lg border p-2">
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8"
                  value={r.field}
                  onChange={(e) => setRule(i, { field: e.target.value })}
                  placeholder="contact.lifecycleStage"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive"
                  onClick={() => removeRule(i)}
                  aria-label="Xóa điều kiện"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Select value={r.op} onValueChange={(v) => setRule(i, { op: v })}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {CONDITION_OP_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!noValue && (
                  <Input
                    className="h-8"
                    value={r.value}
                    onChange={(e) => setRule(i, { value: e.target.value })}
                    placeholder="Giá trị"
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DelayConfigFields({
  config,
  onConfig,
}: {
  config: Record<string, unknown>
  onConfig: (patch: Record<string, unknown>) => void
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1.5">
        <Label>Thời lượng</Label>
        <Input
          type="number"
          min={0}
          value={(config.duration as number) ?? 0}
          onChange={(e) => onConfig({ duration: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="flex-1 space-y-1.5">
        <Label>Đơn vị</Label>
        <Select
          value={(config.unit as string) ?? 'minutes'}
          onValueChange={(v) => onConfig({ unit: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DELAY_UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {DELAY_UNIT_LABELS[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
