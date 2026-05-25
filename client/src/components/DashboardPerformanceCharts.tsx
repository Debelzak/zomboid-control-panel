import { memo } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

export interface DashboardPerformancePoint {
  time: string
  timestamp?: string
  playerCount: number
  memoryMB: number
  pzMemMB?: number
  cpuPercent?: number
  hostMemUsedGB?: number
  hostMemTotalGB?: number
}

interface DashboardPerformanceChartsProps {
  performanceHistory: DashboardPerformancePoint[]
  serverRunning?: boolean
}

interface Metric {
  key: string
  label: string
  value: string | number
  unit?: string
  dataKey: string
  color: string
  alert?: boolean
}

/**
 * Inline trace — full-width area chart drawn into the metric strip's track.
 * Returns a flat baseline rule when there's no signal, so empty rows still
 * read as a deliberate "no movement" rather than a broken chart.
 */
function InlineTrace({
  data,
  dataKey,
  color,
}: {
  data: DashboardPerformanceChartsProps['performanceHistory']
  dataKey: string
  color: string
}) {
  const hasSignal =
    data.length >= 2 &&
    data.some((d) => {
      const v = (d as unknown as Record<string, unknown>)[dataKey]
      return typeof v === 'number' && v > 0
    })
  if (!hasSignal) {
    return (
      <div className="flex h-full items-center" aria-hidden="true">
        <div className="h-px w-full bg-border/40" />
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`trace-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.42} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#trace-${dataKey})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/**
 * One honest metric row: label on the left, live trace fills the middle, big readout right.
 * Severity-tinted background when alerting.
 */
function MetricStrip({
  metric,
  data,
  isFirst,
}: {
  metric: Metric
  data: DashboardPerformanceChartsProps['performanceHistory']
  isFirst: boolean
}) {
  return (
    <div
      className={cn(
        'relative grid items-center gap-4 px-4 py-3 grid-cols-[8rem_minmax(0,1fr)_7rem] transition-colors',
        !isFirst && 'border-t border-border/30',
        metric.alert && 'bg-destructive/[0.05]'
      )}
    >
      <span
        className={cn(
          'font-mono text-[11px] uppercase tracking-[0.12em] truncate',
          metric.alert ? 'text-destructive/85' : 'text-foreground/65'
        )}
      >
        {metric.label}
      </span>
      <div className="h-8 min-w-0">
        <InlineTrace data={data} dataKey={metric.dataKey} color={metric.alert ? 'hsl(var(--destructive))' : metric.color} />
      </div>
      <div className="flex items-baseline gap-1 justify-self-end">
        <span
          className={cn(
            'font-display text-2xl leading-none tracking-[0.01em] tabular-nums',
            metric.alert ? 'text-destructive' : 'text-foreground'
          )}
        >
          {metric.value}
        </span>
        {metric.unit && (
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {metric.unit}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Shared time-axis row anchored under the trace column. Reads first/last
 * sample timestamps and renders four monospaced ticks: oldest, two thirds,
 * one third, now. Same grid template as MetricStrip so ticks land on the
 * exact start/end of every trace above.
 */
function TimeAxis({ data }: { data: DashboardPerformanceChartsProps['performanceHistory'] }) {
  if (data.length < 2) return null
  const firstTs = data[0].timestamp
  const lastTs = data[data.length - 1].timestamp
  let spanMin: number
  if (firstTs && lastTs) {
    const a = new Date(firstTs).getTime()
    const b = new Date(lastTs).getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null
    spanMin = (b - a) / 60000
  } else {
    // Fallback: assume ~1 sample per minute.
    spanMin = data.length - 1
  }
  const fmt = (fraction: number) => {
    if (fraction === 1) return 'now'
    const ago = spanMin * (1 - fraction)
    if (ago < 1) return `−${Math.max(1, Math.round(ago * 60))}s`
    return `−${Math.round(ago)}m`
  }
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)_7rem] gap-4 border-t border-border/30 px-4 py-1.5">
      <span aria-hidden="true" />
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground/55">
        <span>{fmt(0)}</span>
        <span>{fmt(0.33)}</span>
        <span>{fmt(0.67)}</span>
        <span className="text-muted-foreground/75">{fmt(1)}</span>
      </div>
      <span aria-hidden="true" />
    </div>
  )
}

function DashboardPerformanceCharts({
  performanceHistory,
  serverRunning = true,
}: DashboardPerformanceChartsProps) {
  const latest = performanceHistory[performanceHistory.length - 1]
  if (!latest) return null

  const pzMem = latest.pzMemMB ?? latest.memoryMB
  const cpu = latest.cpuPercent ?? 0
  const hostUsed = latest.hostMemUsedGB
  const hostTotal = latest.hostMemTotalGB

  const pzAlert = serverRunning && pzMem > 7600
  const cpuAlert = cpu >= 90
  const hostRamAlert = hostUsed != null && hostTotal != null && hostUsed / hostTotal > 0.9

  const metrics: Metric[] = []

  // Server-side metrics only when the server is actually running — no stale ghosts.
  if (serverRunning) {
    metrics.push({
      key: 'pzMem',
      label: 'PZ memory',
      value: pzMem > 1024 ? (pzMem / 1024).toFixed(1) : pzMem,
      unit: pzMem > 1024 ? 'GB' : 'MB',
      dataKey: latest.pzMemMB != null ? 'pzMemMB' : 'memoryMB',
      color: 'hsl(var(--chart-2))',
      alert: pzAlert,
    })
    metrics.push({
      key: 'players',
      label: 'Players',
      value: latest.playerCount,
      unit: latest.playerCount === 1 ? 'online' : 'online',
      dataKey: 'playerCount',
      color: 'hsl(var(--chart-1))',
    })
  }

  // Host metrics are always meaningful.
  metrics.push({
    key: 'cpu',
    label: 'Host CPU',
    value: cpu,
    unit: '%',
    dataKey: 'cpuPercent',
    color: 'hsl(var(--chart-3))',
    alert: cpuAlert,
  })

  if (hostUsed != null && hostTotal != null) {
    metrics.push({
      key: 'hostMem',
      label: 'Host memory',
      value: `${hostUsed.toFixed(1)} / ${hostTotal}`,
      unit: 'GB',
      dataKey: 'hostMemUsedGB',
      color: 'hsl(var(--chart-4))',
      alert: hostRamAlert,
    })
  }

  return (
    <div>
      {metrics.map((m, i) => (
        <MetricStrip key={m.key} metric={m} data={performanceHistory} isFirst={i === 0} />
      ))}
      <TimeAxis data={performanceHistory} />
    </div>
  )
}

export default memo(DashboardPerformanceCharts)