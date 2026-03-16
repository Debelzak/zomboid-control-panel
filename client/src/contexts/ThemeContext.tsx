import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'

const SURVIVAL_FONT_STYLESHEET_ID = 'pz-survival-fonts'
const SURVIVAL_FONT_STYLESHEET_HREF = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Special+Elite&display=swap'

function ensureSurvivalFontsLoaded() {
  // Font stylesheet is preloaded in index.html; only inject if missing (e.g. dev hot-reload)
  if (document.getElementById(SURVIVAL_FONT_STYLESHEET_ID)) return
  const existing = document.querySelector(`link[href="${SURVIVAL_FONT_STYLESHEET_HREF}"]`)
  if (existing) return

  const link = document.createElement('link')
  link.id = SURVIVAL_FONT_STYLESHEET_ID
  link.rel = 'stylesheet'
  link.href = SURVIVAL_FONT_STYLESHEET_HREF
  document.head.appendChild(link)
}

export type ThemeName = 'clean' | 'survival'

const THEME_STORAGE_KEY = 'pz-theme'

interface ThemeContextType {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function isThemeName(value: string | null): value is ThemeName {
  return value === 'clean' || value === 'survival'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeName(stored) ? stored : 'survival'
  })

  const setTheme = useCallback((nextTheme: ThemeName) => {
    setThemeState(nextTheme)
  }, [])

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    if (theme === 'survival') {
      ensureSurvivalFontsLoaded()
    }

    // Update document class for theme
    document.documentElement.classList.remove('theme-clean', 'theme-survival')
    document.documentElement.classList.add(theme === 'clean' ? 'theme-clean' : 'theme-survival')
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
