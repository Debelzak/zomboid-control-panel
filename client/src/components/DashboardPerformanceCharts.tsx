import { memo } from 'react'
import { Users, Cpu, HardDrive, Gamepad2 } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'

export interface DashboardPerformancePoint {
  time: string
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

/* Tiny inline sparkline — no axes, no tooltips, just the shape */
function Spark({ data, dataKey, color, height = 40, muted = false }: { data: DashboardPerformanceChartsProps['performanceHistory']; dataKey: string; color: string; height?: number; muted?: boolean }) {
  // Need at least 2 data points to draw a meaningful line; show a flat baseline otherwise.
  // Also show the flat baseline when the metric has been all-zero/null across the
  // window — drawing a flat line at zero reads as "0 active" instead of "no data".
  const hasSignal = !muted && data.some(d => {
    const v = (d as unknown as Record<string, unknown>)[dataKey]
    return typeof v === 'number' && v > 0
  })
  if (data.length < 2 || !hasSignal) {
    return (
      <div className="flex h-10 items-center" aria-hidden="true">
        <div className="h-px w-full bg-border/40" />
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#grad-${dataKey})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* Stat row: icon + label + current value + sparkline */
function StatRow({ icon: Icon, label, value, unit, spark, color, alert, muted }: {
  icon: React.ElementType
  label: string
  value: string | number
  unit: string
  spark: React.ReactNode
  color: string
  alert?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      {/* Icon */}
      <div className="shrink-0 rounded-md p-1.5" style={{ background: `color-mix(in oklch, ${color}, transparent 88%)`, opacity: muted ? 0.5 : 1 }}>
        <Icon className="h-3.5 w-3.5" style={{ color }} />
      </div>
      {/* Label + value */}
      <div className="shrink-0 min-w-[90px]">
        <p className="text-[11px] leading-none text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-lg font-semibold tabular-nums leading-tight ${alert ? 'text-destructive' : muted ? 'text-muted-foreground/60' : 'text-foreground'}`}>
          {value}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>
        </p>
      </div>
      {/* Sparkline */}
      <div className="flex-1 min-w-0" style={{ opacity: muted ? 0.4 : 1 }}>
        {spark}
      </div>
    </div>
  )
}

function DashboardPerformanceCharts({ performanceHistory, serverRunning = true }: DashboardPerformanceChartsProps) {
  const latest = performanceHistory[performanceHistory.length - 1]
  if (!latest) return null

  const pzMem = latest.pzMemMB ?? latest.memoryMB
  const cpu = latest.cpuPercent ?? 0
  const hostUsed = latest.hostMemUsedGB
  const hostTotal = latest.hostMemTotalGB
  const hostLabel = hostUsed != null && hostTotal != null ? `${hostUsed}/${hostTotal}` : '—'
  const pzAlert = serverRunning && pzMem > 7600

  const chartColors = {
    players: 'hsl(var(--chart-1))',
    pzMem: pzAlert ? 'hsl(var(--destructive))' : 'hsl(var(--chart-2))',
    cpu: 'hsl(var(--chart-3))',
    host: 'hsl(var(--chart-4))',
  }

  // When the server is offline, the latest snapshot's PZ-server values are stale
  // (the metrics service stops reporting once the process is gone).
  // Show em-dash placeholders instead of the misleading last-known number.
  const pzValue = serverRunning ? (pzMem > 1024 ? (pzMem / 1024).toFixed(1) : pzMem) : '—'
  const pzUnit = serverRunning ? (pzMem > 1024 ? ' GB' : ' MB') : ''
  const playersValue = serverRunning ? latest.playerCount : '—'

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-5 py-4 divide-y divide-border/40">
      <StatRow
        icon={Users}
        label="Players"
        value={playersValue}
        unit=""
        color={chartColors.players}
        spark={<Spark data={performanceHistory} dataKey="playerCount" color={chartColors.players} muted={!serverRunning} />}
        muted={!serverRunning}
      />
      <StatRow
        icon={Gamepad2}
        label="PZ Server RAM"
        value={pzValue}
        unit={pzUnit}
        color={chartColors.pzMem}
        alert={pzAlert}
        muted={!serverRunning}
        spark={<Spark data={performanceHistory} dataKey={latest.pzMemMB != null ? 'pzMemMB' : 'memoryMB'} color={chartColors.pzMem} muted={!serverRunning} />}
      />
      <StatRow
        icon={Cpu}
        label="Host CPU"
        value={cpu}
        unit="%"
        color={chartColors.cpu}
        spark={<Spark data={performanceHistory} dataKey="cpuPercent" color={chartColors.cpu} />}
      />
      <StatRow
        icon={HardDrive}
        label="Host RAM"
        value={hostLabel}
        unit={hostTotal != null ? ' GB' : ''}
        color={chartColors.host}
        spark={<Spark data={performanceHistory} dataKey="hostMemUsedGB" color={chartColors.host} />}
      />
    </div>
  )
}

export default memo(DashboardPerformanceCharts)