import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, Plus, Pencil, Trash2, ImageIcon, Check, X, Upload, FolderTree, BookOpen } from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Pagination } from '@/components/shared/pagination'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiError } from '@/lib/api-client'
import {
  formatProductPrice,
  resolveImageUrl,
  PRICE_TYPES,
  PRICE_TYPE_LABELS,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  productStatusVariant,
  useProducts,
  useProductCategories,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useUploadProductImage,
  useCreateProductCategory,
  useUpdateProductCategory,
  useDeleteProductCategory,
  type Product,
  type ProductInput,
  type ProductCategory,
  type ProductCategoryInput,
} from '@/hooks/use-products'
import {
  kbLabel,
  KB_TYPES,
  KB_TYPE_LABELS,
  KB_FORMATS,
  KB_FORMAT_LABELS,
  KB_RISKS,
  KB_RISK_LABELS,
  KB_STATUS_LABELS,
  kbStatusVariant,
  KB_CATEGORY_KINDS,
  KB_CATEGORY_KIND_LABELS,
  useKnowledgeEntries,
  useCreateKnowledgeEntry,
  useUpdateKnowledgeEntry,
  useDeleteKnowledgeEntry,
  useApproveKnowledgeEntry,
  useRejectKnowledgeEntry,
  useKnowledgeCategories,
  useCreateKnowledgeCategory,
  useUpdateKnowledgeCategory,
  useDeleteKnowledgeCategory,
  type KnowledgeEntry,
  type KnowledgeEntryInput,
  type KnowledgeCategory,
  type KnowledgeCategoryInput,
} from '@/hooks/use-knowledge'

const LIMIT = 20
const ALL = '__all__'
const NONE = '__none__'

// ── Field helper ─────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

/** Sắp xếp danh mục cây theo cha-con, kèm độ sâu để thụt lề. */
function flattenTree<T extends { id: string; parentId: string | null; sortOrder?: number; name: string }>(
  items: T[],
): Array<T & { depth: number }> {
  const byParent = new Map<string | null, T[]>()
  for (const it of items) {
    const key = it.parentId ?? null
    const arr = byParent.get(key) ?? []
    arr.push(it)
    byParent.set(key, arr)
  }
  const ids = new Set(items.map((i) => i.id))
  const out: Array<T & { depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
    )
    for (const c of children) {
      out.push({ ...c, depth })
      walk(c.id, depth + 1)
    }
  }
  // Gốc = không có cha, hoặc cha không tồn tại (mồ côi) → coi là gốc.
  walk(null, 0)
  for (const it of items) {
    if (it.parentId && !ids.has(it.parentId) && !out.find((o) => o.id === it.id)) {
      out.push({ ...it, depth: 0 })
    }
  }
  return out
}

// ── Trang chính ──────────────────────────────────────────────────────
export function ProductsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sản phẩm & Tri thức"
        description="Quản lý danh mục sản phẩm và kho tri thức phục vụ tư vấn, bán hàng."
      />
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Sản phẩm</TabsTrigger>
          <TabsTrigger value="product-categories">Danh mục sản phẩm</TabsTrigger>
          <TabsTrigger value="knowledge">Kho tri thức (KB)</TabsTrigger>
          <TabsTrigger value="knowledge-categories">Danh mục KB</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="pt-2">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="product-categories" className="pt-2">
          <ProductCategoriesTab />
        </TabsContent>
        <TabsContent value="knowledge" className="pt-2">
          <KnowledgeTab />
        </TabsContent>
        <TabsContent value="knowledge-categories" className="pt-2">
          <KnowledgeCategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// TAB 1 — Sản phẩm
