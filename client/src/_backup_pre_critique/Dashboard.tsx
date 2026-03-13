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
  WifiOff,
  Loader2,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  Link2,
  Link2Off,
  LogIn,
  LogOut,
  Activity,
  Archive,
  Skull,
  Sword,
  ShieldAlert,
  Clock,
  MessageSquare,
  ExternalLink,
  Copy,
  Send,
  Gamepad2,
  Globe,
  FolderOpen,
  X
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { serverApi, rconApi, playersApi, panelBridgeApi, backupApi, configApi, serversApi, debugApi, ServerInstance } from '@/lib/api'
import { formatUptime } from '@/lib/utils'
import { useSocket } from '@/contexts/SocketContext'
import { EmptyState } from '@/components/EmptyState'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

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

interface ChatPreviewMsg {
  author: string
  message: string
  timestamp: Date
}

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

const toneClasses = {
  default: 'border-primary/20 bg-primary/10 text-primary',
  success: 'border-primary/20 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
} as const

function StatusCard({
  title,
  icon,
  tone,
  value,
  description,
  children,
}: {
  title: string
  icon: React.ReactNode
  tone: 'default' | 'success' | 'warning' | 'destructive'
  value: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Card className="card-interactive overflow-hidden border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-3 flex items-center gap-4">
          <div className={cn('flex h-12 w-12 items-center justify-center rounded-xl border', toneClasses[tone])}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-3xl font-bold tracking-tight">{value}</div>
            {description ? <div className="mt-0.5 text-sm text-muted-foreground truncate" title={typeof description === 'string' ? description : undefined}>{description}</div> : null}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [playerActivity, setPlayerActivity] = useState<PlayerActivity[]>([])
  const [performanceHistory, setPerformanceHistory] = useState<PerformancePoint[]>([])
  const [chatPreview, setChatPreview] = useState<ChatPreviewMsg[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [autoStartServer, setAutoStartServer] = useState<boolean>(false)
  const [quickChatMsg, setQuickChatMsg] = useState('')
  const [sendingChat, setSendingChat] = useState(false)
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
    } catch (error) {
      console.error('Failed to fetch status:', error)
      setFetchError('Failed to connect to server')
    }
  }, [])

  const fetchPlayers = useCallback(async () => {
    try {
      const data = await playersApi.getPlayers()
      if (data.players) {
        setPlayers(data.players)
      }
    } catch (error) {
      console.error('Failed to fetch players:', error)
    }
  }, [])

  const fetchBridgeStatus = useCallback(async () => {
    try {
      const data = await panelBridgeApi.getStatus()
      setBridgeStatus(data)
    } catch (error) {
      console.error('Failed to fetch bridge status:', error)
    }
  }, [])

  const fetchPlayerActivity = useCallback(async () => {
    try {
      const data = await playersApi.getActivityLogs(undefined, 15)
      if (data.logs) {
        // Show all event types for timeline
        setPlayerActivity(data.logs.slice(0, 10))
      }
    } catch (error) {
      console.error('Failed to fetch player activity:', error)
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
        await Promise.all([
          fetchStatus(), 
          fetchPlayers(), 
          fetchBridgeStatus(), 
          fetchPlayerActivity(), 
          fetchAutoStartSetting(),
          serverApi.getPanelInfo().then(setPanelInfo).catch(e => console.warn('Failed to load panel info:', e.message)),
          fetchActiveServer()
        ])
      } catch (error) {
        console.error('Failed to load initial data:', error)
      } finally {
        setInitialLoading(false)
      }
    }
    loadInitialData()
    
    // Safety timeout to force exit loading state after 10 seconds
    const loadingTimeout = setTimeout(() => {
      if (initialLoadingRef.current) {
        console.warn('Loading timeout reached, forcing exit from loading state')
        setInitialLoading(false)
      }
    }, 10000)
    
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

      const handleChat = (data: any) => {
        setChatPreview(prev => {
            const next = [...prev, {
                author: data.author,
                message: data.message,
                timestamp: new Date(data.timestamp || Date.now())
            }];
            return next.slice(-5);
        });
      }

      socket.on('server:status', handleServerStatus)
      socket.on('players:update', handlePlayersUpdate)
      socket.on('activeServerChanged', handleActiveServerChanged)
      socket.on('panelBridge:modStatus', handleBridgeModStatus)
      socket.on('chat:message', handleChat)

      return () => {
        socket.off('server:status', handleServerStatus)
        socket.off('players:update', handlePlayersUpdate)
        socket.off('activeServerChanged', handleActiveServerChanged)
        socket.off('panelBridge:modStatus', handleBridgeModStatus)
        socket.off('chat:message', handleChat)
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
        description: error instanceof Error ? error.message : 'Action failed',
        variant: 'destructive',
      })
    } finally {
      setLoading(null)
    }
  }

  const handleConnect = async () => {
    await handleAction('Connect RCON', () => rconApi.connect())
  }

  const handleQuickChat = async () => {
    if (!quickChatMsg.trim()) return
    setSendingChat(true)
    try {
      // Use RCON to broadcast message (servermsg)
      const safeMessage = quickChatMsg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')
      await rconApi.execute(`servermsg "[Admin] ${safeMessage}"`)
      setQuickChatMsg('')
      toast({
        title: 'Broadcast Sent',
        description: 'Your message is now moving across the server feed.',
        variant: 'success' as const,
        duration: 2000
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive',
      })
    } finally {
      setSendingChat(false)
    }
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
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl" />
              <RefreshCw className="relative w-10 h-10 animate-spin text-primary" />
            </div>
            <p className="text-muted-foreground font-medium">Loading server status...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 page-transition">
      <PageHeader
        title="Dashboard"
        description="Monitor and control your Project Zomboid server"
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
        <Card className="mission-brief card-interactive overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--primary)/0.08))]">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Server className="h-5 w-5 text-primary" />
                  First server quick start
                </CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-6">
                  The panel becomes useful as soon as one server is connected, active, and reachable over RCON. You do not need to configure every feature first.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={dismissQuickStart} className="shrink-0" aria-label="Dismiss quick start guide">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="mission-step-grid grid gap-3 md:grid-cols-3">
              <div className="mission-step-card rounded-xl border border-border/60 bg-background/45 p-4">
                <div className="mission-step-icon mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-foreground">1. Bring in a server</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Add an existing install, a remote RCON target, or create a new server from the guided setup.
                </p>
              </div>

              <div className="mission-step-card rounded-xl border border-border/60 bg-background/45 p-4">
                <div className="mission-step-icon mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Wifi className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-foreground">2. Verify connectivity</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Confirm server paths, RCON credentials, and the active server selection so the dashboard can talk to the right machine.
                </p>
              </div>

              <div className="mission-step-card rounded-xl border border-border/60 bg-background/45 p-4">
                <div className="mission-step-icon mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Play className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-foreground">3. Reach live control</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Once status, players, and chat start updating here, you have the core admin loop working.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link to="/server-setup" className={cn(buttonVariants({ variant: 'default' }), 'onboarding-cta')}>
                <Server className="mr-2 h-4 w-4" />
                Install New Server
              </Link>
              <Link to="/servers" className={cn(buttonVariants({ variant: 'outline' }), 'onboarding-cta')}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Add Existing Server
              </Link>
              <Link to="/servers" className={cn(buttonVariants({ variant: 'secondary' }), 'onboarding-cta')}>
                <Globe className="mr-2 h-4 w-4" />
                Add Remote Server
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 stagger-in">
        <StatusCard
          title="Server Status"
          icon={<Server className="h-5 w-5" />}
          tone={status?.running ? 'success' : 'destructive'}
          value={status?.running ? 'Online' : 'Offline'}
          description={status?.running && status.uptime > 0 ? `Uptime: ${formatUptime(status.uptime)}` : undefined}
        >
          {(status?.publicIp || status?.localIp || status?.port) && (
              <div className="grid grid-cols-1 gap-2 border-t border-border/50 pt-3">
                {status.publicIp && (
                  <div className="flex items-center justify-between gap-2 text-sm bg-muted/40 px-2 py-1.5 rounded-md">
                    <span className="text-xs text-muted-foreground font-medium shrink-0 w-16">Public IP</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(status.publicIp!, "Public IP"); }}
                      className="flex-1 flex items-center justify-end gap-2 hover:text-primary transition-colors font-mono text-right"
                      title="Click to copy"
                    >
                      <span className="truncate">{status.publicIp}</span>
                      <Copy className="w-3 h-3 opacity-50 shrink-0" />
                    </button>
                    {status.port && (
                      <a 
                         href={`steam://connect/${status.publicIp}:${status.port}`}
                         onClick={(e) => e.stopPropagation()}
                         className="p-1 hover:bg-muted rounded text-primary hover:text-primary/80"
                         title="Connect with Steam"
                      >
                         <Gamepad2 className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}
                {status.localIp && (
                  <div className="flex items-center justify-between gap-2 text-sm bg-muted/40 px-2 py-1.5 rounded-md">
                    <span className="text-xs text-muted-foreground font-medium shrink-0 w-16">Local IP</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(status.localIp!, "Local IP"); }}
                      className="flex-1 flex items-center justify-end gap-2 hover:text-primary transition-colors font-mono text-right"
                      title="Click to copy"
                    >
                      <span className="truncate">{status.localIp}</span>
                      <Copy className="w-3 h-3 opacity-50 shrink-0" />
                    </button>
                    {status.port && (
                      <a 
                         href={`steam://connect/${status.localIp}:${status.port}`}
                         onClick={(e) => e.stopPropagation()}
                         className="p-1 hover:bg-muted rounded text-primary hover:text-primary/80"
                         title="Connect with Steam"
                      >
                         <Gamepad2 className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}
                {status.port && (
                  <div className="flex items-center justify-between gap-2 text-sm bg-muted/40 px-2 py-1.5 rounded-md">
                    <span className="text-xs text-muted-foreground font-medium shrink-0 w-16">Port</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(status.port!.toString(), "Port"); }}
                      className="flex-1 flex items-center justify-end gap-2 hover:text-primary transition-colors font-mono text-right"
                      title="Click to copy"
                    >
                      {status.port}
                      <Copy className="w-3 h-3 opacity-50 shrink-0" />
                    </button>
                    <div className="w-6" /> {/* Spacer alignment */}
                  </div>
                )}
              </div>
            )}
        </StatusCard>

        <StatusCard
          title="RCON"
          icon={status?.rcon?.connected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          tone={status?.rcon?.connected ? 'success' : 'destructive'}
          value={status?.rcon?.connected ? 'Connected' : 'Offline'}
          description={`${status?.rcon?.host}:${status?.rcon?.port}`}
        />

        <StatusCard
          title="Panel Bridge"
          icon={bridgeStatus?.modConnected ? <Link2 className="h-5 w-5" /> : <Link2Off className="h-5 w-5" />}
          tone={bridgeStatus?.modConnected ? 'success' : bridgeStatus?.configured ? 'warning' : 'default'}
          value={bridgeStatus?.modConnected ? 'Connected' : bridgeStatus?.configured ? 'Waiting' : 'Setup Needed'}
          description={bridgeStatus?.modConnected
            ? (bridgeStatus.modStatus?.version ? `v${bridgeStatus.modStatus.version}` : bridgeStatus.modStatus?.serverName || 'Active')
            : bridgeStatus?.configured
              ? 'Panel ready. Waiting for the game server to load the Lua mod.'
              : undefined}
        >
          {!bridgeStatus?.modConnected ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {bridgeStatus?.configured
                  ? 'The panel is waiting for the in-game Lua mod to come online.'
                  : 'Install PanelBridge.lua in Settings, run Auto Setup, then restart the server.'}
              </p>
              <Link to="/settings" className="text-sm text-primary hover:underline">Open Bridge Setup</Link>
            </div>
          ) : null}
        </StatusCard>

        <StatusCard
          title="Players"
          icon={<Users className="h-5 w-5" />}
          tone="default"
          value={players.length}
          description={players.length > 0
            ? `${players.slice(0, 3).map(p => p.name).join(', ')}${players.length > 3 ? ` +${players.length - 3} more` : ''}`
            : 'No players online'}
        />
      </div>

      {/* Panel Access Address */}
      {panelInfo && (
        <Card className="card-interactive overflow-hidden border-border/60">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <Globe className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-muted-foreground mb-1">Panel Address — Access from any device on your network</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="max-w-full break-all text-base font-bold font-mono text-primary sm:text-lg">{panelInfo.url}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 sm:h-7 sm:w-7"
                    onClick={() => copyToClipboard(panelInfo.url, 'Panel address')}
                    aria-label="Copy panel address"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <a
                    href={panelInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                  >
                    <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-7 sm:w-7" aria-label="Open panel address in a new tab">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Server Controls */}
      <Card className="card-interactive">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Server className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Server Controls</CardTitle>
              <CardDescription className="mt-0.5">Start, stop, and manage your server</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => handleAction('Start server', serverApi.start)}
              disabled={status?.running || loading !== null || activeServer?.isRemote}
              variant="success"
              size="lg"
              className="gap-2"
              title={activeServer?.isRemote ? 'Not available for remote (RCON-only) servers' : undefined}
            >
              {loading === 'Start server' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              Start Server
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
              size="lg"
              className="gap-2"
            >
              {loading === 'Stop server' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Square className="w-5 h-5" />}
              Stop Server
            </Button>
            <Button
              onClick={() => setConfirmAction({
                title: 'Restart Server',
                description: 'This will send a 5-minute warning to all players, then restart the server.',
                action: () => serverApi.restart(5),
                variant: 'warning'
              })}
              disabled={!status?.running || loading !== null}
              variant="warning"
              size="lg"
              className="gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Restart (5min warning)
            </Button>
            <Button
              onClick={() => setConfirmAction({
                title: 'Restart Server Now',
                description: 'This will immediately restart the server without warning. All players will be disconnected!',
                action: () => serverApi.restart(0),
                variant: 'destructive'
              })}
              disabled={!status?.running || loading !== null}
              variant="destructive"
              size="lg"
              className="gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Restart Now
            </Button>
            <div className="flex-1 min-w-[200px]" />
            <Button
              onClick={() => handleAction('Save world', serverApi.save)}
              disabled={!status?.running || loading !== null}
              variant="secondary"
              size="lg"
              className="gap-2"
            >
              <Save className="w-5 h-5" />
              Save World
            </Button>
            <Button
              onClick={() => handleAction('Create backup', () => backupApi.createBackup({ includeDb: true }))}
              disabled={loading !== null || activeServer?.isRemote}
              variant="outline"
              size="lg"
              className="gap-2"
              title={activeServer?.isRemote ? 'Not available for remote (RCON-only) servers' : undefined}
            >
              <Archive className="w-5 h-5" />
              Backup Now
            </Button>
            {!status?.rcon?.connected && (
              <Button
                onClick={handleConnect}
                disabled={loading !== null}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                <Wifi className="w-5 h-5" />
                Connect RCON
              </Button>
            )}
          </div>
          
          {/* Auto-start setting - only for local servers */}
          {!activeServer?.isRemote && (
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border">
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
        </CardContent>
      </Card>

      {/* Performance Charts */}
      {performanceHistory.length > 0 && (
        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[0, 1].map((index) => (
                <Card key={index} className="card-interactive">
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
      )}

      {/* Events & Chat Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Events Timeline */}
        <Card className="card-interactive h-full">
          <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Events Timeline</CardTitle>
              <CardDescription className="mt-0.5">Recent server and player events</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {playerActivity.length === 0 ? (
            <EmptyState type="noData" title="No recent events" description="Events will appear here as players connect and interact" compact />
          ) : (
            <div className="space-y-2">
              {playerActivity.map((activity) => {
                // Define icon and colors based on action type
                const getEventStyle = (action: string) => {
                  switch (action) {
                    case 'connect':
                      return { icon: <LogIn className="w-4 h-4" />, shell: 'border-primary/20 bg-primary/10 text-primary', label: 'joined' }
                    case 'disconnect':
                      return { icon: <LogOut className="w-4 h-4" />, shell: 'border-destructive/30 bg-destructive/10 text-destructive', label: 'left' }
                    case 'death':
                      return { icon: <Skull className="w-4 h-4" />, shell: 'border-warning/30 bg-warning/10 text-warning', label: 'died' }
                    case 'pvp_kill':
                      return { icon: <Sword className="w-4 h-4" />, shell: 'border-warning/30 bg-warning/10 text-warning', label: 'killed' }
                    case 'ban':
                      return { icon: <ShieldAlert className="w-4 h-4" />, shell: 'border-destructive/30 bg-destructive/10 text-destructive', label: 'was banned' }
                    case 'kick':
                      return { icon: <AlertCircle className="w-4 h-4" />, shell: 'border-warning/30 bg-warning/10 text-warning', label: 'was kicked' }
                    default:
                      return { icon: <Activity className="w-4 h-4" />, shell: 'border-border/60 bg-muted/40 text-foreground', label: action }
                  }
                }
                const style = getEventStyle(activity.action)
                
                return (
                  <div 
                    key={activity.id} 
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
                  >
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-full border', style.shell)}>
                      {style.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{activity.player_name}</span>
                      <span className="text-muted-foreground ml-2">{style.label}</span>
                      {activity.details && (
                        <span className="text-muted-foreground ml-1 text-sm">({activity.details})</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(activity.logged_at).toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Chat Preview */}
      <Card className="card-interactive flex h-full flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Live Chat</CardTitle>
                <CardDescription className="mt-0.5">Recent messages</CardDescription>
              </div>
            </div>
            <Link to="/chat">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-[200px] flex flex-col justify-end">
          {chatPreview.length === 0 ? (
            <EmptyState type="noMessages" title="No recent messages" description="Chat messages will appear here" compact />
          ) : (
            <div className="space-y-3">
              {chatPreview.map((msg, i) => (
                <div key={i} className="animate-in slide-in-from-bottom-2 flex gap-3 text-sm duration-300 fade-in">
                  <span className="font-semibold text-primary whitespace-nowrap">{msg.author}:</span>
                  <span className="text-foreground/90 break-words">{msg.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter className="pt-4 border-t px-4 py-3 bg-muted/20">
          <div className="flex w-full items-center gap-2">
            <Input 
              placeholder="Send message..." 
              value={quickChatMsg} 
              onChange={(e) => setQuickChatMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuickChat()}
              className="h-9 bg-background font-medium"
              maxLength={500}
            />
            <Button 
              size="icon" 
              className="h-9 w-9 shrink-0" 
              onClick={handleQuickChat}
              disabled={sendingChat || !quickChatMsg.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </CardFooter>
      </Card>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
          <AlertDialogContent className="glass border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <div className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full border',
                confirmAction?.variant === 'destructive'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-warning/30 bg-warning/10 text-warning'
              )}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              {confirmAction?.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base pl-[52px]">
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
