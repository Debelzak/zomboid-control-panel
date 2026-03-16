import { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: ReactNode
  actions?: ReactNode
  badge?: ReactNode
  eyebrow?: string
  tone?: 'ops' | 'world' | 'maintain' | 'config' | 'servers'
}

export function PageHeader({ title, description, icon, actions, badge, eyebrow, tone = 'ops' }: PageHeaderProps) {
  return (
    <section className="page-header-shell rounded-2xl border border-border/60 bg-card/55 p-4 sm:p-5" data-tone={tone}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <p className="page-eyebrow text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">{eyebrow}</p>}
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                {icon && <span className="page-title-icon text-primary shrink-0">{icon}</span>}
                <h1 className="page-title text-2xl font-semibold tracking-tight text-foreground sm:text-3xl font-display">{title}</h1>
                {badge}
              </div>
              {description && (
                <p className="page-description mt-1 max-w-3xl text-sm leading-6 text-foreground/82 sm:text-base">{description}</p>
              )}
            </div>
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:max-w-[48%] sm:justify-end sm:self-auto">
            {actions}
          </div>
        )}
      </div>
    </section>
  )
}
