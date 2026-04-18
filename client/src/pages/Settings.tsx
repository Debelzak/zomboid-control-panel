import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePageShortcut } from '../hooks/useKeyboardShortcuts'
import { 
  Save,
  Server,
  Link,
  Clock,
  Shield,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Key,
  Cloud,
  Zap,
  CheckCircle2,
  XCircle,
  Download,
  RefreshCw,
  Archive,
  Info,
  Trash2,
  HardDrive,
  RotateCcw,
  Settings2,
  Globe,
  RotateCw,
  Lock,
  User,
  ExternalLink,
  FolderOpen,
  Palette
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { reportClientError } from '@/lib/client-errors'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/use-toast'
import { EmptyState } from '@/components/EmptyState'
import {
  configApi,
  panelBridgeApi,
  backupApi,
  authApi,
  serversApi,
  serverApi,
  panelUpdateApi,
  BackupStatus,
  BackupFile,
  PanelUpdateStatus,
  PanelUpdatePreflight,
  ServerInstance
} from '@/lib/api'
import { useSocket } from '@/contexts/SocketContext'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme, type ThemeName } from '@/contexts/ThemeContext'
import { BridgeStatusBadge } from '@/components/BridgeStatusBadge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AppSettings {
  // Bridge Settings
  panelBridgeAutoUpdate: boolean

  // Mod Checker Settings
  modCheckInterval: string
  modAutoRestart: boolean
  modRestartDelay: string
  
  // API Keys
  steamApiKey: string
  
  // General Settings
  darkMode: boolean
  autoReconnect: boolean
  reconnectInterval: string
  
  // Panel Settings
  panelPort: string

  // HTTPS Settings
  httpsEnabled: boolean
  httpsPort: string
  httpsKeyPath: string
  httpsCertPath: string

  // CORS Settings
  corsAllowedOrigins: string
  corsAllowAll: boolean
  corsAllowPrivateNetworks: boolean
  corsDebug: boolean
}

interface CorsDiagnostics {
  allowAll: boolean
  allowPrivateNetworks: boolean
  debug: boolean
  customOrigins: string[]
  effectiveAllowedOrigins: string[]
  blocked: Array<{ id: number; origin: string; source: string; blockedAt: string }>
  blockedCount: number
  lastLoadedAt: string | null
}

const MAX_CORS_ALLOWED_ORIGINS = 100
const MAX_CORS_ORIGIN_LENGTH = 256

function ThemeSelect() {
  const { theme, setTheme } = useTheme()
  return (
    <Select value={theme} onValueChange={(v) => setTheme(v as ThemeName)}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="survival">Survival (Dark)</SelectItem>
        <SelectItem value="light">Light</SelectItem>
      </SelectContent>
    </Select>
  )
}

