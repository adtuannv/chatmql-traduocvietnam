import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronDown,
  Contact as ContactIcon,
  Eye,
  ImageOff,
  Link2,
  Loader2,
  Search, X} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox, Textarea } from '@/components/ui/misc'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { cn, initials } from '@/lib/utils'
import { useContacts, type ContactListItem } from '@/hooks/use-contacts'

export type ExtrasTab = 'card' | 'bank' | 'link'

interface Props {
  convId: string
  /** Tài khoản Zalo dùng để lấy xem trước link (truyền vào /link/parse) */
  accountId?: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultTab?: ExtrasTab
}

/**
 * Backend trả về toàn bộ trường vô hướng của Contact (dùng Prisma `include`),
 * nên `zaloUid` luôn có mặt dù kiểu `ContactListItem` chưa khai báo.
 */
type ContactRow = ContactListItem & { zaloUid?: string | null }

interface BankItem {
  name: string
  bin: number
}

interface LinkPreview {
  thumb?: string | null
  title?: string | null
  desc?: string | null
  href?: string | null
}

/** Thông điệp lỗi thân thiện, ưu tiên các mã trạng thái đặc thù của Zalo. */
function sendErrorMessage(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 503) return 'Tài khoản Zalo chưa kết nối'
  if (status === 429) return 'Thao tác quá nhanh, thử lại sau'
  return apiError(err)
}

function contactName(c: ContactRow): string {
  return c.fullName || c.crmName || 'Không tên'
}

/** Bỏ dấu tiếng Việt để lọc danh sách ngân hàng không phụ thuộc dấu. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
}

/**
 * Hộp thoại "Gửi nội dung đặc biệt" qua Zalo cá nhân, gồm 3 tab:
 *  - Danh thiếp  → POST /conversations/:id/messages/card
 *  - Thẻ ngân hàng → POST /conversations/:id/messages/bank-card
 *  - Link có xem trước → POST /link/parse (xem trước) + POST /conversations/:id/messages/link
 */

/* ── Số tài khoản đã lưu ─────────────────────────────────────────────
 * Ưu tiên lưu chung cho cả tổ chức (AppSetting key `org.bank_accounts`,
 * chỉ owner/admin ghi được). Nếu không đủ quyền thì lưu riêng máy người dùng.
 */
const BANK_SETTING_KEY = 'org.bank_accounts'
const BANK_LOCAL_KEY = 'chatmql_bank_accounts'

export interface SavedBankAccount {
  bin: number
  bankName: string
  numAccBank: string
  nameAccBank?: string
}

