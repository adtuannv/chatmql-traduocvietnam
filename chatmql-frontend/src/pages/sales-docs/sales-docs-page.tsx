/**
 * sales-docs-page.tsx — Module "Tài liệu bán hàng", duyệt như một cây thư mục:
 *
 *   /sales-docs              Tổng quan: biểu giá + thư mục danh mục
 *   /sales-docs/c/:catId     Một danh mục: lưới sản phẩm
 *   /sales-docs/p/:productId Chi tiết: bộ ảnh · mô tả · video
 *   /sales-docs?code=XXX     Lối tắt từ màn "Sản phẩm (CRM)" theo mã
 *
 * HAI NGUỒN GHÉP LẠI:
 *   • Dữ liệu gốc (mã, tên, giá, tồn, danh mục) — hệ thống nguồn (CRM/TDVN), chỉ đọc.
 *   • Tri thức bán hàng (ảnh, mô tả, video) — bảng `product_docs` của ChatMQL,
 *     gắn theo MÃ sản phẩm, admin soạn tại đây, AI đọc khi tư vấn.
 *
 * Bảng `products` nội bộ KHÔNG còn được dùng ở đây và sẽ ngừng dùng hẳn khi
 * nguồn sản phẩm chính thức chạy — xem docs/cau-truc-du-lieu-san-pham.md.
 */
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ChevronRight, ExternalLink, Folder, FolderOpen, ImageOff, Pencil, PlayCircle, ReceiptText,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState, Loading } from '@/components/shared/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiError } from '@/lib/api-client'
import { formatVnd } from '@/lib/order-calc'
import { cn } from '@/lib/utils'
import { useMyPermissions } from '@/hooks/use-settings'
import { resolveImageUrl } from '@/hooks/use-products'
import { useCrmProductList, type CrmProduct } from '@/hooks/use-crm-products'
import { useProductDoc } from '@/hooks/use-product-docs'
import {
  KIND_LABELS, VISIBILITY_LABELS, assetUrl, useDocAssets, type DocAsset,
} from '@/hooks/use-doc-library'
import { useDocFolders, type DocFolder } from '@/hooks/use-doc-library'
import { FileText } from 'lucide-react'
import { SalesDocEditDialog } from './sales-doc-edit-dialog'
import { DocAssetDetailDialog } from './doc-asset-detail-dialog'

const ROOT = '/sales-docs'
/** Phần tài liệu mà trang tổng quan cần — không cần cả bản ghi. */
type ProductDocLite = {
  productCode: string
  folderId: string | null
  description: string | null
  images: string[]
  videoUrls: string[]
}

/** Nhận diện YouTube → id để nhúng; link khác trả null. */
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{6,})/i)
  return m ? m[1] : null
}

function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)
}

function priceText(p: CrmProduct): string {
  if (p.price == null && p.priceMax == null) return 'Liên hệ'
  if (p.priceMax != null && p.price != null && p.priceMax !== p.price) {
    return `${formatVnd(p.price)} – ${formatVnd(p.priceMax)}`
  }
  return formatVnd(p.price ?? p.priceMax)
}

/** Toàn bộ sản phẩm từ hệ thống nguồn — mọi cấp của module đều dựa vào đây. */
function useAllProducts() {
  return useCrmProductList({ pageSize: 200 })
}

