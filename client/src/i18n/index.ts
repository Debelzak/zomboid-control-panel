import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import enLogin from '../locales/en/login.json'
import enSetup from '../locales/en/setup.json'
import enShell from '../locales/en/shell.json'
import frLogin from '../locales/fr/login.json'
import frSetup from '../locales/fr/setup.json'
import frShell from '../locales/fr/shell.json'

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_STORAGE_KEY = 'zcp-language'

function isSupportedLanguage(value: string | null | undefined): value is SupportedLanguage {
  return !!value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

// Phase 1 covers Login, Setup and the app shell/nav only — every other page
// still renders hardcoded English. See the i18n scoping report for the plan
// to roll the remaining ~3,300 strings out namespace by namespace.
function detectInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (isSupportedLanguage(stored)) return stored
  } catch {
    // localStorage unavailable (privacy mode, disabled storage) — fall through
  }
  const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return isSupportedLanguage(browserLang) ? browserLang : 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { login: enLogin, setup: enSetup, shell: enShell },
    fr: { login: frLogin, setup: frSetup, shell: frShell },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  ns: ['login', 'setup', 'shell'],
  defaultNS: 'shell',
  interpolation: { escapeValue: false }, // React already escapes interpolated values
  returnEmptyString: false,
})

export function setLanguage(lang: SupportedLanguage): void {
  void i18n.changeLanguage(lang)
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  } catch {
    // ignore — language just won't persist across reloads
  }
}

export function getCurrentLanguage(): SupportedLanguage {
  return isSupportedLanguage(i18n.language) ? i18n.language : 'en'
}

export default i18n
