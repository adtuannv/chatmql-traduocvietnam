import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { API_ORIGIN } from '@/lib/config'
import type { BadgeProps } from '@/components/ui/badge'

// ── Envelope backend { success, data, meta } ─────────────────────────
interface Envelope<T> {
  success: boolean
  data: T
  meta?: { page: number; pageSize: number; total: number; totalPages: number }
}

// ── Nhãn tiếng Việt & hằng số ────────────────────────────────────────
export const PRICE_TYPES = ['fixed', 'range', 'contact', 'free', 'description'] as const
export type PriceType = (typeof PRICE_TYPES)[number]

export const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: 'Giá cố định',
  range: 'Khoảng giá',
  contact: 'Liên hệ báo giá',
  free: 'Miễn phí',
  description: 'Giá trong mô tả',
}

export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  active: 'Đang bán',
  draft: 'Nháp',
  archived: 'Lưu trữ',
}

export function productStatusVariant(status?: string | null): BadgeProps['variant'] {
  switch (status) {
    case 'active':
      return 'success'
    case 'draft':
      return 'secondary'
    case 'archived':
      return 'outline'
    default:
      return 'secondary'
  }
}

/** Định dạng giá theo priceType để hiển thị trong bảng/chi tiết. */
export function formatProductPrice(p: Pick<Product, 'priceType' | 'price' | 'priceMax' | 'currency'>): string {
  const cur = p.currency || 'VND'
  const money = (v: number | null | undefined) =>
    v == null ? '—' : `${new Intl.NumberFormat('vi-VN').format(v)} ${cur}`
  switch (p.priceType) {
    case 'free':
      return 'Miễn phí'
    case 'contact':
      return 'Liên hệ báo giá'
    case 'description':
      return 'Giá trong mô tả'
    case 'range':
      if (p.price != null && p.priceMax != null) return `${money(p.price)} – ${money(p.priceMax)}`
      return money(p.price ?? p.priceMax)
    case 'fixed':
    default:
      return money(p.price)
  }
}

/** Ghép API_ORIGIN nếu URL ảnh là đường dẫn tương đối. */
export function resolveImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`
}

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────
export interface ProductCategoryLite {
  id: string
  name: string
}

export interface Product {
  id: string
  categoryId: string | null
  name: string
  code: string | null
  slug: string
  description: string | null
  notes: string | null
  keywords: string | null
  tags: string[]
  priceType: string
  price: number | null
  priceMax: number | null
  currency: string
  specs: Record<string, unknown>
  images: string[]
  /** Link video (YouTube / mp4) cho tài liệu bán hàng — backend `video_urls`. */
  videoUrls: string[]
  status: string
  sortOrder: number
  source: string
  createdAt: string
  updatedAt: string
  category: ProductCategoryLite | null
}

export interface ProductCategory {
  id: string
  parentId: string | null
  name: string
  slug: string
  description: string | null
  icon: string | null
  sortOrder: number
  productCount: number
  createdAt: string
  updatedAt: string
}

export interface ProductInput {
  name: string
  code?: string | null
  categoryId?: string | null
  description?: string | null
  notes?: string | null
  keywords?: string | null
  tags?: string[]
  priceType?: string
  price?: number | null
  priceMax?: number | null
  currency?: string
  images?: string[]
  videoUrls?: string[]
  status?: string
}

export interface ProductCategoryInput {
  name: string
  parentId?: string | null
  description?: string | null
  icon?: string | null
  sortOrder?: number
}

// ── Products query/mutation ──────────────────────────────────────────
export interface ProductQueryParams {
  page?: number
  pageSize?: number
  search?: string
  categoryId?: string
  status?: string
}

export interface ProductListResult {
  items: Product[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export function useProducts(params: ProductQueryParams) {
  return useQuery<ProductListResult>({
    queryKey: ['products', params],
    queryFn: async () => {
      const { data } = await api.get<Envelope<Product[]>>('/products', { params })
      return {
        items: data.data,
        meta: data.meta ?? { page: 1, pageSize: 20, total: data.data.length, totalPages: 1 },
      }
    },
    placeholderData: (prev) => prev,
  })
}

/** Một sản phẩm — dùng cho trang chi tiết Tài liệu bán hàng. Backend: GET /products/:id. */
export function useProduct(id: string | undefined) {
  return useQuery<Product>({
    queryKey: ['product', id],
    enabled: !!id,
    queryFn: async () => (await api.get<Envelope<Product>>(`/products/${id}`)).data.data,
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ProductInput) => {
      const { data } = await api.post<Envelope<Product>>('/products', input)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<ProductInput> }) => {
      const { data } = await api.patch<Envelope<Product>>(`/products/${vars.id}`, vars.data)
      return data.data
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['product', vars.id] }) // trang chi tiết Tài liệu bán hàng
    },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<Envelope<{ deleted: boolean }>>(`/products/${id}`)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

/** Upload ảnh sản phẩm → trả URL (tương đối). */
export function useUploadProductImage() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<Envelope<{ url: string }>>('/products/upload-image', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data.data.url
    },
  })
}

// ── Product categories query/mutation ────────────────────────────────
export function useProductCategories() {
  return useQuery<ProductCategory[]>({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const { data } = await api.get<Envelope<ProductCategory[]>>('/product-categories')
      return data.data
    },
  })
}

export function useCreateProductCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ProductCategoryInput) => {
      const { data } = await api.post<Envelope<ProductCategory>>('/product-categories', input)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  })
}

export function useUpdateProductCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<ProductCategoryInput> }) => {
      const { data } = await api.patch<Envelope<ProductCategory>>(
        `/product-categories/${vars.id}`,
        vars.data,
      )
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-categories'] }),
  })
}

export function useDeleteProductCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<Envelope<{ deleted: boolean }>>(`/product-categories/${id}`)
      return data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-categories'] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}
