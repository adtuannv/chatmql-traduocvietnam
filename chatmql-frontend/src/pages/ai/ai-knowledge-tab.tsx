/**
 * ai-knowledge-tab.tsx — Tab "Knowledge" của module AI: KHO TRI THỨC CHUNG.
 *
 * - Trái: danh mục KB (tạo/sửa/xoá) — cũng là đơn vị cấp phát cho từng bot
 *   (màn Train AI chọn danh mục nào bot được tra cứu).
 * - Phải: danh sách tri thức + nút "Tạo knowledge" với các loại:
 *   Local File (.txt/.md đọc tại trình duyệt) · Google Sheets/Docs · Text ·
 *   Product (chọn từ DB sản phẩm, bật/tắt cho AI) · Website (sắp có) ·
 *   Table Data (dán CSV).
 *
 * Từng con AI KHÔNG giữ dữ liệu riêng — chúng gọi vào kho này qua công cụ
 * search_products/search_knowledge, giới hạn theo danh mục (guardrail).
 */
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Plus, Trash2, Save, Pencil, Search, FolderPlus, Database, RefreshCw, GraduationCap,
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
import { api, apiError } from '@/lib/api-client'
import {
  useKnowledgeEntries, useKnowledgeCategories, useDeleteKnowledgeEntry,
  useUpdateKnowledgeEntry, useCreateKnowledgeCategory, useUpdateKnowledgeCategory,
  useDeleteKnowledgeCategory, kbLabel,
  type KnowledgeEntry,
} from '@/hooks/use-knowledge'
import {
  useProducts, useUpdateProduct, useProductCategories, formatProductPrice,
} from '@/hooks/use-products'

