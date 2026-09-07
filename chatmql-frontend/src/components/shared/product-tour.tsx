/**
 * product-tour.tsx — Tour tương tác: tô sáng đúng phần tử thật trên màn hình.
 *
 * Khác với bản đọc trong HDSD, tour này chạy ĐÈ LÊN giao diện đang dùng: khoét
 * một lỗ sáng quanh nút đang nói tới, làm tối phần còn lại, và đặt bảng chỉ dẫn
 * cạnh đó. Người học nhìn thẳng vào thứ mình sẽ bấm chứ không phải đoán.
 *
 * Ba điều làm tour kiểu này hay hỏng, và cách xử lý ở đây:
 *   • Phần tử chưa render (đang tải, ở trang khác) — chờ có mặt trong một
 *     khoảng, không thấy thì bỏ qua bước thay vì treo màn hình.
 *   • Phần tử nằm ngoài tầm nhìn — cuộn vào giữa trước khi đo.
 *   • Bố cục xê dịch khi cuộn hoặc đổi cỡ cửa sổ — đo lại liên tục theo khung
 *     hình, nên lỗ sáng luôn bám đúng chỗ.
 *
 * Mốc neo bằng thuộc tính `data-tour` chứ không bằng class: class đổi theo
 * thiết kế, còn `data-tour` là hợp đồng có chủ đích giữa giao diện và tour.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Hand, List, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface TourStep {
  /**
   * Chương chứa bước này. Tour dài phải chia chương thì người học mới biết
   * mình đang ở đoạn nào và còn bao nhiêu — 20 bước trôi tuột không có mốc
   * nghỉ là bỏ giữa chừng.
   */
  section?: string
  /** Mốc trên giao diện, ví dụ `[data-tour="chat-docs"]`. Bỏ trống = bảng giữa màn. */
  selector?: string
  title: string
  body: string
  /** Điều hướng tới trang này trước khi tìm mốc. */
  route?: string
  /** Bấm thẳng vào mốc để sang bước sau — dùng cho nút mở ra thứ cần xem tiếp. */
  clickToAdvance?: boolean
  /** Tự bấm hộ khi vào bước, cho những chỗ phải mở ra mới thấy. */
  autoClick?: boolean
  /**
   * Bấm phần tử này TRƯỚC khi tìm mốc chính. Dùng khi mốc nằm trong một tab
   * chưa mở: người học đang ở tab khác thì không có gì để tô sáng, mà bắt họ
   * tự mò đúng tab thì tour hết tác dụng.
   */
  prepareClick?: string
  /** Nới rộng vùng sáng (px), mặc định 6. */
  pad?: number
  /**
   * Hiện khi không tìm thấy mốc. Nhiều mốc chỉ tồn tại sau một thao tác — ví
   * dụ thanh công cụ chat chỉ có khi đã mở một hội thoại — nên phải nói rõ
   * cần làm gì thay vì để người học nhìn một bảng trôi giữa màn.
   */
  missingHint?: string
}

export interface TourDef {
  id: string
  label: string
  steps: TourStep[]
}

interface Rect { top: number; left: number; width: number; height: number }

const PANEL_W = 340
const GAP = 14

/**
 * Mốc dùng được là mốc NHÌN THẤY được.
 *
 * Nhiều vùng bị ẩn theo bề ngang màn hình (`hidden xl:flex`) nhưng vẫn nằm
 * trong DOM, nên `querySelector` thấy mà kích thước bằng 0 — tô sáng một ô 0×0
 * ở góc trái là tệ hơn cả không tô. Coi như chưa có để tour nói rõ lý do.
 */
function visible(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 4 && r.height > 4 ? el : null
}

/** Chờ phần tử xuất hiện; trả null nếu quá hạn để tour đi tiếp chứ không treo. */
function waitFor(selector: string, timeout = 2500): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const found = visible(document.querySelector<HTMLElement>(selector))
    if (found) { resolve(found); return }
    const started = Date.now()
    const timer = window.setInterval(() => {
      const el = visible(document.querySelector<HTMLElement>(selector))
      if (el || Date.now() - started > timeout) {
        window.clearInterval(timer)
        resolve(el)
      }
    }, 120)
  })
}

