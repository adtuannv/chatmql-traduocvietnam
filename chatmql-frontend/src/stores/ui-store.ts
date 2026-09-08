import { create } from 'zustand'

type Theme = 'light' | 'dark'
type NavMode = 'vertical' | 'horizontal'

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  navMode: NavMode
  /**
   * Module được ghim lên thanh menu ngang, theo đường dẫn.
   *
   * `null` = chưa cấu hình gì, thanh menu tự xếp theo bề rộng như cũ. Phân biệt
   * với mảng rỗng, vì rỗng là người dùng CỐ Ý bỏ ghim hết — lúc đó mọi module
   * nằm trong "Xem thêm", và đó là lựa chọn hợp lệ.
   */
  pinnedNav: string[] | null
  toggleTheme: () => void
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  toggleNavMode: () => void
  setNavMode: (m: NavMode) => void
  setPinnedNav: (v: string[] | null) => void
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  localStorage.setItem('chatmql_theme', t)
}

const initialTheme: Theme =
  (localStorage.getItem('chatmql_theme') as Theme) ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
applyTheme(initialTheme)

const initialNavMode: NavMode =
  localStorage.getItem('chatmql_nav_mode') === 'horizontal' ? 'horizontal' : 'vertical'

/** Ghim là sở thích của từng người nên để ở máy họ, không đồng bộ lên máy chủ. */
function docPinned(): string[] | null {
  try {
    const raw = localStorage.getItem('chatmql_pinned_nav')
    if (!raw) return null
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null
  } catch {
    return null
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme,
  sidebarCollapsed: localStorage.getItem('chatmql_sidebar') === '1',
  navMode: initialNavMode,
  pinnedNav: docPinned(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },
  setTheme: (t) => {
    applyTheme(t)
    set({ theme: t })
  },
  setPinnedNav: (v) => {
    if (v === null) localStorage.removeItem('chatmql_pinned_nav')
    else localStorage.setItem('chatmql_pinned_nav', JSON.stringify(v))
    set({ pinnedNav: v })
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    localStorage.setItem('chatmql_sidebar', next ? '1' : '0')
    set({ sidebarCollapsed: next })
  },
  toggleNavMode: () => {
    const next: NavMode = get().navMode === 'vertical' ? 'horizontal' : 'vertical'
    localStorage.setItem('chatmql_nav_mode', next)
    set({ navMode: next })
  },
  setNavMode: (m) => {
    localStorage.setItem('chatmql_nav_mode', m)
    set({ navMode: m })
  },
}))