function readLocalAccounts(): SavedBankAccount[] {
  try {
    const raw = localStorage.getItem(BANK_LOCAL_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeLocalAccounts(list: SavedBankAccount[]) {
  try {
    localStorage.setItem(BANK_LOCAL_KEY, JSON.stringify(list))
  } catch { /* bộ nhớ trình duyệt đầy hoặc bị chặn — bỏ qua */ }
}

function parseAccounts(raw: unknown): SavedBankAccount[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as SavedBankAccount[]) : []
  } catch {
    return []
  }
}

/** Khoá định danh một tài khoản để chống trùng */
const accKey = (a: SavedBankAccount) => `${a.bin}-${a.numAccBank}`

export function SendExtrasDialog({
  convId,
  accountId,
  open,
  onOpenChange,
  defaultTab = 'card',
}: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<ExtrasTab>(defaultTab)

  // ── Tab 1: danh thiếp ────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [manualUid, setManualUid] = useState('')

  // ── Tab 2: thẻ ngân hàng ─────────────────────────────────────────
  const [bankOpen, setBankOpen] = useState(false)
  const [bankFilter, setBankFilter] = useState('')
  const [selectedBank, setSelectedBank] = useState<BankItem | null>(null)
  const [numAccBank, setNumAccBank] = useState('')
  const [nameAccBank, setNameAccBank] = useState('')
  const [saveAcc, setSaveAcc] = useState(true)

  // ── Tab 3: link ──────────────────────────────────────────────────
  const [link, setLink] = useState('')
  const [linkMsg, setLinkMsg] = useState('')
  const [preview, setPreview] = useState<LinkPreview | null>(null)

  // Mở hộp thoại → về đúng tab mặc định
  useEffect(() => {
    if (open) setTab(defaultTab)
  }, [open, defaultTab])

  // Đóng hộp thoại → xoá toàn bộ trạng thái tạm
  useEffect(() => {
    if (open) return
    setSearch('')
    setDebouncedSearch('')
    setSelectedContactId(null)
    setManualUid('')
    setBankOpen(false)
    setBankFilter('')
    setSelectedBank(null)
    setNumAccBank('')
    setNameAccBank('')
    setLink('')
    setLinkMsg('')
    setPreview(null)
  }, [open])

  // Radix tự đưa tiêu điểm vào nội dung menu khi mở, nên phải chủ động
  // đưa tiêu điểm về ô lọc ở khung hình kế tiếp.
  const bankFilterRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!bankOpen) return
    const timer = setTimeout(() => bankFilterRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [bankOpen])

  // Debounce ô tìm danh bạ 400ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(timer)
  }, [search])

  const contactsQuery = useContacts({
    search: debouncedSearch || undefined,
    limit: 50,
  })
  const contacts = (contactsQuery.data?.contacts ?? []) as ContactRow[]

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  )

  const bankQuery = useQuery<{ items: BankItem[] }>({
    queryKey: ['zalo-bank-list'],
    queryFn: async () => {
      const { data } = await api.get<{ items: BankItem[] }>('/zalo/bank-list')
      return data
    },
    enabled: open,
    staleTime: 60 * 60 * 1000,
  })

  // Danh sách số tài khoản đã lưu (tổ chức + máy cá nhân)
  const savedAccountsQuery = useQuery<SavedBankAccount[]>({
    queryKey: ['saved-bank-accounts'],
    queryFn: async () => {
      let org: SavedBankAccount[] = []
      try {
        const { data } = await api.get<{ settings: Record<string, string | null> }>('/settings')
        org = parseAccounts(data?.settings?.[BANK_SETTING_KEY])
      } catch { /* không đọc được cấu hình chung — vẫn dùng danh sách cá nhân */ }
      const local = readLocalAccounts()
      const merged = [...org]
      for (const a of local) {
        if (!merged.some((m) => accKey(m) === accKey(a))) merged.push(a)
      }
      return merged
    },
    enabled: open,
    staleTime: 60_000,
  })
  const savedAccounts = savedAccountsQuery.data ?? []

  /** Lưu tài khoản: thử lưu chung cho tổ chức, thiếu quyền thì lưu riêng máy này */
  async function persistAccount(acc: SavedBankAccount) {
    const next = [acc, ...savedAccounts.filter((a) => accKey(a) !== accKey(acc))].slice(0, 10)
    try {
      await api.put('/settings', { key: BANK_SETTING_KEY, value: JSON.stringify(next) })
    } catch {
      writeLocalAccounts(next.filter((a) => !savedAccounts.some((s2) => accKey(s2) === accKey(a) && false)))
      writeLocalAccounts(next)
    }
    queryClient.invalidateQueries({ queryKey: ['saved-bank-accounts'] })
  }

  /** Xoá một tài khoản khỏi danh sách đã lưu */
  async function removeAccount(acc: SavedBankAccount) {
    const next = savedAccounts.filter((a) => accKey(a) !== accKey(acc))
    try {
      await api.put('/settings', { key: BANK_SETTING_KEY, value: JSON.stringify(next) })
    } catch { /* thiếu quyền — chỉ xoá bản cá nhân */ }
    writeLocalAccounts(readLocalAccounts().filter((a) => accKey(a) !== accKey(acc)))
    queryClient.invalidateQueries({ queryKey: ['saved-bank-accounts'] })
  }


  const banks = bankQuery.data?.items ?? []
  const filteredBanks = useMemo(() => {
    const q = normalize(bankFilter.trim())
    if (!q) return banks
    return banks.filter((b) => normalize(b.name).includes(q))
  }, [banks, bankFilter])

  /** Gửi xong: toast, làm mới danh sách tin & hội thoại, đóng hộp thoại. */
  function finishSend(message: string) {
    toast.success(message)
    queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
    onOpenChange(false)
  }

  // ── Mutations ────────────────────────────────────────────────────
  const sendCard = useMutation({
    mutationFn: async (body: { userId: string; phoneNumber?: string }) => {
      const { data } = await api.post(`/conversations/${convId}/messages/card`, body)
      return data
    },
    onSuccess: () => finishSend('Đã gửi danh thiếp'),
    onError: (err) => toast.error(sendErrorMessage(err)),
  })

  const sendBankCard = useMutation({
    mutationFn: async (body: {
      binBank: number
      numAccBank: string
      nameAccBank?: string
    }) => {
      const { data } = await api.post(`/conversations/${convId}/messages/bank-card`, body)
      return data
    },
    onSuccess: () => finishSend('Đã gửi thẻ ngân hàng'),
    onError: (err) => toast.error(sendErrorMessage(err)),
  })

  const parseLink = useMutation({
    mutationFn: async (value: string) => {
      const { data } = await api.post<{ data?: LinkPreview & { data?: LinkPreview } }>(
        '/link/parse',
        { link: value, ...(accountId ? { accountId } : {}) },
      )
      // Response có thể lồng 2 mức: { data: { data: {...} } } hoặc { data: {...} }
      const outer = data?.data
      return (outer?.data ?? outer ?? null) as LinkPreview | null
    },
    onSuccess: (result) => {
      setPreview(result)
      if (!result?.title && !result?.desc && !result?.thumb) {
        toast.warning('Không lấy được thông tin xem trước cho link này')
      }
    },
    onError: (err) => toast.error(sendErrorMessage(err)),
  })

  const sendLink = useMutation({
    mutationFn: async (body: { link: string; msg?: string }) => {
      const { data } = await api.post(`/conversations/${convId}/messages/link`, body)
      return data
    },
    onSuccess: () => finishSend('Đã gửi link'),
    onError: (err) => toast.error(sendErrorMessage(err)),
  })

  // ── Điều kiện gửi ────────────────────────────────────────────────
  const cardUserId = manualUid.trim() || selectedContact?.zaloUid?.trim() || ''
  const cardPhone = manualUid.trim()
    ? ''
    : (selectedContact?.phone ?? '').replace(/\D/g, '')
  const canSendCard = !!cardUserId && !sendCard.isPending

  const canSendBank =
    !!selectedBank && numAccBank.trim().length > 0 && !sendBankCard.isPending

  const trimmedLink = link.trim()
  const canParseLink = trimmedLink.length > 0 && !parseLink.isPending
  const canSendLink = trimmedLink.length > 0 && !sendLink.isPending

  function handleSendCard() {
    if (!canSendCard) return
    sendCard.mutate({
      userId: cardUserId,
      ...(cardPhone ? { phoneNumber: cardPhone } : {}),
    })
  }

  function handleSendBank() {
    if (!canSendBank || !selectedBank) return
    if (saveAcc) {
      persistAccount({
        bin: selectedBank.bin,
        bankName: selectedBank.name,
        numAccBank: numAccBank.trim(),
        ...(nameAccBank.trim() ? { nameAccBank: nameAccBank.trim() } : {}),
      })
    }
    sendBankCard.mutate({
      binBank: selectedBank.bin,
      numAccBank: numAccBank.trim(),
      ...(nameAccBank.trim() ? { nameAccBank: nameAccBank.trim() } : {}),
    })
  }

  function handleSendLink() {
    if (!canSendLink) return
    sendLink.mutate({
      link: trimmedLink,
      ...(linkMsg.trim() ? { msg: linkMsg.trim() } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gửi nội dung đặc biệt</DialogTitle>
          <DialogDescription>
            Gửi danh thiếp, thẻ ngân hàng hoặc link có xem trước qua Zalo cá nhân.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ExtrasTab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="card">Danh thiếp</TabsTrigger>
            <TabsTrigger value="bank">Thẻ ngân hàng</TabsTrigger>
            <TabsTrigger value="link">Link</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Danh thiếp ─────────────────────────────────── */}
          <TabsContent value="card" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Chọn liên hệ trong danh bạ CRM để gửi danh thiếp. Chỉ liên hệ đã có
              UID Zalo mới gửi được.
            </p>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                autoComplete="off"
                placeholder="Tìm liên hệ theo tên, số điện thoại, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {contactsQuery.isLoading ? (
                <Loading className="py-10" label="Đang tải danh bạ..." />
              ) : contactsQuery.isError ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Không tải được danh bạ"
                  description={apiError(contactsQuery.error) || undefined}
                />
              ) : contacts.length === 0 ? (
                <EmptyState
                  icon={ContactIcon}
                  title="Không có liên hệ phù hợp"
                  description={
                    debouncedSearch
                      ? 'Thử từ khoá khác để tìm liên hệ.'
                      : 'Danh bạ CRM chưa có liên hệ nào.'
                  }
                />
              ) : (
                <ul className="divide-y">
                  {contacts.map((c) => {
                    const uid = c.zaloUid?.trim() || ''
                    const disabled = !uid
                    const active = !disabled && c.id === selectedContactId
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setSelectedContactId(c.id)
                            setManualUid('')
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                            disabled
                              ? 'cursor-not-allowed opacity-50'
                              : 'hover:bg-muted/60',
                            active && 'bg-primary/5',
                          )}
                        >
                          <Avatar className="h-8 w-8">
                            {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                            <AvatarFallback>{initials(contactName(c))}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {contactName(c)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.phone || 'Chưa có số điện thoại'}
                            </p>
                          </div>
                          {disabled ? (
                            <Badge variant="secondary" className="shrink-0">
                              Chưa có UID Zalo
                            </Badge>
                          ) : active ? (
                            <Check className="h-4 w-4 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Hoặc nhập UID Zalo
              </label>
              <Input
                autoComplete="off"
                placeholder="Ví dụ: 1234567890123456789"
                value={manualUid}
                onChange={(e) => {
                  setManualUid(e.target.value)
                  if (e.target.value.trim()) setSelectedContactId(null)
                }}
              />
              <p className="text-xs text-muted-foreground">
                {manualUid.trim()
                  ? 'Đang dùng UID nhập tay, liên hệ đã chọn sẽ bị bỏ qua.'
                  : selectedContact
                    ? `Sẽ gửi danh thiếp của ${contactName(selectedContact)}.`
                    : 'Chọn một liên hệ hoặc nhập UID Zalo để gửi.'}
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={sendCard.isPending}
              >
                Huỷ
              </Button>
              <Button type="button" onClick={handleSendCard} disabled={!canSendCard}>
                {sendCard.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ContactIcon className="h-4 w-4" />
                )}
                Gửi danh thiếp
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* ── Tab 2: Thẻ ngân hàng ──────────────────────────────── */}
          <TabsContent value="bank" className="space-y-3">
            {/* Số tài khoản đã lưu — bấm để điền nhanh */}
            {savedAccounts.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Đã lưu
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {savedAccounts.map((a) => (
                    <span
                      key={accKey(a)}
                      className="group inline-flex items-center gap-1 rounded-full border bg-muted/60 py-1 pl-2.5 pr-1 text-xs"
                    >
                      <button
                        type="button"
                        title={`${a.bankName} · ${a.nameAccBank ?? ''}`}
                        onClick={() => {
                          const bank = (bankQuery.data?.items ?? []).find((b: BankItem) => b.bin === a.bin)
                          if (bank) setSelectedBank(bank)
                          setNumAccBank(a.numAccBank)
                          setNameAccBank(a.nameAccBank ?? '')
                        }}
                        className="max-w-[190px] truncate hover:text-primary"
                      >
                        <span className="font-medium">{a.bankName}</span>
                        <span className="text-muted-foreground"> · {a.numAccBank}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Xoá ${a.numAccBank}`}
                        onClick={() => removeAccount(a)}
                        className="rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Ngân hàng <span className="text-destructive">*</span>
              </label>
              {/* Select của dự án (Radix) không hỗ trợ tìm kiếm nên dùng
                  DropdownMenu cuộn được kèm ô lọc. */}
              <DropdownMenu open={bankOpen} onOpenChange={setBankOpen} modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between font-normal"
                  >
                    <span
                      className={cn('truncate', !selectedBank && 'text-muted-foreground')}
                    >
                      {selectedBank
                        ? `${selectedBank.name} (${selectedBank.bin})`
                        : 'Chọn ngân hàng...'}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[var(--radix-dropdown-menu-trigger-width)] p-0"
                >
                  <div className="border-b p-2">
                    <Input
                      ref={bankFilterRef}
                      autoComplete="off"
                      placeholder="Lọc theo tên ngân hàng..."
                      value={bankFilter}
                      onChange={(e) => setBankFilter(e.target.value)}
                      // Chặn typeahead của Radix menu cướp phím gõ
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {bankQuery.isLoading ? (
                      <Loading className="py-6" label="Đang tải ngân hàng..." />
                    ) : filteredBanks.length === 0 ? (
                      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                        Không tìm thấy ngân hàng phù hợp
                      </p>
                    ) : (
                      filteredBanks.map((bank) => (
                        <button
                          key={bank.bin}
                          type="button"
                          onClick={() => {
                            setSelectedBank(bank)
                            setBankOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                            selectedBank?.bin === bank.bin && 'bg-accent',
                          )}
                        >
                          <span className="truncate">{bank.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {bank.bin}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Số tài khoản <span className="text-destructive">*</span>
              </label>
              <Input
                inputMode="numeric"
                autoComplete="off"
                placeholder="Chỉ nhập chữ số"
                value={numAccBank}
                onChange={(e) => setNumAccBank(e.target.value.replace(/\D/g, ''))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Tên chủ tài khoản (tuỳ chọn)
              </label>
              <Input
                autoComplete="off"
                placeholder="Ví dụ: NGUYEN VAN A"
                value={nameAccBank}
                onChange={(e) => setNameAccBank(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={saveAcc} onCheckedChange={(v: boolean | 'indeterminate') => setSaveAcc(v === true)} />
              Lưu số tài khoản này để dùng lần sau
            </label>


            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={sendBankCard.isPending}
              >
                Huỷ
              </Button>
              <Button type="button" onClick={handleSendBank} disabled={!canSendBank}>
                {sendBankCard.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Banknote className="h-4 w-4" />
                )}
                Gửi thẻ ngân hàng
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* ── Tab 3: Link có xem trước ──────────────────────────── */}
          <TabsContent value="link" className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Đường dẫn <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <Input
                  autoComplete="off"
                  placeholder="https://..."
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value)
                    setPreview(null)
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => parseLink.mutate(trimmedLink)}
                  disabled={!canParseLink}
                >
                  {parseLink.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  Xem trước
                </Button>
              </div>
            </div>

            {preview && (
              <div className="flex gap-3 rounded-lg border p-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {preview.thumb ? (
                    <img
                      src={preview.thumb}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">
                    {preview.title || 'Không có tiêu đề'}
                  </p>
                  {preview.desc && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {preview.desc}
                    </p>
                  )}
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {preview.href || trimmedLink}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Lời nhắn kèm theo (tuỳ chọn)
              </label>
              <Textarea
                placeholder="Nhập lời nhắn gửi kèm link..."
                value={linkMsg}
                onChange={(e) => setLinkMsg(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={sendLink.isPending}
              >
                Huỷ
              </Button>
              <Button type="button" onClick={handleSendLink} disabled={!canSendLink}>
                {sendLink.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Gửi link
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
