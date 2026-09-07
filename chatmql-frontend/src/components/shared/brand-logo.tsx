import { getBranding } from '@/lib/branding'
import { cn } from '@/lib/utils'

export function BrandLogo({ className, showText = true }: { className?: string; showText?: boolean }) {
  const b = getBranding()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img
        src={b.logoUrl}
        alt={b.brandName}
        className="h-8 w-auto max-w-[140px] object-contain"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
      {showText && !b.logoUrl && <span className="text-lg font-bold">{b.brandName}</span>}
    </div>
  )
}
