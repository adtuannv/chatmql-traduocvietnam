import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Định dạng số kiểu VN (1.234) */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '0'
  return new Intl.NumberFormat('vi-VN').format(n)
}

/** Rút gọn tên → 2 ký tự initials */
export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
