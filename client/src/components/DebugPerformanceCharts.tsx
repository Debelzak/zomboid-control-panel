import { memo, useMemo } from 'react'
import { Activity, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface DebugPerformancePoint {
  memoryMB?: number
  cpuLoad?: number
  time?: string
}

interface DebugPerformanceChartsProps {
  performanceHistory: DebugPerformancePoint[]
}

function useChartColors() {
  return useMemo(() => {
    const root = document.documentElement
    const style = getComputedStyle(root)
    const hsl = (v: string) => `hsl(${style.getPropertyValue(v).trim()})`
    return {
      grid: hsl('--border'),
      axis: hsl('--muted-foreground'),
      memory: hsl('--chart-1'),
      cpu: hsl('--chart-2'),
    }
  }, [])
}

function DebugPerformanceCharts({ performanceHistory }: DebugPerformanceChartsProps) {
  const colors = useChartColors()

  if (performanceHistory.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardContent>
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No performance data yet. Data collects over time.
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Memory Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={performanceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" stroke={colors.axis} fontSize={12} />
              <YAxis stroke={colors.axis} fontSize={12} unit=" MB" />
              <RTooltip />
              <Area type="monotone" dataKey="memoryMB" stroke={colors.memory} fill={colors.memory} fillOpacity={0.3} name="Memory (MB)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            CPU Load Average
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={performanceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" stroke={colors.axis} fontSize={12} />
              <YAxis stroke={colors.axis} fontSize={12} />
              <RTooltip />
              <Line type="monotone" dataKey="cpuLoad" stroke={colors.cpu} strokeWidth={2} strokeDasharray="6 3" dot={false} name="CPU Load" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

export default memo(DebugPerformanceCharts)