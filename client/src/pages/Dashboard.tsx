import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { usePageShortcut } from '../hooks/useKeyboardShortcuts'
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
  Trash2,
  Download,
  Sparkles,
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
import { serverApi, rconApi, playersApi, panelBridgeApi, backupApi, configApi, serversApi, debugApi, panelUpdateApi, ServerInstance, PanelUpdateStatus } from '@/lib/api'
import { formatUptime } from '@/lib/utils'
import { useSocket } from '@/contexts/SocketContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusIndicator } from '@/components/StatusIndicator'
import { cn, copyText } from '@/lib/utils'
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
  pzMemMB?: number
  cpuPercent?: number
  hostMemUsedGB?: number
  hostMemTotalGB?: number
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
  const [, setTick] = useState(0)
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
  const [panelUpdate, setPanelUpdate] = useState<PanelUpdateStatus | null>(null)
  const [panelUpdateDismissedVersion, setPanelUpdateDismissedVersion] = useState<string | null>(() => {
    try { return sessionStorage.getItem('panel-update-banner-dismissed') } catch { return null }
  })

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialLoadingRef = useRef(true)
  const [confirmAction, setConfirmAction] = useState<{
    title: string
    description: string
    action: () => Promise<unknown>
    variant?: 'destructive' | 'warning'
  } | null>(null)
  const [wipeDialog, setWipeDialog] = useState(false)
  const [wipeTargets, setWipeTargets] = useState<Record<string, boolean>>({ map: true, players: true, world: true })
  const [wipePreview, setWipePreview] = useState<{
    totalFiles: number
    totalSize: number
    preview: Record<string, { files: number; size: number }>
  } | null>(null)
  const [wipeLoading, setWipeLoading] = useState(false)
  const { toast } = useToast()
  const socket = useSocket()

  useEffect(() => {
    initialLoadingRef.current = initialLoading
  }, [initialLoading])

  // Tick every 10s to keep relative timestamp fresh
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(timer)
  }, [])

  // Fetch panel update status on mount + listen for socket announcements
  useEffect(() => {
    let cancelled = false
    panelUpdateApi.getStatus()
      .then(s => { if (!cancelled) setPanelUpdate(s) })
      .catch(() => { /* non-fatal; banner simply won't show */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!socket) return
    const handleAvailable = (data: { latestVersion?: string; currentVersion?: string; releaseUrl?: string }) => {
      setPanelUpdate(prev => ({
        currentVersion: data.currentVersion || prev?.currentVersion || 'Unknown',
        updateAvailable: true,
        latestVersion: data.latestVersion || prev?.latestVersion || null,
        releaseUrl: data.releaseUrl || prev?.releaseUrl || null,
        releaseNotes: prev?.releaseNotes ?? null,
        publishedAt: prev?.publishedAt ?? null,
        isChecking: false,
        isDownloading: prev?.isDownloading ?? false,
        downloadProgress: prev?.downloadProgress ?? 0,
        lastCheck: prev?.lastCheck ?? null,
        lastError: null,
        stagedUpdate: prev?.stagedUpdate ?? null,
        lastApplyResult: prev?.lastApplyResult ?? null,
      }))
    }
    const handleApplied = () => setPanelUpdate(prev => prev ? { ...prev, updateAvailable: false } : prev)
    socket.on('panel:updateAvailable', handleAvailable)
    socket.on('panel:updateApplied', handleApplied)
    return () => {
      socket.off('panel:updateAvailable', handleAvailable)
      socket.off('panel:updateApplied', handleApplied)
    }
  }, [socket])

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await copyText(text)
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
        duration: 2000,
      })
    } catch {
      toast({
        title: "Failed to Copy",
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

  // R = refresh dashboard
  usePageShortcut('r', () => { if (loading === null) fetchStatus() })

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
          memoryMB: Math.round((h.memoryUsed || 0) / (1024 * 1024)),
          pzMemMB: h.pzMemUsed ? Math.round(h.pzMemUsed / (1024 * 1024)) : undefined,
          cpuPercent: h.cpuUsage != null ? Math.round(h.cpuUsage) : undefined,
          hostMemUsedGB: h.hostMemUsed ? +(h.hostMemUsed / (1024 * 1024 * 1024)).toFixed(1) : undefined,
          hostMemTotalGB: h.hostMemTotal ? +(h.hostMemTotal / (1024 * 1024 * 1024)).toFixed(1) : undefined,
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
        title: checked ? 'Auto-Start Enabled' : 'Auto-Start Disabled',
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
      // Only poll data NOT pushed via Socket.IO (status, players, bridge are socket-driven)
      fetchPlayerActivity()
      if (showPerformanceCharts) {
        fetchPerformanceHistory()
      }
    }, 15000)

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
          <p className="text-4xl font-bold tracking-tight">Dashboard</p>
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
        return { icon: <LogIn className="w-3.5 h-3.5" />, color: 'text-success', label: 'joined' }
      case 'disconnect':
        return { icon: <LogOut className="w-3.5 h-3.5" />, color: 'text-destructive', label: 'left' }
      case 'death':
        return { icon: <Skull className="w-3.5 h-3.5" />, color: 'text-warning', label: 'died' }
      case 'pvp_kill':
        return { icon: <Sword className="w-3.5 h-3.5" />, color: 'text-warning', label: 'killed' }
      case 'ban':
        return { icon: <ShieldAlert className="w-3.5 h-3.5" />, color: 'text-destructive', label: 'was banned' }
      case 'kick':
        return { icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-warning', label: 'was kicked' }
      default:
        return { icon: <Activity className="w-3.5 h-3.5" />, color: 'text-muted-foreground', label: action }
    }
  }

  return (
    <div className="space-y-6 page-transition">
      <PageHeader
        title="Dashboard"
        description="Monitor and control your Project Zomboid server"
        tone="ops"
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground" title={lastUpdated.toLocaleTimeString()}>
                Updated {(() => {
                  const seconds = Math.round((Date.now() - lastUpdated.getTime()) / 1000)
                  if (seconds < 10) return 'just now'
                  if (seconds < 60) return `${seconds}s ago`
                  return `${Math.floor(seconds / 60)}m ago`
                })()}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading !== null}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Panel Update Available Banner */}
      {(() => {
        if (!panelUpdate?.updateAvailable) return null
        const latest = panelUpdate.latestVersion
        // Defensive: backend says update available but versions match — hide.
        if (latest && latest === panelUpdate.currentVersion) return null
        // Per-version dismissal.
        if (latest && panelUpdateDismissedVersion === latest) return null
        const isStaged = !!panelUpdate.stagedUpdate && (!latest || panelUpdate.stagedUpdate.version === latest)
        const lastFailed = panelUpdate.lastApplyResult?.status === 'failed'
          && (!latest || panelUpdate.lastApplyResult.pendingVersion === latest)
        const ctaLabel = isStaged ? 'Apply update' : 'View update'
        const title = isStaged
          ? `Panel update ready to apply${latest ? ` — v${latest}` : ''}`
          : `Panel update available${latest ? ` — v${latest}` : ''}`
        const body = lastFailed
          ? `Last apply attempt failed. Open Settings for diagnostics and the apply log.`
          : isStaged
            ? `v${latest ?? '?'} is downloaded. Restart the panel from Settings to apply it.`
            : `You're on v${panelUpdate.currentVersion}. Head to Settings to download and apply the update.`
        const dismiss = () => {
          if (!latest) return
          try { sessionStorage.setItem('panel-update-banner-dismissed', latest) } catch { /* ignore */ }
          setPanelUpdateDismissedVersion(latest)
        }
        return (
          <Alert className={lastFailed ? 'border-destructive/40 bg-destructive/10' : 'border-primary/40 bg-primary/10'}>
            <Sparkles className={`h-4 w-4 ${lastFailed ? 'text-destructive' : 'text-primary'}`} />
            <AlertTitle className={`break-words ${lastFailed ? 'text-destructive' : 'text-primary'}`}>
              {title}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words text-sm">{body}</span>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Link to="/settings?tab=panel">
                  <Button size="sm" variant={lastFailed ? 'destructive' : 'default'}>
                    <Download className="mr-2 h-4 w-4" />
                    {ctaLabel}
                  </Button>
                </Link>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Dismiss update notification"
                  onClick={dismiss}
                  disabled={!latest}
                  title="Dismiss until next version"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )
      })()}

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
        <Card className="overflow-hidden border-primary/25 bg-card">
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
                <span role="status" aria-live="polite" className="text-xl font-bold tracking-tight">
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
                  onClick={() => copyToClipboard(`${status.publicIp}${status.port ? `:${status.port}` : ''}`, "Public address")}
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
                  onClick={() => copyToClipboard(`${status.localIp}${status.port ? `:${status.port}` : ''}`, "Local address")}
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
                <DropdownMenuItem
                  onClick={() => { setWipePreview(null); setWipeDialog(true) }}
                  disabled={status?.running || loading !== null || activeServer?.isRemote}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Wipe Server
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
                <div className="rounded-xl border border-border/60 bg-card/50 px-5 py-4 space-y-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <div className="h-8 w-8 rounded-md bg-muted/40" />
                      <div className="w-[90px] space-y-1.5">
                        <div className="h-3 w-12 rounded bg-muted/40" />
                        <div className="h-5 w-16 rounded bg-muted/50" />
                      </div>
                      <div className="flex-1 h-10 animate-pulse rounded bg-muted/30" />
                    </div>
                  ))}
                </div>
              }
            >
              {showPerformanceCharts ? <DashboardPerformanceCharts performanceHistory={performanceHistory} /> : null}
            </Suspense>
          ) : (
            <div className="rounded-xl border border-border/60 bg-card/50 px-5 py-4 flex flex-col h-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">Players Online</p>
                  </div>
                  <p className="text-3xl font-bold tracking-tight tabular-nums">{players.length}</p>
                </section>
                <section>
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">Uptime</p>
                  </div>
                  <p className="text-3xl font-bold tracking-tight tabular-nums">{status?.running && status.uptime > 0 ? formatUptime(status.uptime) : 'Offline'}</p>
                </section>
              </div>
              {!status?.running && (
                <div className="mt-4 flex-1 flex flex-col gap-3">
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
                    <p className="text-sm text-muted-foreground">Performance data appears when the server is running.</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">Start the server to begin tracking CPU, RAM, and player metrics.</p>
                  </div>
                  <div className="mt-auto pt-3 border-t border-border/30">
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
                </div>
              )}
              {status?.running && (
                <div className="mt-auto pt-4 border-t border-border/30">
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
              <EmptyState compact type="noPlayers" title="No activity yet" description={status?.running ? "Player join/leave events will appear here." : "Start the server to begin tracking player activity."} />
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
                confirmAction?.variant === 'destructive' ? 'text-destructive' : 'text-warning'
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

      {/* Wipe Server Dialog */}
      <AlertDialog open={wipeDialog} onOpenChange={(open) => { if (!open && !wipeLoading) { setWipeDialog(false); setWipePreview(null) } }}>
        <AlertDialogContent className="glass border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <Trash2 className="w-5 h-5 text-destructive" />
              Wipe Server
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Select what data to delete from <span className="font-medium text-foreground">{activeServer?.serverName || 'the active server'}</span>. The server must be stopped.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            {([
              ['map', 'Map & Terrain', 'Chunks, terrain, buildings, zombie population, iso regions.'],
              ['players', 'Players & Vehicles', 'Player saves, inventories, positions, vehicle data.'],
              ['world', 'World State', 'World dictionary, metadata, erosion, game object states, radio.'],
            ] as const).map(([key, label, desc]) => (
              <label key={key} className="flex items-start gap-3 p-3 rounded-md border border-border/50 hover:bg-muted/30 cursor-pointer">
                <Checkbox
                  checked={wipeTargets[key]}
                  disabled={wipeLoading}
                  onCheckedChange={(checked) => {
                    setWipeTargets(prev => ({ ...prev, [key]: checked === true }))
                    setWipePreview(null)
                  }}
                />
                <div className="min-w-0">
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </label>
            ))}
            <div className="text-xs text-muted-foreground px-3 pb-1">Server .ini and sandbox settings are stored separately and will not be affected.</div>
          </div>

          {wipePreview && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm space-y-1">
              {wipePreview.totalFiles === 0 ? (
                <div className="text-muted-foreground">No files found for the selected targets.</div>
              ) : (
                <>
                  <div className="font-medium text-destructive">This will permanently delete:</div>
                  {(['map', 'players', 'world'] as const).map(key => {
                    const data = wipePreview.preview?.[key]
                    if (!data) return null
                    const labels = { map: 'map/terrain', players: 'player/vehicle', world: 'world state' }
                    return data.files > 0
                      ? <div key={key}>{data.files.toLocaleString()} {labels[key]} files ({(data.size / 1024 / 1024).toFixed(1)} MB)</div>
                      : <div key={key} className="text-muted-foreground">No {labels[key]} files found</div>
                  })}
                  <div className="font-medium pt-1">Total: {wipePreview.totalFiles.toLocaleString()} files ({(wipePreview.totalSize / 1024 / 1024).toFixed(1)} MB)</div>
                </>
              )}
            </div>
          )}

          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0" disabled={wipeLoading} onClick={() => { setWipeDialog(false); setWipePreview(null) }}>Cancel</AlertDialogCancel>
            {!wipePreview ? (
              <Button
                variant="warning"
                disabled={!Object.values(wipeTargets).some(Boolean) || wipeLoading}
                onClick={async () => {
                  if (wipeLoading) return
                  setWipeLoading(true)
                  try {
                    const targets = Object.entries(wipeTargets).filter(([, v]) => v).map(([k]) => k)
                    const res = await serverApi.wipePreview(targets)
                    setWipePreview(res)
                  } catch (e: unknown) {
                    toast({ title: 'Preview Failed', description: e instanceof Error ? e.message : 'Could not scan save directory', variant: 'destructive' })
                  } finally {
                    setWipeLoading(false)
                  }
                }}
              >
                {wipeLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Preview
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={wipeLoading || wipePreview.totalFiles === 0}
                onClick={async () => {
                  if (wipeLoading) return
                  setWipeLoading(true)
                  try {
                    const targets = Object.entries(wipeTargets).filter(([, v]) => v).map(([k]) => k)
                    await serverApi.wipe(targets)
                    toast({ title: 'Server Wiped', description: `Deleted: ${targets.join(', ')}` })
                    setWipeDialog(false)
                    setWipePreview(null)
                  } catch (e: unknown) {
                    toast({ title: 'Wipe Failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
                  } finally {
                    setWipeLoading(false)
                  }
                }}
              >
                {wipeLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Wipe Now
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
