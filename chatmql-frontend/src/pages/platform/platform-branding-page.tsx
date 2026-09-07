/**
 * platform-branding-page.tsx — Thương hiệu toàn hệ thống (Platform).
 * Route `/platform/branding`.
 *
 * Cấu hình brandName/tagline/primaryColor + upload logo & favicon. Đây là nguồn
 * mà toàn app đọc qua GET /platform/branding.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Save, Upload, Trash2, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { API_BASE } from '@/lib/config'
import { platformApiError } from '@/lib/platform-client'
import {
  usePlatformBranding,
  useUpdateBrandName,
  useUploadBrandingImage,
  useClearBrandingImage,
} from '@/hooks/use-platform'

export function PlatformBrandingPage() {
  const { data, isLoading, isError } = usePlatformBranding()
  const updateBrand = useUpdateBrandName()

  const [brandName, setBrandName] = useState('')
  const [tagline, setTagline] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#0045ff')

  useEffect(() => {
    if (data) {
      setBrandName(data.brandName ?? '')
      setTagline(data.tagline ?? '')
      setPrimaryColor(data.primaryColor ?? '#0045ff')
    }
  }, [data])

  async function onSaveBrand(e: React.FormEvent) {
    e.preventDefault()
    try {
      await updateBrand.mutateAsync({ brandName: brandName.trim(), tagline: tagline.trim(), primaryColor })
      toast.success('Đã lưu thương hiệu')
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  if (isLoading) return <Loading label="Đang tải..." />
  if (isError || !data) return <ErrorState message="Không tải được cấu hình thương hiệu." />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thương hiệu"
        description="Cấu hình nhận diện thương hiệu áp dụng cho toàn hệ thống."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin thương hiệu</CardTitle>
            <CardDescription>Tên, khẩu hiệu và màu chủ đạo hiển thị trên toàn app.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSaveBrand} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="brandName">Tên thương hiệu</Label>
                <Input id="brandName" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Trà Dược Việt Nam" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tagline">Khẩu hiệu (tagline)</Label>
                <Input id="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Empowering Digital Future" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="primaryColor">Màu chủ đạo</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="primaryColor"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-14 cursor-pointer rounded-md border bg-background"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="max-w-[160px]"
                  />
                </div>
              </div>
              <Button type="submit" disabled={updateBrand.isPending}>
                {updateBrand.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Lưu thương hiệu
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <BrandImageCard
            kind="logo"
            title="Logo"
            description="Ảnh logo hiển thị ở thanh điều hướng và trang đăng nhập."
            version={data.logoVersion}
          />
          <BrandImageCard
            kind="favicon"
            title="Favicon"
            description="Biểu tượng nhỏ hiển thị trên tab trình duyệt."
            version={data.faviconVersion}
          />
        </div>
      </div>
    </div>
  )
}

// ── Card upload ảnh (logo / favicon) ──────────────────────────────
function BrandImageCard({
  kind,
  title,
  description,
  version,
}: {
  kind: 'logo' | 'favicon'
  title: string
  description: string
  version: string | null
}) {
  const upload = useUploadBrandingImage(kind)
  const clear = useClearBrandingImage(kind)
  const fileRef = useRef<HTMLInputElement>(null)
  const [broken, setBroken] = useState(false)

  const imageUrl = `${API_BASE}/platform/branding/${kind}${version ? `?v=${encodeURIComponent(version)}` : ''}`

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Ảnh tối đa 2MB')
      return
    }
    try {
      const dataUrl = await readAsDataUrl(file)
      await upload.mutateAsync(dataUrl)
      setBroken(false)
      toast.success(`Đã cập nhật ${title.toLowerCase()}`)
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  async function onClear() {
    try {
      await clear.mutateAsync()
      toast.success(`Đã đặt lại ${title.toLowerCase()} mặc định`)
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
          {broken ? (
            <div className="flex flex-col items-center text-muted-foreground">
              <ImageIcon className="h-6 w-6" />
              <span className="mt-1 text-xs">Chưa có ảnh</span>
            </div>
          ) : (
            <img
              src={imageUrl}
              alt={title}
              className="max-h-20 max-w-[70%] object-contain"
              onError={() => setBroken(true)}
            />
          )}
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Tải lên
          </Button>
          <Button variant="ghost" onClick={onClear} disabled={clear.isPending}>
            <Trash2 className="h-4 w-4" /> Đặt lại
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
