import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/** Helper GET + TanStack Query. */
export function useApiQuery<T>(
  key: unknown[],
  url: string,
  params?: Record<string, unknown>,
  options?: Partial<UseQueryOptions<T>>,
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      const { data } = await api.get<T>(url, { params })
      return data
    },
    ...options,
  })
}
