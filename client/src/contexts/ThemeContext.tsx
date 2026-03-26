import { createContext, useContext, useEffect, ReactNode } from 'react'

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

const ThemeContext = createContext<'survival'>('survival')

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    ensureSurvivalFontsLoaded()
    document.documentElement.classList.add('theme-survival')
  }, [])

  return (
    <ThemeContext.Provider value="survival">
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return { theme: useContext(ThemeContext) }
}
