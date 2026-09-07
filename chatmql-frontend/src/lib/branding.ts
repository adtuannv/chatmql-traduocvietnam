export interface Branding {
  brandName?: string
  tagline?: string
  logoUrl?: string
  primaryColor?: string
  faviconVersion?: string
  logoVersion?: string
}

declare global {
  interface Window {
    __CHATMQL_BRANDING__?: Branding
  }
}

export const DEFAULT_BRANDING: Branding = {
  brandName: 'Trà Dược Việt Nam',
  tagline: 'Phước lành cho sức khỏe',
  logoUrl: '/assets/logo-traduocvietnam.svg',
  primaryColor: '#0068FF',
}

/** Lấy branding đã nạp sẵn ở index.html, fallback về mặc định. */
export function getBranding(): Branding {
  return { ...DEFAULT_BRANDING, ...(window.__CHATMQL_BRANDING__ || {}) }
}
