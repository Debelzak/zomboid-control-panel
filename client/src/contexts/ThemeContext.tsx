import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

export type ThemeName = 'survival' | 'light'

const STORAGE_KEY = 'pz-panel-theme'
const THEME_CLASSES: ThemeName[] = ['survival', 'light'] as const

const SURVIVAL_FONT_STYLESHEET_ID = 'pz-survival-fonts'
const SURVIVAL_FONT_STYLESHEET_HREF = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Special+Elite&display=swap'

function ensureSurvivalFontsLoaded() {
  if (document.getElementById(SURVIVAL_FONT_STYLESHEET_ID)) return
  const existing = document.querySelector(`link[href="${SURVIVAL_FONT_STYLESHEET_HREF}"]`)
  if (existing) return

  const link = document.createElement('link')
  link.id = SURVIVAL_FONT_STYLESHEET_ID
  link.rel = 'stylesheet'
  link.href = SURVIVAL_FONT_STYLESHEET_HREF
  document.head.appendChild(link)
}

function getStoredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && THEME_CLASSES.includes(stored as ThemeName)) return stored as ThemeName
  } catch { /* localStorage may be unavailable */ }
  return 'survival'
}

function applyThemeClass(theme: ThemeName) {
  const root = document.documentElement
  for (const cls of THEME_CLASSES) root.classList.remove(`theme-${cls}`)
  root.classList.remove('dark')
  root.classList.add(`theme-${theme}`)
  // Dark attribute for components that check it (Radix, shadcn)
  if (theme === 'light') {
    root.style.colorScheme = 'light'
  } else {
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
  }
}

interface ThemeContextValue {
  theme: ThemeName
  setTheme: (t: ThemeName) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'survival',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(getStoredTheme)

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch { /* ok */ }
    applyThemeClass(t)
  }, [])

  useEffect(() => {
    ensureSurvivalFontsLoaded()
    applyThemeClass(theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
