import { useEffect, useState, useCallback, useRef } from 'react'
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
  Trash2,
  HardDrive,
  RotateCcw,
  Settings2,
  Globe,
  RotateCw,
  Lock,
  User,
  ExternalLink
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
  ServerInstance
} from '@/lib/api'
import { useSocket } from '@/contexts/SocketContext'
import { useAuth } from '@/contexts/AuthContext'
import { BridgeStatusBadge } from '@/components/BridgeStatusBadge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AppSettings {
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

export default function Settings() {
  const socket = useSocket()
  const [settings, setSettings] = useState<AppSettings>({
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

  // Section navigation
  const settingsSections = [
    { id: 'panel', label: 'Panel', icon: Globe },
    { id: 'https', label: 'HTTPS', icon: Lock },
    { id: 'rcon', label: 'RCON', icon: Link },
    { id: 'bridge', label: 'Bridge', icon: Zap },
    { id: 'mods', label: 'Mods', icon: Clock },
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'backups', label: 'Backups', icon: Archive },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'about', label: 'About', icon: Server },
  ]
  const [activeSection, setActiveSection] = useState('panel')

  // Track visible section via IntersectionObserver
  useEffect(() => {
    const ids = settingsSections.map((s) => s.id)
    const elements = ids.map((id) => document.getElementById(`settings-${id}`)).filter(Boolean) as HTMLElement[]
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          const id = visible[0].target.id.replace('settings-', '')
          setActiveSection(id)
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])
  
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
      if (!status.updateAvailable) {
        setPanelUpdateReady(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load updater status'
      setPanelUpdateStatusError(message)
      reportClientError('Failed to fetch panel update status.', error)
    }
  }, [])

  useEffect(() => {
    fetchPanelUpdateStatus()
  }, [fetchPanelUpdateStatus])

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
      const result = await panelUpdateApi.download()
      if (!result.success) {
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

    socket.on('panel:updateAvailable', handlePanelUpdateAvailable)
    socket.on('panel:downloadProgress', handlePanelDownloadProgress)
    socket.on('panel:updateReady', handlePanelUpdateReady)

    return () => {
      socket.off('panel:updateAvailable', handlePanelUpdateAvailable)
      socket.off('panel:downloadProgress', handlePanelDownloadProgress)
      socket.off('panel:updateReady', handlePanelUpdateReady)
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
        await fetchBridgeStatus()
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
  }, [fetchBridgeStatus])

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

  const handlePingMod = async () => {
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
  const watchedBridgeFolder = bridgeStatus?.bridgePath
    || (selectedInstallServer?.zomboidDataPath
      ? `${selectedInstallServer.zomboidDataPath}${sep}panelbridge${sep}${selectedInstallServer.serverName}`
      : null)

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
      <div className="flex items-center justify-center h-[60vh]">
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
        description="Manage panel network, updates, integrations, backups, and security."
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

      <div className="mt-6 flex gap-8">
        {/* Sidebar nav — hidden on small screens */}
        <nav className="hidden lg:block w-44 shrink-0">
          <div className="sticky top-20 space-y-0.5">
            {settingsSections.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  onClick={() => {
                    document.getElementById(`settings-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className={cn(
                    'flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm transition-colors text-left',
                    activeSection === section.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {section.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-5">

      {/* Panel Settings */}
      <Card id="settings-panel">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="w-4 h-4 text-primary" />
            Panel Settings
          </CardTitle>
          <CardDescription>Configure core panel behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Label>Panel Port</Label>
            <Input
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
              <p className="text-sm font-medium">Remote Access (CORS)</p>
              <p className="text-xs text-muted-foreground">
                If you open the panel from another machine or public hostname, add that origin here.
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
                <p className="text-xs text-muted-foreground">Accept localhost, 192.168.x.x, 10.x.x.x, 100.x.x.x, and 172.16-31.x.x origins automatically.</p>
              </div>
              <Switch
                checked={settings.corsAllowPrivateNetworks}
                onCheckedChange={(value) => updateSetting('corsAllowPrivateNetworks', value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Additional Allowed Origins</Label>
              <Textarea
                value={settings.corsAllowedOrigins}
                onChange={(e) => updateSetting('corsAllowedOrigins', e.target.value)}
                placeholder={'http://123.45.67.89:3001\nhttps://panel.example.com'}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Enter full origins only (scheme + host + optional port). One origin per line.
              </p>
              {corsOriginValidationError && (
                <p className="text-xs text-destructive">{corsOriginValidationError}</p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div>
                <Label className="text-sm font-medium text-warning">Allow All Origins (Debug Only)</Label>
                <p className="text-xs text-muted-foreground">Temporarily disable origin checks to confirm whether CORS is the blocker.</p>
              </div>
              <Switch
                checked={settings.corsAllowAll}
                onCheckedChange={(value) => updateSetting('corsAllowAll', value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/25 p-3">
              <div>
                <Label className="text-sm font-medium">Enable CORS Debug Logging</Label>
                <p className="text-xs text-muted-foreground">Store recent blocked origins so you can see exactly what the browser sent.</p>
              </div>
              <Switch
                checked={settings.corsDebug}
                onCheckedChange={(value) => updateSetting('corsDebug', value)}
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
                disabled={!panelUpdateStatus?.updateAvailable || checkingPanelUpdate || downloadingPanelUpdate || restarting}
                className="gap-2"
              >
                {downloadingPanelUpdate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {downloadingPanelUpdate ? 'Downloading...' : 'Download Update'}
              </Button>

              <Button
                variant="warning"
                onClick={() => restartPanelWithReconnect('Applying downloaded update. Restarting panel...')}
                disabled={!panelUpdateReady || restarting || isDirty || downloadingPanelUpdate || Boolean(panelUpdateStatus?.isDownloading)}
                className="gap-2"
              >
                {restarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                Restart and Apply Update
              </Button>

              {panelUpdateStatus?.releaseUrl && (
                <Button asChild variant="ghost" className="gap-2">
                  <a href={panelUpdateStatus.releaseUrl} target="_blank" rel="noopener noreferrer" className="max-w-full truncate" title={panelUpdateStatus.releaseUrl}>
                    <ExternalLink className="h-4 w-4" />
                    View Release Notes
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

      {/* HTTPS Settings */}
      <Card id="settings-https">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="w-4 h-4 text-primary" />
            HTTPS
          </CardTitle>
          <CardDescription>Secure panel access with TLS.</CardDescription>
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
                <Label>HTTPS Port</Label>
                <Input
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
                <Label>Custom Certificate Path <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  value={settings.httpsCertPath}
                  onChange={(e) => updateSetting('httpsCertPath', e.target.value)}
                  placeholder="Example: C:\\certs\\panel.fullchain.pem"
                  maxLength={260}
                />
                <p className="text-xs text-muted-foreground mt-1">Set both certificate and key paths, or leave both empty.</p>
              </div>
              <div className="max-w-md">
                <Label>Custom Key Path <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
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

      {/* RCON Settings */}
      <Card id="settings-rcon">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link className="w-4 h-4 text-primary" />
            RCON Connection
          </CardTitle>
          <CardDescription>RCON settings are configured per-server in the Servers page</CardDescription>
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
              />
              <Label>Auto-reconnect on disconnect</Label>
            </div>
          </div>
          {settings.autoReconnect && (
            <div className="max-w-xs">
              <Label>Reconnect Interval (seconds)</Label>
              <Input
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

      {/* Panel Bridge - Advanced Features */}
      <Card id="settings-bridge">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="w-4 h-4 text-primary" />
                Panel Bridge
              </CardTitle>
              <CardDescription>Connects this panel to the live game for weather, utilities, richer chat, and other in-world actions</CardDescription>
            </div>
            {bridgeStatus && (
              <BridgeStatusBadge
                connected={bridgeStatus.modConnected}
                running={bridgeStatus.isRunning}
                loading={bridgeLoading}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-border/60 bg-muted/40">
            <Zap className="h-4 w-4 text-primary" />
            <AlertTitle>What Panel Bridge does</AlertTitle>
            <AlertDescription className="space-y-3 text-sm text-muted-foreground">
              <p>
                Panel Bridge has two pieces that must meet in the middle: the panel runs a local watcher, and your Project Zomboid server runs <strong className="text-foreground">PanelBridge.lua</strong> inside the game.
              </p>
              <p className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-foreground">
                Before starting the server, set <strong className="text-foreground">LuaChecksum=false</strong> in your server INI. PanelBridge commands can fail when Lua checksum is enabled.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                  <p className="text-sm font-semibold text-foreground">1. Install the Lua file</p>
                  <p className="mt-2 text-sm text-foreground">Copy <strong>PanelBridge.lua</strong> into the server install folder.</p>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {selectedInstallTarget || 'Select a server below to see the exact install path.'}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                  <p className="text-sm font-semibold text-foreground">2. Run Auto Setup</p>
                  <p className="mt-2 text-sm text-foreground">Tell the panel which server data folder to watch.</p>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {watchedBridgeFolder || 'When configured, the panel watches the panelbridge folder for your selected server.'}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                  <p className="text-sm font-semibold text-foreground">3. Start the server</p>
                  <p className="mt-2 text-sm text-foreground">When the game loads the mod, the status changes from Waiting to Connected.</p>
                  <p className="mt-2 text-xs text-muted-foreground">Connected means the Lua mod is alive in-game and ready to answer advanced commands.</p>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-muted/25 p-3">
              <p className="text-sm font-semibold text-foreground">Not running</p>
              <p className="mt-2 text-sm text-foreground">The panel watcher is not started yet.</p>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning/8 p-3">
              <p className="text-sm font-semibold text-warning">Waiting</p>
              <p className="mt-2 text-sm text-foreground">The panel is watching the folder, but the PZ server has not loaded the mod yet.</p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/8 p-3">
              <p className="text-sm font-semibold text-primary">Connected</p>
              <p className="mt-2 text-sm text-foreground">The panel watcher and the in-game Lua mod can now exchange commands and status.</p>
            </div>
          </div>

          {/* Status Display - when connected */}
          {bridgeStatus?.modConnected && bridgeStatus.modStatus && (
            <Alert className="border-primary/30 bg-primary/10">
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

          {/* Not running - show auto-setup button */}
          {!bridgeStatus?.isRunning && (
            <div className="p-4 bg-muted rounded-xl space-y-4">
              <p className="text-sm text-muted-foreground">
                Start with <strong className="text-foreground">Auto Setup</strong>. It points the panel at the correct server data folder and starts the bridge watcher for the active server.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button 
                  onClick={() => handleAutoConfigure()} 
                  disabled={bridgeLoading}
                  className="gap-2"
                >
                  {bridgeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Auto Setup
                </Button>
                <p className="text-xs text-muted-foreground self-center">
                  Best first step after installing the Lua file
                </p>
              </div>
            </div>
          )}

          {/* Waiting for mod */}
          {bridgeStatus?.isRunning && !bridgeStatus?.modConnected && (
            <Alert className="border-warning/40 bg-warning/10">
              <Cloud className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Waiting for PZ mod to respond</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>The panel side is ready. Now start the Project Zomboid server with PanelBridge.lua installed and enabled in the server mod list.</p>
                <p>Make sure <strong className="text-foreground">LuaChecksum=false</strong> is set in the server INI before startup.</p>
                {bridgeStatus?.bridgePath && (
                  <p className="text-xs text-muted-foreground break-words">
                    Watching folder: <code className="rounded bg-background px-1 break-all">{bridgeStatus.bridgePath}</code>
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Error display */}
          {bridgeError && (
            <Alert variant="destructive">
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
                disabled={!bridgeStatus?.modConnected}
              >
                <RefreshCw className="w-4 h-4" />
                Ping Mod
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

          {/* Install Mod Section */}
          <div className="p-4 bg-muted rounded-xl space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Install PanelBridge.lua</p>
              <p className="text-xs text-muted-foreground">
                This copies the Lua file into your game server install so Project Zomboid can load it on startup.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={selectedInstallServerId} onValueChange={setSelectedInstallServerId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select server..." />
                </SelectTrigger>
                <SelectContent>
                  {servers.map((server) => (
                    <SelectItem key={String(server.id)} value={String(server.id)}>
                      {server.name} {server.isActive ? '(Active)' : ''}
                    </SelectItem>
                  ))}
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
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                Copies PanelBridge.lua to <code className="bg-background px-1 rounded">media/lua/server/</code> in the selected server's install folder.
              </p>
              <p className="break-all">
                Exact destination: <code className="bg-background px-1 rounded">{selectedInstallTarget || 'Select a server to see the destination path.'}</code>
              </p>
              <p>
                After copying the file, start Auto Setup and then restart the PZ server so the mod can load.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mod Update Settings */}
      <Card id="settings-mods">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" />
              Mod Update Settings
            </CardTitle>
          </div>
          <CardDescription>Configure automatic mod update checking and server restarts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-xs space-y-2">
            <Label className="text-base">Check Interval (minutes)</Label>
            <Input
              type="number"
              value={settings.modCheckInterval}
              onChange={(e) => updateSetting('modCheckInterval', e.target.value)}
              min="5"
              max="120"
              className="h-11"
            />
            <p className="text-sm text-muted-foreground">
              How often to check Steam Workshop for mod updates
            </p>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
            <Switch
              checked={settings.modAutoRestart}
              onCheckedChange={(value) => updateSetting('modAutoRestart', value)}
            />
            <div>
              <Label className="text-base">Auto-restart server when mods update</Label>
              <p className="text-sm text-muted-foreground">Automatically restart the server when mod updates are detected</p>
            </div>
          </div>
          {settings.modAutoRestart && (
            <div className="max-w-xs space-y-2 pl-4 border-l-2 border-primary/30">
              <Label className="text-base">Restart Delay (minutes)</Label>
              <Input
                type="number"
                value={settings.modRestartDelay}
                onChange={(e) => updateSetting('modRestartDelay', e.target.value)}
                min="1"
                max="30"
                className="h-11"
              />
              <p className="text-sm text-muted-foreground">
                Warning time before restart (players will be notified)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card id="settings-api-keys">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="w-4 h-4 text-primary" />
            API Keys
          </CardTitle>
          <CardDescription>Configure API keys for external services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="text-base">Steam Web API Key</Label>
            <div className="relative max-w-md">
              <Input
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                <li>Go to <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Steam API Key Registration</a></li>
                <li>Log in with your Steam account</li>
                <li>Enter a domain name (can be "localhost" for personal use)</li>
                <li>Copy the key and paste it here</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* World Backups */}
      <Card id="settings-backups">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Archive className="w-4 h-4 text-primary" />
                World Backups
              </CardTitle>
              <CardDescription>Backup your server world data on a schedule</CardDescription>
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
              />
            </div>

            {backupStatus?.enabled && (
              <div className="grid grid-cols-1 gap-4 border-l-2 border-primary/20 pl-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="backup-schedule">Schedule (Cron)</Label>
                  <Input
                    id="backup-schedule"
                    value={backupSchedule}
                    onChange={(e) => setBackupSchedule(e.target.value)}
                    placeholder="0 */6 * * *"
                    className="font-mono"
                    maxLength={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: Every 6 hours. Format: minute hour day month weekday
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
                    Oldest backups will be deleted when limit is reached
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
          {backups.length > 0 && (
            <div className="space-y-2">
              <Label className="text-base">Existing Backups</Label>
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
            </div>
          )}

          {/* Path Info */}
          {backupStatus?.savesPath && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Saves:</strong> {backupStatus.savesPath}</p>
              <p><strong>Backups:</strong> {backupStatus.backupsPath}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security & Authentication */}
      <Card id="settings-security">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="w-4 h-4 text-primary" />
            Security & Authentication
          </CardTitle>
          <CardDescription>Manage your account and view security information</CardDescription>
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
              <Label className="text-base font-medium">Change Password</Label>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Passwords do not match
                  </p>
                )}
                {newPassword && newPassword.length > 0 && newPassword.length < 6 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
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

      {/* About */}
      <Card id="settings-about">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="w-4 h-4 text-primary" />
            About PZ Server Panel
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
        </div>
      </div>
    </div>
  )
}
