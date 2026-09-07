// ── Kiểu dùng chung ───────────────────────────────────────────────

export type Role = 'owner' | 'admin' | 'manager' | 'member'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: Role
  orgId: string
  isActive?: boolean
  avatarUrl?: string | null
  createdAt?: string
  org?: Organization
  impersonatedBy?: string | null
  platformActorId?: string | null
}

export interface Organization {
  id: string
  name: string
  status?: 'active' | 'suspended'
  expiresAt?: string | null
  plan?: string | null
}

export interface LoginResponse {
  token: string
  refreshToken: string
  user: AuthUser
}

/** Phản hồi phân trang chuẩn: khoá danh sách thay đổi theo endpoint. */
export type Paginated<T, K extends string> = {
  total: number
  page: number
  limit: number
} & { [P in K]: T[] }

export interface ListParams {
  page?: number
  limit?: number
  search?: string
  [key: string]: unknown
}
