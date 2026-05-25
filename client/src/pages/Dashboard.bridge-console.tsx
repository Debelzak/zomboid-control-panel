import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { usePageShortcut } from '../hooks/useKeyboardShortcuts'
import {
  Play, Square, RotateCcw, Save, Server, Wifi, Loader2, AlertTriangle, RefreshCw, AlertCircle,
  LogIn, LogOut, Activity, Archive, Skull, Sword, ShieldAlert, Copy, Gamepad2, Globe, FolderOpen,
  X, MoreHorizontal, Zap, Trash2, Download, Sparkles, CalendarClock, Package, CheckCircle2,
  ChevronRight,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  serverApi, rconApi, playersApi, panelBridgeApi, backupApi, configApi, serversApi, debugApi,
  panelUpdateApi, modsApi, schedulerApi, ServerInstance, PanelUpdateStatus,
} from '@/lib/api'
import { formatUptime } from '@/lib/utils'
import { useSocket } from '@/contexts/SocketContext'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn, copyText } from '@/lib/utils'
import { getUserErrorMessage } from '@/lib/errorMessage'

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface PlayerActivity { id: number; player_name: string; action: string; details: string | null; logged_at: string }
interface BridgeStatus {
  configured: boolean
  isRunning: boolean
  modConnected: boolean
  modStatus: { alive: boolean; version?: string; serverName?: string; playerCount?: number } | null
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
  rcon: { host: string; port: number; connected: boolean }
}
interface Player { name: string; online: boolean }
interface PerformancePoint {
  time: string; playerCount: number; memoryMB: number
  pzMemMB?: number; cpuPercent?: number; hostMemUsedGB?: number; hostMemTotalGB?: number
}

