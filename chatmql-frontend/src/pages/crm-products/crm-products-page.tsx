/**
 * crm-products-page.tsx — Module "Sản phẩm (CRM)": DANH SÁCH SẢN PHẨM CHÍNH THỨC.
 *
 * Danh sách lấy thẳng từ hệ thống nguồn nên giá và tồn kho luôn là số thật,
 * không có bản sao để lệch. Những trường đó CHỈ ĐỌC — muốn đổi thì đổi ở hệ
 * thống nguồn, sửa ở đây sẽ bị lần đồng bộ sau ghi đè.
 *
 * Bấm một dòng thì bung chi tiết ngay tại chỗ, và phần ChatMQL sở hữu (mô tả
 * bán hàng, từ khoá, ảnh, video, mã Mini App) sửa và lưu luôn ở đó — người
 * dùng thường xem rồi sửa liên tiếp nhiều sản phẩm, bắt nhảy trang mỗi lần là
 * mất mạch. Phần này lưu vào tài liệu sản phẩm, gắn theo MÃ — xem
 * docs/cau-truc-du-lieu-san-pham.md.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight,
  FileText, Grid2x2, List as ListIcon, Loader2, PackageSearch, RefreshCw, Search, ServerCog,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState, Loading } from '@/components/shared/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/misc'
import { apiError } from '@/lib/api-client'
import { formatVnd } from '@/lib/order-calc'
import { cn } from '@/lib/utils'
import { MiniAppCell } from './miniapp-cell'
import { ProductRowDetail } from './product-row-detail'
import { SourceSwitch } from './source-switch'
import { useFormLookups } from '@/hooks/use-order-form'
import { SOURCE_LABELS, useCrmProductList, useCrmProductSource, type CrmProduct } from '@/hooks/use-crm-products'

const ALL = '__all__'
const PAGE_SIZE = 50

function formatNumber(n: number | null): string {
  return n == null ? '—' : new Intl.NumberFormat('vi-VN').format(n)
}

/** Giá hiển thị: có cận trên thì ghi thành khoảng giá. */
function priceText(p: CrmProduct): string {
  if (p.price == null && p.priceMax == null) return 'Liên hệ'
  if (p.priceMax != null && p.price != null && p.priceMax !== p.price) {
    return `${formatVnd(p.price)} – ${formatVnd(p.priceMax)}`
  }
  return formatVnd(p.price ?? p.priceMax)
}

