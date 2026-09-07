import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/hooks/use-api'

export interface CompanyListItem {
  id: string
  name: string
  taxCode: string | null
  industry: string | null
  size: string | null
  website: string | null
  address: string | null
  phone: string | null
  email: string | null
  notes: string | null
  tags: string[]
  createdAt: string
  owner: { id: string; fullName: string | null } | null
  _count?: { contacts: number }
}

export interface CompanyListResponse {
  companies: CompanyListItem[]
  total: number
  page: number
  limit: number
}

export interface CompanyInput {
  name?: string
  taxCode?: string | null
  industry?: string | null
  size?: string | null
  website?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
}

export interface CompanyQueryParams {
  page?: number
  limit?: number
  search?: string
}

export function useCompanies(params: CompanyQueryParams) {
  return useApiQuery<CompanyListResponse>(
    ['companies', params],
    '/companies',
    params as Record<string, unknown>,
    { placeholderData: (prev) => prev },
  )
}

export function useCompany(id: string | undefined) {
  return useQuery<CompanyListItem & { contacts: unknown[] }>({
    queryKey: ['company', id],
    queryFn: async () => {
      const { data } = await api.get(`/companies/${id}`)
      return data
    },
    enabled: !!id,
  })
}

export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CompanyInput) => {
      const res = await api.post('/companies', data)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: CompanyInput }) => {
      const res = await api.patch(`/companies/${vars.id}`, vars.data)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  })
}

export function useDeleteCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/companies/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  })
}
