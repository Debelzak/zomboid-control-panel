import { memo } from 'react'
import { Users, Cpu, HardDrive, Gamepad2 } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'

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
}

/* Tiny inline sparkline — no axes, just the shape */
function Spark({ data, dataKey, color, height = 40 }: { data: DashboardPerformancePoint[]; dataKey: string; color: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <RTooltip
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11, padding: '4px 8px' }}
          labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }}
        />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#grad-${dataKey})`} dot={false} animationDuration={600} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* Stat row: icon + label + current value + sparkline */
function StatRow({ icon: Icon, label, value, unit, spark, color, alert }: {
  icon: React.ElementType
  label: string
  value: string | number
  unit: string
  spark: React.ReactNode
  color: string
  alert?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      {/* Icon */}
      <div className="shrink-0 rounded-md p-1.5" style={{ background: `color-mix(in oklch, ${color}, transparent 88%)` }}>
        <Icon className="h-3.5 w-3.5" style={{ color }} />
      </div>
      {/* Label + value */}
      <div className="shrink-0 min-w-[90px]">
        <p className="text-[11px] leading-none text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-lg font-semibold tabular-nums leading-tight ${alert ? 'text-destructive' : 'text-foreground'}`}>
          {value}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>
        </p>
      </div>
      {/* Sparkline */}
      <div className="flex-1 min-w-0">
        {spark}
      </div>
    </div>
  )
}

function DashboardPerformanceCharts({ performanceHistory }: DashboardPerformanceChartsProps) {
  const latest = performanceHistory[performanceHistory.length - 1]
  if (!latest) return null

  const pzMem = latest.pzMemMB ?? latest.memoryMB
  const cpu = latest.cpuPercent ?? 0
  const hostUsed = latest.hostMemUsedGB
  const hostTotal = latest.hostMemTotalGB
  const hostLabel = hostUsed != null && hostTotal != null ? `${hostUsed}/${hostTotal}` : '—'
  const pzAlert = pzMem > 7600

  const chartColors = {
    players: 'hsl(var(--chart-1))',
    pzMem: pzAlert ? 'hsl(var(--destructive))' : 'hsl(var(--chart-2))',
    cpu: 'hsl(var(--chart-3))',
    host: 'hsl(var(--chart-4))',
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-5 py-4 divide-y divide-border/40">
      <StatRow
        icon={Users}
        label="Players"
        value={latest.playerCount}
        unit=""
        color={chartColors.players}
        spark={<Spark data={performanceHistory} dataKey="playerCount" color={chartColors.players} />}
      />
      <StatRow
        icon={Gamepad2}
        label="PZ Server RAM"
        value={pzMem > 1024 ? (pzMem / 1024).toFixed(1) : pzMem}
        unit={pzMem > 1024 ? ' GB' : ' MB'}
        color={chartColors.pzMem}
        alert={pzAlert}
        spark={<Spark data={performanceHistory} dataKey={latest.pzMemMB != null ? 'pzMemMB' : 'memoryMB'} color={chartColors.pzMem} />}
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