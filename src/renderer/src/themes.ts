import type { Settings } from '../../shared/types'

export interface Theme {
  id: string
  dark: boolean
  bg: string
  panel: string
  raised: string
  border: string
  text: string
  muted: string
}

export const THEMES: Theme[] = [
  { id: 'midnight', dark: true, bg: '#0e1016', panel: '#141722', raised: '#1c2030', border: '#272c3f', text: '#e7e9f3', muted: '#8b91a8' },
  { id: 'graphite', dark: true, bg: '#111111', panel: '#181818', raised: '#222222', border: '#303030', text: '#ececec', muted: '#919191' },
  { id: 'aurora', dark: true, bg: '#120f1c', panel: '#191527', raised: '#231d37', border: '#342b4e', text: '#ece8f7', muted: '#9a90b5' },
  { id: 'forest', dark: true, bg: '#0d1512', panel: '#121c18', raised: '#1a2722', border: '#273a32', text: '#e3efe9', muted: '#86a095' },
  { id: 'paper', dark: false, bg: '#f4f4f1', panel: '#ffffff', raised: '#eeeeea', border: '#deded8', text: '#1c1d21', muted: '#6a6d76' },
  { id: 'sand', dark: false, bg: '#f3ecdf', panel: '#fbf7ef', raised: '#ece3d2', border: '#dccfb8', text: '#2b2620', muted: '#7a6f60' }
]

export const ACCENTS = ['#7c8cff', '#4cc2ff', '#3ecf8e', '#f5a524', '#ff6b6b', '#e879f9', '#f472b6']

export function resolveTheme(id: string, systemDark: boolean): Theme {
  if (id === 'system') return THEMES.find((t) => t.id === (systemDark ? 'graphite' : 'paper'))!
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111318' : '#ffffff'
}

export function applyTheme(settings: Settings, systemDark: boolean): void {
  const theme = resolveTheme(settings.theme, systemDark)
  const root = document.documentElement
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accent) ? settings.accent : ACCENTS[0]
  root.dataset.dark = String(theme.dark)
  root.lang = settings.language
  const vars: Record<string, string> = {
    '--bg': theme.bg,
    '--panel': theme.panel,
    '--raised': theme.raised,
    '--border': theme.border,
    '--text': theme.text,
    '--muted': theme.muted,
    '--accent': accent,
    '--on-accent': readableOn(accent),
    '--font-size': `${settings.fontSize}px`
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}
