import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { apiError } from '@/lib/api-client'
import { initials } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { Profile } from '@/hooks/use-settings'
import {
  useProfile,
  useUpdateProfile,
  useUploadAvatar,
  useDeleteAvatar,
} from '@/hooks/use-settings'
import { ROLE_LABELS, avatarSrc } from './settings-utils'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024

export function ProfilePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, isLoading, isError } = useProfile()
  const updateProfile = useUpdateProfile()
  const uploadAvatar = useUploadAvatar()
  const deleteAvatar = useDeleteAvatar()

  const setUser = useAuthStore((s) => s.setUser)
  const user = useAuthStore((s) => s.user)

  const [fullName, setFullName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (data) setFullName(data.fullName)
  }, [data])

  // Đồng bộ lại authStore (giữ nguyên các field khác của AuthUser).
  function syncAuth(p: Profile) {
    setUser({
      ...(user ?? {}),
      id: p.id,
      email: p.email,
      fullName: p.fullName,
      role: p.role,
      avatarUrl: p.avatarUrl,
      orgId: user?.orgId ?? '',
    })
  }

  if (isLoading) return <Loading label="Đang tải hồ sơ..." />
  if (isError || !data) return <ErrorState />

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) {
      toast.error('Vui lòng nhập họ tên')
      return
    }
    try {
      const updated = await updateProfile.mutateAsync({ fullName: fullName.trim() })
      syncAuth(updated)
      toast.success('Đã cập nhật hồ sơ')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng file
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Vui lòng chọn file ảnh')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Kích thước ảnh tối đa 2MB')
      return
    }
    try {
      const updated = await uploadAvatar.mutateAsync(file)
      syncAuth(updated)
      toast.success('Đã cập nhật ảnh đại diện')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function onRemoveAvatar() {
    try {
      const updated = await deleteAvatar.mutateAsync()
      syncAuth(updated)
      toast.success('Đã xóa ảnh đại diện')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const uploading = uploadAvatar.isPending || deleteAvatar.isPending

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader title="Hồ sơ của tôi" description="Xem và cập nhật thông tin cá nhân của bạn." />
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Thông tin cá nhân</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Ảnh đại diện */}
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              {data.avatarUrl && <AvatarImage src={avatarSrc(data.avatarUrl)} />}
              <AvatarFallback className="text-lg">{initials(data.fullName)}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadAvatar.isPending ? <Loader2 className="animate-spin" /> : <Camera />}
                  Đổi ảnh
                </Button>
                {data.avatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={uploading}
                    onClick={onRemoveAvatar}
                  >
                    {deleteAvatar.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Xóa ảnh
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPG, PNG, WebP hoặc GIF. Tối đa 2MB.</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Họ tên</Label>
              <Input
                id="profile-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={data.email} readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Vai trò</Label>
              <div>
                <Badge variant="secondary">{ROLE_LABELS[data.role]}</Badge>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Lưu thay đổi
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
