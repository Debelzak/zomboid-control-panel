import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type BridgeState = 'connected' | 'waiting' | 'offline' | 'loading'

interface BridgeStatusBadgeProps {
  connected: boolean
  running?: boolean
  loading?: boolean
  bridgePath?: string | null
  summary?: string | null
  className?: string
}

export function BridgeStatusBadge({ connected, running, loading, bridgePath, summary, className }: BridgeStatusBadgeProps) {
  const state: BridgeState = loading ? 'loading' : connected ? 'connected' : running ? 'waiting' : 'offline'

  const config: Record<BridgeState, { surface: string; dot: string; label: string; hint?: string }> = {
    connected: {
      surface: 'border-primary/15 bg-primary/8',
      dot: 'bg-primary',
      label: 'Bridge connected',
    },
    waiting: {
      surface: 'border-warning/20 bg-warning/8',
      dot: 'bg-warning animate-pulse',
      label: 'Bridge waiting',
      hint: 'Watching for PZ mod — start/restart the server',
    },
    offline: {
      surface: 'border-destructive/20 bg-destructive/8',
      dot: 'bg-destructive',
      label: 'Bridge offline',
      hint: 'Go to Settings → Bridge to configure',
    },
    loading: {
      surface: 'border-border/40 bg-muted/30',
      dot: '',
      label: 'Checking…',
    },
  }

  const c = config[state]
  const tooltip = [
    summary || c.hint,
    bridgePath ? `Path: ${bridgePath}` : null,
  ].filter(Boolean).join('\n')

  return (
    <div
      role="status"
      aria-live="polite"
      title={tooltip || undefined}
      className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-default', c.surface, className)}
    >
      {state === 'loading' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      ) : (
        <div className={cn('w-2 h-2 rounded-full shrink-0', c.dot)} aria-hidden="true" />
      )}
      <span className="text-sm font-medium text-foreground">{c.label}</span>
    </div>
  )
}
