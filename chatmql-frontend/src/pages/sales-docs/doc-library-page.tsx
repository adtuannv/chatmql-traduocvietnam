/**
 * doc-library-page.tsx — Thư viện tài liệu bán hàng.
 *
 * Admin tự dựng cây thư mục và nạp tài nguyên: ảnh, video, pdf, tài liệu, văn
 * bản, hoặc chỉ một đường dẫn. Mỗi tài nguyên gắn được nhiều MÃ sản phẩm (hoặc
 * không mã nào — biểu giá, ảnh xưởng, banner chiến dịch).
 *
 * `visibility` quyết định tài nguyên có được gửi ra khách không; backend chặn
 * theo cờ này chứ không chỉ nhắc trong prompt AI.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft, ChevronDown, ChevronUp, FileText, Film, Folder, FolderPlus, Image as ImageIcon, Link2,
  Package, Pencil, Plus, Search, Trash2, Type,
} from 'lucide-react'
import { ErrorState, Loading } from '@/components/shared/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useMyPermissions } from '@/hooks/use-settings'
import {
  KIND_LABELS, VISIBILITY_LABELS, assetUrl,
  useDeleteDocAsset, useDeleteDocFolder, useDocAssets, useDocFolders, useSaveDocFolder,
  type AssetKind, type DocAsset, type DocFolder,
} from '@/hooks/use-doc-library'
import { DocAssetDialog } from './doc-asset-dialog'
import { DocFolderDialog } from './doc-folder-dialog'
import { DocAssetDetailDialog } from './doc-asset-detail-dialog'

const ALL = '__all__'
const UNFILED = '__unfiled__'

const KIND_ICON: Record<AssetKind, typeof ImageIcon> = {
  product: Package,
  image: ImageIcon, video: Film, pdf: FileText, doc: FileText, text: Type, link: Link2,
}

function formatSize(n: number | null): string {
  if (!n) return ''
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

/** Cây thư mục phẳng hoá kèm độ sâu để thụt lề. */
function flatten(folders: DocFolder[]): Array<DocFolder & { depth: number }> {
  const byParent = new Map<string | null, DocFolder[]>()
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? []
    arr.push(f)
    byParent.set(f.parentId, arr)
  }
  const out: Array<DocFolder & { depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const f of (byParent.get(parentId) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
      out.push({ ...f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  // Thư mục mồ côi (cha đã xoá) vẫn phải hiện, không được "mất" tài nguyên.
  const seen = new Set(out.map((f) => f.id))
  for (const f of folders) if (!seen.has(f.id)) out.push({ ...f, depth: 0 })
  return out
}

export function DocLibraryPage() {
  const permsQ = useMyPermissions()
  const canEdit = permsQ.data?.has('products.update') ?? false

  const foldersQ = useDocFolders()
  const [folderId, setFolderId] = useState<string>(ALL)
  const [kind, setKind] = useState<string>(ALL)
  const [q, setQ] = useState('')
  const [assetOpen, setAssetOpen] = useState(false)
  const [editing, setEditing] = useState<DocAsset | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<DocFolder | null>(null)
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null)

  const assetsQ = useDocAssets({
    folderId: folderId === ALL || folderId === UNFILED ? undefined : folderId,
    unfiled: folderId === UNFILED,
    kind: kind === ALL ? undefined : (kind as AssetKind),
    q,
    pageSize: 100,
  })

  const folders = useMemo(() => flatten(foldersQ.data ?? []), [foldersQ.data])
  const assets = assetsQ.data?.items ?? []
  const totalAssets = (foldersQ.data ?? []).reduce((s, f) => s + f.assetCount, 0)

  const openNew = () => { setEditing(null); setAssetOpen(true) }
  const openEdit = (a: DocAsset) => { setEditing(a); setAssetOpen(true) }
  const openNewFolder = (parentId: string | null) => {
    setEditingFolder(null); setNewFolderParent(parentId); setFolderOpen(true)
  }
  const openEditFolder = (f: DocFolder) => {
    setEditingFolder(f); setNewFolderParent(null); setFolderOpen(true)
  }
  const navigate = useNavigate()


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tiêu đề, lối quay lại và nút thao tác trên CÙNG một hàng. Trước đây ba
          thứ này xếp thành ba tầng, ăn gần một phần ba chiều cao màn hình trước
          khi thấy được tài liệu nào. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Quay lại"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight">Thư viện tài liệu</h1>
          <p className="truncate text-xs text-muted-foreground">
            Ảnh, video, PDF, văn bản — nhân viên gửi khách, AI đọc khi tư vấn.
          </p>
        </div>
        {canEdit && (
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openNewFolder(null)}>
              <FolderPlus className="h-4 w-4" /> Thư mục mới
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openNew}><Plus className="h-4 w-4" /> Thêm tài nguyên</Button>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-5 pt-4 lg:grid-cols-[230px_1fr]">
        {/* Cây thư mục: cố định chỗ, dài quá thì tự cuộn trong cột — không đẩy
            cả trang dài ra rồi phải cuộn xuống mới thấy danh sách tài liệu. */}
        <aside className="space-y-1 lg:sticky lg:top-0 lg:max-h-[calc(100vh-11rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <FolderRow label="Tất cả tài nguyên" count={totalAssets} active={folderId === ALL} onClick={() => setFolderId(ALL)} />
          <FolderRow label="Chưa xếp thư mục" active={folderId === UNFILED} onClick={() => setFolderId(UNFILED)} />
          {foldersQ.isLoading ? (
            <Loading className="py-6" />
          ) : folders.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Chưa có thư mục nào.{canEdit ? ' Bấm "Thư mục mới" để tạo.' : ''}
            </p>
          ) : (
            folders.map((f) => (
              <FolderRow
                key={f.id}
                label={`${f.icon ? `${f.icon} ` : ''}${f.name}`}
                count={f.assetCount}
                depth={f.depth}
                visibility={f.visibility}
                active={folderId === f.id}
                onClick={() => setFolderId(f.id)}
                folder={canEdit ? f : undefined}
                siblings={folders.filter((x) => x.parentId === f.parentId)}
                onEdit={() => openEditFolder(f)}
                onAddChild={() => openNewFolder(f.id)}
              />
            ))
          )}
        </aside>

        {/* Danh sách tài nguyên */}
        <section className="min-w-0 space-y-3">
          {/* Ghim lại: cuộn danh sách dài mà mất ô tìm thì phải cuộn ngược lên
              đầu chỉ để gõ một từ. */}
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background px-1 pb-2 pt-0.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tiêu đề, mô tả, nội dung…" className="pl-9" />
            </div>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Loại" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tất cả loại</SelectItem>
                {(Object.keys(KIND_LABELS) as AssetKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {assetsQ.isLoading ? (
            <Loading className="py-16" />
          ) : assetsQ.error ? (
            <ErrorState message={apiError(assetsQ.error)} />
          ) : assets.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">Chưa có tài nguyên nào ở đây</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {canEdit ? 'Bấm "Thêm tài nguyên" để tải tệp lên hoặc dán đường dẫn.' : 'Liên hệ quản trị để bổ sung tài liệu.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {assets.map((a) => <AssetCard key={a.id} a={a} canEdit={canEdit} onEdit={() => openEdit(a)} />)}
            </div>
          )}

          {assets.length > 0 && (
            <p className="text-xs text-muted-foreground">{assetsQ.data?.meta.total ?? assets.length} tài nguyên</p>
          )}
        </section>
      </div>

      <DocFolderDialog
        folder={editingFolder}
        folders={foldersQ.data ?? []}
        defaultParentId={newFolderParent}
        open={folderOpen}
        onOpenChange={setFolderOpen}
      />

      <DocAssetDialog
        asset={editing}
        folders={foldersQ.data ?? []}
        defaultFolderId={folderId === ALL || folderId === UNFILED ? null : folderId}
        open={assetOpen}
        onOpenChange={setAssetOpen}
      />
    </div>
  )
}

function FolderRow({
  label, count, depth = 0, active, onClick, visibility, folder, siblings, onEdit, onAddChild,
}: {
  label: string
  count?: number
  depth?: number
  active: boolean
  onClick: () => void
  visibility?: string
  folder?: DocFolder
  /** Các thư mục cùng cấp (cùng cha) — dùng để đổi thứ tự lên/xuống. */
  siblings?: DocFolder[]
  onEdit?: () => void
  onAddChild?: () => void
}) {
  const del = useDeleteDocFolder()
  const save = useSaveDocFolder()

  /**
   * Đổi chỗ với thư mục liền kề CÙNG CẤP bằng cách hoán đổi `sortOrder`.
   * Khi nhiều thư mục cùng sortOrder (đều 0 lúc mới tạo) thì gán lại số thứ tự
   * theo vị trí hiện tại rồi mới hoán đổi, nếu không bấm sẽ không thấy đổi gì.
   */
  const move = (dir: -1 | 1) => {
    if (!folder || !siblings) return
    const ordered = [...siblings].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    const i = ordered.findIndex((f) => f.id === folder.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ordered.length) return

    const me = ordered[i]
    const other = ordered[j]
    save.mutate({ id: me.id, data: { sortOrder: j } })
    save.mutate({ id: other.id, data: { sortOrder: i } })
  }

  const ordered = siblings
    ? [...siblings].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    : []
  const idx = folder ? ordered.findIndex((f) => f.id === folder.id) : -1

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
        active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
      )}
      style={depth ? { paddingLeft: 8 + depth * 12 } : undefined}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {visibility === 'internal' && <Badge variant="outline" className="shrink-0 text-[9px]">Nội bộ</Badge>}
        {visibility === 'ai_only' && <Badge variant="outline" className="shrink-0 text-[9px]">AI</Badge>}
        {count != null && <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>}
      </button>

      {folder && (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            type="button" title="Lên" aria-label="Di chuyển lên"
            disabled={idx <= 0 || save.isPending}
            onClick={() => move(-1)}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" title="Xuống" aria-label="Di chuyển xuống"
            disabled={idx < 0 || idx >= ordered.length - 1 || save.isPending}
            onClick={() => move(1)}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" title="Thêm thư mục con" aria-label="Thêm thư mục con"
            onClick={onAddChild}
            className="text-muted-foreground hover:text-primary"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button" title="Sửa thư mục" aria-label="Sửa thư mục"
            onClick={onEdit}
            className="text-muted-foreground hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Xoá thư mục (tài nguyên bên trong vẫn giữ)"
            aria-label="Xoá thư mục"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (!confirm(`Xoá thư mục "${folder.name}"? Tài nguyên bên trong sẽ chuyển về mục "Chưa xếp thư mục".`)) return
              del.mutate(folder.id, {
                onSuccess: () => toast.success('Đã xoá thư mục'),
                onError: (e) => toast.error(apiError(e)),
              })
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function AssetCard({ a, canEdit, onEdit }: { a: DocAsset; canEdit: boolean; onEdit: () => void }) {
  const del = useDeleteDocAsset()
  const [detailOpen, setDetailOpen] = useState(false)
  const Icon = KIND_ICON[a.kind] ?? FileText
  const src = a.kind === 'product'
    ? assetUrl(a.images?.[0])
    : a.kind === 'image' ? assetUrl(a.thumbUrl || a.fileUrl) : undefined
  const href = assetUrl(a.fileUrl) ?? a.sourceUrl ?? undefined

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="relative aspect-[4/3] bg-muted">
        {src ? (
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <Icon className="h-7 w-7" />
            <span className="text-[10px]">{KIND_LABELS[a.kind]}</span>
          </div>
        )}
        {a.visibility !== 'sales' && (
          <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
            {VISIBILITY_LABELS[a.visibility]}
          </span>
        )}
        {canEdit && (
          <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
            <button
              type="button" onClick={onEdit} aria-label="Sửa"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-background/90 shadow hover:text-primary"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button" aria-label="Xoá"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-background/90 shadow hover:text-destructive"
              onClick={() => {
                if (!confirm(`Xoá "${a.title}"?`)) return
                del.mutate(a.id, {
                  onSuccess: () => toast.success('Đã xoá'),
                  onError: (e) => toast.error(apiError(e)),
                })
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1 p-2.5">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="line-clamp-2 text-left text-sm font-medium leading-snug hover:text-primary hover:underline"
        >
          {a.title}
        </button>
        {a.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{a.description}</p>}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {a.productCodes.slice(0, 3).map((c) => (
            <span key={c} className="rounded bg-muted px-1 font-mono text-[9.5px]">{c}</span>
          ))}
          {a.productCodes.length > 3 && <span className="text-[9.5px] text-muted-foreground">+{a.productCodes.length - 3}</span>}
          {a.fileSize ? <span className="ml-auto text-[9.5px] text-muted-foreground">{formatSize(a.fileSize)}</span> : null}
        </div>
      </div>
    </div>
  )
}
