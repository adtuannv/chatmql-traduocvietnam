import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, BarChart3, Info, Loader2, Plus, Trash2, Users } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/misc'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/** Zalo giới hạn số lựa chọn của một bình chọn. */
const MIN_OPTIONS = 2
const MAX_OPTIONS = 10

interface Props {
  convId: string
  isGroup: boolean
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Payload gửi lên `POST /conversations/:id/polls`. */
interface CreatePollBody {
  question: string
  options: string[]
  expiredTime?: number
  allowMultiChoices?: boolean
  allowAddNewOption?: boolean
  isAnonymous?: boolean
}

interface CreatePollResponse {
  success: boolean
  poll?: unknown
}

/** Ánh xạ lỗi HTTP sang thông điệp tiếng Việt rõ ràng. */
function pollError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  switch (status) {
    // 400 = không phải nhóm / dữ liệu sai → giữ nguyên thông điệp từ server
    case 400:
      return apiError(err) || 'Dữ liệu bình chọn không hợp lệ.'
    case 429:
      return 'Thao tác quá nhanh, thử lại sau'
    case 503:
      return 'Tài khoản Zalo chưa kết nối'
    default:
      return apiError(err) || 'Không tạo được bình chọn.'
  }
}

/**
 * Đổi giá trị của `<input type="datetime-local">` (giờ địa phương, không có
 * múi giờ) sang epoch ms. Trả `undefined` nếu chuỗi rỗng hoặc không hợp lệ.
 */
