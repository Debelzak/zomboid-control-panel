import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { getCurrentLanguage, setLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '@/i18n'

const LANGUAGE_LABEL_KEY: Record<SupportedLanguage, string> = {
  en: 'languageSwitcher.english',
  fr: 'languageSwitcher.french',
}

// Phase 1's visible, persisted locale switcher — English/French only, more
// languages join SUPPORTED_LANGUAGES as later phases translate more of the
// app. Usable pre-login (Login/Setup) and from the app shell footer.
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('shell')
  const current = getCurrentLanguage()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}
          aria-label={t('languageSwitcher.label')}
        >
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t(LANGUAGE_LABEL_KEY[current])}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => {
              setLanguage(lang)
            }}
            className={cn(lang === current && 'font-medium text-foreground')}
          >
            {t(LANGUAGE_LABEL_KEY[lang])}
            {lang === i18n.language ? ' ✓' : ''}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
