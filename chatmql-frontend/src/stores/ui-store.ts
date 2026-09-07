import { create } from 'zustand'

type Theme = 'light' | 'dark'
type NavMode = 'vertical' | 'horizontal'

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  navMode: NavMode
  toggleTheme: () => void
  setTheme: (t: Theme) => void
  toggleSidebar: () => void
  toggleNavMode: () => void
  setNavMode: (m: NavMode) => void
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

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme,
  sidebarCollapsed: localStorage.getItem('chatmql_sidebar') === '1',
  navMode: initialNavMode,
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },
  setTheme: (t) => {
    applyTheme(t)
    set({ theme: t })
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
