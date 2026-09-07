# Hướng dẫn viết trang (cho agent)

Frontend eCDP — Vite + React 19 + TS + Tailwind + shadcn-style. Alias `@/` → `src/`.

## Quy tắc bắt buộc
- **CHỈ tạo/sửa file trong thư mục trang được giao** (`src/pages/<feature>/...`) và hook riêng (`src/hooks/use-<feature>.ts`). **KHÔNG sửa** `routes.tsx`, `nav-config.ts`, `App.tsx`, hay file trong `components/ui`, `components/shared`, `lib`, `stores` (dùng lại, không đổi).
- Export **named** component (vd `export function CustomersPage()`).
- Tiếng Việt cho mọi text UI.
- Gọi API qua `api` (`@/lib/api-client`) + **TanStack Query** (`useQuery`/`useMutation`), hoặc helper `useApiQuery` (`@/hooks/use-api`). Base đã là `/api/v1`.
- Lỗi: `apiError(err)` (`@/lib/api-client`) + `toast` (`sonner`).
- Sau khi mutation thành công: `queryClient.invalidateQueries({queryKey:[...]})`.

## Thành phần dùng lại (KHÔNG viết lại)
- **UI primitives** `@/components/ui/`: `button`, `input`, `label`, `card` (Card/CardHeader/CardTitle/CardContent/...), `badge`, `avatar`, `dropdown-menu`, `dialog` (Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter), `tabs`, `select`, và `misc` (Switch, Checkbox, Separator, Tooltip*, ScrollArea, Textarea, Skeleton).
- **Shared** `@/components/shared/`: `PageHeader` (title/description/actions), `StatCard`, `DataTable` (columns: `Column<T>[]`, rows, rowKey, onRowClick, loading), `Pagination` (page/limit/total/onPageChange), `feedback` (`Loading`, `EmptyState`, `ErrorState`).
- Tiện ích `@/lib/utils`: `cn`, `formatNumber`, `initials`.
- Realtime `@/lib/socket`: `getSocket()`, `joinConversation(id)`, `leaveConversation(id)`; sự kiện xem prompt.

## Mẫu tham khảo (đọc trước khi viết)
- `src/pages/dashboard/dashboard-page.tsx` — trang + useApiQuery + StatCard.
- `src/components/shared/data-table.tsx` — cách dùng DataTable.

## Pattern phân trang
API trả `{ <items>: [...], total, page, limit }`. Dùng state `page`, truyền `params:{page,limit,search}`, render `DataTable` + `Pagination`.

## Style
- Bo góc dùng token (`rounded-lg`/`rounded-xl`), màu qua token (`bg-card`, `text-muted-foreground`, `bg-primary`...), KHÔNG hardcode hex.
- Trang bọc trong `<div className="space-y-6">` mở đầu bằng `<PageHeader />`.
