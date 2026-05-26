import { memo, useMemo } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
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
  trend?: 'up' | 'down' | 'flat'
  trendPercent?: number
}

/**
 * Compute trend from data — compares average of first half vs second half.
 */
function computeTrend(data: DashboardPerformancePoint[], dataKey: string): { dir: 'up' | 'down' | 'flat'; pct: number } {
  if (data.length < 4) return { dir: 'flat', pct: 0 }
  const mid = Math.floor(data.length / 2)
  const avg = (slice: DashboardPerformancePoint[]) => {
    const vals = slice.map(d => {
      const v = (d as unknown as Record<string, unknown>)[dataKey]
      return typeof v === 'number' ? v : 0
    })
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }
  const first = avg(data.slice(0, mid))
  const second = avg(data.slice(mid))
  if (first === 0 && second === 0) return { dir: 'flat', pct: 0 }
  const pct = first > 0 ? ((second - first) / first) * 100 : second > 0 ? 100 : 0
  if (Math.abs(pct) < 3) return { dir: 'flat', pct: 0 }
  return { dir: pct > 0 ? 'up' : 'down', pct: Math.round(Math.abs(pct)) }
}

/**
 * Custom tooltip for the sparkline.
 */
function SparkTooltip({ active, payload, dataKey, unit }: { active?: boolean; payload?: Array<{ payload: DashboardPerformancePoint }>; dataKey: string; unit: string }) {
  if (!active || !payload?.[0]) return null
  const point = payload[0].payload
  const val = (point as unknown as Record<string, unknown>)[dataKey]
  const ts = point.timestamp ? new Date(point.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : point.time
  return (
    <div className="rounded border border-border/60 bg-popover/95 px-2 py-1 text-xs shadow-md backdrop-blur-sm">
      <span className="font-mono tabular-nums text-foreground">{typeof val === 'number' ? (val > 100 ? Math.round(val) : val.toFixed(1)) : String(val ?? '')}</span>
      <span className="ml-0.5 text-muted-foreground">{unit}</span>
      <span className="ml-2 text-muted-foreground/70">{ts}</span>
    </div>
  )
}

/**
 * Inline trace — sparkline area chart with subtle glow and interactive tooltip.
 */
function InlineTrace({
  data,
  dataKey,
  color,
  unit,
}: {
  data: DashboardPerformanceChartsProps['performanceHistory']
  dataKey: string
  color: string
  unit?: string
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

  const gradientId = `trace-${dataKey}`
  const glowId = `glow-${dataKey}`

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="60%" stopColor={color} stopOpacity={0.08} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <Tooltip
          content={<SparkTooltip dataKey={dataKey} unit={unit || ''} />}
          cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '3 3', strokeOpacity: 0.3 }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 3, fill: color, stroke: 'hsl(var(--background))', strokeWidth: 1.5 }}
          isAnimationActive={false}
          filter={`url(#${glowId})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/**
 * Trend indicator arrow.
 */
function TrendArrow({ dir, pct }: { dir: 'up' | 'down' | 'flat'; pct: number }) {
  if (dir === 'flat' || pct === 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-[9px] tabular-nums',
        dir === 'up' ? 'text-amber-400/80' : 'text-emerald-400/80'
      )}
      title={`${dir === 'up' ? '+' : '-'}${pct}% vs prior window`}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className={dir === 'down' ? 'rotate-180' : ''}>
        <path d="M4 1L7 5H1L4 1Z" />
      </svg>
      {pct > 5 && <span>{pct}%</span>}
    </span>
  )
}

/**
 * Live pulse dot — animating indicator that data is flowing.
 */
function LiveDot({ color }: { color: string }) {
  return (
    <span className="relative ml-1 inline-flex h-2 w-2">
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  )
}

/**
 * One metric row: label + trend on the left, sparkline in the middle, readout + live dot right.
 */
function MetricStrip({
  metric,
  data,
  isFirst,
  isLive,
}: {
  metric: Metric
  data: DashboardPerformanceChartsProps['performanceHistory']
  isFirst: boolean
  isLive: boolean
}) {
  return (
    <div
      className={cn(
        'relative grid items-center gap-4 px-4 py-3 grid-cols-[8rem_minmax(0,1fr)_8rem] transition-colors',
        !isFirst && 'border-t border-border/30',
        metric.alert && 'bg-destructive/[0.06]'
      )}
    >
      {/* Label + trend */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'font-mono text-[11px] uppercase tracking-[0.12em] truncate',
            metric.alert ? 'text-destructive/85' : 'text-foreground/65'
          )}
        >
          {metric.label}
        </span>
        {metric.trend && <TrendArrow dir={metric.trend} pct={metric.trendPercent ?? 0} />}
      </div>

      {/* Sparkline */}
      <div className="h-9 min-w-0">
        <InlineTrace data={data} dataKey={metric.dataKey} color={metric.alert ? 'hsl(var(--destructive))' : metric.color} unit={metric.unit} />
      </div>

      {/* Value readout + live dot */}
      <div className="flex items-center gap-1 justify-self-end">
        <div className="flex items-baseline gap-0.5">
          <span
            className={cn(
              'font-display text-2xl leading-none tracking-[0.01em] tabular-nums',
              metric.alert ? 'text-destructive' : 'text-foreground'
            )}
          >
            {metric.value}
          </span>
          {metric.unit && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {metric.unit}
            </span>
          )}
        </div>
        {isLive && <LiveDot color={metric.alert ? 'hsl(var(--destructive))' : metric.color} />}
      </div>
    </div>
  )
}

/**
 * Time axis with 5 ticks aligned to the trace column.
 */
function TimeAxis({ data }: { data: DashboardPerformanceChartsProps['performanceHistory'] }) {
  if (data.length < 2) return null
  const firstTs = data[0].timestamp
  const lastTs = data[data.length - 1].timestamp
  let spanSec: number
  if (firstTs && lastTs) {
    const a = new Date(firstTs).getTime()
    const b = new Date(lastTs).getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null
    spanSec = (b - a) / 1000
  } else {
    spanSec = (data.length - 1) * 15
  }
  const fmt = (fraction: number) => {
    if (fraction >= 0.98) return 'now'
    const ago = spanSec * (1 - fraction)
    if (ago < 60) return `−${Math.round(ago)}s`
    return `−${Math.round(ago / 60)}m`
  }
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)_8rem] gap-4 border-t border-border/20 px-4 py-1">
      <span aria-hidden="true" />
      <div className="flex justify-between font-mono text-[9px] tabular-nums text-muted-foreground/50">
        <span>{fmt(0)}</span>
        <span>{fmt(0.25)}</span>
        <span>{fmt(0.5)}</span>
        <span>{fmt(0.75)}</span>
        <span className="text-muted-foreground/70">{fmt(1)}</span>
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

  // Data is "live" if the last sample is < 30s old
  const isLive = useMemo(() => {
    if (!latest.timestamp) return false
    return (Date.now() - new Date(latest.timestamp).getTime()) < 30000
  }, [latest.timestamp])

  const metrics: Metric[] = useMemo(() => {
    const m: Metric[] = []

    if (serverRunning) {
      const pzDataKey = latest.pzMemMB != null ? 'pzMemMB' : 'memoryMB'
      const pzTrend = computeTrend(performanceHistory, pzDataKey)
      m.push({
        key: 'pzMem',
        label: 'PZ memory',
        value: pzMem > 1024 ? (pzMem / 1024).toFixed(1) : pzMem,
        unit: pzMem > 1024 ? 'GB' : 'MB',
        dataKey: pzDataKey,
        color: 'hsl(var(--chart-2))',
        alert: pzAlert,
        trend: pzTrend.dir,
        trendPercent: pzTrend.pct,
      })

      const playerTrend = computeTrend(performanceHistory, 'playerCount')
      m.push({
        key: 'players',
        label: 'Players',
        value: latest.playerCount,
        unit: 'online',
        dataKey: 'playerCount',
        color: 'hsl(var(--chart-1))',
        trend: playerTrend.dir,
        trendPercent: playerTrend.pct,
      })
    }

    const cpuTrend = computeTrend(performanceHistory, 'cpuPercent')
    m.push({
      key: 'cpu',
      label: 'Host CPU',
      value: cpu,
      unit: '%',
      dataKey: 'cpuPercent',
      color: 'hsl(var(--chart-3))',
      alert: cpuAlert,
      trend: cpuTrend.dir,
      trendPercent: cpuTrend.pct,
    })

    if (hostUsed != null && hostTotal != null) {
      const hostTrend = computeTrend(performanceHistory, 'hostMemUsedGB')
      m.push({
        key: 'hostMem',
        label: 'Host memory',
        value: `${hostUsed.toFixed(1)} / ${hostTotal}`,
        unit: 'GB',
        dataKey: 'hostMemUsedGB',
        color: 'hsl(var(--chart-4))',
        alert: hostRamAlert,
        trend: hostTrend.dir,
        trendPercent: hostTrend.pct,
      })
    }

    return m
  }, [performanceHistory, serverRunning, latest, pzMem, cpu, hostUsed, hostTotal, pzAlert, cpuAlert, hostRamAlert])

  return (
    <div>
      {metrics.map((m, i) => (
        <MetricStrip key={m.key} metric={m} data={performanceHistory} isFirst={i === 0} isLive={isLive} />
      ))}
      <TimeAxis data={performanceHistory} />
    </div>
  )
}

export default memo(DashboardPerformanceCharts)