const DashboardPerformanceCharts = lazy(() => import('@/components/DashboardPerformanceCharts'))
const DASHBOARD_ONBOARDING_DISMISSED_KEY = 'pz-dashboard-onboarding-dismissed-v1'

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function getDashboardSuccessCopy(action: string) {
  switch (action) {
    case 'Start server':   return { title: 'Server starting',     description: 'Watch the dashboard for live status.' }
    case 'Stop server':    return { title: 'Server stopped',      description: 'Session closed cleanly.' }
    case 'Restart server': return { title: 'Restart scheduled',   description: 'The server will restart shortly.' }
    case 'Restart server now': return { title: 'Restart triggered', description: 'Hard restart command sent.' }
    case 'Save world':     return { title: 'World saved',         description: 'Current state written to disk.' }
    case 'Create backup':  return { title: 'Backup started',      description: 'Packaging a fresh recovery point.' }
    case 'Connect RCON':   return { title: 'RCON connected',      description: 'Remote command control ready.' }
    default:               return { title: 'Action complete',     description: `${action} completed successfully.` }
  }
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function eventStyle(action: string) {
  switch (action) {
    case 'connect':    return { icon: <LogIn       className="h-3.5 w-3.5" />, tone: 'text-success',         verb: 'joined' }
    case 'disconnect': return { icon: <LogOut      className="h-3.5 w-3.5" />, tone: 'text-destructive/85',  verb: 'left' }
    case 'death':      return { icon: <Skull       className="h-3.5 w-3.5" />, tone: 'text-warning',         verb: 'died' }
    case 'pvp_kill':   return { icon: <Sword       className="h-3.5 w-3.5" />, tone: 'text-warning',         verb: 'killed' }
    case 'ban':        return { icon: <ShieldAlert className="h-3.5 w-3.5" />, tone: 'text-destructive',     verb: 'banned' }
    case 'kick':       return { icon: <AlertCircle className="h-3.5 w-3.5" />, tone: 'text-warning',         verb: 'kicked' }
    default:           return { icon: <Activity    className="h-3.5 w-3.5" />, tone: 'text-muted-foreground', verb: action }
  }
}

/**
 * Section heading — a single labeled rule line. Replaces card-wrapping for
 * the main stage sections so the page reads as one composed surface.
 */
function SectionHeading({
  label, meta, children,
}: { label: string; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-3 pb-3">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-foreground/55">
        {label}
      </span>
      <span className="h-px flex-1 bg-border/40" aria-hidden="true" />
      {meta && (
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
          {meta}
        </span>
      )}
      {children}
    </header>
  )
}

/**
 * Connection LED row used inside the right rail.
 */
function ConnLine({
  label, state, value, hint,
}: { label: string; state: 'on' | 'off' | 'wait'; value?: string; hint?: string }) {
  const dot =
    state === 'on'   ? 'bg-success shadow-[0_0_6px_hsl(var(--success)/0.7)]'
  : state === 'wait' ? 'bg-warning shadow-[0_0_6px_hsl(var(--warning)/0.7)] animate-pulse'
                     : 'bg-destructive/55'
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot)} aria-hidden="true" />
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground/70">{label}</span>
      <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground truncate">
        {value ?? (state === 'on' ? 'connected' : state === 'wait' ? 'pending' : 'offline')}
      </span>
      {hint && <span className="font-mono text-[10px] text-muted-foreground/50">{hint}</span>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

export default function Dashboard() {
  /* ---------------------------- state ------------------------------------- */
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
    try { return localStorage.getItem(DASHBOARD_ONBOARDING_DISMISSED_KEY) !== 'true' } catch { return true }
  })
  const [panelUpdate, setPanelUpdate] = useState<PanelUpdateStatus | null>(null)
  const [panelUpdateDismissedVersion, setPanelUpdateDismissedVersion] = useState<string | null>(() => {
    try { return sessionStorage.getItem('panel-update-banner-dismissed') } catch { return null }
  })
  const [maintenance, setMaintenance] = useState<{
    lastBackup: { name: string; size: number; created: string } | null
    backupCount: number
    modUpdatesAvailable: number
    modsTracked: number
    scheduledTasksCount: number
    schedulerLoaded: boolean
  }>({
    lastBackup: null, backupCount: 0, modUpdatesAvailable: 0, modsTracked: 0,
    scheduledTasksCount: 0, schedulerLoaded: false,
  })

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initialLoadingRef = useRef(true)

  const [confirmAction, setConfirmAction] = useState<{
    title: string; description: string
    action: () => Promise<unknown>
    variant?: 'destructive' | 'warning'
  } | null>(null)
  const [wipeDialog, setWipeDialog] = useState(false)
  const [wipeTargets, setWipeTargets] = useState<Record<string, boolean>>({ map: true, players: true, world: true })
  const [wipePreview, setWipePreview] = useState<{
    totalFiles: number; totalSize: number
    preview: Record<string, { files: number; size: number }>
  } | null>(null)
  const [wipeLoading, setWipeLoading] = useState(false)

  const { toast } = useToast()
  const socket = useSocket()

  /* ---------------------------- effects ----------------------------------- */
  useEffect(() => { initialLoadingRef.current = initialLoading }, [initialLoading])
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 10000); return () => clearInterval(t) }, [])

  useEffect(() => {
    let cancelled = false
    panelUpdateApi.getStatus().then(s => { if (!cancelled) setPanelUpdate(s) }).catch(() => {})
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
    try { await copyText(text); toast({ title: 'Copied', description: `${label} copied to clipboard`, duration: 2000 }) }
    catch { toast({ title: 'Failed to copy', description: 'Could not copy to clipboard', variant: 'destructive' }) }
  }

  const dismissQuickStart = () => {
    setShowQuickStart(false)
    try { localStorage.setItem(DASHBOARD_ONBOARDING_DISMISSED_KEY, 'true') } catch {}
  }

  /* ---------------------------- fetchers ---------------------------------- */
  const fetchStatus = useCallback(async () => {
    try { const data = await serverApi.getStatus(); setStatus(data); setFetchError(null); setLastUpdated(new Date()) }
    catch { setFetchError('Failed to connect to server.') }
  }, [])

  usePageShortcut('r', () => { if (loading === null) fetchStatus() })

  const fetchPlayers = useCallback(async () => {
    try { const d = await playersApi.getPlayers(); if (d.players) setPlayers(d.players) } catch { setPlayers([]) }
  }, [])
  const fetchBridgeStatus = useCallback(async () => {
    try { setBridgeStatus(await panelBridgeApi.getStatus()) } catch { setBridgeStatus(null) }
  }, [])
  const fetchPlayerActivity = useCallback(async () => {
    try { const d = await playersApi.getActivityLogs(undefined, 15); if (d.logs) setPlayerActivity(d.logs.slice(0, 12)) }
    catch { setPlayerActivity([]) }
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
    } catch {}
  }, [])
  const fetchAutoStartSetting = useCallback(async () => {
    try {
      const r = await configApi.getAppSettings()
      if (r?.settings?.autoStartServer !== undefined) {
        setAutoStartServer(r.settings.autoStartServer === true || r.settings.autoStartServer === 'true')
      }
    } catch {}
  }, [])
  const fetchActiveServer = useCallback(async () => {
    try { const d = await serversApi.getActive(); setActiveServer(d.server ?? null) } catch { setActiveServer(null) }
  }, [])
  const fetchMaintenance = useCallback(async () => {
    const [backupRes, modsRes, tasksRes] = await Promise.allSettled([
      backupApi.getStatus(),
      modsApi.getStatus(),
      schedulerApi.getTasks() as Promise<{ tasks: Array<{ enabled?: number | boolean }> }>,
    ])
    setMaintenance(prev => ({
      lastBackup: backupRes.status === 'fulfilled' ? backupRes.value.lastBackup : prev.lastBackup,
      backupCount: backupRes.status === 'fulfilled' ? (backupRes.value.backupCount ?? 0) : prev.backupCount,
      modUpdatesAvailable: modsRes.status === 'fulfilled' ? ((modsRes.value as { updatesAvailable?: number }).updatesAvailable ?? 0) : prev.modUpdatesAvailable,
      modsTracked: modsRes.status === 'fulfilled' ? ((modsRes.value as { totalModsTracked?: number }).totalModsTracked ?? 0) : prev.modsTracked,
      scheduledTasksCount: tasksRes.status === 'fulfilled'
        ? (tasksRes.value.tasks ?? []).filter(t => t.enabled === 1 || t.enabled === true).length
        : prev.scheduledTasksCount,
      schedulerLoaded: true,
    }))
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
      setAutoStartServer(!checked)
      toast({ title: 'Error', description: 'Failed to save auto-start setting', variant: 'destructive' })
    }
  }

  /* ---------------------------- bootstrap --------------------------------- */
  useEffect(() => {
    const load = async () => {
      try {
        await Promise.allSettled([fetchStatus(), fetchPlayers(), fetchBridgeStatus()])
        setInitialLoading(false)
        void Promise.allSettled([
          fetchPlayerActivity(),
          fetchAutoStartSetting(),
          serverApi.getPanelInfo().then(setPanelInfo).catch(() => setPanelInfo(null)),
          fetchActiveServer(),
          fetchMaintenance(),
        ])
      } catch { setFetchError('Failed to load dashboard status.'); setInitialLoading(false) }
    }
    load()

    const loadingTimeout = setTimeout(() => {
      if (initialLoadingRef.current) {
        setFetchError((c) => c ?? 'The dashboard is taking longer than expected to respond.')
        setInitialLoading(false)
      }
    }, 5000)

    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchPlayerActivity()
      if (showPerformanceCharts) fetchPerformanceHistory()
    }, 15000)
    const maintenanceInterval = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchMaintenance()
    }, 60000)

    return () => {
      clearTimeout(loadingTimeout)
      clearInterval(interval)
      clearInterval(maintenanceInterval)
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
    }
  }, [fetchStatus, fetchPlayers, fetchBridgeStatus, fetchPlayerActivity, fetchPerformanceHistory,
      fetchAutoStartSetting, fetchActiveServer, fetchMaintenance, showPerformanceCharts])

  useEffect(() => {
    if (!socket) return
    const onStatus = (data: Partial<ServerStatus>) => {
      setStatus(prev => {
        if (prev) return { ...prev, ...data }
        if ('running' in data && 'configured' in data) return data as ServerStatus
        return prev
      })
    }
    const onPlayers = (d: Player[]) => setPlayers(d)
    const onActiveServer = (d?: { server?: ServerInstance | null }) => {
      if (d?.server !== undefined) setActiveServer(d.server); else fetchActiveServer()
      fetchStatus(); fetchPlayers(); fetchBridgeStatus()
    }
    const onBridgeMod = (d: { alive: boolean; version?: string; serverName?: string; playerCount?: number }) => {
      setBridgeStatus(prev => ({
        configured: prev?.configured ?? true,
        isRunning: prev?.isRunning ?? true,
        modConnected: d.alive,
        modStatus: {
          alive: d.alive,
          version: d.version || prev?.modStatus?.version,
          serverName: d.serverName || prev?.modStatus?.serverName,
          playerCount: d.playerCount ?? 0,
        },
      }))
    }
    socket.on('server:status', onStatus)
    socket.on('players:update', onPlayers)
    socket.on('activeServerChanged', onActiveServer)
    socket.on('panelBridge:modStatus', onBridgeMod)
    return () => {
      socket.off('server:status', onStatus)
      socket.off('players:update', onPlayers)
      socket.off('activeServerChanged', onActiveServer)
      socket.off('panelBridge:modStatus', onBridgeMod)
    }
  }, [socket, fetchStatus, fetchPlayers, fetchBridgeStatus, fetchActiveServer])

  useEffect(() => {
    if (initialLoading || showPerformanceCharts) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null
    const reveal = () => setShowPerformanceCharts(true)
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(reveal, { timeout: 1500 })
    } else { timeoutId = setTimeout(reveal, 300) }
    return () => {
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [initialLoading, showPerformanceCharts])

  useEffect(() => { if (showPerformanceCharts) fetchPerformanceHistory() }, [showPerformanceCharts, fetchPerformanceHistory])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus(); fetchPlayers(); fetchBridgeStatus(); fetchPlayerActivity()
        if (showPerformanceCharts) fetchPerformanceHistory()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [fetchStatus, fetchPlayers, fetchBridgeStatus, fetchPlayerActivity, fetchPerformanceHistory, showPerformanceCharts])

  /* ---------------------------- actions ----------------------------------- */
  const handleAction = async (action: string, fn: () => Promise<unknown>) => {
    setLoading(action)
    try {
      await fn()
      const copy = getDashboardSuccessCopy(action)
      toast({ title: copy.title, description: copy.description, variant: 'success' as const })
      if (action === 'Start server') {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
        let attempts = 0
        pollIntervalRef.current = setInterval(async () => {
          attempts++
          try {
            const data = await serverApi.getStatus()
            setStatus(data)
            if (data?.running || attempts >= 15) {
              if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null }
            }
          } catch {
            if (attempts >= 15 && pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current); pollIntervalRef.current = null
            }
          }
        }, 2000)
      } else { fetchStatus() }
    } catch (error) {
      toast({ title: 'Error', description: getUserErrorMessage(error, 'Action failed. Please try again.'), variant: 'destructive' })
    } finally { setLoading(null) }
  }
  const handleConnect = async () => { await handleAction('Connect RCON', () => rconApi.connect()) }

  /* ---------------------------- loading ----------------------------------- */
  if (initialLoading) {
    return (
      <div className="page-transition">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Establishing link…</p>
        </div>
      </div>
    )
  }

  /* ---------------------------- derived ----------------------------------- */
  const online = !!status?.running
  const hasServer = !!activeServer
  const modsPending = maintenance.modUpdatesAvailable > 0
  const stateLabel = online
    ? 'Online'
    : status?.configured ? 'Offline' : 'Not configured'
  const stateHelper = online
    ? 'Session active · accepting connections'
    : status?.configured
      ? 'Host unreachable · awaiting start command'
      : 'Open Server Setup to configure'

  /* ====================================================================== */
  /*  RENDER                                                                  */
  /* ====================================================================== */
  return (
    <div className="page-transition pb-12">
      {/* ─── COMMAND BAR ───────────────────────────────────────────────── */}
      <section
        aria-label="Server status"
        className={cn(
          'relative overflow-hidden rounded-2xl border bg-card/60 transition-colors',
          online ? 'border-success/30' : status?.configured ? 'border-destructive/35' : 'border-warning/40'
        )}
      >
        {/* severity wash */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0',
            online
              ? 'bg-[radial-gradient(circle_at_8%_-30%,hsl(var(--success)/0.14),transparent_55%)]'
              : status?.configured
                ? 'bg-[radial-gradient(circle_at_8%_-30%,hsl(var(--destructive)/0.18),transparent_55%)]'
                : 'bg-[radial-gradient(circle_at_8%_-30%,hsl(var(--warning)/0.16),transparent_55%)]'
          )}
        />

        {/* identity + state + primary controls */}
        <div className="relative grid grid-cols-1 gap-6 px-5 py-5 sm:px-7 sm:py-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
              {activeServer?.isRemote ? 'Remote bridge' : 'Local instance'} · last seen {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-2">
              {/* big state */}
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'h-3 w-3 rounded-full shrink-0',
                    online
                      ? 'bg-success shadow-[0_0_10px_hsl(var(--success)/0.8)] animate-pulse'
                      : status?.configured ? 'bg-destructive shadow-[0_0_10px_hsl(var(--destructive)/0.5)]' : 'bg-warning'
                  )}
                  aria-hidden="true"
                />
                <span
                  role="status"
                  aria-live="polite"
                  className={cn(
                    'font-display text-3xl uppercase leading-none tracking-[0.04em] sm:text-4xl',
                    online ? 'text-success' : status?.configured ? 'text-destructive' : 'text-warning'
                  )}
                >
                  {stateLabel}
                </span>
              </div>

              {/* server name */}
              <h1 className="min-w-0 truncate text-xl font-semibold leading-tight text-foreground sm:text-2xl">
                {activeServer?.serverName ?? 'No active server'}
              </h1>

              {online && status && status.uptime > 0 && (
                <span className="font-mono text-xs uppercase tracking-[0.16em] tabular-nums text-muted-foreground">
                  up {formatUptime(status.uptime)}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{stateHelper}</p>
          </div>

          {/* primary controls */}
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              onClick={() => handleAction('Start server', serverApi.start)}
              disabled={online || loading !== null || activeServer?.isRemote}
              variant="success"
              size={online ? 'default' : 'lg'}
              className={cn('gap-2', !online && 'shadow-[0_0_20px_hsl(var(--success)/0.25)] font-semibold')}
              title={activeServer?.isRemote ? 'Not available for remote (RCON-only) servers' : undefined}
            >
              {loading === 'Start server' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {online ? 'Start' : 'Start server'}
            </Button>
            <Button
              onClick={() => setConfirmAction({
                title: 'Stop server',
                description: 'Are you sure you want to stop the server? All connected players will be disconnected.',
                action: serverApi.stop,
                variant: 'destructive',
              })}
              disabled={!online || loading !== null}
              variant="destructive"
              className="gap-2"
            >
              {loading === 'Stop server' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Stop
            </Button>
            <Button
              onClick={() => setConfirmAction({
                title: 'Restart server',
                description: 'This will send a 5-minute warning to all players, then restart the server.',
                action: () => serverApi.restart(5),
                variant: 'warning',
              })}
              disabled={!online || loading !== null || activeServer?.isRemote}
              variant="warning"
              className="gap-2"
              title={activeServer?.isRemote ? 'Not available for remote (RCON-only) servers' : undefined}
            >
              <RotateCcw className="h-4 w-4" /> Restart
            </Button>
            <Button
              onClick={() => handleAction('Save world', serverApi.save)}
              disabled={!online || loading !== null}
              variant="outline"
              className="gap-2"
            >
              <Save className="h-4 w-4" /> Save
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10" aria-label="More server actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handleAction('Create backup', () => backupApi.createBackup({ includeDb: true }).then(() => fetchMaintenance()))}
                  disabled={loading !== null || activeServer?.isRemote}
                >
                  <Archive className="mr-2 h-4 w-4" /> Create backup
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center"><Server className="mr-2 h-4 w-4" /> Bridge settings</Link>
                </DropdownMenuItem>
                {!status?.rcon?.connected && (
                  <DropdownMenuItem onClick={handleConnect} disabled={loading !== null}>
                    <Wifi className="mr-2 h-4 w-4" /> Connect RCON
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirmAction({
                    title: 'Restart server now',
                    description: `This will immediately restart the server without warning.${players.length > 0 ? ` ${players.length} player(s) will be disconnected!` : ''}`,
                    action: () => serverApi.restart(0),
                    variant: 'destructive',
                  })}
                  disabled={!online || loading !== null || activeServer?.isRemote}
                  className="text-destructive focus:text-destructive"
                >
                  <Zap className="mr-2 h-4 w-4" /> Restart now
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => { setWipePreview(null); setWipeDialog(true) }}
                  disabled={online || loading !== null || activeServer?.isRemote}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Wipe server
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* address strip */}
        {(status?.publicIp || status?.localIp || panelInfo) && (
          <div className="relative border-t border-border/40 bg-background/35 px-3 py-2 sm:px-5">
            <div className="flex flex-wrap items-center gap-1">
              {status?.publicIp && (
                <button
                  onClick={() => copyToClipboard(`${status.publicIp}${status.port ? `:${status.port}` : ''}`, 'Public address')}
                  className="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  aria-label={`Copy public address: ${status.publicIp}${status.port ? `:${status.port}` : ''}`}
                >
                  <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">pub</span>
                  <span className="tabular-nums">{status.publicIp}{status.port ? `:${status.port}` : ''}</span>
                  <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              )}
              {status?.localIp && (
                <button
                  onClick={() => copyToClipboard(`${status.localIp}${status.port ? `:${status.port}` : ''}`, 'Local address')}
                  className="group flex min-h-9 items-center gap-2 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  aria-label={`Copy local address: ${status.localIp}${status.port ? `:${status.port}` : ''}`}
                >
                  <span className="rounded-sm bg-info/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-info">lan</span>
                  <span className="tabular-nums">{status.localIp}{status.port ? `:${status.port}` : ''}</span>
                  <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              )}
              {status?.publicIp && status?.port && (
                <a
                  href={`steam://connect/${status.publicIp}:${status.port}`}
                  className="flex min-h-9 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-primary"
                  title="Connect with Steam"
                >
                  <Gamepad2 className="h-3.5 w-3.5" />
                  <span className="font-medium">Steam connect</span>
                </a>
              )}
              {panelInfo && (
                <button
                  onClick={() => copyToClipboard(panelInfo.url, 'Panel address')}
                  className="group ml-auto flex min-h-9 items-center gap-2 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-primary"
                  aria-label={`Copy panel address: ${panelInfo.url}`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>{panelInfo.url}</span>
                  <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ─── Panel update banner ─────────────────────────────────────────── */}
      {(() => {
        if (!panelUpdate?.updateAvailable) return null
        const latest = panelUpdate.latestVersion
        if (latest && latest === panelUpdate.currentVersion) return null
        if (latest && panelUpdateDismissedVersion === latest) return null
        const isStaged = !!panelUpdate.stagedUpdate && (!latest || panelUpdate.stagedUpdate.version === latest)
        const lastFailed = panelUpdate.lastApplyResult?.status === 'failed'
          && (!latest || panelUpdate.lastApplyResult.pendingVersion === latest)
        const ctaLabel = isStaged ? 'Apply update' : 'View update'
        const title = isStaged
          ? `Panel update ready to apply${latest ? ` — v${latest}` : ''}`
          : `Panel update available${latest ? ` — v${latest}` : ''}`
        const body = lastFailed
          ? 'Last apply attempt failed. Open Settings for diagnostics and the apply log.'
          : isStaged
            ? `v${latest ?? '?'} is downloaded. Restart the panel from Settings to apply it.`
            : `You're on v${panelUpdate.currentVersion}. Head to Settings to download and apply the update.`
        const dismiss = () => {
          if (!latest) return
          try { sessionStorage.setItem('panel-update-banner-dismissed', latest) } catch {}
          setPanelUpdateDismissedVersion(latest)
        }
        return (
          <Alert className={cn('mt-5', lastFailed ? 'border-destructive/40 bg-destructive/10' : 'border-primary/40 bg-primary/10')}>
            <Sparkles className={cn('h-4 w-4', lastFailed ? 'text-destructive' : 'text-primary')} />
            <AlertTitle className={cn('break-words', lastFailed ? 'text-destructive' : 'text-primary')}>{title}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words text-sm">{body}</span>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Link to="/settings?tab=panel">
                  <Button size="sm" variant={lastFailed ? 'destructive' : 'default'}>
                    <Download className="mr-2 h-4 w-4" /> {ctaLabel}
                  </Button>
                </Link>
                <Button size="icon" variant="ghost" aria-label="Dismiss update notification" onClick={dismiss} disabled={!latest} title="Dismiss until next version">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )
      })()}

      {/* ─── Error banner ────────────────────────────────────────────────── */}
      {fetchError && (
        <Alert variant="destructive" className="mt-5">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection error</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">{fetchError}. Some features may be unavailable.</span>
            <Button variant="outline" size="sm" onClick={fetchStatus} className="self-start sm:self-auto">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ─── Not configured ──────────────────────────────────────────────── */}
      {status && !status.configured && (
        <Link to="/server-setup" className="mt-5 block">
          <Alert className="cursor-pointer border-warning/40 bg-warning/10 transition-colors hover:bg-warning/15">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle className="text-warning">Server not configured</AlertTitle>
            <AlertDescription>Open Server Setup to add or configure a server.</AlertDescription>
          </Alert>
        </Link>
      )}

      {/* ─── Quick-start onboarding ──────────────────────────────────────── */}
      {!hasServer && showQuickStart && (
        <section className="relative mt-5 overflow-hidden rounded-2xl border border-primary/25 bg-card/60 px-6 py-6">
          <button
            onClick={dismissQuickStart}
            aria-label="Dismiss quick start guide"
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/80">First server</p>
          <h2 className="mt-1.5 text-2xl font-semibold leading-tight text-foreground">Get one server up, RCON working, then layer on the rest.</h2>
          <ol className="mt-5 grid gap-3 list-none p-0 md:grid-cols-3">
            {[
              ['1', 'Bring in a server', 'Add an existing install, connect remote RCON, or create a new server.'],
              ['2', 'Verify connectivity', 'Confirm paths, RCON credentials, and active server.'],
              ['3', 'Reach live control',  'When status, players, and chat update, live control is ready.'],
            ].map(([n, title, body]) => (
              <li key={n} className="rounded-lg border border-border/50 bg-background/40 p-4">
                <p className="text-sm font-semibold text-foreground">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold bg-primary/15 text-primary" aria-hidden="true">{n}</span>
                  {title}
                </p>
                <p className="mt-1.5 pl-7 text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/server-setup"  className={cn(buttonVariants({ variant: 'default' }))}><Server className="mr-2 h-4 w-4" />Install new server</Link>
            <Link to="/servers" className={cn(buttonVariants({ variant: 'outline' }))}><FolderOpen className="mr-2 h-4 w-4" />Add existing server</Link>
            <Link to="/servers" className={cn(buttonVariants({ variant: 'secondary' }))}><Globe className="mr-2 h-4 w-4" />Add remote server</Link>
          </div>
        </section>
      )}

      {/* ─── MAIN STAGE + SIDE RAIL ──────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ───────── main column ───────── */}
        <main className="min-w-0 space-y-9">
          {/* Performance */}
          <section>
            <SectionHeading
              label="Performance"
              meta={performanceHistory.length > 0 ? 'last 5 min' : online ? 'sampling' : 'standby'}
            />
            {performanceHistory.length > 0 ? (
              <Suspense
                fallback={
                  <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-4 py-4">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className="h-3 w-20 rounded bg-muted/40" />
                        <div className="h-6 flex-1 animate-pulse rounded bg-muted/30" />
                        <div className="h-5 w-12 rounded bg-muted/40" />
                      </div>
                    ))}
                  </div>
                }
              >
                {showPerformanceCharts ? (
                  <DashboardPerformanceCharts performanceHistory={performanceHistory} serverRunning={online} />
                ) : null}
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground">
                {online
                  ? 'Telemetry will appear here within the next sample cycle.'
                  : 'Start the server to begin tracking CPU, RAM, and player metrics.'}
              </p>
            )}
          </section>

          {/* Live activity */}
          <section>
            <SectionHeading
              label="Live activity"
              meta={
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      online ? 'bg-success animate-pulse shadow-[0_0_6px_hsl(var(--success)/0.7)]' : 'bg-muted-foreground/40'
                    )}
                    aria-hidden="true"
                  />
                  {playerActivity.length > 0 ? `${playerActivity.length} events` : online ? 'idle' : 'offline'}
                </span>
              }
            >
              <Link
                to="/players"
                className="ml-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 rounded px-1"
              >
                view all <ChevronRight className="h-3 w-3" />
              </Link>
            </SectionHeading>
            {playerActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {online
                  ? 'Player join, leave, death, and moderation events will appear here in real time.'
                  : 'Start the server to begin tracking player activity.'}
              </p>
            ) : (
              <ol className="rounded-xl border border-border/50 bg-card/30 divide-y divide-border/30">
                {playerActivity.map(a => {
                  const s = eventStyle(a.action)
                  return (
                    <li key={a.id} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20">
                      <time className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/65">
                        {new Date(a.logged_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </time>
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background/60', s.tone)} aria-hidden="true">
                        {s.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto" title={a.player_name}>
                        {a.player_name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/75">
                        {s.verb}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {/* Readiness */}
          {maintenance.schedulerLoaded && (
            <section>
              <SectionHeading label="Readiness" meta="backups · mods · schedule" />
              <div className={cn(
                'grid grid-cols-1 gap-3',
                modsPending ? 'md:grid-cols-[1fr_1.6fr_1fr]' : 'md:grid-cols-3',
              )}>
                {/* Backup */}
                <article className="relative overflow-hidden rounded-xl border border-border/55 bg-card/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/65">Backup</p>
                    <Archive className="h-3.5 w-3.5 text-muted-foreground/55" />
                  </div>
                  {maintenance.lastBackup ? (
                    <>
                      <p className="text-2xl font-semibold leading-none text-foreground tabular-nums">
                        {formatAge(maintenance.lastBackup.created)}
                      </p>
                      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {(maintenance.lastBackup.size / (1024 * 1024)).toFixed(0)} MB · {maintenance.backupCount} archived
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No backups yet.</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 w-full gap-1.5 text-xs"
                    disabled={loading !== null || activeServer?.isRemote}
                    onClick={() => handleAction('Create backup', () => backupApi.createBackup({ includeDb: true }).then(() => fetchMaintenance()))}
                  >
                    {loading === 'Create backup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                    {maintenance.lastBackup ? 'Back up now' : 'Create first backup'}
                  </Button>
                </article>

                {/* Mods — focal when updates pending */}
                <article
                  className={cn(
                    'relative overflow-hidden rounded-xl border p-4 transition-colors',
                    modsPending
                      ? 'border-warning/45 bg-warning/[0.05] shadow-[inset_0_0_24px_hsl(var(--warning)/0.08)]'
                      : 'border-border/55 bg-card/40',
                  )}
                >
                  {modsPending && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_-20%,hsl(var(--warning)/0.18),transparent_60%)]"
                    />
                  )}
                  <div className="relative mb-3 flex items-center justify-between">
                    <p className={cn(
                      'font-mono text-[10px] uppercase tracking-[0.2em]',
                      modsPending ? 'text-warning' : 'text-muted-foreground/65',
                    )}>
                      Workshop mods
                    </p>
                    <Package className={cn('h-3.5 w-3.5', modsPending ? 'text-warning' : 'text-muted-foreground/55')} />
                  </div>
                  {modsPending ? (
                    <div className="relative">
                      <p className="font-display text-4xl leading-none text-warning tabular-nums">
                        {maintenance.modUpdatesAvailable}
                        <span className="ml-2 text-base font-normal uppercase tracking-[0.08em] text-warning/75">pending</span>
                      </p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {maintenance.modUpdatesAvailable === 1 ? 'Mod has' : 'Mods have'} a new version on Steam Workshop. Restart the server to apply.
                      </p>
                      <Link
                        to="/mods"
                        className={cn(buttonVariants({ size: 'sm', variant: 'warning' }), 'mt-3 w-full gap-1.5 text-xs font-semibold')}
                      >
                        <Download className="h-3.5 w-3.5" /> Review updates
                      </Link>
                    </div>
                  ) : (
                    <div className="relative">
                      <p className="flex items-center gap-2 text-2xl font-semibold leading-none text-success">
                        <CheckCircle2 className="h-5 w-5" /> Up to date
                      </p>
                      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {maintenance.modsTracked} {maintenance.modsTracked === 1 ? 'mod' : 'mods'} tracked · steam workshop
                      </p>
                      <Link
                        to="/mods"
                        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'mt-3 w-full gap-1.5 text-xs')}
                      >
                        <Package className="h-3.5 w-3.5" /> Manage mods
                      </Link>
                    </div>
                  )}
                </article>

                {/* Scheduler */}
                <article className="relative overflow-hidden rounded-xl border border-border/55 bg-card/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/65">Scheduler</p>
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground/55" />
                  </div>
                  <p className="text-2xl font-semibold leading-none text-foreground tabular-nums">
                    {maintenance.scheduledTasksCount}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">active</span>
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {maintenance.scheduledTasksCount === 0
                      ? 'Set up automatic restarts, backups, and announcements.'
                      : 'Restarts, backups, and announcements running on schedule.'}
                  </p>
                  <Link
                    to="/scheduler"
                    className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'mt-3 w-full gap-1.5 text-xs')}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    {maintenance.scheduledTasksCount === 0 ? 'Add task' : 'View schedule'}
                  </Link>
                </article>
              </div>
            </section>
          )}
        </main>

        {/* ───────── side rail ───────── */}
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          {/* Connections */}
          <section className="rounded-xl border border-border/55 bg-card/40 p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">Connections</p>
            <ConnLine
              label="RCON"
              state={status?.rcon?.connected ? 'on' : 'off'}
              value={status?.rcon ? `${status.rcon.host}:${status.rcon.port}` : undefined}
            />
            <ConnLine
              label="Bridge"
              state={bridgeStatus?.modConnected ? 'on' : bridgeStatus?.isRunning ? 'wait' : 'off'}
              value={
                bridgeStatus?.modConnected && bridgeStatus.modStatus?.version
                  ? `v${bridgeStatus.modStatus.version.replace(/^v/, '')}`
                  : bridgeStatus?.isRunning ? 'pending' : 'offline'
              }
            />
            <Link
              to="/players"
              className="block -mx-2 rounded px-2 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              aria-label={`${players.length} players online — open Players page`}
            >
              <ConnLine
                label="Players"
                state={players.length > 0 ? 'on' : 'off'}
                value={`${players.length} online`}
              />
            </Link>
            {!status?.rcon?.connected && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full gap-1.5 text-xs"
                onClick={handleConnect}
                disabled={loading !== null}
              >
                {loading === 'Connect RCON' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                Connect RCON
              </Button>
            )}
          </section>

          {/* Utilities */}
          {!activeServer?.isRemote && (
            <section className="rounded-xl border border-border/55 bg-card/40 p-4 space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">Utilities</p>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start gap-2 text-xs"
                onClick={fetchStatus}
                disabled={loading !== null}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
                Refresh status
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start gap-2 text-xs"
                disabled={loading !== null || activeServer?.isRemote}
                onClick={() => handleAction('Create backup', () => backupApi.createBackup({ includeDb: true }).then(() => fetchMaintenance()))}
              >
                {loading === 'Create backup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                Create backup
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start gap-2 text-xs text-destructive hover:text-destructive"
                disabled={online || loading !== null || activeServer?.isRemote}
                onClick={() => { setWipePreview(null); setWipeDialog(true) }}
                title={online ? 'Stop the server before wiping' : 'Delete map / players / world state'}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Wipe server
              </Button>
              <label className="flex cursor-pointer items-center gap-2.5 pt-2 border-t border-border/30">
                <Checkbox
                  id="autoStartServer"
                  checked={autoStartServer}
                  onCheckedChange={(checked) => handleAutoStartChange(checked === true)}
                />
                <Label htmlFor="autoStartServer" className="cursor-pointer text-xs text-muted-foreground">
                  Auto-start on panel launch
                </Label>
              </label>
            </section>
          )}

          {/* Shortcuts */}
          <section className="rounded-xl border border-border/55 bg-card/40 p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">Shortcuts</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { to: '/server-config', icon: Server,    label: 'Config' },
                { to: '/mods',          icon: Gamepad2,  label: 'Mods' },
                { to: '/backups',       icon: Archive,   label: 'Backups' },
                { to: '/settings',      icon: Wifi,      label: 'Settings' },
              ].map(({ to, icon: Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="group flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Icon className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
                  <span className="truncate font-medium">{label}</span>
                </Link>
              ))}
            </div>
            {bridgeStatus && !bridgeStatus.configured && (
              <p className="mt-3 border-t border-border/30 pt-3 text-xs text-muted-foreground">
                Advanced world controls require PanelBridge.{' '}
                <Link to="/settings" className="text-primary hover:underline">Configure bridge</Link>
                {' '}when needed.
              </p>
            )}
          </section>
        </aside>
      </div>

      {/* ─── Confirm dialog ──────────────────────────────────────────────── */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent className="glass border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <AlertTriangle className={cn('h-5 w-5', confirmAction?.variant === 'destructive' ? 'text-destructive' : 'text-warning')} />
              {confirmAction?.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">{confirmAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: confirmAction?.variant === 'destructive' ? 'destructive' : 'warning' }))}
              onClick={async () => { if (confirmAction) { await handleAction(confirmAction.title, confirmAction.action); setConfirmAction(null) } }}
            >
              {confirmAction?.title}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Wipe dialog ─────────────────────────────────────────────────── */}
      <AlertDialog open={wipeDialog} onOpenChange={(open) => { if (!open && !wipeLoading) { setWipeDialog(false); setWipePreview(null) } }}>
        <AlertDialogContent className="glass border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3 text-xl">
              <Trash2 className="h-5 w-5 text-destructive" /> Wipe server
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Select what data to delete from <span className="font-medium text-foreground">{activeServer?.serverName || 'the active server'}</span>. The server must be stopped.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            {([
              ['map',     'Map & terrain',       'Chunks, terrain, buildings, zombie population, iso regions.'],
              ['players', 'Players & vehicles',  'Player saves, inventories, positions, vehicle data.'],
              ['world',   'World state',         'World dictionary, metadata, erosion, game object states, radio.'],
            ] as const).map(([key, label, desc]) => (
              <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border/50 p-3 hover:bg-muted/30">
                <Checkbox
                  checked={wipeTargets[key]}
                  disabled={wipeLoading}
                  onCheckedChange={(checked) => { setWipeTargets(prev => ({ ...prev, [key]: checked === true })); setWipePreview(null) }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </label>
            ))}
            <div className="px-3 pb-1 text-xs text-muted-foreground">Server .ini and sandbox settings are stored separately and will not be affected.</div>
          </div>

          {wipePreview && (
            <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
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
                  <div className="pt-1 font-medium">Total: {wipePreview.totalFiles.toLocaleString()} files ({(wipePreview.totalSize / 1024 / 1024).toFixed(1)} MB)</div>
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
                    toast({ title: 'Preview failed', description: e instanceof Error ? e.message : 'Could not scan save directory', variant: 'destructive' })
                  } finally { setWipeLoading(false) }
                }}
              >
                {wipeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
                    toast({ title: 'Server wiped', description: `Deleted: ${targets.join(', ')}` })
                    setWipeDialog(false); setWipePreview(null)
                  } catch (e: unknown) {
                    toast({ title: 'Wipe failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
                  } finally { setWipeLoading(false) }
                }}
              >
                {wipeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Wipe now
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}