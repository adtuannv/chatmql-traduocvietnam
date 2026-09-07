/**
 * user-guide-dialog.tsx — Hướng dẫn sử dụng (HDSD) dạng onboarding.
 *
 * Hai màn, đúng cách người mới tìm thông tin:
 *   1. CHỌN MODULE — lưới thẻ, mỗi thẻ một mảng việc, kèm dấu đã học xong.
 *   2. TỪNG BƯỚC   — danh sách bước bên trái, nội dung bên phải, đi tới đi lui.
 *
 * Module nào có màn hình để chỉ thì kèm một TOUR TƯƠNG TÁC: tour tô sáng đúng
 * nút trên giao diện thật và dẫn đi từng chỗ. Hai thứ bổ cho nhau — tour dạy
 * "bấm ở đâu", phần đọc nói "vì sao và tránh gì" — nên bản đọc vẫn giữ.
 *
 * Tiến độ lưu ở máy người dùng — đây là trí nhớ tiện tay, mất cũng không sao.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CircleCheck, ExternalLink, Lightbulb,
  MousePointerClick, TriangleAlert,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { GUIDE_MODULES, type GuideModule } from '@/lib/user-guide-content'
import { tourFor } from '@/lib/product-tours'
import { ProductTour } from './product-tour'

const DONE_KEY = 'chatmql_guide_done'

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    // Bộ nhớ trình duyệt hỏng hoặc bị chặn — coi như chưa học module nào.
    return new Set()
  }
}

function saveDone(done: Set<string>) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]))
  } catch { /* không lưu được thì thôi, không chặn người dùng đọc tiếp */ }
}

