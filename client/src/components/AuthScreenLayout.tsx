import { ReactNode } from 'react'
import { Shield } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

interface AuthScreenLayoutProps {
  badge: string
  title: string
  description: string
  cardTitle: string
  cardDescription: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthScreenLayout({
  badge,
  title,
  description,
  cardTitle,
  cardDescription,
  children,
  footer,
}: AuthScreenLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-10 sm:px-6">
      <a href="#auth-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm">Skip to content</a>
      <div
        aria-hidden="true"
        className="auth-bg-gradient absolute inset-0 opacity-70"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,hsl(var(--border)/0.22)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.22)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(circle_at_center,black_26%,transparent_82%)]"
      />
      <div aria-hidden="true" className="control-room-sweep absolute inset-0 opacity-55" />
      <div aria-hidden="true" className="drift-embers absolute inset-x-0 bottom-0 h-48 opacity-45" />

      <main id="auth-content" className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-start justify-center pt-[12vh]">
        <div className="w-full">
          <div className="mb-8 text-center">
            <div aria-hidden="true" className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/12 bg-primary/8 text-primary shadow-sm">
              <Shield className="h-7 w-7" />
            </div>
            <div aria-hidden="true" className="mb-3 inline-flex items-center rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground backdrop-blur-sm">
              {badge}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
            <div aria-hidden="true" className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/45 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <span className="inline-flex h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.45)]" />
              Operational access
            </div>
          </div>

          <Card className="border-border/60 bg-card/80 shadow-[0_24px_80px_-40px_hsl(var(--foreground)/0.45)] backdrop-blur-sm supports-[backdrop-filter]:bg-card/72">
            <CardHeader className="space-y-2 pb-5">
              <CardTitle className="text-xl font-semibold tracking-tight">{cardTitle}</CardTitle>
              <CardDescription className="max-w-sm text-sm leading-6">{cardDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">{children}</CardContent>
          </Card>

          {footer ? (
            <p className="mx-auto mt-4 text-center text-xs leading-5 text-muted-foreground sm:max-w-sm">{footer}</p>
          ) : null}
        </div>
      </main>
    </div>
  )
}