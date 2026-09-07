import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Loading, EmptyState } from './feedback'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  emptyTitle = 'Không có dữ liệu',
  onRowClick,
  rowKey,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  emptyTitle?: string
  onRowClick?: (row: T) => void
  rowKey: (row: T) => string
}) {
  if (loading) return <Loading label="Đang tải..." />
  if (!rows.length) return <EmptyState title={emptyTitle} />

  return (
    <div className="w-full overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'border-b last:border-0 transition-colors hover:bg-muted/40',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-4 py-3 align-middle',
                    c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : '',
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