// ════════════════════════════════════════════════════════════════════
function ProductsTab() {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const params = useMemo(
    () => ({
      page,
      pageSize: LIMIT,
      search: search || undefined,
      categoryId: categoryId === ALL ? undefined : categoryId,
      status: status === ALL ? undefined : status,
    }),
    [page, search, categoryId, status],
  )

  const { data, isLoading, isError } = useProducts(params)
  const { data: categories } = useProductCategories()
  const del = useDeleteProduct()

  const onDelete = (p: Product) => {
    if (!confirm(`Xóa sản phẩm "${p.name}"?`)) return
    del.mutate(p.id, {
      onSuccess: () => toast.success('Đã xóa sản phẩm'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const columns: Column<Product>[] = [
    {
      key: 'image',
      header: 'Ảnh',
      cell: (p) => {
        const url = resolveImageUrl(p.images?.[0])
        return (
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {url ? (
              <img src={url} alt={p.name} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        )
      },
    },
    {
      key: 'name',
      header: 'Tên sản phẩm',
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          {p.keywords && <p className="truncate text-xs text-muted-foreground">{p.keywords}</p>}
        </div>
      ),
    },
    {
      key: 'code',
      header: 'Mã (SKU)',
      cell: (p) => <span className="tabular-nums text-muted-foreground">{p.code || '—'}</span>,
    },
    {
      key: 'price',
      header: 'Giá',
      align: 'right',
      cell: (p) => <span className="whitespace-nowrap font-medium">{formatProductPrice(p)}</span>,
    },
    {
      key: 'category',
      header: 'Danh mục',
      cell: (p) => <span className="text-muted-foreground">{p.category?.name || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (p) => (
        <Badge variant={productStatusVariant(p.status)}>
          {PRODUCT_STATUS_LABELS[p.status] ?? p.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing(p)} title="Sửa">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(p)} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, mã, từ khóa..."
            className="pl-9"
          />
        </div>
        <Select
          value={categoryId}
          onValueChange={(v) => {
            setCategoryId(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Danh mục" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả danh mục</SelectItem>
            {(categories ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả trạng thái</SelectItem>
            {PRODUCT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PRODUCT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Thêm sản phẩm
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        rowKey={(p) => p.id}
        emptyTitle={isError ? 'Không tải được sản phẩm' : 'Chưa có sản phẩm nào'}
      />

      {!!data && data.meta.total > 0 && (
        <Pagination page={page} limit={LIMIT} total={data.meta.total} onPageChange={setPage} />
      )}

      {(creating || editing) && (
        <ProductDialog
          product={editing}
          categories={categories ?? []}
          open={creating || !!editing}
          onOpenChange={(v) => {
            if (!v) {
              setCreating(false)
              setEditing(null)
            }
          }}
        />
      )}
    </div>
  )
}

function ProductDialog({
  product,
  categories,
  open,
  onOpenChange,
}: {
  product: Product | null
  categories: ProductCategory[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const isEdit = !!product
  const create = useCreateProduct()
  const update = useUpdateProduct()
  const upload = useUploadProductImage()
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: product?.name ?? '',
    code: product?.code ?? '',
    categoryId: product?.categoryId ?? NONE,
    priceType: product?.priceType ?? 'fixed',
    price: product?.price != null ? String(product.price) : '',
    priceMax: product?.priceMax != null ? String(product.priceMax) : '',
    currency: product?.currency ?? 'VND',
    status: product?.status ?? 'active',
    keywords: product?.keywords ?? '',
    description: product?.description ?? '',
  })
  const [images, setImages] = useState<string[]>(product?.images ?? [])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const onPickImage = async (file?: File | null) => {
    if (!file) return
    upload.mutate(file, {
      onSuccess: (url) => {
        setImages([url])
        toast.success('Đã tải ảnh lên')
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const onSubmit = () => {
    if (!form.name.trim()) {
      toast.error('Vui lòng nhập tên sản phẩm')
      return
    }
    const hasPrice = form.priceType === 'fixed' || form.priceType === 'range'
    const payload: ProductInput = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      categoryId: form.categoryId === NONE ? null : form.categoryId,
      priceType: form.priceType,
      price: hasPrice && form.price !== '' ? Number(form.price) : null,
      priceMax: form.priceType === 'range' && form.priceMax !== '' ? Number(form.priceMax) : null,
      currency: form.currency.trim() || 'VND',
      status: form.status,
      keywords: form.keywords.trim() || null,
      description: form.description.trim() || null,
      images,
    }

    const onSuccess = () => {
      toast.success(isEdit ? 'Đã cập nhật sản phẩm' : 'Đã thêm sản phẩm')
      onOpenChange(false)
    }
    const onError = (e: unknown) => toast.error(apiError(e))

    if (isEdit && product) {
      update.mutate({ id: product.id, data: payload }, { onSuccess, onError })
    } else {
      create.mutate(payload, { onSuccess, onError })
    }
  }

  const saving = create.isPending || update.isPending
  const previewUrl = resolveImageUrl(images[0])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {/* Ảnh */}
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {previewUrl ? (
                <img src={previewUrl} alt="preview" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickImage(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
              >
                <Upload className="h-4 w-4" />
                {upload.isPending ? 'Đang tải...' : 'Tải ảnh lên'}
              </Button>
              {previewUrl && (
                <Button type="button" variant="ghost" onClick={() => setImages([])}>
                  <X className="h-4 w-4" /> Bỏ ảnh
                </Button>
              )}
            </div>
          </div>

          <Field label="Tên sản phẩm *">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã (SKU)">
              <Input value={form.code} onChange={(e) => set('code', e.target.value)} />
            </Field>
            <Field label="Danh mục">
              <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Không phân loại</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại giá">
              <Select value={form.priceType} onValueChange={(v) => set('priceType', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PRICE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Trạng thái">
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PRODUCT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {(form.priceType === 'fixed' || form.priceType === 'range') && (
            <div className="grid grid-cols-3 gap-3">
              <Field label={form.priceType === 'range' ? 'Giá từ' : 'Giá'}>
                <Input
                  type="number"
                  value={form.price}
                  onChange={(e) => set('price', e.target.value)}
                />
              </Field>
              {form.priceType === 'range' && (
                <Field label="Giá đến">
                  <Input
                    type="number"
                    value={form.priceMax}
                    onChange={(e) => set('priceMax', e.target.value)}
                  />
                </Field>
              )}
              <Field label="Tiền tệ">
                <Input value={form.currency} onChange={(e) => set('currency', e.target.value)} />
              </Field>
            </div>
          )}

          <Field label="Từ khóa (cách gọi khác, cách nhau bởi dấu phẩy)">
            <Input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
          </Field>

          <Field label="Mô tả">
            <Textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Mô tả chi tiết sản phẩm..."
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ════════════════════════════════════════════════════════════════════
// TAB 2 — Danh mục sản phẩm (cây)
// ════════════════════════════════════════════════════════════════════
function ProductCategoriesTab() {
  const { data, isLoading, isError } = useProductCategories()
  const del = useDeleteProductCategory()
  const [editing, setEditing] = useState<ProductCategory | null>(null)
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => flattenTree(data ?? []), [data])

  const onDelete = (c: ProductCategory) => {
    if (!confirm(`Xóa danh mục "${c.name}"? Sản phẩm & danh mục con sẽ được gỡ khỏi danh mục này.`))
      return
    del.mutate(c.id, {
      onSuccess: () => toast.success('Đã xóa danh mục'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const columns: Column<ProductCategory & { depth: number }>[] = [
    {
      key: 'name',
      header: 'Tên danh mục',
      cell: (c) => (
        <div className="flex items-center gap-2" style={{ paddingLeft: c.depth * 20 }}>
          <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{c.name}</span>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Mô tả',
      cell: (c) => <span className="text-muted-foreground">{c.description || '—'}</span>,
    },
    {
      key: 'count',
      header: 'Số SP',
      align: 'right',
      cell: (c) => <span className="tabular-nums">{c.productCount}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing(c)} title="Sửa">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(c)} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Thêm danh mục
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        rowKey={(c) => c.id}
        emptyTitle={isError ? 'Không tải được danh mục' : 'Chưa có danh mục nào'}
      />

      {(creating || editing) && (
        <ProductCategoryDialog
          category={editing}
          categories={data ?? []}
          open={creating || !!editing}
          onOpenChange={(v) => {
            if (!v) {
              setCreating(false)
              setEditing(null)
            }
          }}
        />
      )}
    </div>
  )
}

function ProductCategoryDialog({
  category,
  categories,
  open,
  onOpenChange,
}: {
  category: ProductCategory | null
  categories: ProductCategory[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const isEdit = !!category
  const create = useCreateProductCategory()
  const update = useUpdateProductCategory()

  const [form, setForm] = useState({
    name: category?.name ?? '',
    parentId: category?.parentId ?? NONE,
    icon: category?.icon ?? '',
    description: category?.description ?? '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const parentOptions = categories.filter((c) => c.id !== category?.id)

  const onSubmit = () => {
    if (!form.name.trim()) {
      toast.error('Vui lòng nhập tên danh mục')
      return
    }
    const payload: ProductCategoryInput = {
      name: form.name.trim(),
      parentId: form.parentId === NONE ? null : form.parentId,
      icon: form.icon.trim() || null,
      description: form.description.trim() || null,
    }
    const onSuccess = () => {
      toast.success(isEdit ? 'Đã cập nhật danh mục' : 'Đã thêm danh mục')
      onOpenChange(false)
    }
    const onError = (e: unknown) => toast.error(apiError(e))
    if (isEdit && category) update.mutate({ id: category.id, data: payload }, { onSuccess, onError })
    else create.mutate(payload, { onSuccess, onError })
  }

  const saving = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Chỉnh sửa danh mục sản phẩm' : 'Thêm danh mục sản phẩm'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="Tên danh mục *">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Danh mục cha">
            <Select value={form.parentId} onValueChange={(v) => set('parentId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Danh mục gốc" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Danh mục gốc</SelectItem>
                {parentOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Biểu tượng (icon, tùy chọn)">
            <Input value={form.icon} onChange={(e) => set('icon', e.target.value)} />
          </Field>
          <Field label="Mô tả">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ════════════════════════════════════════════════════════════════════
// TAB 3 — Kho tri thức (KB)
// ════════════════════════════════════════════════════════════════════
function KnowledgeTab() {
  const [searchInput, setSearchInput] = useState('')
  const [status, setStatus] = useState(ALL)
  const [type, setType] = useState(ALL)
  const [categoryId, setCategoryId] = useState(ALL)
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null)
  const [creating, setCreating] = useState(false)

  const params = useMemo(
    () => ({
      status: status === ALL ? undefined : status,
      type: type === ALL ? undefined : type,
      categoryId: categoryId === ALL ? undefined : categoryId,
    }),
    [status, type, categoryId],
  )

  const { data, isLoading, isError } = useKnowledgeEntries(params)
  const { data: categories } = useKnowledgeCategories()
  const del = useDeleteKnowledgeEntry()
  const approve = useApproveKnowledgeEntry()
  const reject = useRejectKnowledgeEntry()

  const rows = useMemo(() => {
    const q = searchInput.trim().toLowerCase()
    const list = data ?? []
    if (!q) return list
    return list.filter(
      (e) =>
        (e.title ?? '').toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        (e.keywords ?? '').toLowerCase().includes(q),
    )
  }, [data, searchInput])

  const catName = (id: string | null) =>
    id ? (categories ?? []).find((c) => c.id === id)?.name ?? '—' : '—'

  const onDelete = (e: KnowledgeEntry) => {
    if (!confirm('Xóa mục tri thức này?')) return
    del.mutate(e.id, {
      onSuccess: () => toast.success('Đã xóa'),
      onError: (err) => toast.error(apiError(err)),
    })
  }

  const columns: Column<KnowledgeEntry>[] = [
    {
      key: 'title',
      header: 'Tiêu đề / Nội dung',
      cell: (e) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-medium">{kbLabel(e)}</p>
          {e.keywords && <p className="truncate text-xs text-muted-foreground">{e.keywords}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Loại',
      cell: (e) => <Badge variant="outline">{KB_TYPE_LABELS[e.type] ?? e.type}</Badge>,
    },
    {
      key: 'category',
      header: 'Danh mục',
      cell: (e) => <span className="text-muted-foreground">{catName(e.categoryId)}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (e) => (
        <Badge variant={kbStatusVariant(e.status)}>{KB_STATUS_LABELS[e.status] ?? e.status}</Badge>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Cập nhật',
      cell: (e) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dayjs(e.updatedAt).format('DD/MM/YYYY')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          {e.status === 'pending' && (
            <>
              <Button
                variant="ghost"
                size="icon"
                title="Duyệt"
                disabled={approve.isPending}
                onClick={() =>
                  approve.mutate(e.id, {
                    onSuccess: () => toast.success('Đã duyệt'),
                    onError: (err) => toast.error(apiError(err)),
                  })
                }
              >
                <Check className="h-4 w-4 text-success" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Từ chối"
                disabled={reject.isPending}
                onClick={() =>
                  reject.mutate(e.id, {
                    onSuccess: () => toast.success('Đã từ chối'),
                    onError: (err) => toast.error(apiError(err)),
                  })
                }
              >
                <X className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => setEditing(e)} title="Sửa">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(e)} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tiêu đề, nội dung, từ khóa..."
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả trạng thái</SelectItem>
            {Object.entries(KB_STATUS_LABELS).map(([v, label]) => (
              <SelectItem key={v} value={v}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Loại" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả loại</SelectItem>
            {KB_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {KB_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Danh mục" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả danh mục</SelectItem>
            {(categories ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Thêm tri thức
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        rowKey={(e) => e.id}
        emptyTitle={isError ? 'Không tải được kho tri thức' : 'Chưa có mục tri thức nào'}
      />

      {(creating || editing) && (
        <KnowledgeDialog
          entry={editing}
          categories={categories ?? []}
          open={creating || !!editing}
          onOpenChange={(v) => {
            if (!v) {
              setCreating(false)
              setEditing(null)
            }
          }}
        />
      )}
    </div>
  )
}

function KnowledgeDialog({
  entry,
  categories,
  open,
  onOpenChange,
}: {
  entry: KnowledgeEntry | null
  categories: KnowledgeCategory[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const isEdit = !!entry
  const create = useCreateKnowledgeEntry()
  const update = useUpdateKnowledgeEntry()

  const [form, setForm] = useState({
    type: entry?.type ?? 'faq',
    format: entry?.format ?? (entry?.type === 'faq' ? 'qa' : 'article'),
    title: entry?.title ?? '',
    content: entry?.content ?? '',
    risk: entry?.risk ?? 'low',
    categoryId: entry?.categoryId ?? NONE,
    keywords: entry?.keywords ?? '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const needsTitle = form.type === 'faq' || form.format === 'qa'

  const onSubmit = () => {
    if (!form.content.trim()) {
      toast.error('Vui lòng nhập nội dung')
      return
    }
    if (needsTitle && !form.title.trim()) {
      toast.error('Câu hỏi (tiêu đề) là bắt buộc với mục Hỏi - Đáp')
      return
    }
    const payload: KnowledgeEntryInput = {
      type: form.type,
      format: form.format,
      title: form.title.trim() || null,
      content: form.content.trim(),
      risk: form.risk,
      categoryId: form.categoryId === NONE ? null : form.categoryId,
      keywords: form.keywords.trim() || null,
    }
    const onSuccess = () => {
      toast.success(isEdit ? 'Đã cập nhật' : 'Đã thêm mục tri thức')
      onOpenChange(false)
    }
    const onError = (e: unknown) => toast.error(apiError(e))
    if (isEdit && entry) update.mutate({ id: entry.id, data: payload }, { onSuccess, onError })
    else create.mutate(payload, { onSuccess, onError })
  }

  const saving = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Chỉnh sửa tri thức' : 'Thêm tri thức'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại">
              <Select value={form.type} onValueChange={(v) => set('type', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KB_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {KB_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Định dạng">
              <Select value={form.format} onValueChange={(v) => set('format', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KB_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {KB_FORMAT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={needsTitle ? 'Câu hỏi *' : 'Tiêu đề (tùy chọn)'}>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={needsTitle ? 'Nhập câu hỏi của khách...' : 'Để trống nếu là bài viết'}
            />
          </Field>

          <Field label={needsTitle ? 'Câu trả lời *' : 'Nội dung *'}>
            <Textarea
              value={form.content}
              onChange={(e) => set('content', e.target.value)}
              className="min-h-[140px]"
              placeholder="Nội dung tri thức..."
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mức độ">
              <Select value={form.risk} onValueChange={(v) => set('risk', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KB_RISKS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {KB_RISK_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Danh mục">
              <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Không phân loại</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Từ khóa (cách hỏi khác, cách nhau bởi dấu phẩy)">
            <Input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
          </Field>

          <p className="text-xs text-muted-foreground">
            Mục "Nhạy cảm" sẽ ở trạng thái <span className="font-medium">Chờ duyệt</span> cho tới khi
            được phê duyệt.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ════════════════════════════════════════════════════════════════════
// TAB 4 — Danh mục KB
// ════════════════════════════════════════════════════════════════════
function KnowledgeCategoriesTab() {
  const { data, isLoading, isError } = useKnowledgeCategories()
  const del = useDeleteKnowledgeCategory()
  const [editing, setEditing] = useState<KnowledgeCategory | null>(null)
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => flattenTree(data ?? []), [data])

  const onDelete = (c: KnowledgeCategory) => {
    if (!confirm(`Xóa danh mục "${c.name}"? Các mục tri thức sẽ được gỡ khỏi danh mục này.`)) return
    del.mutate(c.id, {
      onSuccess: () => toast.success('Đã xóa danh mục'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const columns: Column<KnowledgeCategory & { depth: number }>[] = [
    {
      key: 'name',
      header: 'Tên danh mục',
      cell: (c) => (
        <div className="flex items-center gap-2" style={{ paddingLeft: c.depth * 20 }}>
          <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{c.name}</span>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Loại',
      cell: (c) => <Badge variant="secondary">{KB_CATEGORY_KIND_LABELS[c.kind] ?? c.kind}</Badge>,
    },
    {
      key: 'description',
      header: 'Mô tả',
      cell: (c) => <span className="text-muted-foreground">{c.description || '—'}</span>,
    },
    {
      key: 'count',
      header: 'Số mục',
      align: 'right',
      cell: (c) => <span className="tabular-nums">{c.entryCount}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing(c)} title="Sửa">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(c)} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Thêm danh mục
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        rowKey={(c) => c.id}
        emptyTitle={isError ? 'Không tải được danh mục' : 'Chưa có danh mục nào'}
      />

      {(creating || editing) && (
        <KnowledgeCategoryDialog
          category={editing}
          categories={data ?? []}
          open={creating || !!editing}
          onOpenChange={(v) => {
            if (!v) {
              setCreating(false)
              setEditing(null)
            }
          }}
        />
      )}
    </div>
  )
}

function KnowledgeCategoryDialog({
  category,
  categories,
  open,
  onOpenChange,
}: {
  category: KnowledgeCategory | null
  categories: KnowledgeCategory[]
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const isEdit = !!category
  const create = useCreateKnowledgeCategory()
  const update = useUpdateKnowledgeCategory()

  const [form, setForm] = useState({
    name: category?.name ?? '',
    kind: category?.kind ?? 'knowledge',
    parentId: category?.parentId ?? NONE,
    description: category?.description ?? '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const parentOptions = categories.filter((c) => c.id !== category?.id)

  const onSubmit = () => {
    if (!form.name.trim()) {
      toast.error('Vui lòng nhập tên danh mục')
      return
    }
    const payload: KnowledgeCategoryInput = {
      name: form.name.trim(),
      kind: form.kind,
      parentId: form.parentId === NONE ? null : form.parentId,
      description: form.description.trim() || null,
    }
    const onSuccess = () => {
      toast.success(isEdit ? 'Đã cập nhật danh mục' : 'Đã thêm danh mục')
      onOpenChange(false)
    }
    const onError = (e: unknown) => toast.error(apiError(e))
    if (isEdit && category) update.mutate({ id: category.id, data: payload }, { onSuccess, onError })
    else create.mutate(payload, { onSuccess, onError })
  }

  const saving = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Chỉnh sửa danh mục KB' : 'Thêm danh mục KB'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="Tên danh mục *">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Loại">
            <Select value={form.kind} onValueChange={(v) => set('kind', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KB_CATEGORY_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KB_CATEGORY_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Danh mục cha">
            <Select value={form.parentId} onValueChange={(v) => set('parentId', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Danh mục gốc" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Danh mục gốc</SelectItem>
                {parentOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Mô tả">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
