/**
 * keo-sap-xep.ts — Kéo thả để đổi thứ tự một danh sách.
 *
 * Dùng kéo-thả sẵn có của trình duyệt, không thêm thư viện: nhu cầu ở đây chỉ
 * là đổi chỗ vài tấm ảnh, không đáng thêm vài chục KB vào gói tải về.
 *
 * ⚠️ Kéo-thả của trình duyệt KHÔNG chạy trên màn cảm ứng. Chỗ nào dùng hook này
 * vẫn phải giữ nút mũi tên hoặc cách khác để đổi chỗ, nếu không người dùng máy
 * tính bảng sẽ không sắp xếp được.
 */
import { useCallback, useState } from 'react'

export interface KeoSapXep {
  /** Vị trí đang được kéo. null = không kéo gì. */
  dangKeo: number | null
  /** Vị trí con trỏ đang lơ lửng bên trên. */
  dangTren: number | null
  /** Gắn vào từng phần tử trong danh sách. */
  props: (i: number) => {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
    onDragEnter: () => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
}

/** Chuyển phần tử từ vị trí này sang vị trí kia, trả về mảng mới. */
export function doiCho<T>(ds: T[], tu: number, den: number): T[] {
  if (tu === den || tu < 0 || den < 0 || tu >= ds.length || den >= ds.length) return ds
  const v = [...ds]
  const [lay] = v.splice(tu, 1)
  v.splice(den, 0, lay)
  return v
}

export function useKeoSapXep(onSapXep: (tu: number, den: number) => void): KeoSapXep {
  const [dangKeo, setDangKeo] = useState<number | null>(null)
  const [dangTren, setDangTren] = useState<number | null>(null)

  const props = useCallback((i: number) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      setDangKeo(i)
      // Firefox không bắt đầu kéo nếu dataTransfer rỗng.
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(i))
    },
    onDragEnter: () => setDangTren(i),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const tu = Number(e.dataTransfer.getData('text/plain'))
      if (Number.isInteger(tu) && tu !== i) onSapXep(tu, i)
      setDangKeo(null)
      setDangTren(null)
    },
    onDragEnd: () => { setDangKeo(null); setDangTren(null) },
  }), [onSapXep])

  return { dangKeo, dangTren, props }
}
