import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { COMPANY_FIELDS } from './settings-utils'

export function CompanyTab() {
  const { data, isLoading, isError } = useSettings()
  const update = useUpdateSettings()
  const [form, setForm] = useState<Record<string, string>>({})

  // Nạp giá trị hiện có vào form khi có dữ liệu.
  useEffect(() => {
    if (!data) return
    const next: Record<string, string> = {}
    for (const f of COMPANY_FIELDS) next[f.key] = data.settings[f.key] ?? ''
    setForm(next)
  }, [data])

  if (isLoading) return <Loading label="Đang tải thông tin công ty..." />
  if (isError || !data) return <ErrorState />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const entries = COMPANY_FIELDS.map((f) => ({ key: f.key, value: form[f.key] ?? '' }))
    try {
      await update.mutateAsync(entries)
      toast.success('Đã lưu thông tin công ty')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin công ty</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {COMPANY_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type={f.type || 'text'}
                  placeholder={f.placeholder}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