export function CrmProductsPage() {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [warehouseId, setWarehouseId] = useState<string>(ALL)
  const [category, setCategory] = useState<string>(ALL)
  const [page, setPage] = useState(1)
  const [view, setView] = useState<'table' | 'grid'>('table')

  const sourceQ = useCrmProductSource()
  /** Mã (hoặc id) của dòng đang bung chi tiết; chỉ mở một dòng để bảng khỏi rối. */
  const [dongMo, setDongMo] = useState<string | null>(null)
  const mauLink = sourceQ.data?.miniAppUrlTemplate ?? ''
  const lookups = useFormLookups()
  const listQ = useCrmProductList({
    q,
    warehouseId: warehouseId === ALL ? undefined : Number(warehouseId),
    category: category === ALL ? undefined : category,
    page,
    pageSize: PAGE_SIZE,
  })

  // Chống gọi hệ thống nguồn mỗi lần gõ một ký tự.
  useEffect(() => {
    const t = setTimeout(() => { setQ(input); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [input])

  const products = listQ.data?.products ?? []
  const meta = listQ.data?.meta
  const categories = listQ.data?.categories ?? []
  const warehouses = lookups.data?.warehouses ?? []

  const filtering = useMemo(
    () => q !== '' || warehouseId !== ALL || category !== ALL,
    [q, warehouseId, category],
  )

  const resetFilters = () => {
    setInput(''); setQ(''); setWarehouseId(ALL); setCategory(ALL); setPage(1)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sản phẩm (CRM)"
        description="Danh sách sản phẩm chính thức, lấy trực tiếp từ hệ thống nguồn — giá và tồn kho là số thật, không phải bản sao."
        actions={
          <>
            {sourceQ.data && <SourceSwitch info={sourceQ.data} />}
            <Button variant="outline" className="gap-1.5" onClick={() => listQ.refetch()} disabled={listQ.isFetching}>
              <RefreshCw className={listQ.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Tải lại
            </Button>
          </>
        }
      />

      {sourceQ.data && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ServerCog className="h-3.5 w-3.5" />
          Nguồn dữ liệu: <b className="text-foreground">{SOURCE_LABELS[sourceQ.data.source]}</b>
          {sourceQ.data.source === 'dashboard' && (
            <span className="text-warning">· token có hạn, hết hạn phải cấu hình lại</span>
          )}
        </p>
      )}

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tìm theo tên hoặc mã sản phẩm…"
            className="pl-9"
          />
          {listQ.isFetching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setPage(1) }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Kho" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả kho</SelectItem>
            {warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1) }} disabled={!categories.length}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={categories.length ? 'Danh mục' : 'Không có danh mục'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả danh mục</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>


        {filtering && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={resetFilters}>Bỏ lọc</Button>
        )}

        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5">
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7"
            onClick={() => setView('table')} title="Dạng bảng" aria-label="Dạng bảng"
          >
            <ListIcon className="h-4 w-4" />
          </Button>
          <Button
            variant={view === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7"
            onClick={() => setView('grid')} title="Dạng thẻ" aria-label="Dạng thẻ"
          >
            <Grid2x2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {listQ.isLoading ? (
        <Loading className="py-16" />
      ) : listQ.error ? (
        <ErrorState message={apiError(listQ.error)} />
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <PackageSearch className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            {filtering ? 'Không có sản phẩm nào khớp bộ lọc' : 'Hệ thống nguồn chưa trả về sản phẩm nào'}
          </p>
          {filtering && <Button variant="outline" size="sm" onClick={resetFilters}>Bỏ lọc</Button>}
        </div>
      ) : view === 'table' ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mã</th>
                <th className="px-3 py-2 text-left font-medium">Tên sản phẩm</th>
                <th className="px-3 py-2 text-left font-medium">Danh mục</th>
                <th className="px-3 py-2 text-right font-medium">Giá</th>
                <th className="px-3 py-2 text-right font-medium">Tồn</th>
                <th className="px-3 py-2 text-left font-medium">ĐVT</th>
                <th className="px-3 py-2 text-left font-medium">Kho</th>
                <th className="px-3 py-2 text-right font-medium">Link Mini App</th>
                <th className="px-3 py-2 text-right font-medium">Tài liệu</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => {
                const khoa = `${p.code ?? p.id ?? i}`
                return (
                  <Fragment key={khoa}>
                    <Row
                      p={p}
                      mauLink={mauLink}
                      dangMo={dongMo === khoa}
                      onToggle={() => setDongMo(dongMo === khoa ? null : khoa)}
                    />
                    {dongMo === khoa && (
                      <ProductRowDetail p={p} mauLink={mauLink} soCot={9} />
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <Card key={`${p.code ?? p.id ?? i}`} p={p} mauLink={mauLink} />
          ))}
        </div>
      )}

      {meta && meta.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} trên {formatNumber(meta.total)} sản phẩm
          </span>
          {meta.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => setPage((p) => p - 1)}>Trước</Button>
              <span>Trang {meta.page}/{meta.totalPages}</span>
              <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Sau</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Nút mở tài liệu bán hàng của sản phẩm — tri thức do ChatMQL sở hữu, khoá theo mã. */
function DocLink({ code }: { code: string | null }) {
  if (!code) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Link
      to={`/sales-docs?code=${encodeURIComponent(code)}`}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      title="Xem tài liệu bán hàng của sản phẩm này"
    >
      <FileText className="h-3.5 w-3.5" /> Tài liệu
    </Link>
  )
}

/**
 * Chỉ hiện số tồn khi sản phẩm CÓ TỒN THỰC.
 *
 * Không hiện "Hết hàng" nữa: mọi sản phẩm đều bán được, hàng đặt trước hay gối
 * vụ vẫn nhận đơn bình thường. Nguồn cũng trả tồn âm cho gần nửa danh mục nên
 * nhãn đó vừa sai vừa làm sale ngại chào hàng.
 */
function StockCell({ n }: { n: number | null }) {
  if (n == null || n <= 0) return <span className="text-muted-foreground">—</span>
  return <span className="font-semibold text-success">{formatNumber(n)}</span>
}

function Row({
  p, mauLink, dangMo, onToggle,
}: { p: CrmProduct; mauLink: string; dangMo: boolean; onToggle: () => void }) {
  return (
    <tr
      onClick={onToggle}
      className={cn(
        'cursor-pointer border-t hover:bg-accent/30',
        dangMo && 'bg-accent/40',
        p.status === 'inactive' && 'opacity-60',
      )}
    >
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                      dangMo && 'rotate-90')} />
          {p.code ?? '—'}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{p.name}</div>
        {(p.vatNote || p.brand) && (
          <div className="text-[11px] text-muted-foreground">{[p.brand, p.vatNote].filter(Boolean).join(' · ')}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{p.categoryName ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{priceText(p)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><StockCell n={p.inventory} /></td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{p.unit ?? '—'}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {p.warehouseName ?? (p.warehouseId != null ? `#${p.warehouseId}` : '—')}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
        <MiniAppCell p={p} mauLink={mauLink} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
        <DocLink code={p.code} />
      </td>
    </tr>
  )
}

function Card({ p, mauLink }: { p: CrmProduct; mauLink: string }) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-lg border bg-card p-3', p.status === 'inactive' && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <span className="rounded bg-muted px-1 font-mono text-[10px]">{p.code ?? '—'}</span>
        <StockCell n={p.inventory} />
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</p>
      {p.categoryName && <p className="text-[11px] text-muted-foreground">{p.categoryName}</p>}
      <p className="mt-auto pt-1 text-sm font-bold tabular-nums">{priceText(p)}</p>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{p.unit ?? ''}</span>
        <DocLink code={p.code} />
      </div>
      <MiniAppCell p={p} mauLink={mauLink} />
    </div>
  )
}