// ══════════════════════ Tab chính ══════════════════════
export function AiKnowledgeTab({ canEdit }: { canEdit: boolean }) {
  const [categoryId, setCategoryId] = useState<string>('') // '' = tất cả
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null)

  const { data: cats, isLoading: catsLoading } = useKnowledgeCategories()
  const { data: entries, isLoading, isError } = useKnowledgeEntries(categoryId ? { categoryId } : {})
  const del = useDeleteKnowledgeEntry()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries ?? []
    return (entries ?? []).filter((e) =>
      (e.title ?? '').toLowerCase().includes(q) || e.content.toLowerCase().includes(q),
    )
  }, [entries, search])

  const catName = (id?: string | null) => (cats ?? []).find((c) => c.id === id)?.name

  async function handleDelete(e: KnowledgeEntry) {
    if (!window.confirm(`Xoá tri thức "${kbLabel(e)}"?`)) return
    try {
      await del.mutateAsync(e.id)
      toast.success('Đã xoá')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* ── Trái: danh mục KB ── */}
      <KbCategoryPanel
        canEdit={canEdit}
        selected={categoryId}
        onSelect={setCategoryId}
      />

      {/* ── Phải: kho tri thức ── */}
      <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Tìm trong kho tri thức..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {/* TDVN: tài liệu logic (persona, quy trình bán…) dạy AI — màn riêng */}
          <Button variant="outline" asChild>
            <Link to="/ai/logic-docs" title="Soạn tài liệu logic để huấn luyện AI">
              <GraduationCap className="h-4 w-4" /> Train AI (Logic docs)
            </Link>
          </Button>
          <Button onClick={() => setCreateOpen(true)} disabled={!canEdit}>
            <Plus className="h-4 w-4" /> Tạo knowledge
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Kho tri thức CHUNG của tổ chức — từng con AI gọi vào đây lấy dữ liệu liên quan (giới hạn theo danh mục cấp cho bot ở màn Train AI).
        </p>

        {isLoading ? (
          <Loading label="Đang tải kho tri thức..." />
        ) : isError ? (
          <ErrorState message="Không tải được kho tri thức." />
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {search ? 'Không có tri thức khớp tìm kiếm.' : 'Chưa có tri thức nào trong nhóm này — bấm "Tạo knowledge".'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((e) => (
              <div key={e.id} className="flex items-start gap-3 rounded-lg border px-3 py-2 hover:bg-muted/40">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setEditing(e)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{kbLabel(e)}</span>
                    <Badge variant="outline">{e.format === 'qa' ? 'FAQ' : 'Bài viết'}</Badge>
                    {e.status !== 'active' && <Badge variant="secondary">{e.status}</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{e.content}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {catName(e.categoryId) ?? 'Chưa gán danh mục'}
                  </p>
                </div>
                <Button variant="ghost" size="icon" title="Sửa" onClick={() => setEditing(e)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Xoá" disabled={!canEdit} onClick={() => void handleDelete(e)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen && <CreateKnowledgeDialog defaultCategoryId={categoryId} onClose={() => setCreateOpen(false)} />}
      {editing && <EditEntryDialog entry={editing} canEdit={canEdit} onClose={() => setEditing(null)} />}
      {catsLoading && null}
    </div>
  )
}

// ══════════════════════ Panel danh mục KB ══════════════════════
function KbCategoryPanel({ canEdit, selected, onSelect }: {
  canEdit: boolean
  selected: string
  onSelect: (id: string) => void
}) {
  const { data: cats, isLoading } = useKnowledgeCategories()
  const create = useCreateKnowledgeCategory()
  const update = useUpdateKnowledgeCategory()
  const remove = useDeleteKnowledgeCategory()

  async function handleAdd() {
    const name = window.prompt('Tên danh mục KB mới:')
    if (!name?.trim()) return
    try {
      await create.mutateAsync({ name: name.trim() })
      toast.success('Đã tạo danh mục')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleRename(id: string, cur: string) {
    const name = window.prompt('Đổi tên danh mục:', cur)
    if (!name?.trim() || name.trim() === cur) return
    try {
      await update.mutateAsync({ id, data: { name: name.trim() } })
      toast.success('Đã đổi tên')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleRemove(id: string, name: string) {
    if (!window.confirm(`Xoá danh mục "${name}"? Tri thức trong nhóm sẽ về "chưa gán danh mục".`)) return
    try {
      await remove.mutateAsync(id)
      if (selected === id) onSelect('')
      toast.success('Đã xoá danh mục')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="h-fit space-y-1 rounded-lg border bg-background p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-bold tracking-wide text-muted-foreground">DANH MỤC KB</p>
        <button
          type="button" title="Thêm danh mục" disabled={!canEdit}
          className="rounded p-0.5 text-primary hover:bg-primary/10"
          onClick={() => void handleAdd()}
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSelect('')}
        className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${selected === '' ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'}`}
      >
        📂 Tất cả tri thức
      </button>
      {isLoading ? (
        <Loading label="Đang tải..." />
      ) : (cats ?? []).map((c) => (
        <div key={c.id} className="group flex items-center">
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${selected === c.id ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'}`}
          >
            📁 {c.name}
          </button>
          <button type="button" title="Đổi tên" disabled={!canEdit} className="hidden rounded p-1 text-muted-foreground hover:bg-muted group-hover:block" onClick={() => void handleRename(c.id, c.name)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Xoá" disabled={!canEdit} className="hidden rounded p-1 text-destructive hover:bg-muted group-hover:block" onClick={() => void handleRemove(c.id, c.name)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted-foreground">
        Danh mục cũng là đơn vị cấp quyền tra cứu cho từng bot (màn Train AI → Nguồn tri thức).
      </p>
    </div>
  )
}

// ══════════════════════ Dialog sửa 1 tri thức ══════════════════════
function EditEntryDialog({ entry, canEdit, onClose }: {
  entry: KnowledgeEntry
  canEdit: boolean
  onClose: () => void
}) {
  const { data: cats } = useKnowledgeCategories()
  const update = useUpdateKnowledgeEntry()
  const [title, setTitle] = useState(entry.title ?? '')
  const [content, setContent] = useState(entry.content)
  const [categoryId, setCategoryId] = useState(entry.categoryId ?? '')
  const [keywords, setKeywords] = useState(entry.keywords ?? '')

  async function save() {
    try {
      await update.mutateAsync({
        id: entry.id,
        data: {
          title: title.trim() || null, content, keywords: keywords.trim() || null,
          categoryId: categoryId || null, changeNote: 'Sửa từ tab Knowledge (AI)',
        },
      })
      toast.success('Đã lưu tri thức (embedding cập nhật nền)')
      onClose()
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sửa tri thức</DialogTitle>
          <DialogDescription>{entry.format === 'qa' ? 'FAQ — title là câu hỏi' : 'Bài viết'} · trạng thái: {entry.status}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{entry.format === 'qa' ? 'Câu hỏi' : 'Tiêu đề (tuỳ chọn)'}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Nội dung</Label>
            <textarea className="min-h-48 w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none" value={content} onChange={(e) => setContent(e.target.value)} />
            {/* KB không bị cắt theo từng mục như persona — nó vào prompt dưới dạng
                đoạn trích khi truy hồi, chia chung một ngân sách mỗi lượt trả lời. */}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {content.length.toLocaleString('vi-VN')} ký tự — nội dung vào prompt dưới dạng đoạn trích khi
              được truy hồi, các mục chia chung ngân sách tri thức mỗi lượt trả lời.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Danh mục</Label>
              <Select value={categoryId || '__none__'} onValueChange={(v) => setCategoryId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không gán —</SelectItem>
                  {(cats ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Từ khoá (tăng recall)</Label>
              <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="cách hỏi khác, tên gọi khác..." />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          <Button onClick={() => void save()} disabled={!canEdit || update.isPending}>
            <Save className="h-4 w-4" /> Lưu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ══════════════════════ Dialog tạo knowledge (đủ loại) ══════════════════════
const MAPPING_PRESETS: Record<string, string> = {
  product: '{ "name": "Tên", "code": "Mã", "price": "Giá", "description": "Mô tả" }',
  knowledge: '{ "title": "Tiêu đề", "content": "Nội dung" }',
}

export function CreateKnowledgeDialog({ defaultCategoryId = '', onClose }: {
  defaultCategoryId?: string
  onClose: () => void
}) {
  const { data: kbCats } = useKnowledgeCategories()
  const { data: prodCats } = useProductCategories()
  const [type, setType] = useState<'file' | 'sheet' | 'text' | 'product' | 'website' | 'csv'>('text')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Text / File
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [categoryId, setCategoryId] = useState(defaultCategoryId)
  // Sheet / CSV
  const [importKind, setImportKind] = useState<'product' | 'knowledge'>('knowledge')
  const [sheetUrl, setSheetUrl] = useState('')
  const [csv, setCsv] = useState('')
  const [mapping, setMapping] = useState(MAPPING_PRESETS.knowledge)

  const importCats = importKind === 'product' ? (prodCats ?? []) : (kbCats ?? [])

  function readLocalFile(f: File) {
    if (!/\.(txt|md|markdown|csv)$/i.test(f.name)) {
      toast.error('Hiện hỗ trợ .txt / .md / .csv (PDF, DOCX cần bổ sung backend ingest)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      if (/\.csv$/i.test(f.name)) {
        setType('csv')
        setCsv(text)
        toast.success(`Đã đọc ${f.name} — chọn nơi import bên dưới`)
      } else {
        setTitle(f.name.replace(/\.(txt|md|markdown)$/i, ''))
        setContent(text)
        toast.success(`Đã đọc ${f.name} — kiểm tra rồi bấm Thêm`)
      }
    }
    reader.readAsText(f)
  }

  async function submit() {
    setBusy(true)
    try {
      if (type === 'text' || type === 'file') {
        if (!content.trim()) { toast.error('Chưa có nội dung'); return }
        await api.post('/knowledge', {
          type: 'description', format: 'article', risk: 'low', source: 'staff_manual',
          title: title.trim() || null,
          content: title.trim() ? `# ${title.trim()}\n\n${content.trim()}` : content.trim(),
          categoryId: categoryId || null,
        })
        toast.success('Đã thêm vào kho tri thức (embedding chạy nền)')
      } else if (type === 'sheet' || type === 'csv') {
        if (type === 'sheet' && !sheetUrl.trim()) { toast.error('Nhập link Google Sheet'); return }
        if (type === 'csv' && !csv.trim()) { toast.error('Dán dữ liệu CSV'); return }
        let mapObj: Record<string, string>
        try { mapObj = JSON.parse(mapping) } catch { toast.error('Mapping không phải JSON hợp lệ'); return }
        const { data } = await api.post('/product-knowledge/import', {
          kind: importKind,
          ...(type === 'sheet' ? { sheetUrl: sheetUrl.trim() } : { csv }),
          mapping: mapObj,
          categoryId: categoryId || undefined,
        })
        const r = data?.data ?? {}
        toast.success(`Import xong: ${r.created ?? 0} mới, ${r.updated ?? 0} cập nhật${r.skipped ? `, ${r.skipped} bỏ qua` : ''}`)
      }
      onClose()
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  const isImport = type === 'sheet' || type === 'csv'
  const isTextLike = type === 'text' || type === 'file'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm mới knowledge</DialogTitle>
          <DialogDescription>Tài nguyên lưu vào KHO TRI THỨC CHUNG (DB) và tự tạo embedding để mọi bot tra cứu được.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Loại Knowledge</Label>
            <Select value={type} onValueChange={(v) => {
              const t = v as typeof type
              setType(t)
              if (t === 'sheet' || t === 'csv') setMapping(MAPPING_PRESETS[importKind])
              if (t === 'file') setTimeout(() => fileRef.current?.click(), 50)
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="file">Local File (.txt / .md / .csv)</SelectItem>
                <SelectItem value="sheet">Google Sheets / Google Docs</SelectItem>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="product">Product (chọn từ DB sản phẩm)</SelectItem>
                <SelectItem value="website">Website (sắp có)</SelectItem>
                <SelectItem value="csv">Table Data (dán CSV)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <input
            ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readLocalFile(f); e.target.value = '' }}
          />

          {type === 'website' && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Website cần backend crawler (chưa có trong BE). Tạm thời copy nội dung trang vào loại <b>Text</b>.
            </p>
          )}

          {type === 'product' && <ProductPickerInline />}

          {type === 'file' && !content && !csv && (
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              📄 Chọn file .txt / .md / .csv từ máy
            </Button>
          )}

          {isImport && (
            <>
              <div>
                <Label>Import vào</Label>
                <Select value={importKind} onValueChange={(v) => { setImportKind(v as 'product' | 'knowledge'); setMapping(MAPPING_PRESETS[v]); setCategoryId('') }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="knowledge">Kho tri thức</SelectItem>
                    <SelectItem value="product">Kho sản phẩm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {type === 'sheet' && (
                <div>
                  <Label>Link Google Sheet (công khai / anyone with link)</Label>
                  <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
                </div>
              )}
              {type === 'csv' && (
                <div>
                  <Label>Dữ liệu CSV (dòng đầu là header)</Label>
                  <textarea className="min-h-24 w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Tiêu đề,Nội dung\nChính sách đổi trả,...'} />
                </div>
              )}
              <div>
                <Label>Mapping cột (JSON: field → tên cột)</Label>
                <textarea className="min-h-16 w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none" value={mapping} onChange={(e) => setMapping(e.target.value)} />
              </div>
            </>
          )}

          {isTextLike && (
            <>
              <div>
                <Label>Tiêu đề</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nhập tiêu đề knowledge..." />
              </div>
              <div>
                <Label>Nội dung *</Label>
                <textarea className="min-h-32 w-full rounded-md border bg-transparent p-2 text-sm outline-none" value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
            </>
          )}

          {(isTextLike || isImport) && (
            <div>
              <Label>Danh mục (tuỳ chọn)</Label>
              <Select value={categoryId || '__none__'} onValueChange={(v) => setCategoryId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không gán danh mục —</SelectItem>
                  {(isImport ? importCats : (kbCats ?? [])).map((c: { id: string; name: string }) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{type === 'product' ? 'Đóng' : 'Huỷ'}</Button>
          {type !== 'product' && type !== 'website' && (
            <Button onClick={() => void submit()} disabled={busy}>
              <Plus className="h-4 w-4" /> {busy ? 'Đang thêm...' : 'Thêm'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ══════════════════════ Product picker: chọn sản phẩm cho AI từ DB ══════════════════════
function ProductPickerInline() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useProducts({ search: search || undefined, pageSize: 50 })
  const update = useUpdateProduct()

  async function toggleAi(id: string, on: boolean) {
    try {
      await update.mutateAsync({ id, data: { status: on ? 'active' : 'draft' } })
      toast.success(on ? 'Sản phẩm đã bật cho AI' : 'Sản phẩm đã tắt khỏi AI')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Database className="h-3.5 w-3.5" />
        Link trực tiếp DB sản phẩm — bật/tắt là chọn sản phẩm AI được tra cứu (chỉ sản phẩm "active" mới vào kết quả tìm kiếm của AI).
      </p>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Tìm sản phẩm trong DB..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
        {isLoading ? (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Đang tải sản phẩm...</div>
        ) : (data?.items ?? []).length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Không có sản phẩm nào.</p>
        ) : (data?.items ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="text-[11px] text-muted-foreground">{formatProductPrice(p)}</p>
            </div>
            {p.status === 'archived' ? (
              <Badge variant="secondary">lưu trữ</Badge>
            ) : (
              <Switch checked={p.status === 'active'} onCheckedChange={(v) => void toggleAi(p.id, v)} />
            )}
          </div>
        ))}
      </div>
      <Separator />
      <p className="text-[11px] text-muted-foreground">
        Tổng: {data?.meta.total ?? 0} sản phẩm trong DB. Thêm/sửa chi tiết sản phẩm tại mục "Sản phẩm &amp; Tri thức".
      </p>
    </div>
  )
}