function toEpochMs(value: string): number | undefined {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** Thời điểm hiện tại theo định dạng `datetime-local` để chặn chọn quá khứ. */
function nowLocalInput(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

/** Trạng thái form ban đầu: đúng 2 ô lựa chọn trống. */
function emptyOptions(): string[] {
  return Array.from({ length: MIN_OPTIONS }, () => '')
}

/**
 * Hộp thoại "Tạo bình chọn" cho hội thoại nhóm Zalo.
 *
 * Bình chọn là tính năng CHỈ dành cho nhóm — backend trả 400
 * "Bình chọn chỉ dùng được trong nhóm" với chat 1-1. Vì vậy khi
 * `isGroup === false` hộp thoại không hiển thị form, chỉ báo cho người dùng
 * biết lý do để tránh gửi request chắc chắn lỗi.
 */
export function PollDialog({ convId, isGroup, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()

  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(emptyOptions)
  const [allowMultiChoices, setAllowMultiChoices] = useState(false)
  const [allowAddNewOption, setAllowAddNewOption] = useState(false)
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [expiredAt, setExpiredAt] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Tính lại mốc "không chọn quá khứ" mỗi lần mở hộp thoại
  const minDateTime = useMemo(() => nowLocalInput(), [open])

  function resetForm() {
    setQuestion('')
    setOptions(emptyOptions())
    setAllowMultiChoices(false)
    setAllowAddNewOption(false)
    setIsAnonymous(false)
    setExpiredAt('')
    setErrorMsg(null)
  }

  // Đóng hộp thoại → xoá toàn bộ trạng thái tạm
  useEffect(() => {
    if (open) return
    resetForm()
  }, [open])

  const createPoll = useMutation<CreatePollResponse, unknown, CreatePollBody>({
    mutationFn: async (body) => {
      const { data } = await api.post<CreatePollResponse>(
        `/conversations/${convId}/polls`,
        body,
      )
      return data
    },
    onSuccess: () => {
      toast.success('Đã tạo bình chọn')
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      onOpenChange(false)
      resetForm()
    },
    onError: (err) => {
      const message = pollError(err)
      setErrorMsg(message)
      toast.error(message)
    },
  })

  // Bỏ qua ô trống khi gửi — chỉ các lựa chọn có nội dung mới được tính
  const filledOptions = options.map((o) => o.trim()).filter(Boolean)
  const hasQuestion = question.trim().length > 0
  const canSubmit =
    hasQuestion && filledOptions.length >= MIN_OPTIONS && !createPoll.isPending

  function updateOption(index: number, value: string) {
    setErrorMsg(null)
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)))
  }

  function addOption() {
    setErrorMsg(null)
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, '']))
  }

  function removeOption(index: number) {
    setErrorMsg(null)
    setOptions((prev) => (prev.length <= MIN_OPTIONS ? prev : prev.filter((_, i) => i !== index)))
  }

  function handleSubmit() {
    if (createPoll.isPending) return
    setErrorMsg(null)

    if (!hasQuestion) {
      setErrorMsg('Vui lòng nhập câu hỏi cho bình chọn.')
      return
    }
    if (filledOptions.length < MIN_OPTIONS) {
      setErrorMsg(`Cần ít nhất ${MIN_OPTIONS} lựa chọn có nội dung.`)
      return
    }

    const expiredTime = toEpochMs(expiredAt)

    createPoll.mutate({
      question: question.trim(),
      options: filledOptions,
      ...(expiredTime !== undefined ? { expiredTime } : {}),
      allowMultiChoices,
      allowAddNewOption,
      isAnonymous,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo bình chọn</DialogTitle>
          {isGroup && (
            <DialogDescription>
              Bình chọn sẽ được gửi vào nhóm Zalo này. Cần ít nhất {MIN_OPTIONS} lựa
              chọn, tối đa {MAX_OPTIONS}.
            </DialogDescription>
          )}
        </DialogHeader>

        {!isGroup ? (
          /* Chat 1-1 → backend chắc chắn trả 400, không hiện form */
          <>
            <div className="flex items-start gap-3 rounded-lg border bg-muted p-4">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Bình chọn chỉ dùng được trong hội thoại nhóm Zalo.
                </p>
                <p className="text-sm text-muted-foreground">
                  Hãy mở một nhóm Zalo rồi thử lại.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              {/* Câu hỏi */}
              <div className="space-y-1.5">
                <Label htmlFor="poll-question">
                  Câu hỏi <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="poll-question"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="Ví dụ: Chốt lịch họp tuần này vào thứ mấy?"
                  value={question}
                  onChange={(e) => {
                    setErrorMsg(null)
                    setQuestion(e.target.value)
                  }}
                  disabled={createPoll.isPending}
                />
              </div>

              {/* Danh sách lựa chọn */}
              <div className="space-y-1.5">
                <Label>
                  Lựa chọn <span className="text-destructive">*</span>
                </Label>
                <div className="space-y-2">
                  {options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        autoComplete="off"
                        maxLength={100}
                        placeholder={`Lựa chọn ${index + 1}`}
                        value={option}
                        onChange={(e) => updateOption(index, e.target.value)}
                        disabled={createPoll.isPending}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Xoá lựa chọn ${index + 1}`}
                        className={cn(
                          'shrink-0 text-muted-foreground hover:text-destructive',
                          options.length <= MIN_OPTIONS && 'invisible',
                        )}
                        onClick={() => removeOption(index)}
                        disabled={options.length <= MIN_OPTIONS || createPoll.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addOption}
                    disabled={options.length >= MAX_OPTIONS || createPoll.isPending}
                  >
                    <Plus className="h-4 w-4" />
                    Thêm lựa chọn
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {options.length}/{MAX_OPTIONS}
                  </span>
                </div>

                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Ô để trống sẽ được bỏ qua khi gửi.
                </p>
              </div>

              {/* Tuỳ chọn bình chọn */}
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="poll-multi" className="cursor-pointer font-normal">
                    Cho chọn nhiều đáp án
                  </Label>
                  <Switch
                    id="poll-multi"
                    checked={allowMultiChoices}
                    onCheckedChange={setAllowMultiChoices}
                    disabled={createPoll.isPending}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="poll-add-option" className="cursor-pointer font-normal">
                    Cho phép thêm lựa chọn mới
                  </Label>
                  <Switch
                    id="poll-add-option"
                    checked={allowAddNewOption}
                    onCheckedChange={setAllowAddNewOption}
                    disabled={createPoll.isPending}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="poll-anonymous" className="cursor-pointer font-normal">
                    Bình chọn ẩn danh
                  </Label>
                  <Switch
                    id="poll-anonymous"
                    checked={isAnonymous}
                    onCheckedChange={setIsAnonymous}
                    disabled={createPoll.isPending}
                  />
                </div>
              </div>

              {/* Thời hạn (tuỳ chọn) */}
              <div className="space-y-1.5">
                <Label htmlFor="poll-expired">Thời hạn (tuỳ chọn)</Label>
                <Input
                  id="poll-expired"
                  type="datetime-local"
                  min={minDateTime}
                  value={expiredAt}
                  onChange={(e) => {
                    setErrorMsg(null)
                    setExpiredAt(e.target.value)
                  }}
                  disabled={createPoll.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Để trống nếu bình chọn không tự hết hạn.
                </p>
              </div>

              {/* Lỗi */}
              {errorMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p className="break-words">{errorMsg}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createPoll.isPending}
              >
                Huỷ
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
                {createPoll.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BarChart3 className="h-4 w-4" />
                )}
                Tạo bình chọn
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