export function ProductTour({
  tour, onClose,
}: { tour: TourDef; onClose: () => void }) {
  const navigate = useNavigate()
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  /** Bước có mốc nhưng mốc chưa xuất hiện trên màn hình. */
  const [missing, setMissing] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const targetRef = useRef<HTMLElement | null>(null)

  const step = tour.steps[idx]
  const isLast = idx === tour.steps.length - 1

  const next = useCallback(() => {
    if (isLast) onClose()
    else setIdx((i) => i + 1)
  }, [isLast, onClose])

  // Vào bước: điều hướng nếu cần, chờ mốc, cuộn vào tầm nhìn rồi mới đo.
  useEffect(() => {
    let alive = true
    setReady(false)
    setRect(null)
    setMissing(false)
    targetRef.current = null

    const run = async () => {
      // So khớp theo NHÁNH đường dẫn, không so bằng tuyệt đối: đang mở
      // /conversations/<id> mà thấy khác /conversations rồi điều hướng lại là
      // đóng mất hội thoại, và mọi mốc phía sau biến sạch.
      if (step.route && !window.location.pathname.startsWith(step.route)) {
        navigate(step.route)
        await new Promise((r) => setTimeout(r, 420))
      }
      if (!alive) return

      if (step.prepareClick) {
        visible(document.querySelector<HTMLElement>(step.prepareClick))?.click()
        await new Promise((r) => setTimeout(r, 360))
        if (!alive) return
      }

      if (!step.selector) { setReady(true); return }

      const el = await waitFor(step.selector)
      if (!alive) return
      if (!el) { setMissing(true); setReady(true); return }

      if (step.autoClick) {
        el.click()
        await new Promise((r) => setTimeout(r, 350))
        if (!alive) return
      }

      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      await new Promise((r) => setTimeout(r, 320))
      if (!alive) return

      targetRef.current = el
      setReady(true)
    }
    void run()
    return () => { alive = false }
  }, [idx, step, navigate])

  // Đo lại theo khung hình: cuộn, đổi cỡ, hay bố cục tự xê dịch đều bám kịp.
  useLayoutEffect(() => {
    if (!ready) return
    let raf = 0
    const measure = () => {
      // Người học vừa làm theo hướng dẫn (mở một hội thoại chẳng hạn) thì mốc
      // mới xuất hiện — bắt lấy ngay thay vì bắt họ bấm Tiếp rồi quay lại.
      if (step.selector && !visible(targetRef.current)) {
        const late = visible(document.querySelector<HTMLElement>(step.selector))
        targetRef.current = late
        setMissing((m) => {
          const now = !late
          return m === now ? m : now
        })
      }
      const el = targetRef.current
      if (el?.isConnected) {
        const r = el.getBoundingClientRect()
        const pad = step.pad ?? 6
        setRect({
          top: r.top - pad,
          left: r.left - pad,
          width: r.width + pad * 2,
          height: r.height + pad * 2,
        })
      } else {
        setRect(null)
      }
      raf = window.requestAnimationFrame(measure)
    }
    raf = window.requestAnimationFrame(measure)
    return () => window.cancelAnimationFrame(raf)
  }, [ready, step.pad, step.selector])

  // Bấm vào mốc để sang bước sau.
  useEffect(() => {
    if (!ready || !step.clickToAdvance) return
    const el = targetRef.current
    if (!el) return
    const onClick = () => window.setTimeout(next, 260)
    el.addEventListener('click', onClick, { once: true })
    return () => el.removeEventListener('click', onClick)
  }, [ready, step.clickToAdvance, next, idx])

  // Escape để thoát, mũi tên để đi lại — tour phải bỏ được ngay lập tức.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, onClose])

  const sections = groupSections(tour.steps)
  const panel = placePanel(rect)

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {/* Bốn mảng tối chặn bấm nhầm ra ngoài; vùng sáng ở giữa vẫn bấm được.
          Chưa thấy mốc thì phủ nhạt và KHÔNG chặn: bước đó thường bảo người
          học tự mở một hội thoại, chặn chuột là bảo làm rồi không cho làm. */}
      {rect
        ? <Shades rect={rect} />
        : <div className={cn('absolute inset-0', missing ? 'pointer-events-none bg-black/25' : 'bg-black/55')} />}

      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-300"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        >
          <span className="absolute inset-0 animate-pulse rounded-lg ring-4 ring-primary/25" />
        </div>
      )}

      <div
        className="pointer-events-auto absolute w-[340px] rounded-xl border bg-card p-4 shadow-2xl transition-all duration-300"
        style={panel}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
            {idx + 1}/{tour.steps.length}
          </span>
          {step.section && (
            <span className="min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {step.section}
            </span>
          )}
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            aria-label="Mục lục"
            title="Mục lục các chương"
            className={cn(
              'ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-accent',
              tocOpen && 'bg-accent text-foreground',
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Thoát hướng dẫn"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {tocOpen && (
          <div className="mb-2 max-h-44 overflow-y-auto rounded-lg border bg-muted/40 p-1">
            {sections.map((sec) => (
              <button
                key={sec.name}
                type="button"
                onClick={() => { setIdx(sec.start); setTocOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] transition-colors hover:bg-card',
                  idx >= sec.start && idx <= sec.end ? 'bg-card font-semibold' : 'text-muted-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{sec.name}</span>
                <span className="shrink-0 text-[10px] opacity-70">{sec.end - sec.start + 1} bước</span>
              </button>
            ))}
          </div>
        )}

        <b className="mb-1 block text-[14px] leading-snug">{step.title}</b>

        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{step.body}</p>

        {missing && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11.5px] leading-snug text-amber-900">
            {step.missingHint ?? 'Phần này chưa có trên màn hình hiện tại. Mở đúng màn rồi bấm Tiếp.'}
          </p>
        )}

        {!missing && step.clickToAdvance && (
          <p className="mt-2 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-[11.5px] font-medium text-primary">
            <Hand className="h-3.5 w-3.5 shrink-0" /> Bấm thử vào chỗ đang sáng để đi tiếp
          </p>
        )}

        <div className="mt-3 flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 gap-1">
            {tour.steps.map((s, i) => (
              <span
                key={s.title}
                className={cn('h-1 flex-1 rounded-full transition-colors', i <= idx ? 'bg-primary' : 'bg-border')}
              />
            ))}
          </div>
          <Button
            variant="ghost" size="sm" className="h-7 px-2"
            disabled={idx === 0}
            onClick={() => setIdx((i) => i - 1)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="h-7 px-2.5 text-[12px]" onClick={next}>
            {isLast ? 'Kết thúc' : 'Tiếp'} {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Gom các bước liền nhau cùng chương để dựng mục lục. */
function groupSections(steps: TourStep[]): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = []
  steps.forEach((s, i) => {
    const name = s.section ?? 'Nội dung'
    const last = out[out.length - 1]
    if (last && last.name === name) last.end = i
    else out.push({ name, start: i, end: i })
  })
  return out
}

/** Bốn mảng tối quanh lỗ sáng — cách duy nhất vừa làm tối vừa cho bấm vào giữa. */
function Shades({ rect }: { rect: Rect }) {
  const cls = 'pointer-events-auto absolute bg-black/55 transition-all duration-300'
  return (
    <>
      <div className={cls} style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }} />
      <div className={cls} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
      <div className={cls} style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} />
      <div className={cls} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
    </>
  )
}

/**
 * Đặt bảng chỉ dẫn cạnh vùng sáng, ưu tiên bên phải rồi trái rồi dưới; hết chỗ
 * thì về giữa màn. Luôn kẹp trong khung hình để không bao giờ lọt ra ngoài.
 */
function placePanel(rect: Rect | null): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!rect) {
    return { top: vh / 2 - 90, left: vw / 2 - PANEL_W / 2 }
  }
  const clampTop = (t: number) => Math.max(12, Math.min(t, vh - 210))

  if (rect.left + rect.width + GAP + PANEL_W < vw) {
    return { top: clampTop(rect.top), left: rect.left + rect.width + GAP }
  }
  if (rect.left - GAP - PANEL_W > 0) {
    return { top: clampTop(rect.top), left: rect.left - GAP - PANEL_W }
  }
  const left = Math.max(12, Math.min(rect.left, vw - PANEL_W - 12))
  if (rect.top + rect.height + GAP + 190 < vh) {
    return { top: rect.top + rect.height + GAP, left }
  }
  return { top: clampTop(rect.top - GAP - 190), left }
}
