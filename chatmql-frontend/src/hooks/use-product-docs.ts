/**
 * use-product-docs.ts — Tài liệu bán hàng gắn theo MÃ sản phẩm.
 *
 * Tri thức này do ChatMQL sở hữu (ảnh · mô tả · video), tách khỏi dữ liệu gốc
 * sản phẩm lấy từ hệ thống nguồn. Backend: product-docs-routes.ts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export interface ProductDoc {
  id: string
  productCode: string
  /** Danh mục trong cây tài liệu bán hàng (doc_folders). */
  folderId: string | null
  name: string | null
  description: string | null
  images: string[]
  videoUrls: string[]
  keywords: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductDocInput {
  folderId?: string | null
  name?: string | null
  description?: string | null
  images?: string[]
  videoUrls?: string[]
  keywords?: string | null
}

/** Tài liệu của nhiều mã cùng lúc — dùng cho danh sách, tránh gọi từng cái. */
export function useProductDocsByCodes(codes: string[]) {
  const key = [...new Set(codes.filter(Boolean))].sort()
  return useQuery<Map<string, ProductDoc>>({
    queryKey: ['product-docs', 'by-codes', key],
    enabled: key.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<{ docs: ProductDoc[] }>('/product-docs', {
        params: { codes: key.join(',') },
      })
      return new Map(data.docs.map((d) => [d.productCode, d]))
    },
  })
}

/** Toàn bộ tài liệu đã soạn — dùng cho trang tổng quan Tài liệu bán hàng. */
export function useAllProductDocs() {
  return useQuery<ProductDoc[]>({
    queryKey: ['product-docs', 'all'],
    staleTime: 60_000,
    queryFn: async () => (await api.get<{ docs: ProductDoc[] }>('/product-docs')).data.docs,
  })
}

export function useProductDoc(code: string | undefined) {
  return useQuery<ProductDoc | null>({
    queryKey: ['product-docs', 'one', code],
    enabled: !!code,
    queryFn: async () =>
      (await api.get<{ doc: ProductDoc | null }>(`/product-docs/${encodeURIComponent(code!)}`)).data.doc,
  })
}

export function useSaveProductDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { code: string; data: ProductDocInput }) =>
      (await api.put<{ doc: ProductDoc }>(`/product-docs/${encodeURIComponent(vars.code)}`, vars.data)).data.doc,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-docs'] }),
  })
}
