import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ZaloPersonalTab } from './zalo-personal-tab'
import { ZaloOaTab } from './zalo-oa-tab'
import { FacebookPageTab } from './facebook-page-tab'
import { PancakeTab } from './pancake-tab'
import { WebsiteChatTab } from './website-chat-tab'
import { useModuleEnabled } from '@/hooks/use-integrations'
import { FEATURES } from '@/lib/features'

const OA_ERRORS: Record<string, string> = {
  oa_not_configured: 'Zalo OA chưa được cấu hình trên máy chủ.',
  state_expired: 'Phiên uỷ quyền đã hết hạn, vui lòng thử lại.',
  state_invalid: 'Phiên uỷ quyền không hợp lệ.',
  missing_oa_id: 'Không lấy được thông tin OA.',
  server_misconfig: 'Máy chủ chưa cấu hình đầy đủ.',
}

const FB_ERRORS: Record<string, string> = {
  no_pages: 'Tài khoản Facebook không quản lý Fanpage nào.',
  state_expired: 'Phiên uỷ quyền đã hết hạn, vui lòng thử lại.',
  state_invalid: 'Phiên uỷ quyền không hợp lệ.',
  server_misconfig: 'Máy chủ chưa cấu hình đầy đủ.',
}

/**
 * Trang Tích hợp — quản lý kết nối các kênh (Zalo cá nhân, Zalo OA, Facebook, Pancake).
 * Route: /integrations
 */
export function IntegrationsPage() {
  // Pancake nằm trong kho lưu trữ → ẩn tab. Xem shared/module-registry.ts.
  const pancakeOn = useModuleEnabled('pancake')
  const [searchParams, setSearchParams] = useSearchParams()

  // Xử lý kết quả redirect OAuth (Zalo OA / Facebook) trả về qua query string.
  useEffect(() => {
    let handled = false

    if (searchParams.has('oa_connected')) {
      toast.success('Đã kết nối Zalo OA thành công')
      handled = true
    }
    const oaError = searchParams.get('oa_error')
    if (oaError) {
      toast.error(OA_ERRORS[oaError] || `Kết nối Zalo OA thất bại (${oaError})`)
      handled = true
    }

    const fbConnected = searchParams.get('fb_connected')
    if (fbConnected) {
      const n = Number(fbConnected)
      toast.success(n > 0 ? `Đã kết nối ${n} Fanpage` : 'Hoàn tất kết nối Facebook')
      const conflict = searchParams.get('fb_conflict')
      if (conflict && Number(conflict) > 0) {
        toast.warning(`${conflict} trang bị bỏ qua do đã kết nối ở kênh khác`)
      }
      handled = true
    }
    const fbError = searchParams.get('fb_error')
    if (fbError) {
      toast.error(FB_ERRORS[fbError] || `Kết nối Facebook thất bại (${fbError})`)
      handled = true
    }

    if (handled) {
      // Dọn query string để không hiển thị lại toast khi refresh
      setSearchParams({}, { replace: true })
    }
    // Chỉ chạy khi query string đổi
  }, [searchParams, setSearchParams])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tích hợp"
        description="Kết nối và quản lý các kênh giao tiếp với khách hàng."
      />

      <Tabs defaultValue="zalo-personal">
        <TabsList>
          <TabsTrigger value="zalo-personal">Zalo cá nhân</TabsTrigger>
          <TabsTrigger value="zalo-oa">Zalo OA</TabsTrigger>
          <TabsTrigger value="facebook">Facebook Page</TabsTrigger>
          {/* Widget live chat website (/widgets) — backend TDVN đã có (src/modules/widget). */}
          {FEATURES.WEBSITE_WIDGETS && <TabsTrigger value="website">Website / Live Chat</TabsTrigger>}
          {pancakeOn && <TabsTrigger value="pancake">Pancake</TabsTrigger>}
        </TabsList>

        <TabsContent value="zalo-personal">
          <ZaloPersonalTab />
        </TabsContent>
        <TabsContent value="zalo-oa">
          <ZaloOaTab />
        </TabsContent>
        <TabsContent value="facebook">
          <FacebookPageTab />
        </TabsContent>
        {FEATURES.WEBSITE_WIDGETS && (
          <TabsContent value="website">
            <WebsiteChatTab />
          </TabsContent>
        )}
        {pancakeOn && (
          <TabsContent value="pancake">
          <PancakeTab />
        </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
