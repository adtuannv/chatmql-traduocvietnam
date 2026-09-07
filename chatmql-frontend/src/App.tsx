import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { router } from './routes'
import { queryClient } from '@/lib/query-client'
import { TooltipProvider } from '@/components/ui/misc'
import { useAuthStore } from '@/stores/auth-store'
import { getToken } from '@/lib/api-client'

export default function App() {
  const loadMe = useAuthStore((s) => s.loadMe)
  const setUser = useAuthStore((s) => s.setUser)

  useEffect(() => {
    if (getToken()) {
      void loadMe()
    } else {
      setUser(null)
      useAuthStore.setState({ loading: false })
    }
  }, [loadMe, setUser])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
