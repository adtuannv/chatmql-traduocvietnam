/**
 * use-doc-library.ts — Thư viện tài liệu bán hàng: thư mục + tài nguyên.
 * Backend: doc-library-routes.ts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { API_ORIGIN } from '@/lib/config'

export type AssetKind = 'product' | 'image' | 'video' | 'pdf' | 'doc' | 'text' | 'link'
export type Visibility = 'sales' | 'internal' | 'ai_only'

export const KIND_LABELS: Record<AssetKind, string> = {
  product: 'Sản phẩm',
  image: 'Hình ảnh',
  video: 'Video',
  pdf: 'PDF',
  doc: 'Tài liệu',
  text: 'Văn bản',
  link: 'Đường dẫn',
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  sales: 'Gửi khách được',
  internal: 'Chỉ nội bộ',
  ai_only: 'Chỉ AI đọc',
}

export interface DocFolder {
  id: string
  parentId: string | null
  name: string
  description: string | null
  icon: string | null
  visibility: Visibility
  sortOrder: number
  assetCount: number
  createdAt: string
  updatedAt: string
}

export interface DocAsset {
  id: string
  folderId: string | null
  kind: AssetKind
  title: string
  description: string | null
  textContent: string | null
  fileUrl: string | null
  thumbUrl: string | null
  /** Bộ ảnh (loại `product`). Ảnh đầu là ảnh đại diện. */
  images: string[]
  videoUrls: string[]
  fileSize: number | null
  mimeType: string | null
  sourceUrl: string | null
  sourceId: string | null
  productCodes: string[]
  tags: string[]
  visibility: Visibility
  createdAt: string
  updatedAt: string
}

export interface AssetQuery {
  folderId?: string
  unfiled?: boolean
  kind?: AssetKind
  productCode?: string
  q?: string
  page?: number
  pageSize?: number
}

// ── Thư mục ─────────────────────────────────────────────────────────

export function useDocFolders() {
  return useQuery<DocFolder[]>({
    queryKey: ['doc-library', 'folders'],
    queryFn: async () => (await api.get<{ folders: DocFolder[] }>('/doc-library/folders')).data.folders,
  })
}

export function useSaveDocFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id?: string; data: Partial<DocFolder> }) =>
      vars.id
        ? (await api.patch<{ folder: DocFolder }>(`/doc-library/folders/${vars.id}`, vars.data)).data.folder
        : (await api.post<{ folder: DocFolder }>('/doc-library/folders', vars.data)).data.folder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-library'] }),
  })
}

export function useDeleteDocFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/doc-library/folders/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-library'] }),
  })
}

// ── Tài nguyên ──────────────────────────────────────────────────────

export function useDocAssets(query: AssetQuery) {
  const params: Record<string, unknown> = { page: query.page ?? 1, pageSize: query.pageSize ?? 50 }
  if (query.unfiled) params.unfiled = 'true'
  else if (query.folderId) params.folderId = query.folderId
  if (query.kind) params.kind = query.kind
  if (query.productCode) params.productCode = query.productCode
  if (query.q?.trim()) params.q = query.q.trim()

  return useQuery<{ items: DocAsset[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>({
    queryKey: ['doc-library', 'assets', params],
    placeholderData: (prev) => prev,
    queryFn: async () => (await api.get('/doc-library/assets', { params })).data,
  })
}

export function useSaveDocAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id?: string; data: Partial<DocAsset> }) =>
      vars.id
        ? (await api.patch<{ asset: DocAsset }>(`/doc-library/assets/${vars.id}`, vars.data)).data.asset
        : (await api.post<{ asset: DocAsset }>('/doc-library/assets', vars.data)).data.asset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-library'] }),
  })
}

export function useDeleteDocAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/doc-library/assets/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-library'] }),
  })
}

export interface UploadResult {
  url: string
  kind: AssetKind
  mimeType: string
  fileSize: number
  originalName: string
}

/** Tải tệp lên trước, rồi mới tạo bản ghi — người dùng còn phải đặt tiêu đề. */
export function useUploadDocFile() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return (await api.post<UploadResult>('/doc-library/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data
    },
  })
}

/** Đường dẫn tương đối từ backend → URL tuyệt đối để trình duyệt mở được. */
export function assetUrl(u?: string | null): string | undefined {
  if (!u) return undefined
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return u
  return `${API_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`
}

/**
 * Gửi tài nguyên đã chọn vào hội thoại.
 * Backend chặn lại lần nữa theo `visibility` — giao diện lọc chỉ là lớp trải nghiệm.
 */
/** Một tài liệu trong gói gửi, đã chọn sẵn phần nào đi phần nào ở lại. */
export interface SendDocItem {
  assetId: string
  /** Sản phẩm: gửi kèm tin giới thiệu + giá. Mặc định bật. */
  includeIntro?: boolean
  /** Ảnh được chọn. Bỏ trống nghĩa là gửi bộ mặc định của tài liệu. */
  imageUrls?: string[]
  videoUrls?: string[]
}

export interface SendDocInput {
  conversationId: string
  /** Gửi trọn bộ — giữ cho các chỗ gọi cũ. */
  assetIds?: string[]
  /** Gói tự soạn: chọn đúng phần muốn gửi. */
  items?: SendDocItem[]
  /** Lời nhắn đi TRƯỚC gói tài liệu. */
  note?: string
}

export function useSendDocAssets() {
  return useMutation({
    mutationFn: async (input: SendDocInput) =>
      (await api.post<{
        sent: number
        sentIds: string[]
        /** Số tin khách thực nhận — khác số tài liệu vì một sản phẩm ra nhiều tin. */
        messages: number
        skipped: Array<{ id: string; reason: string }>
        /** Tin chữ soạn xong nhưng kênh không nhận — khách chưa thấy. */
        failedText: string[]
      }>('/doc-library/send', input)).data,
  })
}
