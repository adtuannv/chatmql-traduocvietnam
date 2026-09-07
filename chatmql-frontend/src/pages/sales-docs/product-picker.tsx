/**
 * product-picker.tsx — Ghép nối tài liệu với sản phẩm của hệ thống.
 *
 * Tài liệu được soạn ĐỘC LẬP; chỉ khi người dùng chủ động chọn ở đây thì mới
 * nạp dữ liệu sản phẩm thật (tên, giá, tồn) từ hệ thống nguồn. Lưu lại chỉ là
 * MÃ sản phẩm — đổi hệ thống nguồn vẫn giữ nguyên ghép nối.
 */
import { useEffect, useState } from 'react'
import { Loader2, Plus, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatVnd } from '@/lib/order-calc'
import { useCrmProductSearch, useCrmProductList } from '@/hooks/use-crm-products'

interface Props {
  /** Mã đã ghép nối. */
  value: string[]
  onChange: (codes: string[]) => void
}

export function ProductPicker({ value, onChange }: Props) {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const searchQ = useCrmProductSearch(q, 15)

  // Nạp thông tin của các mã ĐÃ ghép để hiện tên + giá, không chỉ trơ mã.
  const linkedQ = useCrmProductList({ pageSize: 200 })
  const linked = (linkedQ.data?.products ?? []).filter((p) => p.code && value.includes(p.code.toUpperCase()))

  useEffect(() => {
    const t = setTimeout(() => setQ(input), 350)
    return () => clearTimeout(t)
  }, [input])

  const add = (code: string) => {
    const c = code.trim().toUpperCase()
    if (!c || value.includes(c)) return
    onChange([...value, c])
    setInput('')
    setQ('')
  }
  const remove = (code: string) => onChange(value.filter((c) => c !== code))

  const results = (searchQ.data?.products ?? []).filter((p) => p.code && !value.includes(p.code.toUpperCase()))

  return (
    <div className="space-y-2">
      {/* Danh sách đã ghép — hiện dữ liệu thật lấy từ hệ thống nguồn. */}
      {value.length > 0 && (
        <div className="space-y-1">
          {value.map((code) => {
            const p = linked.find((x) => x.code?.toUpperCase() === code)
            return (
              <div key={code} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                <span className="rounded bg-muted px-1 font-mono text-[10px]">{code}</span>
                <span className="min-w-0 flex-1 truncate">
                  {p ? p.name : linkedQ.isLoading ? 'Đang tải…' : <span className="text-muted-foreground">Không thấy mã này ở hệ thống nguồn</span>}
                </span>
                {p?.price != null && <span className="shrink-0 font-medium tabular-nums">{formatVnd(p.price)}</span>}
                {p?.inventory != null && p.inventory > 0 && (
                  <Badge variant="secondary" className="shrink-0 text-[9px]">
                    Tồn {p.inventory}
                  </Badge>
                )}
                <button type="button" onClick={() => remove(code)} aria-label={`Bỏ ghép nối ${code}`} className="shrink-0 text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Ô tìm để ghép thêm */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              // Enter khi có kết quả thì lấy kết quả đầu; không có thì coi như gõ thẳng mã.
              if (results[0]?.code) add(results[0].code)
              else if (input.trim()) add(input)
            }
          }}
          placeholder="Tìm sản phẩm để ghép nối (tên hoặc mã)…"
          className="h-9 pl-8 text-sm"
        />
        {searchQ.isFetching && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {q.trim() && (
        <div className="max-h-48 overflow-y-auto rounded-md border">
          {searchQ.isLoading ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Đang tìm…</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Không thấy sản phẩm khớp “{q}”. Nhấn Enter để ghép thẳng theo mã này.
            </p>
          ) : (
            results.map((p) => (
              <button
                key={p.code}
                type="button"
                onClick={() => add(p.code!)}
                className="flex w-full items-center gap-2 border-b px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent"
              >
                <Plus className="h-3 w-3 shrink-0 text-primary" />
                <span className="rounded bg-muted px-1 font-mono text-[10px]">{p.code}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.price != null && <span className="shrink-0 tabular-nums">{formatVnd(p.price)}</span>}
              </button>
            ))
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Để trống nếu tài liệu không thuộc sản phẩm nào (biểu giá, ảnh xưởng, banner…).
      </p>
    </div>
  )
}
