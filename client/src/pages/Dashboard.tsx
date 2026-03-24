import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { 
  Play, 
  Square, 
  RotateCcw, 
  Save, 
  Users,
  Server,
  Wifi,
  Loader2,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  LogIn,
  LogOut,
  Activity,
  Archive,
  Skull,
  Sword,
  ShieldAlert,
  Copy,
  Gamepad2,
  Globe,
  FolderOpen,
  X,
  MoreHorizontal,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { serverApi, rconApi, playersApi, panelBridgeApi, backupApi, configApi, serversApi, debugApi, ServerInstance } from '@/lib/api'
import { formatUptime } from '@/lib/utils'
import { useSocket } from '@/contexts/SocketContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/PageHeader'
import { StatusIndicator } from '@/components/StatusIndicator'
import { cn } from '@/lib/utils'
import { getUserErrorMessage } from '@/lib/errorMessage'

interface PlayerActivity {
  id: number
  player_name: string
  action: string
  details: string | null
  logged_at: string
}

interface BridgeStatus {
  configured: boolean
  isRunning: boolean
  modConnected: boolean
  modStatus: {
    alive: boolean
    version?: string
    serverName?: string
    playerCount?: number
  } | null
}

interface ServerStatus {
  running: boolean
  startTime: string | null
  uptime: number
  serverPath: string
  configured: boolean
  publicIp?: string
  localIp?: string
  port?: number
  rcon: {
    host: string
    port: number
    connected: boolean
  }
}

interface Player {
  name: string
  online: boolean
}

interface PerformancePoint {
  time: string
  playerCount: number
  memoryMB: number
}

const DashboardPerformanceCharts = lazy(() => import('@/components/DashboardPerformanceCharts'))
const DASHBOARD_ONBOARDING_DISMISSED_KEY = 'pz-dashboard-onboarding-dismissed-v1'

function getDashboardSuccessCopy(action: string) {
  switch (action) {
    case 'Start server':
      return {
        title: 'Server Starting',
        description: 'Watch the dashboard for live status.',
      }
    case 'Stop server':
      return {
        title: 'Server Stopped',
        description: 'Session closed cleanly.',
      }
    case 'Restart server':
      return {
        title: 'Restart Scheduled',
        description: 'The server will restart shortly.',
      }
    case 'Restart server now':
      return {
        title: 'Restart Triggered',
        description: 'Hard restart command sent.',
      }
    case 'Save world':
      return {
        title: 'World Saved',
        description: 'Current state written to disk.',
      }
    case 'Create backup':
      return {
        title: 'Backup Started',
        description: 'Packaging a fresh recovery point.',
      }
    case 'Connect RCON':
      return {
        title: 'RCON Connected',
        description: 'Remote command control ready.',
      }
    default:
      return {
        title: 'Action Complete',
        description: `${action} completed successfully.`,
      }
  }
}

export default function Dashboard() {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [playerActivity, setPlayerActivity] = useState<PlayerActivity[]>([])
  const [performanceHistory, setPerformanceHistory] = useState<PerformancePoint[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [autoStartServer, setAutoStartServer] = useState<boolean>(false)
  const [panelInfo, setPanelInfo] = useState<{ localIp: string; port: number; url: string } | null>(null)
  const [activeServer, setActiveServer] = useState<ServerInstance | null>(null)
  const [showPerformanceCharts, setShowPerformanceCharts] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DASHBOARD_ONBOARDING_DISMISSED_KEY) !== 'true'
    } catch {
      return true
    }
  })

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialLoadingRef = useRef(true)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    action: () => Promise<unknown>
    variant?: 'destructive' | 'warning'
  } | null>(null)
  const { toast } = useToast()
  const socket = useSocket()

  useEffect(() => {
    initialLoadingRef.current = initialLoading
  }, [initialLoading])

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
        duration: 2000,
      })
    } catch {
      toast({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        variant: "destructive",
      })
    }
  }

  const dismissQuickStart = () => {
    setShowQuickStart(false)
    try {
      localStorage.setItem(DASHBOARD_ONBOARDING_DISMISSED_KEY, 'true')
    } catch {
      // Ignore storage errors.
    }
  }

  const fetchStatus = useCallback(async () => {
    try {
      const data = await serverApi.getStatus()
      setStatus(data)
      setFetchError(null)
      setLastUpdated(new Date())
    } catch {
      setFetchError('Failed to connect to server.')
    }
  }, [])

  const fetchPlayers = useCallback(async () => {
    try {
      const data = await playersApi.getPlayers()
      if (data.players) {
        setPlayers(data.players)
      }
    } catch {
      setPlayers([])
    }
  }, [])

  const fetchBridgeStatus = useCallback(async () => {
    try {
      const data = await panelBridgeApi.getStatus()
      setBridgeStatus(data)
    } catch {
      setBridgeStatus(null)
    }
  }, [])

  const fetchPlayerActivity = useCallback(async () => {
    try {
      const data = await playersApi.getActivityLogs(undefined, 15)
      if (data.logs) {
        // Show all event types for timeline
        setPlayerActivity(data.logs.slice(0, 10))
      }
    } catch {
      setPlayerActivity([])
    }
  }, [])

  const fetchPerformanceHistory = useCallback(async () => {
    try {
      const data = await debugApi.getPerformanceHistory(30)
      if (data.history) {
        setPerformanceHistory(data.history.map((h) => ({
          time: new Date(h.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          playerCount: h.playerCount || 0,
          memoryMB: Math.round((h.memoryUsed || 0) / (1024 * 1024))
        })))
      }
    } catch {
      // Endpoint may not exist yet
    }
  }, [])

  const fetchAutoStartSetting = useCallback(async () => {
    try {
      const response = await configApi.getAppSettings()
      if (response?.settings?.autoStartServer !== undefined) {
        setAutoStartServer(response.settings.autoStartServer === true || response.settings.autoStartServer === 'true')
      }
    } catch {
      // Setting may not exist yet
    }
  }, [])

  const fetchActiveServer = useCallback(async () => {
    try {
      const data = await serversApi.getActive()
      setActiveServer(data.server ?? null)
    } catch {
      setActiveServer(null)
    }
  }, [])

  const handleAutoStartChange = async (checked: boolean) => {
    setAutoStartServer(checked)
    try {
      await configApi.updateAppSettings({ autoStartServer: String(checked) })
      toast({
        title: checked ? 'Auto-start enabled' : 'Auto-start disabled',
        description: checked 
          ? 'Server will start automatically when the panel launches' 
          : 'Server will not start automatically',
      })
    } catch {
      // Revert on error
      setAutoStartServer(!checked)
      toast({
        title: 'Error',
        description: 'Failed to save auto-start setting',
        variant: 'destructive',
      })
    }
  }

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Critical data for above-the-fold dashboard state.
        await Promise.allSettled([
          fetchStatus(),
          fetchPlayers(),
          fetchBridgeStatus(),
        ])

        setInitialLoading(false)

        // Secondary data can load after first paint.
        void Promise.allSettled([
          fetchPlayerActivity(),
          fetchAutoStartSetting(),
          serverApi.getPanelInfo().then(setPanelInfo).catch(() => setPanelInfo(null)),
          fetchActiveServer(),
        ])
      } catch {
        setFetchError('Failed to load dashboard status.')
        setInitialLoading(false)
      }
    }
    loadInitialData()
    
    // Safety timeout to force exit loading state if critical requests stall.
    const loadingTimeout = setTimeout(() => {
      if (initialLoadingRef.current) {
        setFetchError((current) => current ?? 'The dashboard is taking longer than expected to respond.')
        setInitialLoading(false)
      }
    }, 5000)
    
    const interval = setInterval(() => {
      // Skip polling when tab is hidden to save resources
      if (document.visibilityState === 'hidden') return
      fetchStatus()
      fetchPlayers()
      fetchBridgeStatus()
      fetchPlayerActivity()
      if (showPerformanceCharts) {
        fetchPerformanceHistory()
      }
    }, 10000)

    return () => {
      clearTimeout(loadingTimeout)
      clearInterval(interval)
      // Also clean up the poll interval on unmount
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [fetchStatus, fetchPlayers, fetchBridgeStatus, fetchPlayerActivity, fetchPerformanceHistory, fetchAutoStartSetting, fetchActiveServer, showPerformanceCharts])

  useEffect(() => {
    if (socket) {
      const handleServerStatus = (data: Partial<ServerStatus>) => {
        // Safely merge data - only set if we have minimum required fields or existing state
        setStatus(prev => {
          if (prev) {
            return { ...prev, ...data }
          }
          // Only set initial state if data has required fields
          if ('running' in data && 'configured' in data) {
            return data as ServerStatus
          }
          return prev
        })
      }

      const handlePlayersUpdate = (data: Player[]) => {
        setPlayers(data)
      }

      const handleActiveServerChanged = (data?: { server?: ServerInstance | null }) => {
        if (data?.server !== undefined) {
          setActiveServer(data.server)
        } else {
          fetchActiveServer()
        }
        fetchStatus()
        fetchPlayers()
        fetchBridgeStatus()
      }

      const handleBridgeModStatus = (data: { alive: boolean; version?: string; serverName?: string; playerCount?: number }) => {
        setBridgeStatus(prev => ({
          configured: prev?.configured ?? true,
          isRunning: prev?.isRunning ?? true,
          modConnected: data.alive,
          modStatus: {
            alive: data.alive,
            version: data.version || prev?.modStatus?.version,
            serverName: data.serverName || prev?.modStatus?.serverName,
            playerCount: data.playerCount ?? 0
          }
        }))
      }

      socket.on('server:status', handleServerStatus)
      socket.on('players:update', handlePlayersUpdate)
      socket.on('activeServerChanged', handleActiveServerChanged)
      socket.on('panelBridge:modStatus', handleBridgeModStatus)

      return () => {
        socket.off('server:status', handleServerStatus)
        socket.off('players:update', handlePlayersUpdate)
        socket.off('activeServerChanged', handleActiveServerChanged)
        socket.off('panelBridge:modStatus', handleBridgeModStatus)
      }
    }
  }, [socket, fetchStatus, fetchPlayers, fetchBridgeStatus, fetchPlayerActivity, fetchPerformanceHistory, fetchActiveServer])

  useEffect(() => {
    if (initialLoading || showPerformanceCharts) {
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null

    const revealCharts = () => {
      setShowPerformanceCharts(true)
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(revealCharts, { timeout: 1500 })
    } else {
      timeoutId = setTimeout(revealCharts, 300)
    }

    return () => {
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [initialLoading, showPerformanceCharts])

  useEffect(() => {
    if (!showPerformanceCharts) {
      return
    }

    fetchPerformanceHistory()
  }, [showPerformanceCharts, fetchPerformanceHistory])

  // Refetch data when page becomes visible (important for mobile background/foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Page became visible, refetch data
        fetchStatus()
        fetchPlayers()
        fetchBridgeStatus()
        fetchPlayerActivity()
        if (showPerformanceCharts) {
          fetchPerformanceHistory()
        }
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchStatus, fetchPlayers, fetchBridgeStatus, fetchPlayerActivity, fetchPerformanceHistory, showPerformanceCharts])

  const handleAction = async (action: string, fn: () => Promise<unknown>) => {
    setLoading(action)
    try {
      await fn()
      const successCopy = getDashboardSuccessCopy(action)
      toast({
        title: successCopy.title,
        description: successCopy.description,
        variant: 'success' as const,
      })
      
      // After starting server, poll more frequently to detect when it's running
      if (action === 'Start server') {
        // Clear any existing poll interval
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
        }
        
        let attempts = 0
        pollIntervalRef.current = setInterval(async () => {
          attempts++
          try {
            const data = await serverApi.getStatus()
            setStatus(data)
            if (data?.running || attempts >= 15) {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current)
                pollIntervalRef.current = null
              }
            }
          } catch {
            // Continue polling on error
            if (attempts >= 15 && pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }
          }
        }, 2000)
      } else {
        fetchStatus()
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Action failed. Please try again.'),
        variant: 'destructive',
      })
    } finally {
      setLoading(null)
    }
  }

  const handleConnect = async () => {
    await handleAction('Connect RCON', () => rconApi.connect())
  }

  if (initialLoading) {
    return (
      <div className="space-y-8 page-transition">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-lg text-muted-foreground">Monitor and control your Project Zomboid server</p>
        </div>
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">Loading server status...</p>
          </div>
        </div>
      </div>
    )
  }

  const getEventStyle = (action: string) => {
    switch (action) {
      case 'connect':
        return { icon: <LogIn className="w-3.5 h-3.5" />, color: 'text-[hsl(var(--success))]', label: 'joined' }
      case 'disconnect':
        return { icon: <LogOut className="w-3.5 h-3.5" />, color: 'text-destructive', label: 'left' }
      case 'death':
        return { icon: <Skull className="w-3.5 h-3.5" />, color: 'text-[hsl(var(--warning))]', label: 'died' }
      case 'pvp_kill':
        return { icon: <Sword className="w-3.5 h-3.5" />, color: 'text-[hsl(var(--warning))]', label: 'killed' }
      case 'ban':
        return { icon: <ShieldAlert className="w-3.5 h-3.5" />, color: 'text-destructive', label: 'was banned' }
      case 'kick':
        return { icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-[hsl(var(--warning))]', label: 'was kicked' }
      default:
        return { icon: <Activity className="w-3.5 h-3.5" />, color: 'text-muted-foreground', label: action }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Monitor and control your Project Zomboid server"
        tone="ops"
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading !== null}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Error Banner */}
      {fetchError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">{fetchError}. Some features may be unavailable.</span>
            <Button variant="outline" size="sm" onClick={fetchStatus} className="self-start sm:self-auto">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Not Configured Warning */}
      {status && !status.configured && (
        <Link to="/server-setup" className="block">
          <Alert className="cursor-pointer border-warning/40 bg-warning/10 transition-colors hover:bg-warning/15">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle className="text-warning">Server Not Configured</AlertTitle>
            <AlertDescription>Open Server Setup to add or configure a server.</AlertDescription>
          </Alert>
        </Link>
      )}

      {!activeServer && showQuickStart && (
        <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--primary)/0.08))]">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Server className="h-5 w-5 text-primary" />
                  First server quick start
                </CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-6">
                  Start with one active server and working RCON. You can configure the rest later.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={dismissQuickStart} className="h-11 w-11 shrink-0 sm:h-10 sm:w-10" aria-label="Dismiss quick start guide">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <ol className="grid gap-3 md:grid-cols-3 list-none p-0 m-0">
              <li className="rounded-lg border border-border/60 bg-background/45 p-4">
                <p className="text-sm font-semibold text-foreground">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold bg-primary/15 text-primary" aria-hidden="true">1</span>
                  Bring in a server
                </p>
                <p className="mt-1.5 pl-7 text-sm leading-6 text-muted-foreground">
                  Add an existing install, connect remote RCON, or create a new server.
                </p>
              </li>
              <li className="rounded-lg border border-border/60 bg-background/45 p-4">
                <p className="text-sm font-semibold text-foreground">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold bg-primary/15 text-primary" aria-hidden="true">2</span>
                  Verify connectivity
                </p>
                <p className="mt-1.5 pl-7 text-sm leading-6 text-muted-foreground">
                  Confirm paths, RCON credentials, and active server.
                </p>
              </li>
              <li className="rounded-lg border border-border/60 bg-background/45 p-4">
                <p className="text-sm font-semibold text-foreground">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold bg-primary/15 text-primary" aria-hidden="true">3</span>
                  Reach live control
                </p>
                <p className="mt-1.5 pl-7 text-sm leading-6 text-muted-foreground">
                  When status, players, and chat update, live control is ready.
                </p>
              </li>
            </ol>

            <div className="flex flex-wrap gap-3">
              <Link to="/server-setup" className={cn(buttonVariants({ variant: 'default' }))}>
                <Server className="mr-2 h-4 w-4" />
                Install New Server
              </Link>
              <Link to="/servers" className={cn(buttonVariants({ variant: 'outline' }))}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Add Existing Server
              </Link>
              <Link to="/servers" className={cn(buttonVariants({ variant: 'secondary' }))}>
                <Globe className="mr-2 h-4 w-4" />
                Add Remote Server
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Server Status + Controls */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        {/* Status header */}
        <div className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-3 w-3 rounded-full shrink-0 server-status-dot",
                status?.running
                  ? "server-status-dot--online"
                  : "server-status-dot--offline"
              )} aria-hidden="true" />
              <div>
                <span className="text-xl font-bold tracking-tight">
                  {status?.running ? 'Server Online' : 'Server Offline'}
                </span>
                {status?.running && status.uptime > 0 && (
                  <span className="ml-3 text-sm text-muted-foreground">{formatUptime(status.uptime)}</span>
                )}
              </div>
            </div>

            {/* Subsystem indicators */}
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div title={`${status?.rcon?.host}:${status?.rcon?.port}`}>
                <StatusIndicator
                  state={status?.rcon?.connected ? 'online' : 'offline'}
                  label="RCON"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <StatusIndicator
                  state={bridgeStatus?.modConnected ? 'online' : bridgeStatus?.isRunning ? 'connecting' : 'offline'}
                  label="Bridge"
                />
                {bridgeStatus?.modConnected && bridgeStatus.modStatus?.version && (
                  <span className="text-xs text-muted-foreground">v{bridgeStatus.modStatus.version.replace(/^v/, '')}</span>
                )}
              </div>
              <Link to="/players" className="flex items-center gap-1.5 hover:text-primary transition-colors">
                <Users className="h-3.5 w-3.5" />
                <span className="font-medium">{players.length}</span>
                <span className="text-muted-foreground hidden sm:inline">online</span>
              </Link>
            </div>
          </div>

          {/* Connection info */}
          {(status?.publicIp || status?.localIp || panelInfo) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              {status?.publicIp && (
                <button
                  onClick={() => copyToClipboard(status.publicIp!, "Public IP")}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:min-h-8"
                  aria-label={`Copy public IP: ${status.publicIp}${status.port ? `:${status.port}` : ''}`}
                >
                  <span className="font-sans font-medium text-muted-foreground/70 uppercase tracking-wide text-xs">pub</span>
                  {status.publicIp}{status.port ? `:${status.port}` : ''}
                  <Copy className="w-3 h-3 opacity-40" />
                </button>
              )}
              {status?.localIp && (
                <button
                  onClick={() => copyToClipboard(status.localIp!, "Local IP")}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:min-h-8"
                  aria-label={`Copy local IP: ${status.localIp}${status.port ? `:${status.port}` : ''}`}
                >
                  <span className="font-sans font-medium text-muted-foreground/70 uppercase tracking-wide text-xs">lan</span>
                  {status.localIp}{status.port ? `:${status.port}` : ''}
                  <Copy className="w-3 h-3 opacity-40" />
                </button>
              )}
              {status?.publicIp && status?.port && (
                <a
                  href={`steam://connect/${status.publicIp}:${status.port}`}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:min-h-8"
                  title="Connect with Steam"
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  <span className="font-medium">Steam Connect</span>
                </a>
              )}
              {panelInfo && (
                <button
                  onClick={() => copyToClipboard(panelInfo.url, "Panel address")}
                  className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 sm:min-h-8"
                  aria-label={`Copy panel address: ${panelInfo.url}`}
                >
                  <Globe className="w-3 h-3" />
                  {panelInfo.url}
                  <Copy className="w-3 h-3 opacity-40" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Controls toolbar */}
        <div className="border-t border-border/40 px-5 py-4 bg-muted/10">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => handleAction('Start server', serverApi.start)}
              disabled={status?.running || loading !== null || activeServer?.isRemote}
              variant="success"
              className="gap-2"
              title={activeServer?.isRemote ? 'Not available for remote (RCON-only) servers' : undefined}
            >
              {loading === 'Start server' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start
            </Button>

            <Button
              onClick={() => setConfirmAction({
                title: 'Stop Server',
                description: 'Are you sure you want to stop the server? All connected players will be disconnected.',
                action: serverApi.stop,
                variant: 'destructive'
              })}
              disabled={!status?.running || loading !== null}
              variant="destructive"
              className="gap-2"
            >
              {loading === 'Stop server' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
              Stop
            </Button>

            <Button
              onClick={() => setConfirmAction({
                title: 'Restart Server',
                description: 'This will send a 5-minute warning to all players, then restart the server.',
                action: () => serverApi.restart(5),
                variant: 'warning'
              })}
              disabled={!status?.running || loading !== null || activeServer?.isRemote}
              variant="warning"
              className="gap-2"
              title={activeServer?.isRemote ? 'Not available for remote (RCON-only) servers' : undefined}
            >
              <RotateCcw className="w-4 h-4" />
              Restart
            </Button>

            <div className="flex-1" />

            {/* Frequent utility action */}
            <Button
              onClick={() => handleAction('Save world', serverApi.save)}
              disabled={!status?.running || loading !== null}
              variant="outline"
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              Save
            </Button>

            {/* Overflow menu for less-frequent actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-10 sm:w-10" aria-label="Open more server actions">
                  <MoreHorizontal className="w-4 h-4" />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handleAction('Create backup', () => backupApi.createBackup({ includeDb: true }))}
                  disabled={loading !== null || activeServer?.isRemote}
                >
                  <Archive className="w-4 h-4 mr-2" />
                  Create Backup
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center">
                    <Server className="w-4 h-4 mr-2" />
                    Bridge Settings
                  </Link>
                </DropdownMenuItem>
                {!status?.rcon?.connected && (
                  <DropdownMenuItem
                    onClick={handleConnect}
                    disabled={loading !== null}
                  >
                    <Wifi className="w-4 h-4 mr-2" />
                    Connect RCON
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirmAction({
                    title: 'Restart Server Now',
                    description: `This will immediately restart the server without warning.${players.length > 0 ? ` ${players.length} player(s) will be disconnected!` : ''}`,
                    action: () => serverApi.restart(0),
                    variant: 'destructive'
                  })}
                  disabled={!status?.running || loading !== null || activeServer?.isRemote}
                  className="text-destructive focus:text-destructive"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Restart Now
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!activeServer?.isRemote && (
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
              <Checkbox
                id="autoStartServer"
                checked={autoStartServer}
                onCheckedChange={(checked) => handleAutoStartChange(checked === true)}
              />
              <Label htmlFor="autoStartServer" className="text-sm text-muted-foreground cursor-pointer">
                Auto-start server when panel launches
              </Label>
            </div>
          )}
          {bridgeStatus && !bridgeStatus.configured && (
            <div className="mt-3 border-t border-border/30 pt-3 text-xs text-muted-foreground">
              Advanced world controls require PanelBridge.
              {' '}
              <Link to="/settings" className="text-primary hover:underline">Configure bridge</Link>
              {' '}
              when needed.
            </div>
          )}
        </div>
      </div>

      {/* Operational Grid: Performance + Activity side-by-side */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Performance Charts — left 3 cols on desktop */}
        <div className="lg:col-span-3 space-y-4">
          {performanceHistory.length > 0 ? (
            <Suspense
              fallback={
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {[0, 1].map((index) => (
                    <Card key={index}>
                      <CardHeader className="pb-2">
                        <div className="h-5 w-32 rounded bg-muted/60" />
                        <div className="h-4 w-24 rounded bg-muted/40" />
                      </CardHeader>
                      <CardContent>
                        <div className="h-[150px] animate-pulse rounded-lg bg-muted/40" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              }
            >
              {showPerformanceCharts ? <DashboardPerformanceCharts performanceHistory={performanceHistory} /> : null}
            </Suspense>
          ) : (
            <div className="rounded-xl border border-border/60 bg-card/50 px-5 py-4">
              <div className="grid grid-cols-2 gap-6">
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-medium text-muted-foreground">Players Online</h3>
                  </div>
                  <p className="text-3xl font-bold tracking-tight tabular-nums">{players.length}</p>
                </section>
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-medium text-muted-foreground">Uptime</h3>
                  </div>
                  <p className="text-3xl font-bold tracking-tight tabular-nums">{status?.running && status.uptime > 0 ? formatUptime(status.uptime) : 'Offline'}</p>
                </section>
              </div>
              {!status?.running && (
                <div className="mt-4 pt-4 border-t border-border/30">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Quick Actions</p>
                  <div className="flex flex-wrap gap-2">
                    <Link to="/server-config" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5 text-xs')}>
                      <Server className="h-3.5 w-3.5" /> Server Config
                    </Link>
                    <Link to="/mods" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5 text-xs')}>
                      <Gamepad2 className="h-3.5 w-3.5" /> Mods
                    </Link>
                    <Link to="/backups" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5 text-xs')}>
                      <Archive className="h-3.5 w-3.5" /> Backups
                    </Link>
                    <Link to="/settings" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5 text-xs')}>
                      <Wifi className="h-3.5 w-3.5" /> Settings
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Player Activity — right 2 cols, compact feed */}
        <section className="lg:col-span-2 rounded-xl border border-border/60 bg-card/50 px-5 py-4 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Player Activity</h2>
            <Link to="/players">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                View all
              </Button>
            </Link>
          </div>
          {playerActivity.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
            </div>
          ) : (
            <div className="space-y-1 flex-1 overflow-y-auto max-h-[22rem]">
              {playerActivity.map((activity) => {
                const style = getEventStyle(activity.action)

                return (
                  <div key={activity.id} className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/30">
                    <span className={cn("shrink-0", style.color)} aria-hidden="true">{style.icon}</span>
                    <span className="max-w-[10rem] truncate text-sm font-medium" dir="auto" title={activity.player_name}>{activity.player_name}</span>
                    <span className="text-xs text-muted-foreground">{style.label}</span>
                    <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground/70">
                      {new Date(activity.logged_at).toLocaleTimeString()}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent className="glass border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <AlertTriangle className={cn(
                "w-5 h-5",
                confirmAction?.variant === 'destructive' ? 'text-destructive' : 'text-[hsl(var(--warning))]'
              )} />
              {confirmAction?.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: confirmAction?.variant === 'destructive' ? 'destructive' : 'warning' }))}
              onClick={async () => {
                if (confirmAction) {
                  await handleAction(confirmAction.title, confirmAction.action)
                  setConfirmAction(null)
                }
              }}
            >
              {confirmAction?.title}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
