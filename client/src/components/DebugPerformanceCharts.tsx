import { memo, useMemo } from 'react'
import { Activity, TrendingUp, Server, HardDrive } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTheme } from '@/contexts/ThemeContext'

export interface DebugPerformancePoint {
  memoryMB?: number
  cpuLoad?: number
  time?: string
  hostMemUsedGB?: number
  hostMemGB?: number
  pzMemMB?: number | null
  playerCount?: number
}

interface DebugPerformanceChartsProps {
  performanceHistory: DebugPerformancePoint[]
}

function useChartColors() {
  const { theme } = useTheme()
  return useMemo(() => {
    const root = document.documentElement
    const style = getComputedStyle(root)
    const hsl = (v: string) => `hsl(${style.getPropertyValue(v).trim()})`
    return {
      grid: hsl('--border'),
      axis: hsl('--muted-foreground'),
      memory: hsl('--chart-1'),
      cpu: hsl('--chart-2'),
      pz: hsl('--chart-3'),
      players: hsl('--chart-4'),
    }
  }, [theme])
}

function DebugPerformanceCharts({ performanceHistory }: DebugPerformanceChartsProps) {
  const colors = useChartColors()

  const hasPzData = performanceHistory.some(p => p.pzMemMB != null)

  if (performanceHistory.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardContent>
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No performance data yet. Data collects every 60 seconds.
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* PZ Server Memory */}
      {hasPzData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              PZ Server Memory (JVM)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={performanceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="time" stroke={colors.axis} fontSize={12} />
                <YAxis stroke={colors.axis} fontSize={12} unit=" MB" />
                <RTooltip formatter={(value) => [`${value} MB`, 'PZ Server']} />
                <Area type="monotone" dataKey="pzMemMB" stroke={colors.pz} fill={colors.pz} fillOpacity={0.3} name="PZ Server (MB)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Host Memory */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Host Memory
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={performanceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" stroke={colors.axis} fontSize={12} />
              <YAxis stroke={colors.axis} fontSize={12} unit=" GB" />
              <RTooltip formatter={(value) => [`${value} GB`, 'Host Used']} />
              <Area type="monotone" dataKey="hostMemUsedGB" stroke={colors.memory} fill={colors.memory} fillOpacity={0.3} name="Host Used (GB)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* CPU */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Host CPU Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={performanceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" stroke={colors.axis} fontSize={12} />
              <YAxis stroke={colors.axis} fontSize={12} unit="%" domain={[0, 100]} />
              <RTooltip formatter={(value) => [`${value}%`, 'CPU']} />
              <Line type="monotone" dataKey="cpuLoad" stroke={colors.cpu} strokeWidth={2} dot={false} name="CPU %" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Player Count */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Player Count
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={performanceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" stroke={colors.axis} fontSize={12} />
              <YAxis stroke={colors.axis} fontSize={12} allowDecimals={false} />
              <RTooltip />
              <Line type="stepAfter" dataKey="playerCount" stroke={colors.players} strokeWidth={2} dot={false} name="Players" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

export default memo(DebugPerformanceCharts)