export function UserGuideDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [moduleId, setModuleId] = useState<string | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [done, setDone] = useState<Set<string>>(loadDone)
  /** Tour đang chạy — đóng hộp thoại để không che giao diện đang được chỉ. */
  const [tourId, setTourId] = useState<string | null>(null)

  // Mở lại thì bắt đầu từ danh sách module, khỏi rơi vào giữa bài cũ.
  useEffect(() => {
    if (open) { setModuleId(null); setStepIdx(0); setDone(loadDone()) }
  }, [open])

  const mod = useMemo(() => GUIDE_MODULES.find((m) => m.id === moduleId) ?? null, [moduleId])

  const markDone = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev)
      next.add(id)
      saveDone(next)
      return next
    })
  }

  const runTour = (id: string) => {
    setTourId(id)
    onOpenChange(false)
  }

  const activeTour = tourId ? tourFor(tourId) : null
  if (activeTour) {
    return <ProductTour tour={activeTour} onClose={() => setTourId(null)} />
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {mod ? (
          <ModuleSteps
            mod={mod}
            stepIdx={stepIdx}
            onStep={setStepIdx}
            onBack={() => { setModuleId(null); setStepIdx(0) }}
            onFinish={() => { markDone(mod.id); setModuleId(null); setStepIdx(0) }}
            onClose={() => onOpenChange(false)}
            onTour={() => runTour(mod.id)}
          />
        ) : (
          <ModulePicker
            done={done}
            onTour={runTour}
            onPick={(id) => { setModuleId(id); setStepIdx(0) }}
            onReset={() => { setDone(new Set()); saveDone(new Set()) }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Màn 1: chọn module ──────────────────────────────────────────────

function ModulePicker({
  done, onPick, onTour, onReset,
}: {
  done: Set<string>
  onPick: (id: string) => void
  onTour: (id: string) => void
  onReset: () => void
}) {
  const total = GUIDE_MODULES.length
  const finished = GUIDE_MODULES.filter((m) => done.has(m.id)).length

  return (
    <>
      <DialogHeader className="border-b px-6 py-4 pr-14">
        <DialogTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-primary" /> Hướng dẫn sử dụng
        </DialogTitle>
        <DialogDescription>
          Chọn phần muốn xem trước. Mỗi phần là một mảng việc, đọc hết mất vài phút.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-3 border-b bg-muted/40 px-6 py-2.5">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${(finished / total) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">Đã xem {finished}/{total}</span>
        {finished > 0 && (
          <button type="button" onClick={onReset} className="shrink-0 text-xs text-primary hover:underline">
            Đặt lại
          </button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 [&>div]:!block">
        <div className="grid grid-cols-1 gap-2.5 p-6 sm:grid-cols-2">
          {GUIDE_MODULES.map((m) => {
            const Icon = m.icon
            const isDone = done.has(m.id)
            const tour = tourFor(m.id)
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => onPick(m.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(m.id) }}
                className={cn(
                  'group flex cursor-pointer gap-3 rounded-xl border p-3.5 text-left transition-all hover:border-primary/60 hover:shadow-sm',
                  isDone && 'bg-primary/[0.03]',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                    isDone ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
                  )}
                >
                  {isDone ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <b className="text-sm">{m.label}</b>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {m.steps.length} bước
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                    {m.summary}
                  </span>
                  {tour && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onTour(m.id) }}
                      className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <MousePointerClick className="h-3 w-3" />
                      Tour tương tác · {tour.steps.length} bước
                    </button>
                  )}
                </span>
                <ArrowRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </>
  )
}

// ── Màn 2: từng bước ────────────────────────────────────────────────

function ModuleSteps({
  mod, stepIdx, onStep, onBack, onFinish, onClose, onTour,
}: {
  mod: GuideModule
  stepIdx: number
  onStep: (i: number) => void
  onBack: () => void
  onFinish: () => void
  onClose: () => void
  onTour: () => void
}) {
  const navigate = useNavigate()
  const step = mod.steps[stepIdx]
  const isLast = stepIdx === mod.steps.length - 1
  const Icon = mod.icon

  return (
    <>
      <DialogHeader className="border-b px-5 py-3 pr-14">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onBack} aria-label="Về danh sách">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{mod.label}</DialogTitle>
            <DialogDescription className="truncate">{mod.summary}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_1fr] overflow-hidden">
        {/* Danh sách bước — thấy được đang ở đâu trong cả bài */}
        <nav className="min-h-0 overflow-y-auto border-r bg-muted/30 p-2">
          {mod.steps.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => onStep(i)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[12px] leading-snug transition-colors',
                i === stepIdx ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:bg-card/60',
              )}
            >
              <span
                className={cn(
                  'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                  i < stepIdx ? 'bg-primary/15 text-primary'
                    : i === stepIdx ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground',
                )}
              >
                {i < stepIdx ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              <span className="min-w-0">{s.title}</span>
            </button>
          ))}
        </nav>

        <ScrollArea className="min-h-0 [&>div]:!block">
          <div className="space-y-4 p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Bước {stepIdx + 1}/{mod.steps.length}
              </p>
              <h3 className="mt-1 text-[17px] font-bold leading-tight">{step.title}</h3>
            </div>

            <p className="text-[13.5px] leading-relaxed text-foreground/90">{step.body}</p>

            {step.points && (
              <ul className="space-y-1.5">
                {step.points.map((p) => (
                  <li key={p} className="flex gap-2 text-[13px] leading-relaxed">
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}

            {step.warning && (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-[12.5px] leading-relaxed text-amber-900">{step.warning}</p>
              </div>
            )}

            {step.to && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { navigate(step.to!); onClose() }}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Mở màn hình này
              </Button>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center gap-2 border-t px-5 py-3">
        {tourFor(mod.id) ? (
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onTour}>
            <MousePointerClick className="h-3.5 w-3.5" /> Tour tương tác
          </Button>
        ) : (
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
          Đọc xong phần này rồi mở màn hình thật làm thử một lần.
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={stepIdx === 0}
          onClick={() => onStep(stepIdx - 1)}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Trước
        </Button>
        {isLast ? (
          <Button size="sm" className="font-semibold" onClick={onFinish}>
            <Check className="h-3.5 w-3.5" /> Xong phần này
          </Button>
        ) : (
          <Button size="sm" onClick={() => onStep(stepIdx + 1)}>
            Tiếp <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </>
  )
}