function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" aria-label="Đường dẫn">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
          {it.to
            ? <Link to={it.to} className="hover:text-foreground hover:underline">{it.label}</Link>
            : <span className="font-medium text-foreground">{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}

export function SalesDocsPage() {
  const { catId, productId } = useParams<{ catId?: string; productId?: string }>()
  const [params] = useSearchParams()
  // Lối tắt ?code= từ màn "Sản phẩm (CRM)".
  const code = productId ?? params.get('code') ?? undefined
  if (code) return <ProductDetailView code={decodeURIComponent(code)} />
  if (catId) return <CategoryView folderId={decodeURIComponent(catId)} />
  return <RootView />
}

// ── Cấp 1: Tổng quan ────────────────────────────────────────────────

/**
 * Trang đầu = ĐÚNG NHỮNG GÌ NGƯỜI DÙNG TỰ DỰNG.
 *
 * Module này độc lập với hệ thống sản phẩm: thư mục, thứ tự và tài nguyên
 * (bảng giá, ảnh, video, tài liệu) đều do người dùng tạo và sắp xếp. Sản phẩm
 * chỉ xuất hiện khi một tài nguyên được GHÉP NỐI với mã sản phẩm — lúc đó mới
 * nạp dữ liệu thật từ hệ thống nguồn.
 */
function RootView() {
  const foldersQ = useDocFolders()
  const assetsQ = useDocAssets({ pageSize: 200 })

  const folders = foldersQ.data ?? []
  const assets = assetsQ.data?.items ?? []

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, DocFolder[]>()
    for (const f of folders) {
      const arr = m.get(f.parentId) ?? []
      arr.push(f)
      m.set(f.parentId, arr)
    }
    // Thứ tự do người dùng đặt (sortOrder), hoà thì theo tên.
    for (const [, arr] of m) arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    return m
  }, [folders])

  const assetsByFolder = useMemo(() => {
    const m = new Map<string | null, DocAsset[]>()
    for (const a of assets) {
      const arr = m.get(a.folderId) ?? []
      arr.push(a)
      m.set(a.folderId, arr)
    }
    return m
  }, [assets])

  /** Tổng tài nguyên của một nhánh, tính cả cây con. */
  const totalOf = useMemo(() => {
    const memo = new Map<string, number>()
    const walk = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!
      let n = (assetsByFolder.get(id) ?? []).length
      for (const c of childrenOf.get(id) ?? []) n += walk(c.id)
      memo.set(id, n)
      return n
    }
    for (const f of folders) walk(f.id)
    return memo
  }, [folders, childrenOf, assetsByFolder])

  const roots = childrenOf.get(null) ?? []
  const unfiled = assetsByFolder.get(null) ?? []
  const loading = foldersQ.isLoading || assetsQ.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tài liệu bán hàng"
        description="Tài nguyên bán hàng do đội ngũ tự dựng: bảng giá, ảnh, video, tài liệu. Sản phẩm chỉ hiện khi tài nguyên được ghép nối."
        actions={
          <Button variant="outline" className="gap-1.5" asChild>
            <Link to={`${ROOT}/library`}><FolderOpen className="h-4 w-4" /> Quản lý thư viện</Link>
          </Button>
        }
      />
      <Crumbs items={[{ label: 'Tài liệu bán hàng' }]} />

      {loading ? (
        <Loading className="py-16" />
      ) : foldersQ.error || assetsQ.error ? (
        <ErrorState message={apiError(foldersQ.error ?? assetsQ.error)} />
      ) : roots.length === 0 && unfiled.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Chưa có tài liệu nào</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Vào <Link to={`${ROOT}/library`} className="text-primary hover:underline">Quản lý thư viện</Link> để tạo thư mục
            (ví dụ: Bảng giá, Trà, Bánh) và nạp tài nguyên. Thứ tự hiển thị ở đây theo đúng thứ tự bạn sắp xếp.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {roots.map((f) => (
            <FolderNode
              key={f.id}
              folder={f}
              depth={0}
              childrenOf={childrenOf}
              assetsByFolder={assetsByFolder}
              totalOf={totalOf}
            />
          ))}
          {unfiled.length > 0 && (
            <details className="rounded-lg border">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
                Chưa xếp thư mục <span className="text-muted-foreground">({unfiled.length})</span>
              </summary>
              <div className="grid grid-cols-2 gap-3 border-t p-3 sm:grid-cols-3 lg:grid-cols-4">
                {unfiled.map((a) => <AssetTile key={a.id} a={a} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

/** Một nhánh thư mục: mở sẵn 2 cấp đầu, sâu hơn thì bấm để mở. */
function FolderNode({
  folder, depth, childrenOf, assetsByFolder, totalOf,
}: {
  folder: DocFolder
  depth: number
  childrenOf: Map<string | null, DocFolder[]>
  assetsByFolder: Map<string | null, DocAsset[]>
  totalOf: Map<string, number>
}) {
  const kids = childrenOf.get(folder.id) ?? []
  const own = assetsByFolder.get(folder.id) ?? []
  const total = totalOf.get(folder.id) ?? 0

  return (
    <details open={depth < 2} className={cn('rounded-lg border', depth > 0 && 'border-dashed')}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm">
        <Folder className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">{folder.icon ? `${folder.icon} ` : ''}{folder.name}</span>
        <span className="text-xs text-muted-foreground">({total})</span>
        {folder.visibility === 'internal' && <Badge variant="outline" className="text-[9px]">Nội bộ</Badge>}
        {folder.description && (
          <span className="ml-1 hidden truncate text-xs text-muted-foreground sm:inline">{folder.description}</span>
        )}
      </summary>

      <div className="space-y-3 border-t p-3">
        {kids.length > 0 && (
          <div className="space-y-2">
            {kids.map((k) => (
              <FolderNode
                key={k.id}
                folder={k}
                depth={depth + 1}
                childrenOf={childrenOf}
                assetsByFolder={assetsByFolder}
                totalOf={totalOf}
              />
            ))}
          </div>
        )}

        {own.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {own.map((a) => <AssetTile key={a.id} a={a} />)}
          </div>
        ) : kids.length === 0 ? (
          <p className="text-xs text-muted-foreground">Thư mục này chưa có tài nguyên.</p>
        ) : null}
      </div>
    </details>
  )
}

/**
 * Một tài nguyên. Nếu đã ghép nối sản phẩm thì hiện mã kèm lối tắt sang trang
 * chi tiết sản phẩm — nơi dữ liệu thật (giá, tồn) được nạp từ hệ thống nguồn.
 */
function AssetTile({ a }: { a: DocAsset }) {
  const [open, setOpen] = useState(false)
  const src = a.kind === 'product'
    ? assetUrl(a.images?.[0])
    : a.kind === 'image' ? assetUrl(a.thumbUrl || a.fileUrl) : undefined

  return (
    <>
      {/* Bấm vào thẻ mở CHI TIẾT để lấy từng phần hoặc lấy toàn bộ, thay vì
          mở thẳng tệp — tệp vẫn mở được từ trong chi tiết. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary/50"
      >
        <div className="relative aspect-[4/3] w-full bg-muted">
          {src ? (
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <FileText className="h-6 w-6" />
              <span className="text-[10px]">{KIND_LABELS[a.kind]}</span>
            </div>
          )}
          {a.visibility !== 'sales' && (
            <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
              {VISIBILITY_LABELS[a.visibility]}
            </span>
          )}
        </div>
        <div className="min-w-0 space-y-1 p-2.5">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{a.title}</p>
          {a.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{a.description}</p>}
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {a.productCodes.slice(0, 3).map((c) => (
              <span key={c} className="rounded bg-primary/10 px-1 font-mono text-[9.5px] text-primary">{c}</span>
            ))}
            {(a.images?.length ?? 0) > 1 && (
              <span className="text-[9.5px] text-muted-foreground">{a.images.length} ảnh</span>
            )}
            {(a.videoUrls?.length ?? 0) > 0 && (
              <span className="text-[9.5px] text-muted-foreground">{a.videoUrls.length} video</span>
            )}
          </div>
        </div>
      </button>
      <DocAssetDetailDialog asset={a} open={open} onOpenChange={setOpen} />
    </>
  )
}

// ── Cấp 2: Một nhánh thư mục ────────────────────────────────────────

/** Xem riêng một nhánh — gồm cả tài nguyên của các thư mục con. */
function CategoryView({ folderId }: { folderId: string }) {
  const foldersQ = useDocFolders()
  const assetsQ = useDocAssets({ pageSize: 200 })

  const folders = foldersQ.data ?? []
  const folder = folders.find((f) => f.id === folderId)

  const branchIds = useMemo(() => {
    const childrenOf = new Map<string | null, string[]>()
    for (const f of folders) {
      const arr = childrenOf.get(f.parentId) ?? []
      arr.push(f.id)
      childrenOf.set(f.parentId, arr)
    }
    const out = new Set<string>([folderId])
    const stack = [folderId]
    while (stack.length) {
      const cur = stack.pop()!
      for (const c of childrenOf.get(cur) ?? []) if (!out.has(c)) { out.add(c); stack.push(c) }
    }
    return out
  }, [folders, folderId])

  const assets = (assetsQ.data?.items ?? []).filter((a) => a.folderId && branchIds.has(a.folderId))
  const loading = foldersQ.isLoading || assetsQ.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        title={folder ? `${folder.icon ? `${folder.icon} ` : ''}${folder.name}` : 'Thư mục'}
        description={folder?.description || `${assets.length} tài nguyên trong nhánh này (tính cả thư mục con).`}
      />
      <Crumbs items={[{ label: 'Tài liệu bán hàng', to: ROOT }, { label: folder?.name ?? '…' }]} />

      {loading ? (
        <Loading className="py-16" />
      ) : assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nhánh này chưa có tài nguyên nào.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {assets.map((a) => <AssetTile key={a.id} a={a} />)}
        </div>
      )}
    </div>
  )
}

// ── Cấp 3: Chi tiết sản phẩm ────────────────────────────────────────

function ProductDetailView({ code }: { code: string }) {
  const listQ = useCrmProductList({ q: code, pageSize: 50 })
  const docQ = useProductDoc(code)
  const permsQ = useMyPermissions()
  const canEdit = permsQ.data?.has('products.update') ?? false
  const [editOpen, setEditOpen] = useState(false)
  const [activeImg, setActiveImg] = useState(0)

  const p = listQ.data?.products.find((x) => x.code?.toUpperCase() === code.toUpperCase())
  const doc = docQ.data
  const images = doc?.images ?? []
  const mainSrc = resolveImageUrl(images[Math.min(activeImg, Math.max(images.length - 1, 0))])
  const name = p?.name ?? doc?.name ?? code

  if (listQ.isLoading || docQ.isLoading) return <Loading className="py-16" />

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        description={[`Mã: ${code}`, p?.categoryName].filter(Boolean).join(' · ')}
        actions={canEdit ? (
          <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> Chỉnh tài liệu
          </Button>
        ) : undefined}
      />
      <Crumbs items={[
        { label: 'Tài liệu bán hàng', to: ROOT },
        ...(p?.categoryName ? [{ label: p.categoryName, to: `${ROOT}/c/${encodeURIComponent(p.categoryName)}` }] : []),
        { label: name },
      ]} />

      {!p && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          Không tìm thấy mã <b>{code}</b> ở hệ thống nguồn — chỉ hiện tài liệu đã soạn. Sản phẩm có thể đã ngừng bán hoặc hệ thống nguồn đang lỗi.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-2">
          <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
            {mainSrc
              ? <img src={mainSrc} alt={name} className="h-full w-full object-contain" />
              : (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                  <ImageOff className="h-8 w-8" /><span className="text-xs">Chưa có ảnh</span>
                </div>
              )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-1.5">
              {images.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  type="button"
                  onClick={() => setActiveImg(i)}
                  className={cn(
                    'aspect-square overflow-hidden rounded-md border-2 bg-muted',
                    i === activeImg ? 'border-primary' : 'border-transparent hover:border-border',
                  )}
                  aria-label={`Ảnh ${i + 1}`}
                >
                  <img src={resolveImageUrl(u)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          {/* Dữ liệu gốc — chỉ đọc, thuộc hệ thống nguồn. */}
          <div className="flex flex-wrap items-center gap-2">
            {p && <span className="text-2xl font-bold text-primary">{priceText(p)}</span>}
            {p?.inventory != null && p.inventory > 0 && (
              <Badge variant="secondary">Tồn {p.inventory}{p.unit ? ` ${p.unit}` : ''}</Badge>
            )}
            {p?.vatNote && <Badge variant="outline">{p.vatNote}</Badge>}
          </div>

          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mô tả</h3>
            {doc?.description
              ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{doc.description}</p>
              : (
                <p className="text-sm italic text-muted-foreground">
                  Chưa có mô tả.{canEdit ? ' Bấm "Chỉnh tài liệu" để thêm.' : ''}
                </p>
              )}
          </section>

          {doc?.keywords && (
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Từ khoá / tên gọi khác</h3>
              <p className="text-xs text-muted-foreground">{doc.keywords}</p>
            </section>
          )}
        </div>
      </div>

      <LinkedAssets code={code} />

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <PlayCircle className="h-4 w-4" /> Video ({doc?.videoUrls?.length ?? 0})
        </h3>
        {!doc?.videoUrls?.length ? (
          <p className="text-sm italic text-muted-foreground">
            Chưa có video.{canEdit ? ' Dán link YouTube hoặc mp4 trong "Chỉnh tài liệu".' : ''}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {doc.videoUrls.map((v, i) => <VideoBlock key={`${v}-${i}`} url={v} />)}
          </div>
        )}
      </section>

      <SalesDocEditDialog code={code} productName={p?.name ?? doc?.name ?? null} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}

function VideoBlock({ url }: { url: string }) {
  const yt = youtubeId(url)
  if (yt) {
    return (
      <div className="aspect-video overflow-hidden rounded-lg border bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${yt}`}
          title="Video sản phẩm"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    )
  }
  if (isDirectVideo(url)) {
    return (
      <div className="aspect-video overflow-hidden rounded-lg border bg-black">
        <video src={resolveImageUrl(url)} controls preload="metadata" className="h-full w-full" />
      </div>
    )
  }
  return (
    <a
      href={url} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:border-primary/50 hover:text-primary"
    >
      <ExternalLink className="h-4 w-4 shrink-0" /><span className="truncate">{url}</span>
    </a>
  )
}

/** Tài nguyên trong thư viện đã ghép nối với mã sản phẩm này. */
function LinkedAssets({ code }: { code: string }) {
  const q = useDocAssets({ productCode: code, pageSize: 100 })
  const assets = q.data?.items ?? []
  if (q.isLoading || assets.length === 0) return null
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <FileText className="h-4 w-4" /> Tài liệu đã ghép nối ({assets.length})
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((a) => <AssetTile key={a.id} a={a} />)}
      </div>
    </section>
  )
}