export default function Settings() {
  const socket = useSocket()
  const [settings, setSettings] = useState<AppSettings>({
    panelBridgeAutoUpdate: true,
    modCheckInterval: '30',
    modAutoRestart: true,
    modRestartDelay: '5',
    steamApiKey: '',
    darkMode: true,
    autoReconnect: true,
    reconnectInterval: '5',
    panelPort: '3001',
    httpsEnabled: false,
    httpsPort: '3443',
    httpsKeyPath: '',
    httpsCertPath: '',
    corsAllowedOrigins: '',
    corsAllowAll: false,
    corsAllowPrivateNetworks: true,
    corsDebug: false,
  })
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSteamApiKey, setShowSteamApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [corsOriginValidationError, setCorsOriginValidationError] = useState<string | null>(null)
  const [corsDiagnostics, setCorsDiagnostics] = useState<CorsDiagnostics | null>(null)
  const [corsLoading, setCorsLoading] = useState(false)
  const [corsUpdating, setCorsUpdating] = useState(false)
  const [testingRcon, setTestingRcon] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [panelUpdateStatus, setPanelUpdateStatus] = useState<PanelUpdateStatus | null>(null)
  const [panelUpdateStatusError, setPanelUpdateStatusError] = useState<string | null>(null)
  const [checkingPanelUpdate, setCheckingPanelUpdate] = useState(false)
  const [downloadingPanelUpdate, setDownloadingPanelUpdate] = useState(false)
  const [panelUpdateReady, setPanelUpdateReady] = useState(false)
  const [panelUpdatePreflight, setPanelUpdatePreflight] = useState<PanelUpdatePreflight | null>(null)
  const [panelApplyLog, setPanelApplyLog] = useState<string | null>(null)
  const [panelApplyResultDismissed, setPanelApplyResultDismissed] = useState(false)
  const { toast } = useToast()
  const { user, authEnabled } = useAuth()
  
  // Change password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  
  // Panel Bridge state
  const [bridgeStatus, setBridgeStatus] = useState<{
    configured: boolean
    bridgePath: string | null
    isRunning: boolean
    pendingCommands: number
    modConnected: boolean
    consecutiveFailures?: number
    hasFileWatcher?: boolean
    config?: {
      statusStaleMs: number
      pollIntervalMs: number
      statusCheckMs: number
    }
    connection?: {
      healthy: boolean
      canSendCommands: boolean
      summary: string
      issues: string[]
      checks: Record<string, boolean | number | null>
    }
    statusFile?: {
      exists: boolean
      path?: string
      size?: number
      modified?: string
      age?: number
      ageSeconds?: number
      error?: string
    }
    modStatus: {
      alive: boolean
      version: string
      serverName: string
      playerCount?: number
      players: string[]
      path: string
      timestamp: number
      age?: number
      error?: string
    } | null
    detectedPaths?: {
      serverName: string
      installPath: string
      zomboidDataPath: string
    } | null
  } | null>(null)
  const [bridgeLoading, setBridgeLoading] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)
  const [manualBridgePath, setManualBridgePath] = useState('')
  
  // Server list for install dropdown
  const [servers, setServers] = useState<ServerInstance[]>([])
  const [selectedInstallServerId, setSelectedInstallServerId] = useState<string>('')
  const [installingMod, setInstallingMod] = useState(false)
  
  // Backup state
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backups, setBackups] = useState<BackupFile[]>([])
  const [backupLoading, setBackupLoading] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null)
  const [restoreConfirmBackup, setRestoreConfirmBackup] = useState<string | null>(null)
  const [backupSchedule, setBackupSchedule] = useState('0 */6 * * *')
  const [backupMaxCount, setBackupMaxCount] = useState(10)
  
  // Track if there are unsaved changes
  const isDirty = originalSettings !== null && JSON.stringify(settings) !== JSON.stringify(originalSettings)

  // Section navigation via tabs
  const settingsSections = [
    { id: 'panel', label: 'Panel', icon: Globe, group: 'core', tip: 'Port, theme, and panel updates' },
    { id: 'https', label: 'HTTPS', icon: Lock, group: 'core', tip: 'SSL/TLS encryption for secure connections' },
    { id: 'rcon', label: 'RCON', icon: Link, group: 'connections', tip: 'Remote console \u2014 built-in game server protocol for commands' },
    { id: 'bridge', label: 'Bridge', icon: Zap, group: 'connections', tip: 'PanelBridge Lua mod \u2014 adds weather, teleport, and world control' },
    { id: 'mods', label: 'Mods', icon: Clock, group: 'features', tip: 'Auto-update checking and restart behavior' },
    { id: 'api-keys', label: 'API Keys', icon: Key, group: 'features', tip: 'Steam API key for Workshop mod lookups' },
    { id: 'backups', label: 'Backups', icon: Archive, group: 'features', tip: 'Scheduled backup frequency and retention' },
    { id: 'security', label: 'Security', icon: Shield, group: 'system', tip: 'Password and access control' },
    { id: 'about', label: 'About', icon: Server, group: 'system', tip: 'Version info and diagnostics' },
  ]
  const validTabs = settingsSections.map(s => s.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeSection, setActiveSection] = useState(() => {
    const tab = searchParams.get('tab')
    return tab && validTabs.includes(tab) ? tab : 'panel'
  })

  // Sync active tab to URL
  const handleTabChange = useCallback((value: string) => {
    setActiveSection(value)
    setSearchParams({ tab: value }, { replace: true })
  }, [setSearchParams])
  
  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Clean up restart redirect timer on unmount
  useEffect(() => () => {
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
  }, [])

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const data = await configApi.getAppSettings()
      if (data.settings) {
        // Use functional update to get current state and merge with loaded settings
        setSettings(prevSettings => {
          const loadedSettings = {
            ...prevSettings,
            ...data.settings
          }
          setOriginalSettings(loadedSettings)
          return loadedSettings
        })
      }
    } catch (error) {
      reportClientError('Failed to fetch settings.', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const fetchCorsDiagnostics = useCallback(async () => {
    setCorsLoading(true)
    try {
      const data = await configApi.getCorsDiagnostics()
      setCorsDiagnostics(data.diagnostics)
    } catch (error) {
      reportClientError('Failed to fetch CORS diagnostics.', error)
    } finally {
      setCorsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCorsDiagnostics()
  }, [fetchCorsDiagnostics])

  // Reload settings when active server changes
  useEffect(() => {
    if (!socket) return
    
    const handleActiveServerChanged = () => {
      fetchSettings()
    }
    
    socket.on('activeServerChanged', handleActiveServerChanged)
    return () => {
      socket.off('activeServerChanged', handleActiveServerChanged)
    }
  }, [socket, fetchSettings])

  const fetchPanelUpdateStatus = useCallback(async () => {
    try {
      const status = await panelUpdateApi.getStatus()
      setPanelUpdateStatus(status)
      setPanelUpdateStatusError(null)
      // "Ready to apply" reflects whether a binary is staged on disk, not just
      // whether the last click finished. Survives page reloads.
      if (status.stagedUpdate) {
        setPanelUpdateReady(true)
      } else if (!status.updateAvailable) {
        setPanelUpdateReady(false)
      }
      // If a previous apply failed, surface the helper log right away so the
      // user can see what happened without clicking anything.
      if (status.lastApplyResult?.status === 'failed') {
        if (status.lastApplyResult.helperLog) {
          setPanelApplyLog(status.lastApplyResult.helperLog)
        } else {
          try {
            const { log: helperLog } = await panelUpdateApi.getApplyLog()
            setPanelApplyLog(helperLog)
          } catch {
            setPanelApplyLog(null)
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load updater status'
      setPanelUpdateStatusError(message)
      reportClientError('Failed to fetch panel update status.', error)
    }
  }, [])

  const fetchPanelUpdatePreflight = useCallback(async () => {
    try {
      const pre = await panelUpdateApi.preflight()
      setPanelUpdatePreflight(pre)
      return pre
    } catch (error) {
      reportClientError('Failed to fetch panel update preflight.', error)
      return null
    }
  }, [])

  useEffect(() => {
    fetchPanelUpdateStatus()
  }, [fetchPanelUpdateStatus])

  // Run preflight once status tells us we're in a packaged build and there is
  // anything actionable (either an available update or a staged file on disk).
  useEffect(() => {
    if (!panelUpdateStatus) return
    if (panelUpdateStatus.updateAvailable || panelUpdateStatus.stagedUpdate) {
      fetchPanelUpdatePreflight()
    }
  }, [panelUpdateStatus?.updateAvailable, panelUpdateStatus?.stagedUpdate?.path, fetchPanelUpdatePreflight])

  const normalizePort = (value: string): string => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return String(parsed)
    }
    return '3001'
  }

  const validateCorsOriginsInput = useCallback((rawInput: string): string | null => {
    const origins = rawInput
      .split(/[\n,;]+/)
      .map((origin) => origin.trim())
      .filter(Boolean)

    if (origins.length > MAX_CORS_ALLOWED_ORIGINS) {
      return `Too many origins. Maximum is ${MAX_CORS_ALLOWED_ORIGINS}.`
    }

    for (const origin of origins) {
      if (origin.length > MAX_CORS_ORIGIN_LENGTH) {
        return `Origin too long (${origin.length} chars). Maximum is ${MAX_CORS_ORIGIN_LENGTH}.`
      }

      try {
        const parsed = new URL(origin)
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return `Only http/https origins are allowed: ${origin}`
        }
      } catch {
        return `Invalid origin format: ${origin}`
      }
    }

    return null
  }, [])

  useEffect(() => {
    setCorsOriginValidationError(validateCorsOriginsInput(settings.corsAllowedOrigins))
  }, [settings.corsAllowedOrigins, validateCorsOriginsInput])

  const handleSave = async () => {
    const validationError = validateCorsOriginsInput(settings.corsAllowedOrigins)
    if (validationError) {
      setCorsOriginValidationError(validationError)
      toast({
        title: 'Invalid CORS Origins',
        description: validationError,
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      await configApi.updateAppSettings(settings as unknown as Record<string, unknown>)
      setOriginalSettings(settings) // Reset dirty state after save
      try {
        await fetchCorsDiagnostics()
      } catch {
        // Settings are already saved; diagnostics refresh is best-effort.
      }
      toast({
        title: 'Settings Saved',
        description: 'Your panel settings were saved.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Could Not Save Settings',
        description: error instanceof Error ? error.message : 'The panel could not save your settings. Try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S to save settings
  usePageShortcut('s', () => { if (isDirty && !saving) handleSave() }, { ctrl: true })

  const handleReloadCorsRules = async () => {
    setCorsUpdating(true)
    try {
      const data = await configApi.reloadCorsDiagnostics()
      setCorsDiagnostics(data.diagnostics)
      toast({
        title: 'CORS Rules Reloaded',
        description: 'The backend reloaded CORS settings from the database.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Could Not Reload CORS Rules',
        description: error instanceof Error ? error.message : 'Failed to reload CORS rules.',
        variant: 'destructive',
      })
    } finally {
      setCorsUpdating(false)
    }
  }

  const handleClearCorsBlocked = async () => {
    setCorsUpdating(true)
    try {
      const data = await configApi.clearCorsBlockedOrigins()
      setCorsDiagnostics(data.diagnostics)
      toast({
        title: 'Blocked Origin Log Cleared',
        description: 'Recent blocked CORS origins were removed from diagnostics.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Could Not Clear Log',
        description: error instanceof Error ? error.message : 'Failed to clear blocked CORS origins.',
        variant: 'destructive',
      })
    } finally {
      setCorsUpdating(false)
    }
  }

  const restartPanelWithReconnect = useCallback(async (description: string) => {
    setRestarting(true)
    try {
      await serverApi.restartPanel()
      toast({
        title: 'Restarting Panel',
        description,
      })

      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = setTimeout(() => {
        const newPort = normalizePort(settings.panelPort)
        const newUrl = `${window.location.protocol}//${window.location.hostname}:${newPort}${window.location.pathname}${window.location.search}${window.location.hash}`
        window.location.href = newUrl
      }, 3000)
    } catch {
      setRestarting(false)
      toast({
        title: 'Restart Failed',
        description: 'Could not restart the panel. You may need to restart it manually.',
        variant: 'destructive',
      })
    }
  }, [settings.panelPort, toast])

  const handleCheckPanelUpdate = async () => {
    setCheckingPanelUpdate(true)
    setPanelUpdateStatusError(null)
    try {
      const status = await panelUpdateApi.check()
      setPanelUpdateStatus(status)

      if (status.updateAvailable) {
        toast({
          title: 'Update Available',
          description: `A newer panel version is available: v${status.latestVersion} (installed: v${status.currentVersion}).`,
        })
      } else {
        setPanelUpdateReady(false)
        toast({
          title: 'Up to Date',
          description: `You are running the latest panel release (v${status.currentVersion}).`,
          variant: 'success' as const,
        })
      }
    } catch (error) {
      toast({
        title: 'Update Check Failed',
        description: error instanceof Error ? error.message : 'The panel could not reach GitHub. Check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setCheckingPanelUpdate(false)
    }
  }

  const handleDownloadPanelUpdate = async () => {
    if (!panelUpdateStatus?.updateAvailable) {
      toast({
        title: 'No Update Available',
        description: 'No newer release was found. Run Check for Updates to refresh status.',
      })
      return
    }

    setDownloadingPanelUpdate(true)
    setPanelUpdateStatusError(null)
    try {
      // Pre-flight before touching disk — refuse early if we know apply will fail.
      const pre = await fetchPanelUpdatePreflight()
      if (pre && !pre.ok) {
        throw new Error(pre.blockers[0] || 'Update blocked by preflight check.')
      }

      const result = await panelUpdateApi.download()
      if (!result.success) {
        if (result.preflight) setPanelUpdatePreflight(result.preflight)
        throw new Error(result.error || result.message || 'Update download failed')
      }

      setPanelUpdateReady(true)
      toast({
        title: 'Update Downloaded',
        description: result.message || 'The update files are ready. Restart the panel to apply this version.',
        variant: 'success' as const,
      })
      await fetchPanelUpdateStatus()
    } catch (error) {
      toast({
        title: 'Download Failed',
        description: error instanceof Error ? error.message : 'The panel could not download the update. Check network access, disk space, and permissions.',
        variant: 'destructive',
      })
    } finally {
      setDownloadingPanelUpdate(false)
    }
  }

  const formatTimestamp = (value: string | null): string => {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  }

  useEffect(() => {
    if (!socket) return

    const handlePanelUpdateAvailable = (data: { latestVersion?: string; currentVersion?: string; releaseUrl?: string }) => {
      setPanelUpdateStatus(prev => {
        const base: PanelUpdateStatus = prev || {
          currentVersion: data.currentVersion || 'Unknown',
          updateAvailable: true,
          latestVersion: data.latestVersion || null,
          releaseUrl: data.releaseUrl || null,
          releaseNotes: null,
          publishedAt: null,
          isChecking: false,
          isDownloading: false,
          downloadProgress: 0,
          lastCheck: new Date().toISOString(),
          lastError: null,
          stagedUpdate: null,
          lastApplyResult: null,
        }
        return {
          ...base,
          updateAvailable: true,
          latestVersion: data.latestVersion || base.latestVersion,
          currentVersion: data.currentVersion || base.currentVersion,
          releaseUrl: data.releaseUrl || base.releaseUrl,
          lastError: null,
        }
      })
    }

    const handlePanelDownloadProgress = (data: { progress?: number; status?: string }) => {
      setPanelUpdateStatus(prev => {
        const base: PanelUpdateStatus = prev || {
          currentVersion: 'Unknown',
          updateAvailable: true,
          latestVersion: null,
          releaseUrl: null,
          releaseNotes: null,
          publishedAt: null,
          isChecking: false,
          isDownloading: false,
          downloadProgress: 0,
          lastCheck: null,
          lastError: null,
          stagedUpdate: null,
          lastApplyResult: null,
        }
        const bounded = Math.max(0, Math.min(100, data.progress ?? base.downloadProgress))
        return {
          ...base,
          isDownloading: data.status === 'downloading' || data.status === 'preparing',
          downloadProgress: bounded,
        }
      })
    }

    const handlePanelUpdateReady = (data: { version?: string }) => {
      setPanelUpdateReady(true)
      toast({
        title: 'Update Ready',
        description: data.version
          ? `Panel v${data.version} is downloaded. Restart the panel to switch to the new version.`
          : 'The update is downloaded. Restart the panel to switch to the new version.',
        variant: 'success' as const,
      })
      setPanelUpdateStatusError(null)
      fetchPanelUpdateStatus()
    }

    const handlePanelUpdateApplied = (data: { version?: string }) => {
      setPanelUpdateReady(false)
      setPanelApplyResultDismissed(false)
      setPanelApplyLog(null)
      toast({
        title: 'Update Applied',
        description: data.version
          ? `Panel successfully updated to v${data.version}.`
          : 'Panel update applied successfully.',
        variant: 'success' as const,
      })
      fetchPanelUpdateStatus()
    }

    const handlePanelUpdateApplyFailed = (data: { pendingVersion?: string; helperLog?: string | null }) => {
      setPanelApplyResultDismissed(false)
      if (data?.helperLog) setPanelApplyLog(data.helperLog)
      toast({
        title: 'Update Failed to Apply',
        description: data?.pendingVersion
          ? `Panel is still running the previous version. The v${data.pendingVersion} update did not install.`
          : 'The downloaded update did not install. Review the helper log for details.',
        variant: 'destructive',
      })
      fetchPanelUpdateStatus()
    }

    socket.on('panel:updateAvailable', handlePanelUpdateAvailable)
    socket.on('panel:downloadProgress', handlePanelDownloadProgress)
    socket.on('panel:updateReady', handlePanelUpdateReady)
    socket.on('panel:updateApplied', handlePanelUpdateApplied)
    socket.on('panel:updateApplyFailed', handlePanelUpdateApplyFailed)

    return () => {
      socket.off('panel:updateAvailable', handlePanelUpdateAvailable)
      socket.off('panel:downloadProgress', handlePanelDownloadProgress)
      socket.off('panel:updateReady', handlePanelUpdateReady)
      socket.off('panel:updateApplied', handlePanelUpdateApplied)
      socket.off('panel:updateApplyFailed', handlePanelUpdateApplyFailed)
    }
  }, [socket, toast, fetchPanelUpdateStatus])

  const handleTestRcon = async () => {
    setTestingRcon(true)
    try {
      await configApi.testRcon()
      toast({
        title: 'RCON Connected',
        description: 'The panel connected to your server over RCON.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'RCON Connection Failed',
        description: error instanceof Error ? error.message : 'The panel could not connect to RCON. Verify host, port, password, and firewall rules.',
        variant: 'destructive',
      })
    } finally {
      setTestingRcon(false)
    }
  }

  // Panel Bridge functions
  const fetchBridgeStatus = useCallback(async () => {
    try {
      const status = await panelBridgeApi.getStatus()
      setBridgeStatus(status)
      setBridgeError(null)
    } catch (error) {
      reportClientError('Failed to fetch bridge status.', error)
    }
  }, [])
  
  // Fetch servers list for install dropdown
  const fetchServers = useCallback(async () => {
    try {
      const data = await serversApi.getAll()
      setServers(data.servers || [])
      // Auto-select active server
      const activeServer = data.servers?.find((s) => s.isActive)
      if (activeServer && !selectedInstallServerId) {
        setSelectedInstallServerId(String(activeServer.id))
      }
    } catch (error) {
      reportClientError('Failed to fetch servers.', error)
    }
  }, [selectedInstallServerId])
  
  // Install PanelBridge mod to selected server
  const handleInstallMod = async () => {
    if (!selectedInstallServerId) {
      toast({
        title: 'Select a Server',
        description: 'Choose the server where you want to install PanelBridge.lua.',
        variant: 'destructive',
      })
      return
    }
    
    setInstallingMod(true)
    try {
      const result = await panelBridgeApi.installModAuto(selectedInstallServerId)
      toast({
        title: 'PanelBridge Installed',
        description: `PanelBridge.lua was copied to ${result.serverName || 'the selected server'}.`,
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Installation Failed',
        description: error instanceof Error ? error.message : 'The panel could not copy PanelBridge.lua. Verify the server path and permissions, then try again.',
        variant: 'destructive',
      })
    } finally {
      setInstallingMod(false)
    }
  }

  // Use ref for bridge polling interval to avoid recreation issues
  const bridgeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bridgeStatusRef = useRef(bridgeStatus)
  
  // Keep ref in sync with state
  useEffect(() => {
    bridgeStatusRef.current = bridgeStatus
  }, [bridgeStatus])

  useEffect(() => {
    fetchBridgeStatus()
    fetchServers()

    // Use recursive setTimeout for adaptive interval based on current status
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    
    const scheduleNextFetch = () => {
      const status = bridgeStatusRef.current
      // Poll faster when waiting for mod to connect
      const interval = (status?.isRunning && !status?.modConnected) ? 3000 : 10000
      
      timeoutId = setTimeout(async () => {
        if (document.visibilityState !== 'hidden') {
          await fetchBridgeStatus()
        }
        scheduleNextFetch()
      }, interval)
    }
    
    scheduleNextFetch()
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (bridgeIntervalRef.current) {
        clearInterval(bridgeIntervalRef.current)
        bridgeIntervalRef.current = null
      }
    }
  }, [fetchBridgeStatus, fetchServers])

  // Backup functions
  const fetchBackupStatus = useCallback(async () => {
    try {
      const status = await backupApi.getStatus()
      setBackupStatus(status)
      setBackupSchedule(status.schedule)
      setBackupMaxCount(status.maxBackups)
    } catch (error) {
      reportClientError('Failed to fetch backup status.', error)
    }
  }, [])

  const fetchBackups = useCallback(async () => {
    try {
      const data = await backupApi.listBackups()
      setBackups(data.backups || [])
    } catch (error) {
      reportClientError('Failed to fetch backups.', error)
    }
  }, [])

  useEffect(() => {
    fetchBackupStatus()
    fetchBackups()
  }, [fetchBackupStatus, fetchBackups])

  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    try {
      const result = await backupApi.createBackup()
      if (result.success && result.backup) {
        toast({
          title: 'Backup Created',
          description: `Created ${result.backup.name} in ${result.duration?.toFixed(1)}s`,
          variant: 'success' as const,
        })
        await fetchBackups()
        await fetchBackupStatus()
      } else {
        throw new Error(result.message || 'Failed to create backup')
      }
    } catch (error) {
      toast({
        title: 'Backup Failed',
        description: error instanceof Error ? error.message : 'Failed to create backup',
        variant: 'destructive',
      })
    } finally {
      setCreatingBackup(false)
    }
  }

  const handleDeleteBackup = async (name: string) => {
    try {
      const result = await backupApi.deleteBackup(name)
      if (result.success) {
        toast({
          title: 'Backup Deleted',
          description: `Deleted ${name}`,
          variant: 'success' as const,
        })
        await fetchBackups()
      } else {
        throw new Error(result.message || 'Failed to delete backup')
      }
    } catch (error) {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete backup',
        variant: 'destructive',
      })
    }
  }

  const handleRestoreBackup = async (name: string) => {
    setRestoringBackup(name)
    try {
      const result = await backupApi.restoreBackup(name, { createPreRestoreBackup: true })
      if (result.success) {
        toast({
          title: 'Backup Restored',
          description: `Restored ${name} in ${(result.duration || 0).toFixed(1)}s`,
          variant: 'success' as const,
        })
        await fetchBackups()
      } else {
        throw new Error(result.message || 'Failed to restore backup')
      }
    } catch (error) {
      toast({
        title: 'Restore Failed',
        description: error instanceof Error ? error.message : 'Failed to restore backup',
        variant: 'destructive',
      })
    } finally {
      setRestoringBackup(null)
      setRestoreConfirmBackup(null)
    }
  }

  // Basic cron validation helper
  const isValidCron = (cron: string): boolean => {
    const parts = cron.trim().split(/\s+/)
    if (parts.length !== 5) return false
    
    const patterns = [
      /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)*)$/, // minute
      /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)*)$/, // hour
      /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)*)$/, // day of month
      /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)*)$/, // month
      /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)*)$/, // day of week
    ]
    
    return parts.every((part, i) => patterns[i].test(part))
  }

  const handleSaveBackupSettings = async () => {
    // Validate cron expression before saving
    if (!isValidCron(backupSchedule)) {
      toast({
        title: 'Invalid Schedule',
        description: 'Please enter a valid cron expression (e.g., 0 */6 * * *)',
        variant: 'destructive',
      })
      return
    }
    
    setBackupLoading(true)
    try {
      await backupApi.updateSettings({
        enabled: backupStatus?.enabled || false,
        schedule: backupSchedule,
        maxBackups: backupMaxCount,
      })
      await fetchBackupStatus()
      toast({
        title: 'Backup Settings Saved',
        description: 'Backup schedule and retention settings were updated.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Could Not Save Backup Settings',
        description: error instanceof Error ? error.message : 'The panel could not save backup schedule settings. Try again.',
        variant: 'destructive',
      })
    } finally {
      setBackupLoading(false)
    }
  }

  const toggleBackupEnabled = async (enabled: boolean) => {
    setBackupLoading(true)
    try {
      await backupApi.updateSettings({ enabled })
      await fetchBackupStatus()
      toast({
        title: enabled ? 'Scheduled Backups Enabled' : 'Scheduled Backups Disabled',
        description: enabled
          ? 'The panel will create backups on the configured schedule.'
          : 'Automatic backups are off. Manual backups are still available.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Could Not Update Backups',
        description: error instanceof Error ? error.message : 'The panel could not update scheduled backup status. Try again.',
        variant: 'destructive',
      })
    } finally {
      setBackupLoading(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  // Listen for real-time bridge status updates via Socket.IO
  // Use ref to avoid stale closure issues with fetchBridgeStatus
  const fetchBridgeStatusRef = useRef(fetchBridgeStatus)
  useEffect(() => {
    fetchBridgeStatusRef.current = fetchBridgeStatus
  }, [fetchBridgeStatus])

  useEffect(() => {
    if (!socket) return

    const handleBridgeStatus = (data: { isRunning: boolean; bridgePath: string }) => {
      setBridgeStatus(prev => prev ? { ...prev, isRunning: data.isRunning, bridgePath: data.bridgePath } : null)
      // Fetch full status to get all details
      fetchBridgeStatusRef.current()
    }

    const handleModStatus = (data: { alive: boolean; version?: string; serverName?: string; playerCount?: number; players?: string[] | Record<string, unknown>; path?: string; timestamp?: number }) => {
      setBridgeStatus(prev => {
        if (!prev) return null
        // Create a proper modStatus object, preserving previous values if new ones are missing
        const prevModStatus = prev.modStatus
        const newModStatus = {
          alive: data.alive,
          version: data.version || prevModStatus?.version || '',
          serverName: data.serverName || prevModStatus?.serverName || '',
          // When alive, use playerCount (defaulting to 0); when offline, leave undefined
          playerCount: data.alive ? (data.playerCount ?? 0) : undefined,
          players: Array.isArray(data.players) ? data.players : Object.keys(data.players || {}),
          path: data.path || prevModStatus?.path || '',
          timestamp: data.timestamp || Date.now()
        }
        return { 
          ...prev, 
          modConnected: data.alive,
          modStatus: newModStatus
        }
      })
    }

    const handleBridgeConfigured = (data: { bridgePath: string }) => {
      setBridgeStatus(prev => prev ? { ...prev, bridgePath: data.bridgePath, configured: true } : null)
      fetchBridgeStatusRef.current()
    }

    socket.on('panelBridge:status', handleBridgeStatus)
    socket.on('panelBridge:modStatus', handleModStatus)
    socket.on('panelBridge:configured', handleBridgeConfigured)

    return () => {
      socket.off('panelBridge:status', handleBridgeStatus)
      socket.off('panelBridge:modStatus', handleModStatus)
      socket.off('panelBridge:configured', handleBridgeConfigured)
    }
  }, [socket]) // Only depend on socket, use ref for fetchBridgeStatus

  // Auto-configure from active server settings (one-click setup)
  const handleAutoConfigure = async () => {
    setBridgeLoading(true)
    setBridgeError(null)
    try {
      const result = await panelBridgeApi.autoConfigure()
      if (result.success) {
        toast({
          title: 'Bridge Auto-Configured',
          description: `Connected to server: ${result.serverName}`,
          variant: 'success' as const,
        })
        await fetchBridgeStatus()
      } else {
        setBridgeError(result.error || 'Failed to auto-configure')
      }
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : 'Failed to auto-configure')
    } finally {
      setBridgeLoading(false)
    }
  }

  const handleStopBridge = async () => {
    setBridgeLoading(true)
    try {
      await panelBridgeApi.stop()
      toast({
        title: 'Bridge Stopped',
        description: 'Panel Bridge has been stopped',
        variant: 'success' as const,
      })
      await fetchBridgeStatus()
    } catch (error) {
      toast({
        title: 'Failed to Stop',
        description: error instanceof Error ? error.message : 'The panel could not stop Panel Bridge. Try again.',
        variant: 'destructive',
      })
    } finally {
      setBridgeLoading(false)
    }
  }

  const handleManualConfigure = async () => {
    const trimmed = manualBridgePath.trim()
    if (!trimmed) return
    setBridgeLoading(true)
    setBridgeError(null)
    try {
      const result = await panelBridgeApi.configureDirect(trimmed)
      if (result.success) {
        toast({
          title: 'Bridge Configured',
          description: `Watching: ${result.bridgePath}`,
          variant: 'success' as const,
        })
        setManualBridgePath('')
        await fetchBridgeStatus()
      } else {
        setBridgeError(result.error || 'Failed to configure bridge')
      }
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : 'Failed to configure bridge with manual path')
    } finally {
      setBridgeLoading(false)
    }
  }

  const handlePingMod = async () => {
    setPinging(true)
    try {
      const result = await panelBridgeApi.ping()
      if (result.success) {
        toast({
          title: 'Mod Connected!',
          description: `Connected to ${result.modStatus?.serverName || 'server'}`,
          variant: 'success' as const,
        })
      } else {
        toast({
          title: 'Mod Did Not Respond',
          description: result.error || 'No response from PanelBridge.lua. Make sure the game server is running and the mod is enabled.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Ping Failed',
        description: error instanceof Error ? error.message : 'The panel could not ping the mod. Confirm the server is running with PanelBridge enabled.',
        variant: 'destructive',
      })
    } finally {
      setPinging(false)
    }
  }

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    // Validate numeric string fields
    if (typeof value === 'string' && ['modCheckInterval', 'modRestartDelay', 'reconnectInterval', 'panelPort', 'httpsPort'].includes(key)) {
      // Allow empty string but reject non-numeric values
      if (value !== '' && isNaN(parseInt(value))) {
        return // Don't update with invalid value
      }
    }
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const selectedInstallServer = servers.find((server) => String(server.id) === selectedInstallServerId) || null
  const trimmedHttpsKeyPath = settings.httpsKeyPath.trim()
  const trimmedHttpsCertPath = settings.httpsCertPath.trim()
  const hasPartialHttpsCertPath = Boolean(trimmedHttpsKeyPath) !== Boolean(trimmedHttpsCertPath)
  const usingAutoGeneratedHttpsCert = settings.httpsEnabled && !trimmedHttpsKeyPath && !trimmedHttpsCertPath
  const httpsPortPreview = normalizePort(settings.httpsPort || '3443')
  const httpPortPreview = normalizePort(settings.panelPort || '3001')
  const httpsPreviewUrl = `https://${window.location.hostname}:${httpsPortPreview}`
  const httpPreviewUrl = `http://${window.location.hostname}:${httpPortPreview}`

  const applyRecommendedHttpsDefaults = () => {
    updateSetting('httpsEnabled', true)
    updateSetting('httpsPort', '3443')
    updateSetting('httpsKeyPath', '')
    updateSetting('httpsCertPath', '')
  }

  // Detect path separator from install path; default to '/' (works on all platforms)
  const sep = selectedInstallServer?.installPath?.includes('\\') ? '\\' : '/'
  const selectedInstallTarget = selectedInstallServer
    ? `${selectedInstallServer.installPath}${sep}media${sep}lua${sep}server${sep}PanelBridge.lua`
    : null

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) return
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' })
      return
    }
    if (newPassword.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' })
      return
    }
    setChangingPassword(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      toast({ title: 'Password Changed', description: 'Your password has been updated.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      toast({
        title: 'Change Password Failed',
        description: error instanceof Error ? error.message : 'The panel could not change your password. Check your current password and try again.',
        variant: 'destructive',
      })
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading && !originalSettings) {
    return (
      <div className="flex items-center justify-center min-h-[320px] py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="page-transition">
      {/* Unsaved Changes Warning */}
      {isDirty && (
        <Alert className="border-warning/40 bg-warning/10 shadow-sm mb-5">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-warning">Unsaved Changes</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              You have unsaved settings. Save changes to apply them.
            </span>
            <Button onClick={handleSave} disabled={saving || Boolean(corsOriginValidationError)} size="sm" variant="warning" className="self-start gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </Button>
          </AlertDescription>
        </Alert>
      )}
      
      <PageHeader
        title="Settings"
        description="Panel port, remote access, server integrations, backups, and security."
        eyebrow="Configuration"
        tone="config"
        icon={<Settings2 className="w-5 h-5" />}
        actions={
          <Button variant="command" onClick={handleSave} disabled={saving || !isDirty || Boolean(corsOriginValidationError)} size="lg" className="w-full sm:w-auto gap-2">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? 'Saving...' : isDirty ? 'Save Settings' : 'No Unsaved Changes'}
          </Button>
        }
      />

      <Tabs value={activeSection} onValueChange={handleTabChange} className="mt-6">
        <TabsList className="flex h-auto flex-wrap gap-1 bg-muted/40 p-1 rounded-lg w-full">
          {settingsSections.map((section, idx) => {
            const Icon = section.icon
            const prevGroup = idx > 0 ? settingsSections[idx - 1].group : section.group
            const showSeparator = idx > 0 && section.group !== prevGroup
            return (
              <React.Fragment key={section.id}>
                {showSeparator && <div className="mx-0.5 hidden sm:block w-px self-stretch bg-border/40" />}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <TabsTrigger
                        value={section.id}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm"
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="hidden sm:inline">{section.label}</span>
                      </TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[200px]">
                    <p className="text-xs">{section.tip}</p>
                  </TooltipContent>
                </Tooltip>
              </React.Fragment>
            )
          })}
        </TabsList>

        {/* Tab Content */}
        <div className="mt-5 space-y-5">

        <TabsContent value="panel" className="mt-0">

      {/* Panel Settings */}
      <Card id="settings-panel">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Panel Settings
          </CardTitle>
          <CardDescription>Port, remote access, and panel updates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Label htmlFor="panel-port">Panel Port</Label>
            <Input
              id="panel-port"
              type="number"
              value={settings.panelPort}
              onChange={(e) => updateSetting('panelPort', e.target.value)}
              min="1024"
              max="65535"
              placeholder="3001"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Port used to access the panel (default: 3001).
            </p>
          </div>
          {originalSettings && settings.panelPort !== originalSettings.panelPort && (
            <Alert className="border-warning/40 bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Restart Required</AlertTitle>
              <AlertDescription>
                Port changes require a restart. Save first, then restart.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={() => restartPanelWithReconnect(`Panel is restarting on port ${settings.panelPort}. Reconnecting...`)}
              disabled={restarting || isDirty}
              className="gap-2"
            >
              {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
              {restarting ? 'Restarting...' : 'Restart Panel'}
            </Button>
            {isDirty && (
              <p className="text-xs text-muted-foreground">Save settings before restarting</p>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium flex items-center gap-2"><Palette className="w-4 h-4 text-primary" />Appearance</p>
              <p className="text-xs text-muted-foreground">Panel theme and visual style.</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/25 p-3">
              <div>
                <Label className="text-sm font-medium">Theme</Label>
                <p className="text-xs text-muted-foreground">Choose between the gritty survival look or a clean light theme.</p>
              </div>
              <ThemeSelect />
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Remote Access (CORS)</p>
              <p className="text-xs text-muted-foreground">
                Controls which devices and browsers can connect to this panel. If you only access the panel from this machine, these defaults are fine.
              </p>
            </div>

            <Alert className="border-border/60 bg-muted/40">
              <Globe className="h-4 w-4 text-primary" />
              <AlertTitle>Quick Start for VPS Remote Access</AlertTitle>
              <AlertDescription className="space-y-1 text-sm text-muted-foreground">
                <p>1. Keep <strong className="text-foreground">Allow private/LAN origins</strong> on.</p>
                <p>2. Add one origin per line in the list below (example: <code>http://YOUR_PUBLIC_IP:3001</code>).</p>
                <p>3. Save settings, then click <strong className="text-foreground">Reload CORS Rules</strong>.</p>
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/25 p-3">
              <div>
                <Label className="text-sm font-medium">Allow Private/LAN Origins</Label>
                <p className="text-xs text-muted-foreground">Automatically allow connections from localhost and private/LAN IP ranges.</p>
              </div>
              <Switch
                checked={settings.corsAllowPrivateNetworks}
                onCheckedChange={(value) => updateSetting('corsAllowPrivateNetworks', value)}
                aria-label="Allow private and LAN origins"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cors-origins">Additional Allowed Origins</Label>
              <Textarea
                id="cors-origins"
                value={settings.corsAllowedOrigins}
                onChange={(e) => updateSetting('corsAllowedOrigins', e.target.value)}
                placeholder={'http://123.45.67.89:3001\nhttps://panel.example.com'}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                One address per line, including http:// or https:// and port if needed.
              </p>
              {corsOriginValidationError && (
                <p className="text-xs text-destructive">{corsOriginValidationError}</p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div>
                <Label className="text-sm font-medium text-warning">Allow All Origins (Debug Only)</Label>
                <p className="text-xs text-muted-foreground">Skip all origin checks — useful for diagnosing connection problems.</p>
              </div>
              <Switch
                checked={settings.corsAllowAll}
                onCheckedChange={(value) => updateSetting('corsAllowAll', value)}
                aria-label="Allow all origins"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/25 p-3">
              <div>
                <Label className="text-sm font-medium">Enable CORS Debug Logging</Label>
                <p className="text-xs text-muted-foreground">Log blocked connection attempts for troubleshooting.</p>
              </div>
              <Switch
                checked={settings.corsDebug}
                onCheckedChange={(value) => updateSetting('corsDebug', value)}
                aria-label="Enable CORS debug logging"
              />
            </div>

            {settings.corsAllowAll && (
              <Alert className="border-warning/40 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Security Warning</AlertTitle>
                <AlertDescription>
                  Allowing all origins removes browser-origin protection. Use this only for short troubleshooting windows.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReloadCorsRules}
                disabled={corsUpdating || saving || Boolean(corsOriginValidationError)}
                className="gap-2"
              >
                {corsUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Reload CORS Rules
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={fetchCorsDiagnostics}
                disabled={corsLoading || corsUpdating}
                className="gap-2"
              >
                <RefreshCw className={cn('w-4 h-4', corsLoading && 'animate-spin')} />
                Refresh Diagnostics
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearCorsBlocked}
                disabled={corsUpdating || !corsDiagnostics?.blockedCount}
                className="gap-2 text-muted-foreground"
              >
                <Trash2 className="w-4 h-4" />
                Clear Blocked Log
              </Button>
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Blocked Origins</p>
                <p className="mt-1 font-medium text-foreground">{corsDiagnostics?.blockedCount ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Effective Allowlist</p>
                <p className="mt-1 font-medium text-foreground">{corsDiagnostics?.effectiveAllowedOrigins.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <p className="text-muted-foreground">Last Reload</p>
                <p className="mt-1 font-medium text-foreground">{formatTimestamp(corsDiagnostics?.lastLoadedAt || null)}</p>
              </div>
            </div>

            {!!corsDiagnostics?.blocked.length && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Recent Blocked Origins</p>
                <ScrollArea className="h-[150px] rounded-lg border border-border/60 bg-muted/20 p-2">
                  <div className="space-y-2 pr-2">
                    {corsDiagnostics.blocked.slice(0, 12).map((entry) => (
                      <div key={entry.id} className="rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-xs">
                        <p className="font-mono break-all text-foreground">{entry.origin}</p>
                        <p className="text-muted-foreground">{entry.source.toUpperCase()} • {formatTimestamp(entry.blockedAt)}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium">Panel Auto Update</p>
                <p className="text-xs text-muted-foreground">
                  Check for a new release, download it, then apply on restart.
                </p>
              </div>
              {(checkingPanelUpdate || panelUpdateStatus?.isChecking) ? (
                <span className="inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2.5 py-0.5 text-xs font-semibold text-foreground/85">
                  Checking...
                </span>
              ) : (downloadingPanelUpdate || panelUpdateStatus?.isDownloading) ? (
                <span className="inline-flex items-center rounded-full border border-primary/35 bg-primary/12 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Downloading...
                </span>
              ) : panelUpdateStatus?.updateAvailable ? (
                <span className="inline-flex items-center rounded-full border border-warning/35 bg-warning/12 px-2.5 py-0.5 text-xs font-semibold text-warning">
                  Update available
                </span>
              ) : panelUpdateStatusError ? (
                <span className="inline-flex items-center rounded-full border border-destructive/35 bg-destructive/12 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                  Cannot reach updater
                </span>
              ) : !panelUpdateStatus ? (
                <span className="inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
                  Not checked
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Up to date
                </span>
              )}
            </div>

            {panelUpdateStatusError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Updater Error</AlertTitle>
                <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="break-words">{panelUpdateStatusError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchPanelUpdateStatus}
                    disabled={checkingPanelUpdate || downloadingPanelUpdate || restarting}
                    className="self-start"
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                <p className="text-muted-foreground">Installed</p>
                <p className="mt-1 font-medium text-foreground">v{panelUpdateStatus?.currentVersion || 'Unknown'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                <p className="text-muted-foreground">Latest</p>
                <p className="mt-1 font-medium text-foreground">{panelUpdateStatus?.latestVersion ? `v${panelUpdateStatus.latestVersion}` : 'Not checked yet'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                <p className="text-muted-foreground">Last Check</p>
                <p className="mt-1 font-medium text-foreground">{formatTimestamp(panelUpdateStatus?.lastCheck || null)}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                <p className="text-muted-foreground">Release Published</p>
                <p className="mt-1 font-medium text-foreground">{formatTimestamp(panelUpdateStatus?.publishedAt || null)}</p>
              </div>
            </div>

            {(downloadingPanelUpdate || panelUpdateStatus?.isDownloading) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Downloading update</span>
                  <span>{panelUpdateStatus?.downloadProgress ?? 0}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full w-full bg-primary transition-transform duration-200 ease-out"
                    style={{ transform: `translateX(-${100 - (panelUpdateStatus?.downloadProgress ?? 0)}%)` }}
                  />
                </div>
              </div>
            )}

            {panelUpdateStatus?.lastError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Last Update Error</AlertTitle>
                <AlertDescription className="break-words whitespace-pre-wrap">{panelUpdateStatus.lastError}</AlertDescription>
              </Alert>
            )}

            {panelUpdateStatus?.lastApplyResult && !panelApplyResultDismissed && (
              panelUpdateStatus.lastApplyResult.status === 'success' ? (
                // Hide the stale success banner if the panel has since moved to a different
                // version (or there's already a newer staged update). The banner should only
                // reflect the version that's currently running.
                (panelUpdateStatus.lastApplyResult.appliedVersion &&
                 panelUpdateStatus.currentVersion &&
                 panelUpdateStatus.lastApplyResult.appliedVersion !== panelUpdateStatus.currentVersion) ||
                panelUpdateStatus.stagedUpdate
                  ? null
                  : (
                <Alert variant="success">
                  <AlertTitle>Update Applied</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      Panel is now running v{panelUpdateStatus.lastApplyResult.appliedVersion || panelUpdateStatus.currentVersion}
                      {panelUpdateStatus.lastApplyResult.at ? ` (applied ${formatTimestamp(panelUpdateStatus.lastApplyResult.at)})` : ''}.
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setPanelApplyResultDismissed(true)} className="self-start">
                      Dismiss
                    </Button>
                  </AlertDescription>
                </Alert>
                  )
              ) : (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Update Failed to Apply</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    <span className="break-words">
                      Panel is still running v{panelUpdateStatus.lastApplyResult.currentVersion || panelUpdateStatus.currentVersion}.
                      {panelUpdateStatus.lastApplyResult.pendingVersion
                        ? ` Expected v${panelUpdateStatus.lastApplyResult.pendingVersion}.`
                        : ''}
                      {panelUpdateStatus.lastApplyResult.stagedStillPresent
                        ? ' The downloaded file is still on disk; you can retry the restart.'
                        : ' The staged binary is gone — re-download the update before retrying.'}
                    </span>
                    {panelUpdateStatus.lastApplyResult.likelyCause === 'av_quarantine' && (
                      <div className="rounded-md border border-destructive/40 bg-background/50 p-2 text-xs leading-relaxed">
                        <strong className="text-destructive-foreground">Likely cause:</strong> antivirus or Controlled Folder Access deleted the new binary after it was placed.
                        {panelUpdateStatus.lastApplyResult.panelFolder && (
                          <div className="mt-1">
                            Add this folder to your AV exclusions and retry:
                            <pre className="mt-1 rounded bg-background/70 p-1 text-[11px]">{panelUpdateStatus.lastApplyResult.panelFolder}</pre>
                            <div className="mt-1 text-[11px] opacity-80">
                              Windows Defender: <code>Add-MpPreference -ExclusionPath {JSON.stringify(panelUpdateStatus.lastApplyResult.panelFolder)}</code>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {panelUpdateStatus.lastApplyResult.likelyCause === 'rename_locked' && (
                      <div className="rounded-md border border-destructive/40 bg-background/50 p-2 text-xs leading-relaxed">
                        <strong className="text-destructive-foreground">Likely cause:</strong> another process (OneDrive, AV, or a file watcher) held the exe locked. Pause OneDrive or close explorer windows pointing at the folder, then retry.
                      </div>
                    )}
                    {panelUpdateStatus.lastApplyResult.likelyCause === 'permission' && (
                      <div className="rounded-md border border-destructive/40 bg-background/50 p-2 text-xs leading-relaxed">
                        <strong className="text-destructive-foreground">Likely cause:</strong> access denied writing to the panel folder. Relaunch the panel as Administrator or move it out of Program Files.
                      </div>
                    )}
                    {panelUpdateStatus.lastApplyResult.likelyCause === 'no_helper_log' && (
                      <div className="rounded-md border border-destructive/40 bg-background/50 p-2 text-xs leading-relaxed">
                        <strong className="text-destructive-foreground">No helper log was written.</strong> The helper script may have been blocked by execution policy or AV. Check Windows Defender protection history.
                      </div>
                    )}
                    {panelApplyLog && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer font-medium">Show helper log</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-destructive/30 bg-background/60 p-2 text-[11px] leading-snug whitespace-pre-wrap break-all">
{panelApplyLog}
                        </pre>
                      </details>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPanelApplyResultDismissed(true)}>Dismiss</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const { log: helperLog } = await panelUpdateApi.getApplyLog()
                            setPanelApplyLog(helperLog || 'No helper log found.')
                          } catch (error) {
                            toast({
                              title: 'Could not read log',
                              description: error instanceof Error ? error.message : 'Failed to read helper log.',
                              variant: 'destructive',
                            })
                          }
                        }}
                      >
                        Refresh log
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )
            )}

            {panelUpdatePreflight && !panelUpdatePreflight.ok && (panelUpdateStatus?.updateAvailable || panelUpdateStatus?.stagedUpdate) && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Update Blocked</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {panelUpdatePreflight.blockers.map((b, i) => (
                      <li key={`blk-${i}`} className="break-words">{b}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {panelUpdatePreflight && panelUpdatePreflight.ok && panelUpdatePreflight.warnings.length > 0 && (panelUpdateStatus?.updateAvailable || panelUpdateStatus?.stagedUpdate) && !(panelUpdateStatus?.lastApplyResult?.status === 'failed' && !panelApplyResultDismissed) && (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Before You Restart</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {panelUpdatePreflight.warnings.map((w, i) => (
                      <li key={`wrn-${i}`} className="break-words">{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleCheckPanelUpdate}
                disabled={checkingPanelUpdate || downloadingPanelUpdate || restarting}
                className="gap-2"
              >
                {checkingPanelUpdate ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {checkingPanelUpdate ? 'Checking...' : 'Check for Updates'}
              </Button>

              <Button
                onClick={handleDownloadPanelUpdate}
                disabled={!panelUpdateStatus?.updateAvailable || checkingPanelUpdate || downloadingPanelUpdate || restarting || (panelUpdatePreflight?.ok === false)}
                className="gap-2"
              >
                {downloadingPanelUpdate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {downloadingPanelUpdate ? 'Downloading...' : 'Download Update'}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="warning"
                    disabled={!panelUpdateReady || restarting || isDirty || downloadingPanelUpdate || Boolean(panelUpdateStatus?.isDownloading) || (panelUpdatePreflight?.ok === false)}
                    className="gap-2"
                  >
                    {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    Restart and Apply Update
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apply panel update?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3 text-sm">
                        <p>
                          The panel will exit immediately. A helper process will swap the executable and relaunch it in a few seconds.
                          {panelUpdateStatus?.stagedUpdate?.version
                            ? ` You are about to install v${panelUpdateStatus.stagedUpdate.version}.`
                            : ''}
                        </p>
                        {panelUpdatePreflight?.warnings.length ? (
                          <div>
                            <p className="font-medium text-foreground">Please confirm before continuing:</p>
                            <ul className="mt-1 list-disc space-y-1 pl-5">
                              {panelUpdatePreflight.warnings.map((w, i) => (
                                <li key={`confirm-wrn-${i}`} className="break-words">{w}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          If the new version does not come back online within a minute, check the helper log in <code>%TEMP%</code>
                          (<code>zomboid-panel-update-*.log</code>) and relaunch the panel manually.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => restartPanelWithReconnect('Applying downloaded update. Restarting panel...')}>
                      Restart and apply
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {panelUpdateStatus?.releaseUrl && (
                <Button asChild variant="ghost" className="gap-2">
                  <a href={panelUpdateStatus.releaseUrl} target="_blank" rel="noopener noreferrer" className="max-w-full truncate" title={panelUpdateStatus.releaseUrl}>
                    <ExternalLink className="h-4 w-4" />
                    View Release Notes <span className="sr-only">(opens in new tab)</span>
                  </a>
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {isDirty
                ? 'Save settings before applying an update.'
                : panelUpdateReady
                ? 'Update files are ready. Restart to switch to the new version.'
                : panelUpdateStatus?.updateAvailable
                ? 'Download the update, then restart to apply it.'
                : 'No update is ready to install.'}
            </p>

            <p className="text-xs text-muted-foreground">
              Auto-update works in packaged builds only. In dev mode, update from git.
            </p>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="https" className="mt-0">
      {/* HTTPS Settings */}
      <Card id="settings-https">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            HTTPS
          </CardTitle>
          <CardDescription>Encrypt panel traffic with a TLS certificate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-border/60 bg-muted/40">
            <Lock className="h-4 w-4 text-primary" />
            <AlertTitle>Recommended Setup (Most Servers)</AlertTitle>
            <AlertDescription className="space-y-2 text-sm text-muted-foreground">
              <p>Enable HTTPS, leave certificate paths empty, save, then restart.</p>
              <p>The panel creates a local self-signed certificate automatically.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={applyRecommendedHttpsDefaults}>
                  Use Recommended Defaults
                </Button>
              </div>
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
            <Switch
              checked={settings.httpsEnabled}
              onCheckedChange={(value) => updateSetting('httpsEnabled', value)}
              aria-label="Enable HTTPS"
            />
            <div>
              <Label className="text-base">Enable HTTPS</Label>
              <p className="text-sm text-muted-foreground">
                Serve the panel over HTTPS.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground space-y-1">
            <p><strong className="text-foreground">HTTP URL:</strong> <code className="break-all">{httpPreviewUrl}</code></p>
            <p><strong className="text-foreground">HTTPS URL:</strong> <code className="break-all">{httpsPreviewUrl}</code></p>
          </div>

          {settings.httpsEnabled && (
            <div className="ml-2 space-y-4 border-l-2 border-primary/20 pl-2">
              <div className="max-w-xs">
                <Label htmlFor="https-port">HTTPS Port</Label>
                <Input
                  id="https-port"
                  type="number"
                  value={settings.httpsPort}
                  onChange={(e) => updateSetting('httpsPort', e.target.value)}
                  min="1024"
                  max="65535"
                  placeholder="3443"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  HTTPS listener port (recommended 3443).
                </p>
              </div>
              <div className="max-w-md">
                <Label htmlFor="https-cert-path">Custom Certificate Path <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="https-cert-path"
                  value={settings.httpsCertPath}
                  onChange={(e) => updateSetting('httpsCertPath', e.target.value)}
                  placeholder="Example: C:\\certs\\panel.fullchain.pem"
                  maxLength={260}
                />
                <p className="text-xs text-muted-foreground mt-1">Set both certificate and key paths, or leave both empty.</p>
              </div>
              <div className="max-w-md">
                <Label htmlFor="https-key-path">Custom Key Path <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="https-key-path"
                  value={settings.httpsKeyPath}
                  onChange={(e) => updateSetting('httpsKeyPath', e.target.value)}
                  placeholder="Example: C:\\certs\\panel.privkey.pem"
                  maxLength={260}
                />
                <p className="text-xs text-muted-foreground mt-1">Supports PEM key files that Node.js can read.</p>
              </div>

              {hasPartialHttpsCertPath && (
                <Alert className="border-warning/40 bg-warning/10">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <AlertTitle className="text-warning">Provide Both Certificate Files</AlertTitle>
                  <AlertDescription>
                    Set both certificate and key paths, or clear both to use auto-generated certs.
                  </AlertDescription>
                </Alert>
              )}

              {usingAutoGeneratedHttpsCert && (
                <Alert className="border-primary/30 bg-primary/10">
                  <Lock className="h-4 w-4 text-primary" />
                  <AlertTitle className="text-primary">Auto-Generated Certificate Mode</AlertTitle>
                  <AlertDescription>
                    The panel will create and reuse a local self-signed certificate.
                  </AlertDescription>
                </Alert>
              )}

              <Alert className="border-border/60 bg-muted/35">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <AlertTitle>Reverse Proxy Note</AlertTitle>
                <AlertDescription>
                  If TLS is terminated by Nginx, Caddy, or Cloudflare Tunnel, keep panel HTTPS off and proxy local HTTP.
                </AlertDescription>
              </Alert>

              {originalSettings && settings.httpsEnabled !== originalSettings.httpsEnabled && (
                <Alert className="border-warning/40 bg-warning/10">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <AlertTitle className="text-warning">Restart Required</AlertTitle>
                  <AlertDescription>
                    HTTPS changes require restart. Save first, then restart from Panel Settings.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="rcon" className="mt-0">
      {/* RCON Settings */}
      <Card id="settings-rcon">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Link className="w-4 h-4 text-primary" />
            RCON Connection
          </CardTitle>
          <CardDescription>Test the connection and set reconnect behavior. Host, port, and password are configured per-server on the Servers page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Button variant="outline" onClick={handleTestRcon} disabled={testingRcon} className="w-full sm:w-auto">
              {testingRcon ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Test Connection
            </Button>
            <div className="flex items-center gap-2">
              <Switch
                checked={settings.autoReconnect}
                onCheckedChange={(value) => updateSetting('autoReconnect', value)}
                aria-label="Auto-reconnect RCON on disconnect"
              />
              <Label>Auto-reconnect on disconnect</Label>
            </div>
          </div>
          {settings.autoReconnect && (
            <div className="max-w-xs">
              <Label htmlFor="reconnect-interval">Reconnect Interval (seconds)</Label>
              <Input
                id="reconnect-interval"
                type="number"
                value={settings.reconnectInterval}
                onChange={(e) => updateSetting('reconnectInterval', e.target.value)}
                min="1"
                max="60"
              />
            </div>
          )}
          <div className="p-4 bg-muted rounded-lg text-sm">
            <p className="font-medium mb-2">RCON is configured per-server:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Go to <strong>Servers</strong> page</li>
              <li>Click <strong>Edit</strong> on your server</li>
              <li>Configure RCON host, port, and password there</li>
            </ol>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="bridge" className="mt-0">
      {/* Panel Bridge - Advanced Features */}
      <Card id="settings-bridge">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Panel Bridge
              </CardTitle>
              <CardDescription className="flex items-center gap-2">
                Connects this panel to the live game for weather, utilities, richer chat, and other in-world actions
                <Dialog>
                  <DialogTrigger asChild>
                    <button className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap">
                      <Info className="w-3.5 h-3.5" />
                      How it works
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-primary" />
                        Panel Bridge
                      </DialogTitle>
                      <DialogDescription>
                        A Lua mod that runs inside Project Zomboid, giving this panel direct access to the live game world.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5 text-sm">
                      {/* What it unlocks */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">What it unlocks</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                            <p className="font-medium text-foreground">Weather & Climate</p>
                            <p className="text-xs text-muted-foreground">Storms, rain, temperature, fog, wind</p>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                            <p className="font-medium text-foreground">Player Actions</p>
                            <p className="text-xs text-muted-foreground">Teleport, heal, god mode, inventory</p>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                            <p className="font-medium text-foreground">World Control</p>
                            <p className="text-xs text-muted-foreground">Utilities, zombies, time, sandbox</p>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                            <p className="font-medium text-foreground">Chat & Sound</p>
                            <p className="text-xs text-muted-foreground">Server chat, admin chat, world sounds</p>
                          </div>
                        </div>
                      </div>

                      {/* How it works */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">How it works</p>
                        <p className="text-muted-foreground mb-3">
                          Two pieces meet in the middle: the panel runs a file watcher, and <strong className="text-foreground">PanelBridge.lua</strong> runs inside the game. They exchange commands via JSON files.
                        </p>
                      </div>

                      {/* Setup steps */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Setup</p>
                        <ol className="space-y-2">
                          <li className="flex gap-3 items-start">
                            <span className="flex-none w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                            <div>
                              <p className="font-medium">Install the Lua file</p>
                              <p className="text-muted-foreground text-xs">Use the Install section on this tab to copy PanelBridge.lua into your server.</p>
                            </div>
                          </li>
                          <li className="flex gap-3 items-start">
                            <span className="flex-none w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                            <div>
                              <p className="font-medium">Run Auto Setup</p>
                              <p className="text-muted-foreground text-xs">Points the panel at the correct server data folder and starts the watcher.</p>
                            </div>
                          </li>
                          <li className="flex gap-3 items-start">
                            <span className="flex-none w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                            <div>
                              <p className="font-medium">Start the PZ server</p>
                              <p className="text-muted-foreground text-xs">When the game loads the mod, status changes from <strong className="text-warning">Waiting</strong> to <strong className="text-primary">Connected</strong>.</p>
                            </div>
                          </li>
                        </ol>
                      </div>

                      {/* Requirement */}
                      <div className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-xs">
                        <p><strong>Requires LuaChecksum=false</strong> in your server INI. Commands can fail with checksum enabled.</p>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardDescription>
            </div>
            {bridgeStatus && (
              <BridgeStatusBadge
                connected={bridgeStatus.modConnected}
                running={bridgeStatus.isRunning}
                loading={bridgeLoading}
                bridgePath={bridgeStatus.bridgePath}
                summary={bridgeStatus.connection?.summary}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Display - when connected */}
          {bridgeStatus?.modConnected && bridgeStatus.modStatus && (
            <Alert className="border-primary/30 bg-primary/10" aria-live="polite">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                <span className="font-semibold text-primary">
                  Connected to {bridgeStatus.modStatus.serverName || 'server'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Mod Version:</span>{' '}
                  <span className="font-medium">{bridgeStatus.modStatus.version || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Players Online:</span>{' '}
                  <span className="font-medium">{bridgeStatus.modStatus.alive ? (bridgeStatus.modStatus.playerCount ?? 0) : 'Offline'}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Advanced features on Events, Players, and Chat are now available.
              </p>
            </Alert>
          )}

          {/* Not running - setup flow */}
          {!bridgeStatus?.isRunning && (
            <div className="p-4 bg-muted rounded-xl space-y-3">
              <p className="text-sm font-medium">Get Started</p>
              <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
                <li>Install <strong className="text-foreground">PanelBridge.lua</strong> using the section below</li>
                <li>Set <strong className="text-foreground">LuaChecksum=false</strong> in your server INI</li>
                <li>Click <strong className="text-foreground">Auto Setup</strong> to start the bridge watcher</li>
                <li>Start or restart the PZ server</li>
              </ol>
              <Button 
                onClick={() => handleAutoConfigure()} 
                disabled={bridgeLoading}
                className="gap-2"
              >
                {bridgeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Auto Setup
              </Button>

              <div className="border-t border-border/50 pt-3 mt-1 space-y-2">
                <p className="text-xs text-muted-foreground">Or set the bridge path manually (Linux / VPS / custom installs):</p>
                <div className="flex gap-2">
                  <Input
                    value={manualBridgePath}
                    onChange={(e) => setManualBridgePath(e.target.value)}
                    placeholder="/home/pzuser/Zomboid/Lua/panelbridge/MyServer"
                    className="text-xs h-9"
                  />
                  <Button
                    onClick={handleManualConfigure}
                    disabled={bridgeLoading || !manualBridgePath.trim()}
                    variant="secondary"
                    size="sm"
                    className="shrink-0 gap-1.5"
                  >
                    {bridgeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                    Connect
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Waiting for mod */}
          {bridgeStatus?.isRunning && !bridgeStatus?.modConnected && (
            <Alert className="border-warning/40 bg-warning/10" aria-live="polite">
              <Cloud className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Waiting for PZ mod</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>The panel is ready. Start the PZ server with PanelBridge.lua installed and <strong className="text-foreground">LuaChecksum=false</strong> set.</p>
                {bridgeStatus?.bridgePath && (
                  <p className="text-xs text-muted-foreground break-words">
                    Watching: <code className="rounded bg-background px-1 break-all">{bridgeStatus.bridgePath}</code>
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Connection Diagnostics — shown when bridge is running but has issues */}
          {bridgeStatus?.isRunning && !bridgeStatus?.modConnected && bridgeStatus?.connection && (
            <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border/40">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">Connection Diagnostics</span>
                {bridgeStatus.consecutiveFailures != null && bridgeStatus.consecutiveFailures > 0 && (
                  <span className="ml-auto text-[10px] tabular-nums text-warning">{bridgeStatus.consecutiveFailures} consecutive failures</span>
                )}
              </div>
              <div className="p-3 space-y-3">
                {/* Summary */}
                <p className="text-xs text-muted-foreground">{bridgeStatus.connection.summary}</p>

                {/* Issues list */}
                {bridgeStatus.connection.issues && bridgeStatus.connection.issues.length > 0 && (
                  <div className="space-y-1">
                    {bridgeStatus.connection.issues.map((issue: string, i: number) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* File checks grid */}
                {bridgeStatus.connection.checks && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    {Object.entries(bridgeStatus.connection.checks).map(([key, val]) => {
                      if (key === 'statusAgeMs') return null
                      const label = key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, s => s.toUpperCase())
                        .trim()
                      const passed = val === true
                      return (
                        <div key={key} className="flex items-center gap-1.5">
                          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', passed ? 'bg-primary' : 'bg-destructive/60')} />
                          <span className={cn(passed ? 'text-muted-foreground' : 'text-destructive/80')}>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Status file info */}
                {bridgeStatus.statusFile && (
                  <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t border-border/30">
                    <div className="flex items-center gap-1.5">
                      <span className="opacity-60">Status file:</span>
                      <span className={bridgeStatus.statusFile.exists ? 'text-foreground' : 'text-destructive/70'}>
                        {bridgeStatus.statusFile.exists ? 'Present' : 'Not found'}
                      </span>
                      {bridgeStatus.statusFile.ageSeconds != null && (
                        <span className="opacity-50">({bridgeStatus.statusFile.ageSeconds}s ago)</span>
                      )}
                    </div>
                    {bridgeStatus.statusFile.path && (
                      <div className="break-all opacity-50">
                        <code className="text-[10px]">{bridgeStatus.statusFile.path}</code>
                      </div>
                    )}
                  </div>
                )}

                {/* File watcher status */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                  <span>
                    File watcher: {bridgeStatus.hasFileWatcher
                      ? <span className="text-primary">Active</span>
                      : <span className="text-warning">Polling only</span>}
                  </span>
                  {bridgeStatus.pendingCommands > 0 && (
                    <span>Pending: <span className="text-warning tabular-nums">{bridgeStatus.pendingCommands}</span></span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {bridgeError && (
            <Alert variant="destructive" aria-live="assertive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Panel Bridge Error</AlertTitle>
              <AlertDescription>{bridgeError}</AlertDescription>
            </Alert>
          )}

          {/* Control buttons when running */}
          {bridgeStatus?.isRunning && (
            <div className="flex flex-wrap gap-3">
              <Button 
                onClick={handleStopBridge} 
                disabled={bridgeLoading}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                {bridgeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Stop Bridge
              </Button>
              <Button 
                onClick={handlePingMod}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!bridgeStatus?.modConnected || pinging}
              >
                {pinging ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {pinging ? 'Pinging...' : 'Ping Mod'}
              </Button>
              <Button 
                onClick={fetchBridgeStatus}
                variant="ghost"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Status
              </Button>
            </div>
          )}

          {/* Auto-update toggle */}
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/25 p-4">
            <div>
              <Label className="text-sm font-medium">Auto-update mod on panel startup</Label>
              <p className="text-xs text-muted-foreground">When the panel starts, automatically copy the latest bundled PanelBridge.lua to the PZ server if versions differ.</p>
            </div>
            <Switch
              checked={settings.panelBridgeAutoUpdate}
              onCheckedChange={(value) => updateSetting('panelBridgeAutoUpdate', value)}
              aria-label="Auto-update PanelBridge mod"
            />
          </div>

          {/* Install Mod */}
          <div className="p-4 bg-muted rounded-xl space-y-3">
            <p className="text-sm font-medium">Install PanelBridge.lua</p>
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={selectedInstallServerId} onValueChange={setSelectedInstallServerId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select server..." />
                </SelectTrigger>
                <SelectContent>
                  {servers.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No servers configured</div>
                  ) : (
                    servers.map((server) => (
                      <SelectItem key={String(server.id)} value={String(server.id)}>
                        {server.name} {server.isActive ? '(Active)' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                onClick={handleInstallMod}
                disabled={installingMod || !selectedInstallServerId}
                className="gap-2"
                variant="outline"
              >
                {installingMod ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Install Mod
              </Button>
            </div>
            {selectedInstallTarget && (
              <p className="text-xs text-muted-foreground break-all">
                Destination: <code className="bg-background px-1 rounded">{selectedInstallTarget}</code>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="mods" className="mt-0">
      {/* Mod Update Settings */}
      <Card id="settings-mods">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Mod Update Settings
            </CardTitle>
          </div>
          <CardDescription>How often to check for Workshop updates and whether to auto-restart when updates arrive.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-xs space-y-2">
            <Label htmlFor="mod-check-interval" className="text-base">Check Interval (minutes)</Label>
            <Input
              id="mod-check-interval"
              type="number"
              value={settings.modCheckInterval}
              onChange={(e) => updateSetting('modCheckInterval', e.target.value)}
              min="5"
              max="120"
              className="h-11"
            />
            <p className="text-sm text-muted-foreground">
              Minutes between Steam Workshop checks.
            </p>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
            <Switch
              checked={settings.modAutoRestart}
              onCheckedChange={(value) => updateSetting('modAutoRestart', value)}
              aria-label="Auto-restart server when mods update"
            />
            <div>
              <Label className="text-base">Auto-restart server when mods update</Label>
              <p className="text-sm text-muted-foreground">Automatically restart the server when mod updates are detected</p>
            </div>
          </div>
          {settings.modAutoRestart && (
            <div className="max-w-xs space-y-2 pl-4 border-l-2 border-primary/30">
              <Label htmlFor="mod-restart-delay" className="text-base">Restart Delay (minutes)</Label>
              <Input
                id="mod-restart-delay"
                type="number"
                value={settings.modRestartDelay}
                onChange={(e) => updateSetting('modRestartDelay', e.target.value)}
                min="1"
                max="30"
                className="h-11"
              />
              <p className="text-sm text-muted-foreground">
                Players are warned before the restart happens.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="api-keys" className="mt-0">
      {/* API Keys */}
      <Card id="settings-api-keys">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            API Keys
          </CardTitle>
          <CardDescription>Keys used for Steam Workshop lookups and the server finder.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="steam-api-key" className="text-base">Steam Web API Key</Label>
            <div className="relative max-w-md">
              <Input
                id="steam-api-key"
                type={showSteamApiKey ? 'text' : 'password'}
                value={settings.steamApiKey}
                onChange={(e) => updateSetting('steamApiKey', e.target.value)}
                placeholder="Your Steam API key"
                className="h-11 pr-10"
                maxLength={128}
              />
              <button
                type="button"
                onClick={() => setShowSteamApiKey(!showSteamApiKey)}
                className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground"
                aria-label={showSteamApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showSteamApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Used for Steam Workshop mod information and server finder features.
            </p>
            <div className="p-4 bg-muted rounded-lg text-sm mt-3">
              <p className="font-medium mb-2">How to get a Steam API Key:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Go to <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Steam API Key Registration <span className="sr-only">(opens in new tab)</span></a></li>
                <li>Log in with your Steam account</li>
                <li>Enter a domain name (can be "localhost" for personal use)</li>
                <li>Copy the key and paste it here</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="backups" className="mt-0">
      {/* World Backups */}
      <Card id="settings-backups">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-primary" />
                World Backups
              </CardTitle>
              <CardDescription>Save and restore your server's world, map, and player data.</CardDescription>
            </div>
            <Button 
              onClick={handleCreateBackup} 
              disabled={creatingBackup || !backupStatus?.savesExists}
              className="gap-2"
            >
              {creatingBackup ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              {creatingBackup ? 'Creating...' : 'Backup Now'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status */}
          {backupStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {backupStatus.savesExists ? (
                    <span className="text-primary">Saves folder found</span>
                  ) : (
                    <span className="text-destructive">Saves folder not found</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{backupStatus.backupCount} backup{backupStatus.backupCount !== 1 ? 's' : ''} stored</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {backupStatus.lastBackup ? (
                    `Last: ${new Date(backupStatus.lastBackup.created).toLocaleString()}`
                  ) : (
                    'No backups yet'
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Scheduled Backups */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Scheduled Backups</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically backup your world on a schedule
                </p>
              </div>
              <Switch
                checked={backupStatus?.enabled || false}
                onCheckedChange={toggleBackupEnabled}
                disabled={backupLoading}
                aria-label="Enable scheduled backups"
              />
            </div>

            {backupStatus?.enabled && (
              <div className="grid grid-cols-1 gap-4 border-l-2 border-primary/20 pl-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="backup-schedule">Schedule</Label>
                  <Input
                    id="backup-schedule"
                    value={backupSchedule}
                    onChange={(e) => setBackupSchedule(e.target.value)}
                    placeholder="0 */6 * * *"
                    className="font-mono"
                    maxLength={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: every 6 hours. Uses cron format: minute hour day month weekday.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="backup-max">Max Backups to Keep</Label>
                  <Input
                    id="backup-max"
                    type="number"
                    min={1}
                    max={100}
                    value={backupMaxCount}
                    onChange={(e) => setBackupMaxCount(parseInt(e.target.value) || 10)}
                    className="max-w-24"
                  />
                  <p className="text-xs text-muted-foreground">
                    The panel deletes the oldest backups when this limit is reached.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Button 
                    onClick={handleSaveBackupSettings} 
                    disabled={backupLoading}
                    variant="outline"
                    size="sm"
                  >
                    {backupLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save Schedule Settings
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Backup List */}
          <div className="space-y-2">
            <p className="text-base font-medium">Existing Backups</p>
            {backups.length === 0 ? (
              <EmptyState compact type="empty" title="No backups yet" description='Click "Backup Now" to create one.' />
            ) : (
              <ScrollArea className="h-[200px] rounded-lg border">
                <div className="p-2 space-y-2">
                  {backups.map((backup) => (
                    <div
                      key={backup.name}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Archive className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{backup.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(backup.size)} • {new Date(backup.created).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <AlertDialog open={restoreConfirmBackup === backup.name} onOpenChange={(open) => !open && setRestoreConfirmBackup(null)}>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRestoreConfirmBackup(backup.name)}
                              disabled={restoringBackup !== null}
                              className="text-warning hover:text-warning hover:bg-warning/10"
                              title="Restore this backup (server must be stopped)"
                            >
                              {restoringBackup === backup.name ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <RotateCcw className="w-4 h-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-warning" />
                                Restore Backup
                              </AlertDialogTitle>
                              <AlertDialogDescription className="text-left space-y-2">
                                <p>This will restore <strong>{backup.name}</strong> and <strong>OVERWRITE</strong> the current world data.</p>
                                <ul className="list-disc list-inside text-sm space-y-1">
                                  <li>Server must be <strong>STOPPED</strong></li>
                                  <li>A pre-restore backup will be created</li>
                                  <li>This cannot be undone</li>
                                </ul>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRestoreBackup(backup.name)}
                                className="bg-warning text-warning-foreground hover:bg-warning/90"
                              >
                                Restore Backup
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => backupApi.downloadBackup(backup.name)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Backup</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{backup.name}"? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteBackup(backup.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Path Info */}
          {backupStatus?.savesPath && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Saves:</strong> {backupStatus.savesPath}</p>
              <p><strong>Backups:</strong> {backupStatus.backupsPath}</p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-0">
      {/* Security & Authentication */}
      <Card id="settings-security">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            Security & Authentication
          </CardTitle>
          <CardDescription>Change your password and review access details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Account Info */}
          {authEnabled && user && (
            <div className="p-4 rounded-xl bg-muted/50 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{user.username}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                </div>
              </div>
            </div>
          )}

          {/* Change Password */}
          {authEnabled && (
            <div className="space-y-4">
              <p className="text-base font-medium">Change Password</p>
              <div className="max-w-sm space-y-3">
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="h-11 pr-10"
                    maxLength={128}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    className="h-11 pr-10"
                    maxLength={128}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="h-11"
                  maxLength={128}
                />
                {newPassword && confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                    <XCircle className="w-3 h-3" /> Passwords do not match
                  </p>
                )}
                {newPassword && newPassword.length < 6 && (
                  <p className="text-xs text-destructive flex items-center gap-1" role="alert">
                    <XCircle className="w-3 h-3" /> Password must be at least 6 characters
                  </p>
                )}
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 6}
                  className="gap-2"
                >
                  {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  {changingPassword ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </div>
          )}

          {/* Security Tips */}
          <div className="space-y-3 text-sm text-muted-foreground pt-2 border-t">
            <p>
              <strong className="text-foreground">RCON Security:</strong> Your RCON password is 
              stored locally and is never transmitted outside of the RCON connection to your server.
            </p>
            <p>
              <strong className="text-foreground">Admin Commands:</strong> Be careful with admin 
              commands. Some actions like banning or kicking players cannot be easily undone.
            </p>
            {!authEnabled && (
              <p>
                <strong className="text-foreground">Authentication:</strong> Authentication is not
                configured. Create an account via the setup wizard on first launch to protect access to
                this panel.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="about" className="mt-0">
      {/* About */}
      <Card id="settings-about">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-muted-foreground">
            A web-based management panel for Project Zomboid dedicated servers.
          </p>
          <p className="text-muted-foreground">
            Features include RCON integration, player management, mod update detection, 
            scheduled restarts, and more.
          </p>
          <div className="mt-6 pt-4 border-t flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Built with React, Node.js, and Socket.IO
            </span>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        </div>
      </Tabs>
    </div>
  )
}
