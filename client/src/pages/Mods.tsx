import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { 
  Package, 
  RefreshCw, 
  Plus, 
  Trash2, 
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Map as MapIcon,
  Library,
  Search,
  Filter,
  Settings2,
  ChevronRight,
  Check,
  Info,
  Layers,
  Save,
  FolderOpen,
  Loader2,
  GripVertical,
  MoreVertical,
  Shield,
  ShieldAlert,
  FileWarning,
  Wrench,
  Network,
  GitBranch,
  PlusCircle,
  X,
} from 'lucide-react'
import { ConflictScanResult, ScanStreamModScanned, ScanStreamConflictFound } from '@/types'
import { FileDiffViewer } from '@/components/FileDiffViewer'
import { getAccessToken } from '@/lib/authToken'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { reportClientError, reportClientWarning } from '@/lib/client-errors'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { modsApi } from '@/lib/api'
import { EmptyState } from '@/components/EmptyState'
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
} from '@/components/ui/alert-dialog'

interface TrackedMod {
  id: number
  workshop_id: string
  name: string
  last_updated: string
  last_checked: string | null
  update_available: number
  created_at: string
  active?: boolean
}

interface ModStatus {
  totalModsTracked: number
  totalModsInWorkshop: number
  updatesAvailable: number
  lastCheck: string | null
  lastUpdateDetected: string | null
  autoRestartEnabled: boolean
  running: boolean
  workshopAcfConfigured: boolean
  workshopAcfPath: string | null
  checkInterval: number
  modsNeedingUpdate: Array<{
    workshopId: string
    name: string
    localTimestamp: string
    latestTimestamp: string
  }>
  // Restart options
  restartWarningMinutes: number
  delayIfPlayersOnline: boolean
  maxDelayMinutes: number
  pendingRestart: boolean
}

interface CollectionMod {
  workshopId: string
  name: string
  description?: string
  tags?: string[]
  isMap: boolean
  modId?: string
  mapFolder?: string
  selected?: boolean
}

interface IniConfig {
  configured: boolean
  modIds: string[]
  workshopIds: string[]
  maps: string[]
  totalMods: number
  iniPath?: string
  error?: string
  workshopModMap?: Record<string, Array<{ id: string; name: string; enabled: boolean }>>
}

// ── Conflict scanner constants (hoisted to avoid re-creation in render) ──
const CONFLICT_FILE_LIMIT = 50

export default function Mods() {
  const [mods, setMods] = useState<TrackedMod[]>([])
  const [status, setStatus] = useState<ModStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const { toast } = useToast()

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('')
  const [showUpdatesOnly, setShowUpdatesOnly] = useState(false)
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set())

  // Advanced Add Mod dialog (with multi-ID selection)
  const [advancedAddOpen, setAdvancedAddOpen] = useState(false)
  const [advancedModInput, setAdvancedModInput] = useState('')
  const [discoveringMod, setDiscoveringMod] = useState(false)
  const [showAdvancedIdSelection, setShowAdvancedIdSelection] = useState(false)
  const [discoveredMod, setDiscoveredMod] = useState<{
    workshopId: string
    name: string
    description: string | null
    modIds: string[]
    hasMultipleModIds: boolean
    isMap: boolean
    mapFolders: string[]
    isDownloaded: boolean
    tags: string[]
    alreadyConfigured?: string[]
    isAlreadyAdded?: boolean
  } | null>(null)
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(new Set())
  
  // Collection import
  const [collectionUrl, setCollectionUrl] = useState('')
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false)
  const [collectionMods, setCollectionMods] = useState<CollectionMod[]>([])
  const [importingCollection, setImportingCollection] = useState(false)
  const [showCollectionAdvanced, setShowCollectionAdvanced] = useState(false)
  
  // INI configuration
  const [iniConfig, setIniConfig] = useState<IniConfig | null>(null)
  const [modsToInstall, setModsToInstall] = useState<CollectionMod[]>([])
  const [orderedModIds, setOrderedModIds] = useState<string[]>([])
  const [savingModOrder, setSavingModOrder] = useState(false)
  const [draggedModIndex, setDraggedModIndex] = useState<number | null>(null)  
  // Expand/collapse states
  const [repairingMaps, setRepairingMaps] = useState(false)
  const [mapRepairResult, setMapRepairResult] = useState<{ removed: string[]; added?: string[]; remaining: string[]; message: string } | null>(null)
  const [confirmRemoveMod, setConfirmRemoveMod] = useState<string | null>(null) // workshopId to confirm single remove
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false)
  const [confirmRemoveWorkshop, setConfirmRemoveWorkshop] = useState<string | null>(null) // wsId for config tab remove
  const [deduplicating, setDeduplicating] = useState(false)
  const [deduplicateResult, setDeduplicateResult] = useState<string | null>(null)
  const [filterMultiId, setFilterMultiId] = useState(true)
  const [modManagerSearch, setModManagerSearch] = useState('')
  const [configSubTab, setConfigSubTab] = useState<'active' | 'order' | 'add' | 'presets' | 'tools'>('active')
  const [lastSavedMod, setLastSavedMod] = useState<string | null>(null)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Restart settings dialog
  const [restartSettingsOpen, setRestartSettingsOpen] = useState(false)
  const [restartWarningMinutes, setRestartWarningMinutes] = useState(5)
  const [delayIfPlayersOnline, setDelayIfPlayersOnline] = useState(false)
  const [maxDelayMinutes, setMaxDelayMinutes] = useState(30)
  
  // Conflict scanner
  const [conflicts, setConflicts] = useState<ConflictScanResult | null>(null)
  const [conflictsLoading, setConflictsLoading] = useState(false)
  const [conflictsError, setConflictsError] = useState<string | null>(null)
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null)
  const [scanIniSnapshot, setScanIniSnapshot] = useState<string | null>(null)
  const [openPairs, setOpenPairs] = useState<string[]>([])
  // SSE streaming scan state
  const [scanProgress, setScanProgress] = useState(0)
  const [scanCurrentMod, setScanCurrentMod] = useState<string | null>(null)
  const [scanModsScanned, setScanModsScanned] = useState(0)
  const [scanTotalMods, setScanTotalMods] = useState(0)
  const [streamConflicts, setStreamConflicts] = useState<ScanStreamConflictFound[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)
  const closingIntentionallyRef = useRef(false)
  const sseIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Batched scan-progress ref — flush via rAF to coalesce rapid SSE updates into 1 render
  const scanBatchRef = useRef<{ progress: number; modName: string | null; modsScanned: number; dirty: boolean; raf: number }>({ progress: 0, modName: null, modsScanned: 0, dirty: false, raf: 0 })

  // Inner sub-tab within Conflicts: 'network' or 'dependencies'
  const [conflictSubTab, setConflictSubTab] = useState<'network' | 'dependencies'>('network')
  // Severity filter for pairs list: 'all' | 'high' | 'medium' | 'low'
  const [pairSeverityFilter, setPairSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  // Graph filter state (used for pair filtering in the conflict list)
  const [graphFilterMod, setGraphFilterMod] = useState<string | null>(null)

  // Track which conflict pairs have "show all files" expanded
  const [expandedFilePairs, setExpandedFilePairs] = useState<Set<string>>(new Set())
  // Missing deps state
  const [depAdding, setDepAdding] = useState<string[]>([])
  const [depAddResults, setDepAddResults] = useState<Record<string, 'added' | 'error'>>({})
  const [fixingAllDeps, setFixingAllDeps] = useState(false)
  // Clean up SSE connection on unmount or page navigation
  useEffect(() => {
    return () => {
      closingIntentionallyRef.current = true
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      if (sseIdleTimerRef.current) clearTimeout(sseIdleTimerRef.current)
      sseIdleTimerRef.current = null
    }
  }, [])

  // Detect stale conflict results when INI config changes
  const conflictsStale = useMemo(() => {
    if (!conflicts || !scanIniSnapshot) return false
    const currentSnapshot = JSON.stringify({
      ws: iniConfig?.workshopIds?.slice().sort() || [],
      mods: iniConfig?.modIds?.slice().sort() || []
    })
    return currentSnapshot !== scanIniSnapshot
  }, [conflicts, scanIniSnapshot, iniConfig?.workshopIds, iniConfig?.modIds])
  
  // Track if auto-discover is pending (moved here for cleanup)
  const autoDiscoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutoDiscoverIdRef = useRef<string | null>(null)
  
  // Mod Presets
  interface ModPreset {
    id: number
    name: string
    description: string
    workshopIds: string[]
    modIds: string[]
    created_at: string
    updated_at: string
  }
  const [presets, setPresets] = useState<ModPreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [savePresetOpen, setSavePresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetDescription, setPresetDescription] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const [applyingPreset, setApplyingPreset] = useState<number | null>(null)
  
  // Mod conflict detection
  interface ModConflict {
    type: 'duplicate' | 'missing_modid' | 'outdated_dependency'
    severity: 'warning' | 'info'
    message: string
    modIds?: string[]
  }
  
  // Detect conflicts in current configuration
  const detectedConflicts = useMemo((): ModConflict[] => {
    if (!iniConfig?.configured) return []
    const conflicts: ModConflict[] = []
    
    // Check for duplicate mod IDs
    const modIdCounts: Record<string, number> = {}
    for (const modId of iniConfig.modIds) {
      modIdCounts[modId] = (modIdCounts[modId] || 0) + 1
    }
    const duplicates = Object.entries(modIdCounts).filter(([, count]) => count > 1)
    if (duplicates.length > 0) {
      conflicts.push({
        type: 'duplicate',
        severity: 'warning',
        message: `Duplicate mod IDs found: ${duplicates.map(([id]) => id).join(', ')}`,
        modIds: duplicates.map(([id]) => id)
      })
    }
    
    // Check for workshop items without corresponding mod IDs
    // This is normal for mods not yet downloaded, so just info level
    const workshopCount = iniConfig.workshopIds?.length || 0
    const modIdCount = iniConfig.modIds?.length || 0
    if (workshopCount > 0 && modIdCount === 0) {
      conflicts.push({
        type: 'missing_modid',
        severity: 'warning',
        message: `${workshopCount} workshop items configured but no mod IDs. Run "Sync Mod IDs" after downloading mods.`,
      })
    }
    
    return conflicts
  }, [iniConfig])
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (autoDiscoverTimeoutRef.current) {
        clearTimeout(autoDiscoverTimeoutRef.current)
      }
      // Cancel any in-flight conflict scan
      eventSourceRef.current?.close()
    }
  }, [])

  const fetchData = useCallback(async () => {
    setFetchError(null)
    try {
      // Use allSettled so one failure doesn't break everything
      const results = await Promise.allSettled([
        modsApi.getTrackedMods(),
        modsApi.getStatus(),
        modsApi.getCurrentConfig()
      ])
      
      // Extract successful results
      if (results[0].status === 'fulfilled') {
        setMods(results[0].value.mods || [])
      }
      if (results[1].status === 'fulfilled') {
        const statusData = results[1].value
        setStatus(statusData)
        // Update restart settings from status
        if (statusData) {
          setRestartWarningMinutes(statusData.restartWarningMinutes || 5)
          setDelayIfPlayersOnline(statusData.delayIfPlayersOnline || false)
          setMaxDelayMinutes(statusData.maxDelayMinutes || 30)
        }
      }
      if (results[2].status === 'fulfilled') {
        setIniConfig(results[2].value)
        // Initialize ordered mod IDs when iniConfig is loaded
        if (results[2].value?.modIds) {
          setOrderedModIds(results[2].value.modIds)
        }
      }
      
      // Check for failures and show persistent error
      const failures = results.filter(r => r.status === 'rejected')
      if (failures.length > 0) {
        failures.forEach((result, index) => {
          reportClientError(`Failed to fetch mods data (index ${index}).`, (result as PromiseRejectedResult).reason)
        })
        if (failures.length === results.length) {
          setFetchError('Failed to load mod data. The backend may be unreachable.')
        }
      }
    } catch (error) {
      reportClientError('Failed to fetch mods data.', error)
      setFetchError('Failed to load mod data. The backend may be unreachable.')
    }
  }, [])

  // Fetch mod presets
  const fetchPresets = useCallback(async () => {
    setPresetsLoading(true)
    try {
      const data = await modsApi.getPresets()
      setPresets(data.presets || [])
    } catch (error) {
      reportClientError('Failed to fetch presets.', error)
      setFetchError('Failed to load presets')
    } finally {
      setPresetsLoading(false)
    }
  }, [])
  
  // Initial data fetch + auto sync from server
  useEffect(() => {
    const initializeData = async () => {
      await Promise.allSettled([fetchData(), fetchPresets()])
      // Load cached conflict scan results (if any) so the Conflicts tab isn't blank
      try {
        const cached = await modsApi.getCachedConflicts()
        if (cached) {
          setConflicts(cached)
          setConflictsError(null) // clear any stale error from a previous session
          setLastScanTime(new Date()) // approximate — exact time isn't stored
          // Set a snapshot so stale detection works when modIds change after cached load
          setScanIniSnapshot(JSON.stringify({
            ws: cached._workshopIdsSnapshot || [],
            mods: cached._modIdsSnapshot || []
          }))
          if (cached.stale) {
            // Config changed since last scan — the stale banner will show
          }
        }
      } catch { /* non-fatal — user can still trigger a fresh scan */ }
    }
    initializeData()
  }, [fetchData, fetchPresets])
  
  const handleSavePreset = async () => {
    if (!presetName.trim()) return
    setSavingPreset(true)
    try {
      await modsApi.createPreset(presetName.trim(), presetDescription.trim())
      toast({
        title: 'Preset Saved',
        description: `Mod preset "${presetName}" has been saved`,
        variant: 'success' as const,
      })
      setSavePresetOpen(false)
      setPresetName('')
      setPresetDescription('')
      fetchPresets()
    } catch (error) {
      toast({
        title: 'Preset save failed',
        description: error instanceof Error ? error.message : 'Failed to save preset',
        variant: 'destructive',
      })
    } finally {
      setSavingPreset(false)
    }
  }
  
  const handleApplyPreset = async (id: number, _name: string) => {
    setApplyingPreset(id)
    try {
      const result = await modsApi.applyPreset(id)
      toast({
        title: 'Preset Applied',
        description: result.message,
        variant: 'success' as const,
      })
      fetchData() // Refresh current config
    } catch (error) {
      toast({
        title: 'Preset apply failed',
        description: error instanceof Error ? error.message : 'Failed to apply preset',
        variant: 'destructive',
      })
    } finally {
      setApplyingPreset(null)
    }
  }
  
  const handleDeletePreset = async (id: number, name: string) => {
    try {
      await modsApi.deletePreset(id)
      toast({
        title: 'Preset Deleted',
        description: `Preset "${name}" has been deleted`,
        variant: 'success' as const,
      })
      fetchPresets()
    } catch (error) {
      toast({
        title: 'Preset delete failed',
        description: error instanceof Error ? error.message : 'Failed to delete preset',
        variant: 'destructive',
      })
    }
  }

  // Filtered mods based on search and filters
  const filteredMods = useMemo(() => {
    let result = [...mods]
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(m => 
        m.name?.toLowerCase().includes(query) || 
        m.workshop_id.includes(query)
      )
    }
    
    if (showUpdatesOnly) {
      result = result.filter(m => m.update_available)
    }
    
    return result.sort((a, b) => {
      if (a.update_available !== b.update_available) {
        return b.update_available - a.update_available
      }
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [mods, searchQuery, showUpdatesOnly])

  const handleCheckUpdates = async () => {
    setChecking(true)
    try {
      const result = await modsApi.checkUpdates()
      toast({
        title: 'Updates Checked',
        description: `${result.updatesFound || 0} mod(s) have updates available`,
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Update check failed',
        description: error instanceof Error ? error.message : 'Failed to check updates',
        variant: 'destructive',
      })
    } finally {
      setChecking(false)
    }
  }

  // Parse workshop ID from input (URL or ID)
  const parseWorkshopId = (input: string): string | null => {
    const trimmed = input.trim()
    if (!trimmed) return null
    
    // Try to extract from URL patterns
    const urlMatch = trimmed.match(/id=(\d+)/)
    if (urlMatch) return urlMatch[1]
    
    // Try direct numeric ID
    const numericMatch = trimmed.match(/^(\d{6,15})$/)
    if (numericMatch) return numericMatch[1]
    
    return null
  }

  const discoverWorkshopMod = useCallback(async (workshopId: string) => {
    // Prevent double-triggering
    if (discoveringMod) return
    
    // Check if already configured
    if (iniConfig?.workshopIds?.includes(workshopId)) {
      toast({
        title: 'Already Added',
        description: 'This mod is already in your server configuration',
        variant: 'default',
      })
    }
    
    setDiscoveringMod(true)
    setDiscoveredMod(null)
    setSelectedModIds(new Set())
    
    try {
      const result = await modsApi.discoverModIds(workshopId)
      
      // Filter out duplicate mod IDs (case-insensitive)
      const seenIds = new Set<string>()
      const uniqueModIds = result.modIds.filter(id => {
        const lower = id.toLowerCase()
        if (seenIds.has(lower)) return false
        seenIds.add(lower)
        return true
      })
      
      // Check which mod IDs are already in config
      const alreadyConfigured = uniqueModIds.filter(id => 
        iniConfig?.modIds?.includes(id)
      )
      
      const newResult = {
        ...result,
        modIds: uniqueModIds,
        hasMultipleModIds: uniqueModIds.length > 1,
        alreadyConfigured,
        isAlreadyAdded: iniConfig?.workshopIds?.includes(workshopId) || false,
      }
      
      setDiscoveredMod(newResult)
      
      // Pre-select only NEW mod IDs (not already configured)
      const newModIds = uniqueModIds.filter(id => !alreadyConfigured.includes(id))
      setSelectedModIds(new Set(newModIds))
      
      if (uniqueModIds.length === 0) {
        toast({
          title: 'No Mod IDs Found',
          description: result.isDownloaded 
            ? 'Mod is downloaded but no mod.info files found'
            : 'Mod not yet downloaded. Add it anyway and sync after the server downloads it.',
          variant: 'default',
        })
      } else if (alreadyConfigured.length > 0 && alreadyConfigured.length === uniqueModIds.length) {
        toast({
          title: 'Already Configured',
          description: 'All mod IDs from this workshop item are already in your server config',
          variant: 'default',
        })
      } else if (newResult.hasMultipleModIds) {
        toast({
          title: 'Multiple Mod IDs Found',
          description: `Found ${uniqueModIds.length} mod IDs. ${newModIds.length} new, ${alreadyConfigured.length} already configured.`,
        })
      }
    } catch (error) {
      toast({
        title: 'Discovery Failed',
        description: error instanceof Error ? error.message : 'Failed to discover mod IDs. Check the Workshop ID and try again.',
        variant: 'destructive',
      })
    } finally {
      setDiscoveringMod(false)
    }
  }, [discoveringMod, iniConfig?.modIds, iniConfig?.workshopIds, toast])

  // Auto-discover on paste (debounced)
  const handleModInputChange = useCallback((value: string) => {
    setAdvancedModInput(value)
    
    if (autoDiscoverTimeoutRef.current) {
      clearTimeout(autoDiscoverTimeoutRef.current)
      autoDiscoverTimeoutRef.current = null
    }
    
    if (value.includes('steamcommunity.com') && value.includes('id=')) {
      const workshopId = parseWorkshopId(value)
      
      if (workshopId && workshopId !== lastAutoDiscoverIdRef.current) {
        lastAutoDiscoverIdRef.current = workshopId
        autoDiscoverTimeoutRef.current = setTimeout(() => {
          void discoverWorkshopMod(workshopId)
        }, 200)
      }
    }
  }, [discoverWorkshopMod])

  // Discover mod IDs from workshop URL/ID
  const handleDiscoverMod = async () => {
    const workshopId = parseWorkshopId(advancedModInput)
    
    if (!workshopId) {
      toast({
        title: 'Invalid Workshop URL',
        description: 'Enter a Workshop URL or numeric ID. Example: 3616536783',
        variant: 'destructive',
      })
      return
    }

    await discoverWorkshopMod(workshopId)
  }
  
  // Add mod with selected mod IDs
  const handleAddModAdvanced = async () => {
    if (!discoveredMod) return
    
    setLoading(true)
    try {
      const modIdsArray = Array.from(selectedModIds)
      
      // Track the mod first
      await modsApi.trackMod(discoveredMod.workshopId)
      
      // Add with selected mod IDs
      const result = await modsApi.addModAdvanced(
        discoveredMod.workshopId,
        modIdsArray.length > 0 ? modIdsArray : undefined,
        modIdsArray.length === 0 // If no mod IDs selected, try to include all
      )
      
      if (result.addedModIds.length > 0) {
        toast({
          title: 'Mod added to server config',
          description: `${result.addedModIds.join(', ')} written to .ini.${result.mapFoldersAdded.length > 0 
            ? ` Map${result.mapFoldersAdded.length !== 1 ? 's' : ''}: ${result.mapFoldersAdded.join(', ')}.` 
            : ''} Restart the server to load it.`,
          variant: 'success' as const,
        })
      } else if (result.workshopAlreadyExisted) {
        toast({
          title: 'Already configured',
          description: 'This mod is already in your server .ini file.',
        })
      } else {
        toast({
          title: 'Workshop ID added',
          description: 'Added to .ini. Mod IDs will be discovered after the server downloads the files.',
        })
      }
      
      // Reset and close
      setAdvancedModInput('')
      setDiscoveredMod(null)
      setSelectedModIds(new Set())
      setAdvancedAddOpen(false)
      fetchData()
    } catch (error) {
      toast({
        title: 'Add mod failed',
        description: error instanceof Error ? error.message : 'Failed to add mod',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }
  
  // Toggle mod ID selection
  const toggleModIdSelection = (modId: string) => {
    setSelectedModIds(prev => {
      const next = new Set(prev)
      if (next.has(modId)) {
        next.delete(modId)
      } else {
        next.add(modId)
      }
      return next
    })
  }
  const handleRemoveMod = async (workshopId: string) => {
    setLoading(true)
    try {
      // Remove from tracking
      await modsApi.untrackMod(workshopId)
      
      // Also remove from server .ini file
      try {
        await modsApi.removeFromIni(workshopId)
      } catch (iniError) {
        reportClientWarning('Could not remove mod from INI.', iniError)
      }
      
      toast({
        title: 'Mod removed',
        description: 'Removed from tracking and server config.',
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Remove failed',
        description: error instanceof Error ? error.message : 'Failed to remove mod',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBulkRemove = async () => {
    if (selectedMods.size === 0) return
    
    setLoading(true)
    const workshopIds = Array.from(selectedMods)
    
    try {
      const results = await Promise.allSettled(workshopIds.map(async (workshopId) => {
        await modsApi.untrackMod(workshopId)
        try {
          await modsApi.removeFromIni(workshopId)
        } catch (iniError) {
          reportClientWarning('Could not remove mod from INI.', iniError)
        }
        return workshopId
      }))

      const successes = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map(result => result.value)
      const failures = results
        .map((result, index) => ({ result, workshopId: workshopIds[index] }))
        .filter((entry): entry is { result: PromiseRejectedResult; workshopId: string } => entry.result.status === 'rejected')
        .map((entry) => {
          reportClientError(`Failed to remove mod ${entry.workshopId}.`, entry.result.reason)
          return entry.workshopId
        })
      
      if (failures.length > 0) {
        toast({
          title: 'Partial Success',
          description: `Removed ${successes.length} mods, ${failures.length} failed`,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Success',
          description: `Removed ${successes.length} mods from tracking and server config`,
        })
      }
      setSelectedMods(new Set())
      fetchData()
    } catch (error) {
      toast({
        title: 'Remove failed',
        description: error instanceof Error ? error.message : 'Failed to remove mods',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleToggleAutoRestart = async () => {
    setLoading(true)
    try {
      await modsApi.setAutoRestart(!status?.autoRestartEnabled)
      toast({
        title: `Auto-restart ${status?.autoRestartEnabled ? 'disabled' : 'enabled'}`,
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Setting update failed',
        description: error instanceof Error ? error.message : 'Failed to update setting',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSyncFromServer = async () => {
    setLoading(true)
    try {
      const result = await modsApi.syncFromServer()
      toast({
        title: 'Mods synced',
        description: `Synced ${result.synced || 0} mods from server configuration.`,
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Failed to sync mods',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClearUpdates = async () => {
    setLoading(true)
    try {
      await modsApi.clearUpdates()
      toast({
        title: 'Update flags cleared',
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Clear failed',
        description: error instanceof Error ? error.message : 'Failed to clear updates',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleImportCollection = async () => {
    if (!collectionUrl) {
      toast({
        title: 'No URL entered',
        description: 'Paste a Steam Workshop collection URL or numeric ID to import.',
        variant: 'destructive',
      })
      return
    }

    setImportingCollection(true)
    try {
      const result = await modsApi.importCollection(collectionUrl)
      setCollectionMods(result.mods.map((m: CollectionMod) => ({
        ...m,
        selected: true,
        modId: m.workshopId,
        mapFolder: m.isMap ? m.name.replace(/\s+/g, '') : undefined
      })))
      
      toast({
        title: `${result.mods.length} mods found`,
        description: 'Select which mods to add, then confirm.',
      })
    } catch (error) {
      toast({
        title: 'Collection import failed',
        description: error instanceof Error ? error.message : 'Could not fetch collection from Steam. Check the URL and try again.',
        variant: 'destructive',
      })
    } finally {
      setImportingCollection(false)
    }
  }

  const toggleModSelection = (workshopId: string) => {
    setCollectionMods(prev => prev.map(m => 
      m.workshopId === workshopId ? { ...m, selected: !m.selected } : m
    ))
  }

  const updateModId = (workshopId: string, modId: string) => {
    setCollectionMods(prev => prev.map(m => 
      m.workshopId === workshopId ? { ...m, modId } : m
    ))
  }

  const updateMapFolder = (workshopId: string, mapFolder: string) => {
    setCollectionMods(prev => prev.map(m => 
      m.workshopId === workshopId ? { ...m, mapFolder } : m
    ))
  }

  const handleAddCollectionMods = async () => {
    const selectedModsList = collectionMods.filter(m => m.selected)
    
    if (selectedModsList.length === 0) {
      toast({
        title: 'No mods selected',
        description: 'Check the mods you want to add from the list above.',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    try {
      const results = await Promise.allSettled(
        selectedModsList.map(async (mod) => {
          // Write each mod directly to the server .ini (workshopId + mod IDs + map folders)
          const selectedModIds = mod.modId ? [mod.modId] : undefined
          await modsApi.addModAdvanced(
            mod.workshopId,
            selectedModIds,
            !selectedModIds // includeAllModIds when no explicit modId was set
          )
          return mod.workshopId
        })
      )

      const added = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          reportClientWarning(`Failed to add mod ${selectedModsList[index].workshopId}.`, result.reason)
        }
      })

      toast({
        title: `${added} mod${added !== 1 ? 's' : ''} added to server config`,
        description: failed > 0
          ? `${failed} failed — check the console for details`
          : 'Restart the server to load the new mods.',
        variant: failed > 0 ? 'destructive' : 'success' as const,
      })
      
      setCollectionDialogOpen(false)
      setCollectionMods([])
      setCollectionUrl('')
      fetchData()
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Could not add mods to server config. Try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleWriteToIni = async () => {
    if (modsToInstall.length === 0) {
      toast({
        title: 'Nothing to write',
        description: 'Add mods to the pending list first, then write to INI.',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    try {
      const modsData = modsToInstall.map(m => ({
        workshopId: m.workshopId,
        modId: m.modId || m.workshopId
      }))
      
      const mapFolders = modsToInstall
        .filter(m => m.isMap && m.mapFolder)
        .map(m => m.mapFolder!)
      
      const result = await modsApi.writeToIni(modsData, mapFolders)
      
      toast({
        title: 'Configuration Saved',
        description: `${result.modsConfigured} mods configured. Restart server to apply.`,
      })
      
      setModsToInstall([])
      fetchData()
    } catch (error) {
      toast({
        title: 'Write to INI failed',
        description: error instanceof Error ? error.message : 'Failed to write configuration',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Sync mod IDs from downloaded workshop mods to the Mods= line in server.ini
  const handleSyncModIds = async () => {
    setSyncing(true)
    try {
      const result = await modsApi.syncModIds()
      
      const synced = result.synced || 0
      const missing = result.missingMods?.length || 0
      
      if (synced > 0 || missing > 0) {
        toast({
          title: 'Mod IDs Synced',
          description: `${synced} mod ID(s) added to config.${missing > 0 ? ` ${missing} mod(s) not yet downloaded.` : ''}`,
        })
      } else {
        toast({
          title: 'Already Synced',
          description: 'All downloaded mods are already in the Mods= configuration.',
        })
      }
      
      // Refresh ini config display
      fetchData()
    } catch (error) {
      toast({
        title: 'Mod ID sync failed',
        description: error instanceof Error ? error.message : 'Failed to sync mod IDs',
        variant: 'destructive',
      })
    } finally {
      setSyncing(false)
    }
  }

  // Drag & drop handlers for mod load order
  const handleDragStart = (index: number) => {
    setDraggedModIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedModIndex === null || draggedModIndex === index) return
    
    // Reorder the mods
    const newOrder = [...orderedModIds]
    const [draggedItem] = newOrder.splice(draggedModIndex, 1)
    newOrder.splice(index, 0, draggedItem)
    setOrderedModIds(newOrder)
    setDraggedModIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedModIndex(null)
  }

  const moveModUp = (index: number) => {
    if (index === 0) return
    const newOrder = [...orderedModIds]
    ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
    setOrderedModIds(newOrder)
  }

  const moveModDown = (index: number) => {
    if (index === orderedModIds.length - 1) return
    const newOrder = [...orderedModIds]
    ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    setOrderedModIds(newOrder)
  }

  const handleSaveModOrder = async () => {
    try {
      setSavingModOrder(true)
      await modsApi.saveModOrder(orderedModIds)
      toast({
        title: 'Mod Order Saved',
        description: 'The mod load order has been updated in the server INI.',
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Save order failed',
        description: error instanceof Error ? error.message : 'Failed to save mod order',
        variant: 'destructive',
      })
    } finally {
      setSavingModOrder(false)
    }
  }

  const hasModOrderChanged = useMemo(() => {
    if (!iniConfig?.modIds) return false
    if (orderedModIds.length !== iniConfig.modIds.length) return true // Different count = changed
    return orderedModIds.some((id, i) => id !== iniConfig.modIds[i])
  }, [orderedModIds, iniConfig?.modIds])

  const removeFromInstallList = (workshopId: string) => {
    setModsToInstall(prev => prev.filter(m => m.workshopId !== workshopId))
  }

  const openWorkshopPage = (workshopId: string) => {
    window.open(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`, '_blank')
  }

  const toggleModSelect = (workshopId: string) => {
    setSelectedMods(prev => {
      const newSet = new Set(prev)
      if (newSet.has(workshopId)) {
        newSet.delete(workshopId)
      } else {
        newSet.add(workshopId)
      }
      return newSet
    })
  }

  const selectAllVisible = () => {
    setSelectedMods(new Set(filteredMods.map(m => m.workshop_id)))
  }

  const deselectAll = () => {
    setSelectedMods(new Set())
  }

  const handleSaveRestartSettings = async () => {
    setLoading(true)
    try {
      await modsApi.setRestartOptions({
        warningMinutes: restartWarningMinutes,
        delayIfPlayersOnline: delayIfPlayersOnline,
        maxDelayMinutes: maxDelayMinutes
      })
      toast({
        title: 'Settings Saved',
        description: 'Restart options have been updated',
      })
      setRestartSettingsOpen(false)
      fetchData()
    } catch (error) {
      toast({
        title: 'Settings save failed',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCancelPendingRestart = async () => {
    setLoading(true)
    try {
      await modsApi.cancelPendingRestart()
      toast({
        title: 'Restart Cancelled',
        description: 'Pending restart has been cancelled',
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Cancel failed',
        description: error instanceof Error ? error.message : 'Failed to cancel restart',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Memoized list of mods with updates available
  const modsWithUpdates = useMemo(() => mods.filter(m => m.update_available), [mods])
  const configuredWorkshopIds = useMemo(() => new Set(iniConfig?.workshopIds || []), [iniConfig?.workshopIds])

  // Memoize conflict-pairs derived data to avoid recalc on every render
  const loadOrderMap = useMemo(() => {
    const entries: [string, number][] = (conflicts?.modLoadOrder ?? []).map((id, i) => [id, i + 1] as [string, number])
    return new Map(entries)
  }, [conflicts?.modLoadOrder])

  const filteredPairs = useMemo(() => {
    if (!conflicts?.pairs?.length) return []
    let pairs = graphFilterMod
      ? conflicts.pairs.filter(p => p.modA.modId === graphFilterMod || p.modB.modId === graphFilterMod)
      : conflicts.pairs
    if (pairSeverityFilter !== 'all') {
      pairs = pairs.filter(p => {
        if (pairSeverityFilter === 'high') return p.highCount > 0
        if (pairSeverityFilter === 'medium') return p.mediumCount > 0
        if (pairSeverityFilter === 'low') return p.lowCount > 0
        return true
      })
    }
    return pairs
  }, [conflicts?.pairs, graphFilterMod, pairSeverityFilter])

  // Top conflicting mods — ranked by number of pairs and severity
  const topConflictingMods = useMemo(() => {
    if (!conflicts?.pairs?.length) return []
    const modStats = new Map<string, { modId: string; modName: string; pairs: number; high: number; medium: number; low: number; files: number }>()
    for (const pair of conflicts.pairs) {
      for (const mod of [pair.modA, pair.modB]) {
        if (!modStats.has(mod.modId)) {
          modStats.set(mod.modId, { modId: mod.modId, modName: mod.modName, pairs: 0, high: 0, medium: 0, low: 0, files: 0 })
        }
        const s = modStats.get(mod.modId)!
        s.pairs++
        s.high += pair.highCount
        s.medium += pair.mediumCount
        s.low += pair.lowCount
        s.files += pair.files.length
      }
    }
    return Array.from(modStats.values()).sort((a, b) => (b.high - a.high) || (b.medium - a.medium) || (b.pairs - a.pairs)).slice(0, 15)
  }, [conflicts?.pairs])

  const scanConflicts = useCallback(async () => {
    // Close any previous SSE connection
    eventSourceRef.current?.close()
    closingIntentionallyRef.current = false

    setConflictsLoading(true)
    setScanProgress(0)
    setScanCurrentMod(null)
    setScanModsScanned(0)
    setScanTotalMods(0)
    setStreamConflicts([])
    setGraphFilterMod(null)
    // Cancel any pending rAF from previous scan
    cancelAnimationFrame(scanBatchRef.current.raf)
    scanBatchRef.current = { progress: 0, modName: null, modsScanned: 0, dirty: false, raf: 0 }

    const token = getAccessToken()
    // SSE doesn't support custom headers, so pass token as query param 
    const url = `/api/mods/conflicts/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    // Idle timeout: if no SSE events arrive for 90s, assume connection is dead
    const resetIdleTimer = () => {
      if (sseIdleTimerRef.current) clearTimeout(sseIdleTimerRef.current)
      sseIdleTimerRef.current = setTimeout(() => {
        es.close()
        eventSourceRef.current = null
        setConflictsError('Scan timed out — no response from server')
        setConflictsLoading(false)
      }, 90_000)
    }
    resetIdleTimer()

    es.addEventListener('init', (e) => {
      resetIdleTimer()
      try {
        const data = JSON.parse(e.data)
        setConflictsError(null)
        setScanTotalMods(data.totalWorkshopIds || 0)
      } catch (err) { console.warn('SSE init parse error:', err) }
    })

    es.addEventListener('mod-scanned', (e) => {
      resetIdleTimer()
      try {
        const data: ScanStreamModScanned = JSON.parse(e.data)
        // Batch into ref — flush once per frame to avoid 3 setState per SSE event
        const batch = scanBatchRef.current
        batch.progress = data.progress
        batch.modName = data.modName
        batch.modsScanned = data.modsScanned
        if (!batch.dirty) {
          batch.dirty = true
          batch.raf = requestAnimationFrame(() => {
            setScanProgress(batch.progress)
            setScanCurrentMod(batch.modName)
            setScanModsScanned(batch.modsScanned)
            batch.dirty = false
          })
        }
      } catch (err) { console.warn('SSE mod-scanned parse error:', err) }
    })

    es.addEventListener('conflict-found', (e) => {
      resetIdleTimer()
      try {
        const data: ScanStreamConflictFound = JSON.parse(e.data)
        // Keep only the last 50 entries (only 8 are displayed at a time)
        setStreamConflicts(prev => {
          if (prev.length >= 50) {
            const next = prev.slice(-24)
            next.push(data)
            return next
          }
          return [...prev, data]
        })
      } catch (err) { console.warn('SSE conflict-found parse error:', err) }
    })

    es.addEventListener('phase', (e) => {
      resetIdleTimer()
      try {
        const data = JSON.parse(e.data)
        setScanProgress(data.progress)
        if (data.phase === 'hashing') setScanCurrentMod('Comparing file contents...')
        if (data.phase === 'grouping') setScanCurrentMod('Grouping results...')
      } catch (err) { console.warn('SSE phase parse error:', err) }
    })

    es.addEventListener('complete', (e) => {
      if (sseIdleTimerRef.current) clearTimeout(sseIdleTimerRef.current)
      try {
        const data = JSON.parse((e as MessageEvent).data)
        // Flush any pending batch before setting final state
        cancelAnimationFrame(scanBatchRef.current.raf)
        scanBatchRef.current.dirty = false
        setConflicts(data)
        setLastScanTime(new Date())
        setScanIniSnapshot(JSON.stringify({
          ws: iniConfig?.workshopIds?.slice().sort() || [],
          mods: iniConfig?.modIds?.slice().sort() || []
        }))
        setOpenPairs([])
        setScanProgress(100)
      } catch (err) {
        setConflictsError('Failed to parse scan results')
      } finally {
        es.close()
        eventSourceRef.current = null
        setConflictsLoading(false)
      }
    })

    es.addEventListener('error', (e) => {
      // Native EventSource fires Event (not MessageEvent) on connection drop.
      // Custom 'error' events from our backend ARE MessageEvents with data.
      if (sseIdleTimerRef.current) clearTimeout(sseIdleTimerRef.current)
      es.close()
      eventSourceRef.current = null

      // If we closed intentionally (navigation/unmount), don't show errors.
      // The backend may still finish — cached results will load on re-mount.
      if (closingIntentionallyRef.current) {
        closingIntentionallyRef.current = false
        setConflictsLoading(false)
        return
      }

      const me = e as MessageEvent
      if (typeof me.data === 'string') {
        try {
          const data = JSON.parse(me.data)
          setConflictsError(data.error || 'Scan failed')
        } catch {
          setConflictsError('Scan connection lost')
        }
      } else {
        // Connection lost — try to recover cached results from backend
        setConflictsError('Scan connection lost')
      }
      setConflictsLoading(false)
      toast({ title: 'Scan Failed', description: 'Lost connection to scan stream', variant: 'destructive' })
    })
  }, [toast, iniConfig?.workshopIds, iniConfig?.modIds])

  return (
    <TooltipProvider>
      <div className="space-y-6 page-transition">
        {fetchError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Mod data could not be loaded</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words" dir="auto">{fetchError}</span>
              <Button variant="outline" size="sm" onClick={fetchData} className="self-start">
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {/* Header */}
        <PageHeader
          title="Mod Manager"
          description="Track, update, and configure Steam Workshop mods"
          eyebrow="Workshop"
          tone="maintain"
          icon={<Package className="w-5 h-5" />}
          actions={
            <Button onClick={() => setAdvancedAddOpen(true)} className="gap-2" variant="command">
              <Plus className="w-4 h-4" />
              Add Mod
            </Button>
          }
        />

        {/* Status Bar — only show when mods are tracked */}
        {(status?.totalModsTracked || 0) > 0 && (
        <div className="flex items-center gap-4 rounded-lg border border-border/50 bg-card/60 px-3 py-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">{status?.totalModsTracked || 0} tracked</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">{iniConfig?.totalMods || 0} configured</span>
          </div>
          {modsWithUpdates.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="text-sm font-medium">{modsWithUpdates.length} updates</span>
              </div>
            </>
          )}
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {status?.lastCheck ? `Last check ${new Date(status.lastCheck).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Never checked'}
            </span>
          </div>
          
          {/* Workshop ACF Status */}
          {!status?.workshopAcfConfigured && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span className="text-xs">Workshop path missing</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Can't find workshop data file (ACF)</p>
                  <p className="text-xs text-muted-foreground">Set the server install path in Settings to enable update detection.</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleSyncFromServer} disabled={loading}>
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Sync
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sync tracked mods from server INI config</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={handleCheckUpdates} disabled={checking}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${checking ? 'animate-spin' : ''}`} />
              Check Updates
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="More actions">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCollectionDialogOpen(true)}>
                  <Library className="w-4 h-4 mr-2" />
                  Import Collection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRestartSettingsOpen(true)}>
                  <Settings2 className="w-4 h-4 mr-2" />
                  Restart Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm">Auto-restart</span>
                    <Switch
                      checked={status?.autoRestartEnabled || false}
                      onCheckedChange={handleToggleAutoRestart}
                      disabled={loading}
                    />
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        )}

        {/* Pending Restart Alert */}
        {status?.pendingRestart && (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 sm:items-center">
              <Clock className="w-5 h-5 animate-pulse text-warning" />
              <div>
                <p className="font-medium text-warning">Restart Pending</p>
                <p className="text-xs text-muted-foreground">
                  Waiting for players to leave before restarting (max {status.maxDelayMinutes} min)
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleCancelPendingRestart} disabled={loading}>
              Cancel
            </Button>
          </div>
        )}

        <Tabs defaultValue="mods" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList className="grid w-full grid-cols-3 sm:w-auto">
              <TabsTrigger value="mods" className="w-full">
                <Package className="w-4 h-4 mr-2" />
                Tracked Mods
              </TabsTrigger>
              <TabsTrigger value="config" className="w-full">
                <Settings2 className="w-4 h-4 mr-2" />
                Server Config
              </TabsTrigger>
              <TabsTrigger value="conflicts" className="w-full" onClick={() => { if (!conflicts) scanConflicts() }}>
                <Shield className="w-4 h-4 mr-2" />
                Conflicts
              </TabsTrigger>
            </TabsList>

            {/* Import Collection Dialog */}
            <Dialog
              open={collectionDialogOpen}
              onOpenChange={(open) => {
                setCollectionDialogOpen(open)
                if (!open) {
                  setShowCollectionAdvanced(false)
                }
              }}
            >
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto sm:max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Import Steam Workshop Collection</DialogTitle>
                    <DialogDescription>
                      Paste a collection URL to add all its mods to your server config at once
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="collection-url-input">Collection URL or ID</Label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="collection-url-input"
                          value={collectionUrl}
                          onChange={(e) => setCollectionUrl(e.target.value)}
                          placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=..."
                        />
                        <Button onClick={handleImportCollection} disabled={importingCollection} className="w-full sm:w-auto">
                          {importingCollection ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {collectionMods.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <Label>Found {collectionMods.length} mods</Label>
                          <div className="flex gap-2 flex-wrap justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setShowCollectionAdvanced(!showCollectionAdvanced)}
                            >
                              {showCollectionAdvanced ? 'Hide Advanced Fields' : 'Edit IDs and Maps'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCollectionMods(prev => prev.map(m => ({ ...m, selected: true })))}
                            >
                              Select All
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCollectionMods(prev => prev.map(m => ({ ...m, selected: false })))}
                            >
                              Deselect All
                            </Button>
                          </div>
                        </div>
                        <ScrollArea className="h-[min(48vh,22rem)] border rounded-md p-2 sm:h-[min(52vh,24rem)]">
                          <div className="space-y-2">
                            {collectionMods.map((mod) => (
                              <div 
                                key={mod.workshopId} 
                                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${mod.selected ? 'border-primary/35 bg-primary/10' : 'bg-card/60 hover:bg-accent/24'}`}
                              >
                                <Checkbox
                                  checked={mod.selected}
                                  onCheckedChange={() => toggleModSelection(mod.workshopId)}
                                aria-label={`Select ${mod.name}`}
                                />
                                <div className="flex-1 space-y-1 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-medium text-sm truncate">{mod.name}</span>
                                    {mod.isMap && (
                                      <Badge variant="secondary" className="text-xs">
                                        <MapIcon className="w-3 h-3 mr-1" />
                                        Map
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    ID: {mod.workshopId}
                                  </p>
                                  {mod.selected && showCollectionAdvanced && (
                                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                      <div>
                                        <Label className="text-xs" htmlFor={`collection-mod-id-${mod.workshopId}`}>Mod ID</Label>
                                        <Input
                                          id={`collection-mod-id-${mod.workshopId}`}
                                          value={mod.modId || ''}
                                          onChange={(e) => updateModId(mod.workshopId, e.target.value)}
                                          placeholder="From info.txt"
                                          className="h-7 text-xs"
                                        />
                                      </div>
                                      {mod.isMap && (
                                        <div>
                                          <Label className="text-xs" htmlFor={`collection-map-folder-${mod.workshopId}`}>Map Folder</Label>
                                          <Input
                                            id={`collection-map-folder-${mod.workshopId}`}
                                            value={mod.mapFolder || ''}
                                            onChange={(e) => updateMapFolder(mod.workshopId, e.target.value)}
                                            placeholder="MapFolderName"
                                            className="h-7 text-xs"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  size="iconDense"
                                  variant="ghost"
                                  className="h-10 w-10 sm:h-10 sm:w-10"
                                  onClick={() => openWorkshopPage(mod.workshopId)}
                                  aria-label="Open workshop page"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCollectionDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleAddCollectionMods} 
                      disabled={loading || collectionMods.filter(m => m.selected).length === 0}
                    >
                      {loading ? 'Adding...' : `Add ${collectionMods.filter(m => m.selected).length} Mods to Server`}
                    </Button>
                  </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add Single Mod Dialog - Improved with Multi-ID support */}
            <Dialog open={advancedAddOpen} onOpenChange={(open) => {
                setAdvancedAddOpen(open)
                if (!open) {
                  setAdvancedModInput('')
                  setDiscoveredMod(null)
                  setSelectedModIds(new Set())
                  setShowAdvancedIdSelection(false)
                }
              }}>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto sm:max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Add Workshop Mod</DialogTitle>
                    <DialogDescription>
                      Paste a Steam Workshop URL or ID — or{' '}
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => { setAdvancedAddOpen(false); setCollectionDialogOpen(true) }}
                      >
                        import an entire collection
                      </button>.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    {/* Input section */}
                    <div className="space-y-2">
                      <Label htmlFor="advanced-mod-input" className="sr-only">Workshop URL or ID</Label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="advanced-mod-input"
                          value={advancedModInput}
                          onChange={(e) => handleModInputChange(e.target.value)}
                          placeholder="Paste Workshop URL or enter ID..."
                          onKeyDown={(e) => e.key === 'Enter' && !discoveringMod && handleDiscoverMod()}
                          className="font-mono text-sm"
                        />
                        <Button 
                          id="discover-mod-btn"
                          onClick={handleDiscoverMod} 
                          disabled={discoveringMod || !advancedModInput.trim()}
                          variant="secondary"
                          className="w-full shrink-0 sm:w-auto"
                        >
                          {discoveringMod ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Search className="w-4 h-4 mr-1" />
                              Discover
                            </>
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Example: https://steamcommunity.com/sharedfiles/filedetails/?id=3616536783
                      </p>
                    </div>
                    
                    {/* Loading skeleton */}
                    {discoveringMod && (
                      <div className="space-y-3 p-4 border rounded-lg bg-muted/30 animate-pulse">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="h-4 bg-muted rounded w-3/4" />
                            <div className="h-3 bg-muted rounded w-1/2" />
                          </div>
                          <div className="h-5 bg-muted rounded w-16" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="h-8 bg-muted rounded" />
                          <div className="h-8 bg-muted rounded" />
                        </div>
                      </div>
                    )}
                    
                    {/* Discovered mod info */}
                    {discoveredMod && !discoveringMod && (
                      <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                        {/* Mod header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-medium text-sm truncate" title={discoveredMod.name}>
                              {discoveredMod.name}
                            </h4>
                            <div className="flex items-center gap-2 mt-0.5">
                              <code className="text-xs text-muted-foreground font-mono">
                                {discoveredMod.workshopId}
                              </code>
                              <button
                                onClick={() => window.open(`https://steamcommunity.com/sharedfiles/filedetails/?id=${discoveredMod.workshopId}`, '_blank')}
                                className="text-xs text-primary hover:underline flex items-center gap-0.5"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {discoveredMod.isMap && (
                              <Badge variant="secondary" className="text-xs h-5">
                                <MapIcon className="w-3 h-3 mr-1" />
                                Map
                              </Badge>
                            )}
                            {discoveredMod.isDownloaded ? (
                              <Badge variant="success" className="text-xs h-5">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Downloaded
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-xs h-5">
                                <Download className="w-3 h-3 mr-1" />
                                Not Downloaded
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        {/* Already added warning */}
                        {discoveredMod.isAlreadyAdded && (
                          <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 p-2 text-xs text-foreground">
                            <Info className="w-4 h-4 text-primary shrink-0" />
                            <span>Workshop ID is already in your server config</span>
                          </div>
                        )}
                        
                        {/* Mod IDs selection */}
                        {discoveredMod.modIds.length > 0 ? (
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-xs font-medium">
                                {discoveredMod.hasMultipleModIds
                                  ? `Mod IDs (${selectedModIds.size} of ${discoveredMod.modIds.length} selected)`
                                  : 'Mod ID'}
                              </Label>
                              {discoveredMod.hasMultipleModIds && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-2.5"
                                  onClick={() => setShowAdvancedIdSelection(!showAdvancedIdSelection)}
                                >
                                  {showAdvancedIdSelection ? 'Hide' : 'Review IDs'}
                                </Button>
                              )}
                            </div>

                            {discoveredMod.hasMultipleModIds && !showAdvancedIdSelection ? (
                              <p className="text-xs text-muted-foreground">
                                New IDs are pre-selected automatically. Open Review IDs to manually adjust selection.
                              </p>
                            ) : (
                              <>
                                {discoveredMod.hasMultipleModIds && (
                                  <div className="flex flex-wrap gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs px-2.5"
                                      onClick={() => {
                                        const newIds = discoveredMod.modIds.filter(
                                          id => !discoveredMod.alreadyConfigured?.includes(id)
                                        )
                                        setSelectedModIds(new Set(newIds))
                                      }}
                                    >
                                      Select New
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs px-2.5"
                                      onClick={() => {
                                        if (selectedModIds.size === discoveredMod.modIds.length) {
                                          setSelectedModIds(new Set())
                                        } else {
                                          setSelectedModIds(new Set(discoveredMod.modIds))
                                        }
                                      }}
                                    >
                                      {selectedModIds.size === discoveredMod.modIds.length ? 'None' : 'All'}
                                    </Button>
                                  </div>
                                )}
                                <div className="space-y-1 max-h-[50vh] overflow-y-auto rounded-md border border-border/50 bg-background/50 p-1.5">
                                  {discoveredMod.modIds.map((modId) => {
                                    const isConfigured = discoveredMod.alreadyConfigured?.includes(modId)
                                    return (
                                      <div
                                        key={modId}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={selectedModIds.has(modId)}
                                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                                          selectedModIds.has(modId)
                                            ? 'bg-primary/8 border-l-2 border-l-primary'
                                            : isConfigured
                                              ? 'bg-muted/30 opacity-70'
                                              : 'hover:bg-muted/40'
                                        }`}
                                        onClick={() => toggleModIdSelection(modId)}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault()
                                            toggleModIdSelection(modId)
                                          }
                                        }}
                                      >
                                        <Checkbox
                                          checked={selectedModIds.has(modId)}
                                          onCheckedChange={() => toggleModIdSelection(modId)}
                                        aria-label={`Select mod ID ${modId}`}
                                        />
                                        <code className="text-xs font-mono flex-1 truncate" title={modId}>
                                          {modId}
                                        </code>
                                        {isConfigured && (
                                          <Badge variant="outline" className="text-xs h-5 shrink-0 text-muted-foreground">
                                            Exists
                                          </Badge>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
                            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                            <div>
                              <p className="font-medium text-warning">
                                {discoveredMod.isDownloaded 
                                  ? 'No mod.info files found'
                                  : 'Mod not yet downloaded'}
                              </p>
                              <p className="text-muted-foreground mt-0.5">
                                {discoveredMod.isDownloaded 
                                  ? 'This mod may use an unconventional structure'
                                  : 'Add the Workshop ID and sync after server downloads it'}
                              </p>
                            </div>
                          </div>
                        )}
                        
                        {/* Map folders info */}
                        {discoveredMod.mapFolders.length > 0 && (
                          <div className="flex items-start gap-2 text-xs">
                            <MapIcon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <span className="font-medium">Map folders will be added:</span>
                              <div className="text-muted-foreground mt-0.5">
                                {discoveredMod.mapFolders.join(', ')}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <DialogFooter className="flex-col sm:flex-row gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setAdvancedAddOpen(false)}
                      className="w-full sm:order-1 sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleAddModAdvanced} 
                      disabled={loading || !discoveredMod || discoveringMod}
                      className="w-full sm:order-2 sm:w-auto"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Adding...
                        </>
                      ) : discoveredMod?.modIds.length ? (
                        selectedModIds.size > 0 
                          ? `Add ${selectedModIds.size} Mod ID${selectedModIds.size !== 1 ? 's' : ''}`
                          : 'Add Workshop ID Only'
                      ) : discoveredMod ? (
                        'Add Workshop ID'
                      ) : (
                        'Discover First'
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Restart Settings Dialog */}
            <Dialog open={restartSettingsOpen} onOpenChange={setRestartSettingsOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Auto-Restart Settings</DialogTitle>
                    <DialogDescription>
                      Configure how the server restarts when mod updates are detected
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="restart-warning-minutes">Warning Time (minutes)</Label>
                      <Input
                        id="restart-warning-minutes"
                        type="number"
                        min="0"
                        max="30"
                        value={restartWarningMinutes}
                        onChange={(e) => setRestartWarningMinutes(parseInt(e.target.value) || 0)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        How long to wait before restarting after detecting updates
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/65 p-3">
                      <div className="space-y-1">
                        <Label>Delay if Players Online</Label>
                        <p className="text-xs text-muted-foreground">
                          Wait for all players to leave before restarting
                        </p>
                      </div>
                      <Switch
                        checked={delayIfPlayersOnline}
                        onCheckedChange={setDelayIfPlayersOnline}
                      />
                    </div>
                    
                    {delayIfPlayersOnline && (
                      <div>
                        <Label htmlFor="restart-max-delay">Maximum Delay (minutes)</Label>
                        <Input
                          id="restart-max-delay"
                          type="number"
                          min="5"
                          max="120"
                          value={maxDelayMinutes}
                          onChange={(e) => setMaxDelayMinutes(parseInt(e.target.value) || 30)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Force restart after this time even if players are online
                        </p>
                      </div>
                    )}
                    
                    <div className="rounded-lg border border-border/70 bg-gradient-to-r from-secondary/80 to-accent/20 p-3">
                      <p className="text-sm font-medium mb-2">Current Settings</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>• Warning time: {restartWarningMinutes} minutes</p>
                        <p>• Delay for players: {delayIfPlayersOnline ? 'Yes' : 'No'}</p>
                        {delayIfPlayersOnline && <p>• Max delay: {maxDelayMinutes} minutes</p>}
                      </div>
                    </div>
                  </div>
                  <DialogFooter className="flex-col sm:flex-row gap-2">
                    <Button variant="outline" onClick={() => setRestartSettingsOpen(false)} className="w-full sm:w-auto">
                      Cancel
                    </Button>
                    <Button onClick={handleSaveRestartSettings} disabled={loading} className="w-full sm:w-auto">
                      {loading ? 'Saving...' : 'Save Settings'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
            </Dialog>
          </div>

          {/* Tracked Mods Tab */}
          <TabsContent value="mods" className="space-y-4">
            {/* Updates Alert */}
            {modsWithUpdates.length > 0 && (
              <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 sm:items-center">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                  <div>
                    <p className="font-medium text-warning">
                      {modsWithUpdates.length} mod{modsWithUpdates.length > 1 ? 's have' : ' has'} updates available
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Restart the server when you are ready to apply them
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleClearUpdates} disabled={loading}>
                  Clear Flags
                </Button>
              </div>
            )}

            {/* Search and Filters */}
            {mods.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search mods..."
                  maxLength={200}
                  className="pl-9"
                  aria-label="Search mods"
                />
              </div>
              
              <Button
                variant={showUpdatesOnly ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowUpdatesOnly(!showUpdatesOnly)}
                className={showUpdatesOnly ? "w-full border-primary/20 bg-primary/12 text-primary sm:w-auto" : "w-full sm:w-auto"}
              >
                <Filter className="w-4 h-4 mr-2" />
                Updates Only
              </Button>

              {selectedMods.size > 0 && (
                <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <span className="text-sm text-muted-foreground">
                    {selectedMods.size} selected
                  </span>
                  <Button variant="outline" size="sm" onClick={deselectAll}>
                    Deselect
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmBulkRemove(true)} disabled={loading}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remove
                  </Button>
                </div>
              )}

              {selectedMods.size === 0 && filteredMods.length > 0 && (
                <Button variant="ghost" size="sm" onClick={selectAllVisible} className="ml-auto w-full sm:w-auto">
                  Select All ({filteredMods.length})
                </Button>
              )}
            </div>
            )}

            {/* Mods List */}
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[min(52vh,24rem)] sm:h-[min(60vh,31rem)]">
                  {filteredMods.length === 0 ? (
                    <EmptyState
                      type={searchQuery ? 'noResults' : 'noMods'}
                      title={searchQuery ? 'No mods match your search' : 'No mods tracked'}
                      description={searchQuery ? 'Try a different search term' : 'Track Workshop mods to detect updates and manage your load order.'}
                      action={searchQuery ? undefined : { label: 'Sync from Server', onClick: handleSyncFromServer, variant: 'outline' }}
                      secondaryAction={searchQuery ? undefined : { label: 'Import Collection', onClick: () => setCollectionDialogOpen(true), variant: 'ghost' }}
                    />
                  ) : (
                    <div className="divide-y">
                      {filteredMods.map((mod) => (
                        <div
                          key={mod.id}
                          className={`flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors ${
                            selectedMods.has(mod.workshop_id) ? 'bg-accent/30' : ''
                          }`}
                        >
                          <Checkbox
                            checked={selectedMods.has(mod.workshop_id)}
                            onCheckedChange={() => toggleModSelect(mod.workshop_id)}
                          aria-label={`Select ${mod.name || mod.workshop_id}`}
                          />
                          
                          {mod.update_available ? (
                            <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
                          )}
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {mod.name || `Mod ${mod.workshop_id}`}
                              </span>
                              {mod.update_available ? (
                                <Badge variant="warning" className="text-xs">
                                  Update
                                </Badge>
                              ) : null}
                              <Badge variant={configuredWorkshopIds.has(mod.workshop_id) ? 'success' : 'secondary'} className="text-xs">
                                {configuredWorkshopIds.has(mod.workshop_id) ? 'In Config' : 'Not in Config'}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <span className="text-xs text-muted-foreground font-mono">{mod.workshop_id}</span>
                              <span className="text-xs text-muted-foreground">•</span>
                              <span className="text-xs text-muted-foreground">
                                {mod.last_checked
                                  ? `Checked ${new Date(mod.last_checked).toLocaleDateString()}`
                                  : 'Never checked'}
                              </span>
                            </div>
                          </div>
                          
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a 
                                href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshop_id}`} 
                                target="_blank" 
                                rel="noreferrer"
                                className="inline-flex"
                              >
                                <Button
                                  variant="ghost"
                                  size="iconDense"
                                  className="h-10 w-10 text-muted-foreground hover:text-primary sm:h-10 sm:w-10"
                                  aria-label="Open workshop page"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>Open Workshop Page</TooltipContent>
                          </Tooltip>
                          
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="iconDense"
                                className="h-10 w-10 text-destructive hover:text-destructive sm:h-10 sm:w-10"
                                onClick={() => setConfirmRemoveMod(mod.workshop_id)}
                                disabled={loading}
                                aria-label={`Remove mod ${mod.name || mod.workshop_id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove from tracking</TooltipContent>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Server Config Tab */}
          <TabsContent value="config" className="space-y-4">
            {iniConfig?.configured ? (
              <>
                {/* ─── Sub-tab nav ─── */}
                <div className="flex items-center gap-1 border-b border-border/40 pb-0 overflow-x-auto">
                  {([
                    { key: 'active' as const, label: 'Active Mods', icon: <Package className="w-3.5 h-3.5" /> },
                    { key: 'order' as const, label: 'Load Order', icon: <GripVertical className="w-3.5 h-3.5" /> },
                    { key: 'add' as const, label: 'Add Mods', icon: <Plus className="w-3.5 h-3.5" /> },
                    { key: 'presets' as const, label: 'Presets', icon: <FolderOpen className="w-3.5 h-3.5" /> },
                    { key: 'tools' as const, label: 'Tools', icon: <Wrench className="w-3.5 h-3.5" /> },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setConfigSubTab(tab.key)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors duration-150 whitespace-nowrap -mb-[1px] ${
                        configSubTab === tab.key
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50'
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.key === 'order' && hasModOrderChanged && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
                    </button>
                  ))}
                </div>

                {/* ─── Summary bar ─── */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="tabular-nums">{iniConfig.totalMods} <span className="opacity-50">mods</span></span>
                  <span className="tabular-nums">{iniConfig.workshopIds.length} <span className="opacity-50">workshop item{iniConfig.workshopIds.length !== 1 ? 's' : ''}</span></span>
                  <span className="tabular-nums">{iniConfig.maps.length} <span className="opacity-50">map{iniConfig.maps.length !== 1 ? 's' : ''}</span></span>
                </div>

                {/* ═══ ACTIVE MODS SUB-TAB ═══ */}
                {configSubTab === 'active' && (() => {
                  const wsMap = iniConfig.workshopModMap || {}
                  type ModEntry = { id: string; name: string; enabled: boolean }
                  type WsGroup = { wsId: string; mods: ModEntry[]; allEnabled: boolean; someEnabled: boolean }
                  const groups: WsGroup[] = []
                  for (const wsId of (iniConfig.workshopIds || [])) {
                    const details = wsMap[wsId] || []
                    if (details.length === 0) continue
                    groups.push({
                      wsId,
                      mods: details,
                      allEnabled: details.every(m => m.enabled),
                      someEnabled: details.some(m => m.enabled),
                    })
                  }
                  const allModsList = groups.flatMap(g => g.mods)
                  const mappedIds = new Set(allModsList.map(m => m.id))
                  const orphaned = (iniConfig.modIds || []).filter(id => !mappedIds.has(id))
                  const enabledCount = allModsList.filter(m => m.enabled).length
                  const multiIdCount = groups.filter(g => g.mods.length > 1).length

                  const q = modManagerSearch.toLowerCase().trim()
                  const filteredGroups = groups
                    .map(g => {
                      if (!q) return g
                      const matchesWs = g.wsId.includes(q)
                      if (matchesWs) return g
                      const matched = g.mods.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
                      if (matched.length === 0) return null
                      return { ...g, mods: matched }
                    })
                    .filter((g): g is WsGroup => g !== null)
                  const displayGroups = filterMultiId ? filteredGroups.filter(g => g.mods.length > 1) : filteredGroups

                  const toggleMod = async (mod: ModEntry, wsId: string) => {
                    const on = !mod.enabled
                    try {
                      await modsApi.toggleModId(mod.id, on)
                      setIniConfig(prev => {
                        if (!prev) return prev
                        const newModIds = on ? [...prev.modIds, mod.id] : prev.modIds.filter(id => id !== mod.id)
                        const newMap = { ...prev.workshopModMap }
                        if (newMap[wsId]) {
                          newMap[wsId] = newMap[wsId].map(m => m.id === mod.id ? { ...m, enabled: on } : m)
                        }
                        return { ...prev, modIds: newModIds, totalMods: newModIds.length, workshopModMap: newMap }
                      })
                      setOrderedModIds(prev => on ? [...prev, mod.id] : prev.filter(id => id !== mod.id))
                      setLastSavedMod(mod.id)
                      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
                      savedTimeoutRef.current = setTimeout(() => setLastSavedMod(null), 2000)
                    } catch (e) { reportClientError('Failed to toggle mod', e); toast({ variant: 'destructive', title: 'Failed to toggle mod' }) }
                  }

                  const toggleAllInGroup = async (g: WsGroup) => {
                    const on = !g.allEnabled
                    const modsToToggle = g.mods.filter(mod => mod.enabled !== on)
                    if (modsToToggle.length === 0) return
                    try {
                      await modsApi.batchToggleModIds(modsToToggle.map(mod => ({ modId: mod.id, enabled: on })))
                      setIniConfig(prev => {
                        if (!prev) return prev
                        let newModIds = [...prev.modIds]
                        const newMap = { ...prev.workshopModMap }
                        for (const mod of modsToToggle) {
                          if (on) {
                            if (!newModIds.includes(mod.id)) newModIds.push(mod.id)
                          } else {
                            newModIds = newModIds.filter(id => id !== mod.id)
                          }
                        }
                        if (newMap[g.wsId]) {
                          newMap[g.wsId] = newMap[g.wsId].map(m => {
                            const toggled = modsToToggle.find(t => t.id === m.id)
                            return toggled ? { ...m, enabled: on } : m
                          })
                        }
                        return { ...prev, modIds: newModIds, totalMods: newModIds.length, workshopModMap: newMap }
                      })
                      setOrderedModIds(prev => {
                        let next = [...prev]
                        for (const mod of modsToToggle) {
                          if (on) { if (!next.includes(mod.id)) next.push(mod.id) }
                          else { next = next.filter(id => id !== mod.id) }
                        }
                        return next
                      })
                    } catch (e) { reportClientError('Failed to toggle group', e); toast({ variant: 'destructive', title: 'Failed to toggle group' }) }
                  }

                  const removeWorkshop = async (wsId: string) => {
                    try {
                      await modsApi.removeFromIni(wsId)
                      const updated = await modsApi.getCurrentConfig()
                      setIniConfig(updated)
                      if (updated?.modIds) setOrderedModIds(updated.modIds)
                      setLastSavedMod(`removed-${wsId}`)
                      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current)
                      savedTimeoutRef.current = setTimeout(() => setLastSavedMod(null), 2000)
                    } catch (e) { reportClientError('Failed to remove workshop item', e); toast({ variant: 'destructive', title: 'Failed to remove workshop item' }) }
                  }

                  // Handle confirmed workshop removal from AlertDialog
                  const handleConfirmedRemoveWorkshop = async () => {
                    if (confirmRemoveWorkshop) {
                      await removeWorkshop(confirmRemoveWorkshop)
                      setConfirmRemoveWorkshop(null)
                    }
                  }

                  const getGroupLabel = (g: WsGroup): string => {
                    const first = g.mods[0]
                    return first.name !== first.id ? first.name : first.id
                  }

                  return (
                    <div className="space-y-3">
                      {/* Conflict warnings (compact) */}
                      {detectedConflicts.length > 0 && (
                        <div className="space-y-1.5">
                          {detectedConflicts.map((conflict, idx) => (
                            <div
                              key={idx}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                                conflict.severity === 'warning' ? 'bg-warning/10 border-warning/40' : 'bg-primary/10 border-primary/30'
                              }`}
                            >
                              <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${conflict.severity === 'warning' ? 'text-warning' : 'text-primary'}`} />
                              <span className="flex-1 min-w-0">
                                <span className={`font-medium ${conflict.severity === 'warning' ? 'text-warning' : 'text-primary'}`}>
                                  {conflict.type === 'duplicate' && 'Duplicate Mods'}
                                  {conflict.type === 'missing_modid' && 'Missing Mod IDs'}
                                  {conflict.type === 'outdated_dependency' && 'Outdated Dependency'}
                                </span>
                                <span className="text-muted-foreground">: {conflict.message}</span>
                              </span>
                              {conflict.type === 'duplicate' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="shrink-0 h-8 text-xs border-warning/40 text-warning hover:bg-warning/20"
                                  disabled={deduplicating}
                                  onClick={async () => {
                                    setDeduplicating(true)
                                    setDeduplicateResult(null)
                                    try {
                                      const result = await modsApi.deduplicateModIds()
                                      setDeduplicateResult(result.message)
                                      if (result.removed.length > 0) {
                                        const updated = await modsApi.getCurrentConfig()
                                        setIniConfig(updated)
                                        if (updated?.modIds) setOrderedModIds(updated.modIds)
                                      }
                                    } catch (err: unknown) {
                                      const errMsg = err instanceof Error ? err.message : 'Failed to deduplicate'
                                      const msg = errMsg.includes('<')
                                        ? 'Failed to deduplicate — server endpoint not available'
                                        : errMsg
                                      setDeduplicateResult(`Error: ${msg}`)
                                    } finally {
                                      setDeduplicating(false)
                                    }
                                  }}
                                >
                                  {deduplicating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wrench className="w-3 h-3 mr-1" />}
                                  Fix
                                </Button>
                              )}
                            </div>
                          ))}
                          {deduplicateResult && (
                            <p className={`text-xs px-3 ${deduplicateResult.startsWith('Removed') ? 'text-emerald-400' : 'text-muted-foreground'}`}>{deduplicateResult}</p>
                          )}
                        </div>
                      )}

                      {/* Search + filter bar */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {enabledCount}<span className="opacity-50">/{allModsList.length}</span> on
                          </span>
                          {multiIdCount > 0 && (
                            <button
                              onClick={() => setFilterMultiId(!filterMultiId)}
                              className={`text-[11px] px-2 py-0.5 rounded border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${filterMultiId ? 'bg-primary/20 border-primary/50 text-primary' : 'border-border/40 text-muted-foreground hover:text-foreground'}`}
                            >
                              Multi-ID ({multiIdCount})
                            </button>
                          )}
                          {lastSavedMod && (
                            <span className="text-[11px] text-emerald-400 flex items-center gap-1 animate-in fade-in duration-300">
                              <Check className="w-3 h-3" /> Saved to INI
                            </span>
                          )}
                        </div>
                        <div className="relative w-full sm:w-56">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                          <Input value={modManagerSearch} onChange={e => setModManagerSearch(e.target.value)} placeholder="Filter mods..." aria-label="Filter mods" className="h-7 text-xs pl-8 bg-background/60" />
                          {modManagerSearch && (
                            <button onClick={() => setModManagerSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 rounded">✕</button>
                          )}
                        </div>
                      </div>

                      {/* Scrollable mod list */}
                      <div className="rounded-lg border border-border/40 overflow-hidden bg-black/20">
                        {displayGroups.length > 0 ? (
                          <ScrollArea className="h-[calc(100vh-340px)] min-h-[300px]">
                            <div className="divide-y divide-border/25">
                              {displayGroups.map(g => {
                                const isSingle = g.mods.length === 1
                                const mod0 = g.mods[0]

                                if (isSingle) {
                                  return (
                                    <div
                                      key={g.wsId}
                                      className={`group flex items-center gap-3 px-3 py-1.5 transition-colors duration-150 hover:bg-muted/10 ${!mod0.enabled ? 'opacity-50' : ''}`}
                                    >
                                      <Checkbox
                                        checked={mod0.enabled}
                                        onCheckedChange={() => toggleMod(mod0, g.wsId)}
                                        className="shrink-0"
                                      aria-label={`${mod0.enabled ? "Disable" : "Enable"} ${mod0.name || mod0.id}`}
                                      />
                                      <div className="min-w-0 flex-1 flex items-baseline gap-2">
                                        <span className="text-xs font-mono truncate">{mod0.id}</span>
                                        {mod0.name !== mod0.id && (
                                          <span className="text-[11px] text-muted-foreground/70 truncate hidden sm:inline">{mod0.name}</span>
                                        )}
                                      </div>
                                      <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0 hidden sm:inline">{g.wsId}</span>
                                      <button
                                        onClick={() => setConfirmRemoveWorkshop(g.wsId)}
                                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-destructive/70 hover:text-destructive transition-opacity duration-150 p-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/50 focus-visible:opacity-100"
                                        title={`Remove workshop item ${g.wsId} from INI`}
                                        aria-label={`Remove ${mod0.id}`}
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )
                                }

                                return (
                                  <div key={g.wsId} className={`group ${!g.someEnabled ? 'opacity-50' : ''}`}>
                                    <div className="flex items-center gap-3 px-3 py-1.5">
                                      <button
                                        onClick={() => toggleAllInGroup(g)}
                                        className="flex items-center gap-3 flex-1 min-w-0 text-left hover:bg-muted/10 -mx-3 -my-1.5 px-3 py-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:bg-muted/10"
                                      >
                                        <div className={`w-2 h-2 rounded-sm shrink-0 ${g.allEnabled ? 'bg-emerald-400' : g.someEnabled ? 'bg-emerald-400/40' : 'bg-muted-foreground/20'}`} />
                                        <span className="text-xs font-medium truncate flex-1">{getGroupLabel(g)}</span>
                                        <span className="text-[11px] tabular-nums text-muted-foreground/70 shrink-0">{g.mods.filter(m => m.enabled).length}/{g.mods.length}</span>
                                        <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0 hidden sm:inline">{g.wsId}</span>
                                      </button>
                                      <button
                                        onClick={() => setConfirmRemoveWorkshop(g.wsId)}
                                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-destructive/70 hover:text-destructive transition-opacity duration-150 p-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/50 focus-visible:opacity-100 shrink-0"
                                        title={`Remove workshop item ${g.wsId} from INI`}
                                        aria-label={`Remove ${getGroupLabel(g)}`}
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                    <div className="pl-8 pr-3 pb-1.5 flex flex-wrap gap-1">
                                      {g.mods.map(mod => (
                                        <button
                                          key={mod.id}
                                          onClick={() => toggleMod(mod, g.wsId)}
                                          title={`${mod.id}${mod.name !== mod.id ? ` — ${mod.name}` : ''}\nClick to ${mod.enabled ? 'disable' : 'enable'}`}
                                          className={`
                                            px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors duration-150 cursor-pointer
                                            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50
                                            ${mod.enabled
                                              ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                              : 'bg-muted/15 text-muted-foreground/75 hover:text-muted-foreground hover:bg-muted/25'
                                            }
                                          `}
                                        >
                                          {mod.id}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}
                              {/* Orphaned mods */}
                              {!filterMultiId && orphaned.filter(id => !q || id.toLowerCase().includes(q)).map(id => (
                                <div key={`orphan-${id}`} className="flex items-center gap-3 px-3 py-1.5 opacity-60">
                                  <AlertTriangle className="w-3 h-3 text-warning/60 shrink-0" />
                                  <span className="text-xs font-mono truncate flex-1">{id}</span>
                                  <span className="text-[11px] text-warning/50">not on disk</span>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        ) : (
                          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                            {q ? `No mods matching "${modManagerSearch}"` : 'No mod IDs found'}
                          </div>
                        )}
                      </div>

                      {/* Mods= raw line */}
                      <div className="pt-2 border-t border-border/15">
                        <div className="text-[11px] text-muted-foreground/60 font-mono break-all leading-tight line-clamp-2" title={`Mods=${iniConfig.modIds?.join(';') || ''}`}>
                          Mods={iniConfig.modIds?.join(';') || ''}
                        </div>
                      </div>

                      {/* Workshop item remove confirmation */}
                      <AlertDialog open={!!confirmRemoveWorkshop} onOpenChange={(open) => { if (!open) setConfirmRemoveWorkshop(null) }}>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove workshop item?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the workshop item and its mod IDs from the server INI. Workshop files on disk won't be deleted.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={handleConfirmedRemoveWorkshop}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )
                })()}

                {/* ═══ LOAD ORDER SUB-TAB ═══ */}
                {configSubTab === 'order' && (
                  <div className="space-y-3">
                    {orderedModIds.length === 0 ? (
                      <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <div className="text-center space-y-2">
                          <Layers className="w-8 h-8 mx-auto opacity-30" />
                          <p className="text-sm font-medium text-foreground/70">No mods in load order</p>
                          <p className="text-xs">Enable mods in the Active Mods tab first.</p>
                        </div>
                      </div>
                    ) : (
                    <>
                    <p className="text-xs text-muted-foreground">Drag to reorder. Changes are not saved until you click Save.</p>
                    <div className="rounded-lg border border-border/30 overflow-hidden">
                      <ScrollArea className="h-[calc(100vh-320px)] min-h-[200px]">
                        <div className="divide-y divide-border/15">
                          {orderedModIds
                            .filter(modId => {
                              const q = modManagerSearch.toLowerCase().trim()
                              return !q || modId.toLowerCase().includes(q)
                            })
                            .map((modId) => {
                              const actualIndex = orderedModIds.indexOf(modId)
                              return (
                                <div
                                  key={modId}
                                  draggable={!modManagerSearch.trim()}
                                  onDragStart={() => handleDragStart(actualIndex)}
                                  onDragOver={(e) => handleDragOver(e, actualIndex)}
                                  onDragEnd={handleDragEnd}
                                  className={`flex items-center gap-2 px-2.5 py-1 cursor-move transition-colors duration-150 hover:bg-muted/15 ${
                                    draggedModIndex === actualIndex ? 'opacity-30 bg-primary/5' : ''
                                  }`}
                                >
                                  <GripVertical className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                                  <span className="text-[11px] tabular-nums text-muted-foreground/60 w-5 text-right shrink-0">{actualIndex + 1}</span>
                                  <span className="text-[11px] font-mono truncate flex-1">{modId}</span>
                                  <div className="flex shrink-0">
                                    <button onClick={() => moveModUp(actualIndex)} disabled={actualIndex === 0} className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center hover:bg-muted/30 disabled:opacity-30 rounded transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50" aria-label="Move up">
                                      <ChevronRight className="w-3.5 h-3.5 -rotate-90" />
                                    </button>
                                    <button onClick={() => moveModDown(actualIndex)} disabled={actualIndex === orderedModIds.length - 1} className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center hover:bg-muted/30 disabled:opacity-30 rounded transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50" aria-label="Move down">
                                      <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                        </div>
                      </ScrollArea>
                      {hasModOrderChanged && (
                        <div className="px-3 py-2 border-t border-border/40 bg-muted/20 flex items-center justify-between">
                          <span className="text-[11px] text-warning">Unsaved order changes</span>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setOrderedModIds(iniConfig.modIds)}>Reset</Button>
                            <Button size="sm" className="h-8 text-xs" onClick={handleSaveModOrder} disabled={savingModOrder}>
                              {savingModOrder ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                              Save Order
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    </>
                    )}
                  </div>
                )}

                {/* ═══ ADD MODS SUB-TAB ═══ */}
                {configSubTab === 'add' && (
                  <div className="space-y-4">
                    {/* Sync Mod IDs */}
                    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-secondary p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Sync Mod IDs from Downloads</p>
                        <p className="text-xs text-muted-foreground">
                          Reads mod.info from downloaded mods and adds their IDs to Mods= in the INI
                        </p>
                      </div>
                      <Button
                        onClick={handleSyncModIds}
                        disabled={syncing}
                        size="sm"
                        variant="outline"
                      >
                        {syncing ? (
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        Sync Mod IDs
                      </Button>
                    </div>

                    {/* Pending Mods to Install */}
                    {modsToInstall.length > 0 && (
                      <div className="space-y-3 rounded-lg border border-border/70 bg-secondary p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <Label className="flex items-center gap-2">
                            <Plus className="w-4 h-4" />
                            {modsToInstall.length} mods queued for INI
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setModsToInstall([])}
                          >
                            Clear All
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {modsToInstall.map(mod => (
                            <Badge key={mod.workshopId} variant="outline" className="max-w-full text-xs sm:max-w-[200px]">
                              <span className="truncate">{mod.name}</span>
                              {mod.isMap && <MapIcon className="w-3 h-3 ml-1" />}
                              <button
                                type="button"
                                aria-label={`Remove ${mod.name} from queue`}
                                onClick={() => removeFromInstallList(mod.workshopId)}
                                className="ml-1 hover:text-destructive"
                              >
                                ×
                              </button>
                            </Badge>
                          ))}
                        </div>
                        <Button onClick={handleWriteToIni} disabled={loading} size="sm">
                          <FileText className="w-4 h-4 mr-2" />
                          Write to Server INI
                        </Button>
                      </div>
                    )}

                    {modsToInstall.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Plus className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No mods pending</p>
                        <p className="text-xs">Use the Tracked Mods tab to find and add new workshop items, or click Sync to detect new downloads.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ PRESETS SUB-TAB ═══ */}
                {configSubTab === 'presets' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Save and restore mod configurations.</p>
                      <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" disabled={!iniConfig?.configured}>
                            <Save className="w-4 h-4 mr-2" />
                            Save Current
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Save Mod Preset</DialogTitle>
                            <DialogDescription>
                              Save the current mod configuration as a preset for easy switching later.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <Label htmlFor="presetName">Preset Name</Label>
                              <Input
                                id="presetName"
                                value={presetName}
                                onChange={(e) => setPresetName(e.target.value)}
                                placeholder="e.g., Vanilla+ Light, Hardcore, RP Server"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="presetDesc">Description (optional)</Label>
                              <Input
                                id="presetDesc"
                                value={presetDescription}
                                onChange={(e) => setPresetDescription(e.target.value)}
                                placeholder="Brief description of this preset..."
                              />
                            </div>
                            {iniConfig?.configured && (
                              <div className="rounded-lg border border-border/70 bg-secondary p-3 text-sm text-muted-foreground">
                                This will save {iniConfig.workshopIds?.length || 0} workshop items and {iniConfig.modIds?.length || 0} mod IDs.
                              </div>
                            )}
                          </div>
                          <DialogFooter className="flex-col sm:flex-row gap-2">
                            <Button variant="outline" onClick={() => setSavePresetOpen(false)} className="w-full sm:w-auto">
                              Cancel
                            </Button>
                            <Button onClick={handleSavePreset} disabled={savingPreset || !presetName.trim()} className="w-full sm:w-auto">
                              {savingPreset && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                              Save Preset
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {presetsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : presets.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No presets saved yet</p>
                        <p className="text-xs">Save your current mod configuration to create a preset</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {presets.map((preset) => (
                          <div
                            key={preset.id}
                            className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/50 p-3 transition-colors hover:bg-accent/22 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{preset.name}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {preset.workshopIds?.length || 0} mods &bull; {preset.description || 'No description'}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Saved {new Date(preset.created_at).toLocaleDateString()}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 self-start sm:self-auto">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleApplyPreset(preset.id, preset.name)}
                                disabled={applyingPreset === preset.id}
                              >
                                {applyingPreset === preset.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Download className="w-4 h-4" />
                                )}
                                <span className="ml-1.5">Load</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeletePreset(preset.id, preset.name)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/*  TOOLS SUB-TAB  */}
                {configSubTab === 'tools' && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border/40 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <MapIcon className="w-4 h-4" />
                          Maps= ({iniConfig?.maps?.length || 0})
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              setRepairingMaps(true)
                              const result = await modsApi.repairMapEntries()
                              setMapRepairResult(result)
                            } catch (err) {
                              console.error('Map repair failed:', err)
                              setMapRepairResult({ removed: [], remaining: iniConfig?.maps || [], message: 'Map repair failed — check server connection' })
                            } finally {
                              setRepairingMaps(false)
                            }
                          }}
                          disabled={repairingMaps}
                          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors disabled:opacity-50"
                          title="Validate and remove invalid map entries"
                        >
                          {repairingMaps ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                          Repair
                        </button>
                      </div>
                      {mapRepairResult && (
                        <div className={`p-2 rounded text-xs ${(mapRepairResult.removed.length > 0 || (mapRepairResult.added?.length ?? 0) > 0) ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                          {mapRepairResult.message}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {iniConfig.maps.map((map, i) => (
                          <Badge key={i} variant="secondary" className="text-xs max-w-[250px] truncate">
                            {map}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Workshop IDs Review */}
                    <div className="rounded-lg border border-border/40 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Package className="w-4 h-4" />
                        WorkshopItems= ({iniConfig.workshopIds?.length || 0})
                      </div>
                      <div className="flex flex-wrap gap-1 max-h-[200px] overflow-y-auto">
                        {iniConfig.workshopIds?.map((id, i) => (
                          <Badge key={i} variant="outline" className="text-xs font-mono">
                            {id}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded font-mono break-all max-h-[80px] overflow-y-auto">
                        WorkshopItems={iniConfig.workshopIds?.join(';') || ''}
                      </div>
                    </div>

                    {/* Operator Notes */}
                    <div className="rounded-lg border border-border/40 p-3 space-y-3 text-sm text-muted-foreground">
                      <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <Info className="w-3.5 h-3.5" />
                        Operator Notes
                      </div>
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
                        <div>
                          <p className="font-medium text-foreground text-xs">Load Order Matters</p>
                          <p className="text-xs">Frameworks and dependencies must load before content mods. Wrong order can cause silent failures.</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapIcon className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                        <div>
                          <p className="font-medium text-foreground text-xs">Map Mods Need Extra Care</p>
                          <p className="text-xs">After importing map mods, verify map folder names so spawns and cells load correctly.</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <RefreshCw className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                        <div>
                          <p className="font-medium text-foreground text-xs">Sync After Downloading New Mods</p>
                          <p className="text-xs">Workshop items without matching mod IDs usually means Steam hasn't finished downloading.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{iniConfig?.error || 'Server config file not found'}</p>
                <p className="text-sm text-muted-foreground">Start the server once — it will create the INI file automatically.</p>
              </div>
            )}
          </TabsContent>

          {/* ─── Conflicts Tab ─── */}
          <TabsContent value="conflicts" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="w-4 h-4" aria-hidden="true" />
                      Mod Conflict Scanner
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Detects when multiple mods modify the same files
                      {lastScanTime && !conflictsLoading && (
                        <span className="ml-2 tabular-nums opacity-50">
                          Last scan: {new Date(lastScanTime).toLocaleString()}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Loading state — streaming scan */}
                {conflictsLoading && !conflicts ? (
                  <div className="py-6">
                    <div className="max-w-md mx-auto space-y-4">
                      {/* Real progress bar */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
                          <span>{scanCurrentMod || 'Preparing to scan mods...'}</span>
                          {scanProgress > 0 && <span className="tabular-nums">{scanProgress}%</span>}
                        </div>
                        <div className={`h-1.5 rounded-full bg-border/50 overflow-hidden ${scanProgress === 0 ? 'scan-indeterminate' : ''}`} role="progressbar" aria-valuenow={scanProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Conflict scan progress">
                          {scanProgress > 0 && (
                            <div
                              className={`h-full rounded-full bg-primary transition-all duration-500 ease-out ${scanProgress > 0 && scanProgress < 100 ? 'scan-progress-glow' : ''} ${scanProgress >= 100 ? 'scan-complete-flash' : ''}`}
                              style={{ width: `${scanProgress}%` }}
                            />
                          )}
                        </div>
                        {scanTotalMods > 0 && (
                          <p className="text-[11px] text-muted-foreground/70">
                            {scanModsScanned} of {scanTotalMods} mods scanned
                          </p>
                        )}
                      </div>

                      {/* Live conflict feed */}
                      {streamConflicts.length > 0 && (
                        <div className="rounded-lg border border-border/30 bg-muted/10 overflow-hidden" aria-live="polite">
                          <div className="px-3 py-1.5 text-[11px] font-medium text-warning/80 border-b border-border/20 bg-warning/5">
                            {streamConflicts[streamConflicts.length - 1]?.conflictsSoFar ?? streamConflicts.length} conflict{(streamConflicts[streamConflicts.length - 1]?.conflictsSoFar ?? streamConflicts.length) !== 1 ? 's' : ''} found so far
                          </div>
                          <div className="max-h-32 overflow-y-auto">
                            {streamConflicts.slice(-8).map((c, i) => (
                              <div key={i} className={`flex items-center gap-2 px-3 py-1 text-[11px] conflict-stream-enter ${
                                c.severity === 'high' ? 'bg-destructive/5' : c.severity === 'medium' ? 'bg-warning/5' : ''
                              }`}>
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  c.severity === 'high' ? 'bg-destructive severity-pulse' : c.severity === 'medium' ? 'bg-warning' : 'bg-primary/50'
                                }`} aria-hidden="true" />
                                <span className="sr-only">{c.severity} severity:</span>
                                <span className="font-mono text-foreground/70 truncate flex-1">{c.file}</span>
                                <span className="text-muted-foreground/70 shrink-0">in {c.mods.length} mods</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : conflictsError && !conflicts ? (
                  /* Error state — scan failed with no prior results */
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <div className="text-center max-w-xs space-y-3">
                      <ShieldAlert className="w-10 h-10 mx-auto text-destructive/60" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-foreground text-sm">Scan failed</p>
                        <p className="text-xs mt-1.5 text-muted-foreground break-words" dir="auto">{conflictsError}</p>
                        <p className="text-[11px] mt-2 text-muted-foreground/60 leading-relaxed">
                          Check that the backend is running, your workshop path is set in Settings, and mods are downloaded.
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={scanConflicts} disabled={conflictsLoading}>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
                      </Button>
                    </div>
                  </div>
                ) : !conflicts ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <div className="text-center max-w-sm space-y-3">
                      <Shield className="w-10 h-10 mx-auto opacity-40" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-foreground text-sm">Scan your mods for file conflicts</p>
                        <p className="text-xs mt-1.5 text-muted-foreground leading-relaxed">
                          Checks all downloaded mods for overlapping files — Lua scripts, item definitions, textures, and more.
                          When two mods change the same file, the last one in your load order wins.
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={scanConflicts} disabled={conflictsLoading}>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Scan Mods
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={`space-y-3 stagger-in relative ${conflictsLoading ? 'pointer-events-none' : ''}`}>
                    {/* Re-scan overlay */}
                    {conflictsLoading && (
                      <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-lg transition-opacity duration-200 animate-in fade-in" role="status" aria-busy="true">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                          Scanning mods...
                        </div>
                      </div>
                    )}

                    {/* Error banner on re-scan failure */}
                    {conflictsError && (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-2 text-xs text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="flex-1 min-w-0 break-words" dir="auto">Scan failed — {conflictsError}</span>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={scanConflicts} disabled={conflictsLoading}>
                          Retry
                        </Button>
                      </div>
                    )}

                    {/* Stale results banner — INI changed since last scan */}
                    {conflictsStale && !conflictsLoading && (
                      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex items-center gap-2 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-warning" aria-hidden="true" />
                        <span className="flex-1 text-muted-foreground">Your mod list changed since this scan — results may be outdated.</span>
                        <Button variant="outline" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={scanConflicts} disabled={conflictsLoading}>
                          Rescan
                        </Button>
                      </div>
                    )}

                    {/* ─── Compact stat bar ─── */}
                    {conflicts.modsScanned > 0 ? (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-border/30 bg-muted/5 px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-xs" title={`${conflicts.totalWorkshopIds || conflicts.modsScanned} workshop items — ${conflicts.modsScanned} mod directories scanned`}>
                          <Package className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                          <span className="text-muted-foreground">Mods</span>
                          <span className="font-medium tabular-nums">{conflicts.totalWorkshopIds || conflicts.modsScanned}</span>
                          {(conflicts.modsNotFound ?? 0) > 0 && (
                            <span className="text-muted-foreground/60 font-normal text-[11px] ml-0.5">({conflicts.modsNotFound} not on disk)</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          {conflicts.totalConflicts > 0 ? (
                            <FileWarning className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                          )}
                          <span className="text-muted-foreground">Conflicts</span>
                          <span className={`font-medium tabular-nums ${conflicts.totalConflicts > 0 ? 'text-warning' : 'text-success'}`}>{conflicts.totalConflicts}</span>
                        </div>
                        {conflicts.totalPairs > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <ShieldAlert className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                            <span className="text-muted-foreground">Mod Pairs</span>
                            <span className="font-medium tabular-nums text-warning">{conflicts.totalPairs}</span>
                          </div>
                        )}
                        {(conflicts.identicalSkipped ?? 0) > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <CheckCircle className="w-3.5 h-3.5 text-success/70" aria-hidden="true" />
                            <span className="text-muted-foreground">Identical (safe)</span>
                            <span className="font-medium tabular-nums text-success">{conflicts.identicalSkipped}</span>
                          </div>
                        )}
                        {((conflicts.additiveSkipped ?? 0) + (conflicts.pzAdditiveSkipped ?? 0)) > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1.5 text-xs cursor-help">
                                <CheckCircle className="w-3.5 h-3.5 text-success/70" aria-hidden="true" />
                                <span className="text-muted-foreground">PZ Additive (safe)</span>
                                <span className="font-medium tabular-nums text-success">{(conflicts.additiveSkipped ?? 0) + (conflicts.pzAdditiveSkipped ?? 0)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs space-y-0.5">
                              <p className="font-medium mb-1">Files PZ merges automatically — not real conflicts:</p>
                              {(conflicts.pzAdditiveBreakdown?.sandbox ?? 0) > 0 && <p>{conflicts.pzAdditiveBreakdown!.sandbox} sandbox-options.txt</p>}
                              {(conflicts.pzAdditiveBreakdown?.translate ?? 0) + (conflicts.additiveSkipped ?? 0) > 0 && <p>{(conflicts.pzAdditiveBreakdown?.translate ?? 0) + (conflicts.additiveSkipped ?? 0)} translation files</p>}
                              {(conflicts.pzAdditiveBreakdown?.scripts ?? 0) > 0 && <p>{conflicts.pzAdditiveBreakdown!.scripts} script files (different definitions)</p>}
                              {(conflicts.pzAdditiveBreakdown?.clothing ?? 0) > 0 && <p>{conflicts.pzAdditiveBreakdown!.clothing} clothing XMLs (different items)</p>}
                              {(conflicts.pzAdditiveBreakdown?.fileguidtable ?? 0) > 0 && <p>{conflicts.pzAdditiveBreakdown!.fileguidtable} mod editor metadata</p>}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {((conflicts.missingDeps?.length ?? 0) + (conflicts.steamDeps?.length ?? 0)) > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 text-destructive" aria-hidden="true" />
                            <span className="text-muted-foreground">Missing Deps</span>
                            <span className="font-medium tabular-nums text-destructive">{(conflicts.missingDeps?.length ?? 0) + (conflicts.steamDeps?.length ?? 0)}</span>
                          </div>
                        )}
                        {/* Warnings inline */}
                        {(conflicts.warnings?.length ?? 0) > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1.5 text-xs cursor-help">
                                <AlertTriangle className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                                <span className="text-warning">{conflicts.warnings!.length} warning{conflicts.warnings!.length !== 1 ? 's' : ''}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs text-xs space-y-0.5">
                              {conflicts.warnings!.slice(0, 5).map((w, i) => <p key={i} className="break-words">{w}</p>)}
                              {conflicts.warnings!.length > 5 && <p className="text-muted-foreground">+{conflicts.warnings!.length - 5} more</p>}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                          <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          No mods are configured. Add mods in Server Config first.
                        </p>
                      </div>
                    )}

                    {/* No conflicts — only when scanned and nothing found */}
                    {conflicts.modsScanned > 0 && conflicts.totalConflicts === 0 && (conflicts.missingDeps?.length ?? 0) === 0 && (conflicts.steamDeps?.length ?? 0) === 0 && (
                      <div className="flex items-center justify-center py-8 text-muted-foreground scan-complete-flash">
                        <div className="text-center max-w-xs">
                          <CheckCircle className="w-8 h-8 mx-auto text-success/70 mb-2" aria-hidden="true" />
                          <p className="font-medium text-foreground text-sm">No conflicts found</p>
                          <p className="text-xs mt-1 text-muted-foreground">
                            {conflicts.modsScanned} mod{conflicts.modsScanned !== 1 ? 's' : ''} scanned — no files overlap between different mods.
                            {(conflicts.modsNotFound ?? 0) > 0 && (
                              <span className="block mt-0.5">
                                {conflicts.modsNotFound} mod{conflicts.modsNotFound !== 1 ? 's' : ''} not downloaded on disk (skipped)
                              </span>
                            )}
                            {(conflicts.identicalSkipped ?? 0) > 0 && (
                              <span className="block mt-0.5">
                                {conflicts.identicalSkipped} identical file{conflicts.identicalSkipped !== 1 ? 's' : ''} shared across mods (safe, not a conflict)
                              </span>
                            )}
                            {(conflicts.additiveSkipped ?? 0) + (conflicts.pzAdditiveSkipped ?? 0) > 0 && (
                              <span className="block mt-0.5">
                                {(conflicts.additiveSkipped ?? 0) + (conflicts.pzAdditiveSkipped ?? 0)} file{(conflicts.additiveSkipped ?? 0) + (conflicts.pzAdditiveSkipped ?? 0) !== 1 ? 's' : ''} PZ merges automatically (translations, sandbox options, clothing, scripts — not real conflicts)
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ─── Inner sub-tabs: Network / Dependencies ─── */}
                    {(conflicts.totalConflicts > 0 || (conflicts.missingDeps?.length ?? 0) > 0 || (conflicts.steamDeps?.length ?? 0) > 0) && (
                      <div>
                        {/* Sub-tab bar */}
                        <div className="flex items-center gap-1 border-b border-border/30 mb-3">
                          <button
                            onClick={() => setConflictSubTab('network')}
                            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                              conflictSubTab === 'network'
                                ? 'border-accent text-accent-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50'
                            }`}
                          >
                            <Network className="w-3.5 h-3.5" />
                            Conflict Network
                            {conflicts.totalPairs > 0 && (
                              <Badge variant="secondary" className="text-[11px] h-4 px-1 ml-0.5">{conflicts.totalPairs}</Badge>
                            )}
                          </button>
                          <button
                            onClick={() => setConflictSubTab('dependencies')}
                            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                              conflictSubTab === 'dependencies'
                                ? 'border-accent text-accent-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50'
                            }`}
                          >
                            <GitBranch className="w-3.5 h-3.5" />
                            Missing Dependencies
                            {(() => {
                              const depCount = (conflicts.missingDeps?.length ?? 0) + (conflicts.steamDeps?.length ?? 0)
                              return depCount > 0 ? (
                                <Badge variant="destructive" className="text-[11px] h-4 px-1 ml-0.5">{depCount}</Badge>
                              ) : null
                            })()}
                          </button>
                        </div>

                        {/* ═══ NETWORK SUB-TAB ═══ */}
                        {conflictSubTab === 'network' && (
                          <div className="space-y-3">
                            {/* Load order tip */}
                            {conflicts.totalConflicts > 0 && (
                              <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2">
                                <p className="text-xs text-muted-foreground flex items-start gap-2">
                                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                                  <span>When mods change the same file, the <strong className="text-foreground/80">last one in your load order</strong> takes effect. Reorder mods in Server Config to control priority.</span>
                                </p>
                              </div>
                            )}

                            {/* Top Conflicting Mods — ranked summary */}
                            {topConflictingMods.length > 0 && (
                              <div className="rounded-lg border border-border/30 bg-muted/5 overflow-hidden">
                                <div className="px-3 py-2 border-b border-border/20 bg-accent/5">
                                  <span className="text-[11px] uppercase tracking-wide text-accent-foreground/70">Most Conflicting Mods</span>
                                </div>
                                <div className="divide-y divide-border/10 max-h-[260px] overflow-y-auto">
                                  {topConflictingMods.map((mod, i) => {
                                    const isSelected = graphFilterMod === mod.modId
                                    return (
                                      <button
                                        key={mod.modId}
                                        onClick={() => setGraphFilterMod(isSelected ? null : mod.modId)}
                                        className={`w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-muted/20 ${isSelected ? 'bg-accent/10' : ''}`}
                                      >
                                        <span className="text-[11px] font-mono text-muted-foreground/60 w-4 text-right shrink-0">{i + 1}</span>
                                        <span className="flex-1 min-w-0 text-xs truncate text-foreground/80">{mod.modName}</span>
                                        <span className="flex items-center gap-1.5 shrink-0">
                                          {mod.high > 0 && <span className="text-[11px] tabular-nums text-destructive/80">{mod.high}H</span>}
                                          {mod.medium > 0 && <span className="text-[11px] tabular-nums text-warning/80">{mod.medium}M</span>}
                                          {mod.low > 0 && <span className="text-[11px] tabular-nums text-primary/60">{mod.low}L</span>}
                                          <span className="text-[11px] text-muted-foreground/60 ml-1">{mod.pairs}p</span>
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Severity filter tabs + pairs header */}
                            {(conflicts.pairs?.length ?? 0) > 0 && (() => {
                              const allPairs = graphFilterMod
                                ? conflicts.pairs!.filter(p => p.modA.modId === graphFilterMod || p.modB.modId === graphFilterMod)
                                : conflicts.pairs!
                              const highCount = allPairs.filter(p => p.highCount > 0).length
                              const medCount = allPairs.filter(p => p.mediumCount > 0).length
                              const lowCount = allPairs.filter(p => p.lowCount > 0).length
                              const allPairKeys = filteredPairs.map(p => `${p.modA.modId}--${p.modB.modId}`)
                              const allExpanded = openPairs.length === allPairKeys.length && allPairKeys.length > 0
                              return (
                                <>
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1">
                                      {[
                                        { key: 'all' as const, label: 'All', count: allPairs.length },
                                        { key: 'high' as const, label: 'Critical', count: highCount, color: 'text-destructive' },
                                        { key: 'medium' as const, label: 'Medium', count: medCount, color: 'text-warning' },
                                        { key: 'low' as const, label: 'Low', count: lowCount, color: 'text-primary/70' },
                                      ].map(tab => (
                                        <button
                                          key={tab.key}
                                          onClick={() => setPairSeverityFilter(tab.key)}
                                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                            pairSeverityFilter === tab.key
                                              ? 'bg-accent text-accent-foreground'
                                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                          }`}
                                        >
                                          {tab.label}
                                          <span className={`tabular-nums ${pairSeverityFilter === tab.key ? '' : tab.color || ''}`}>{tab.count}</span>
                                        </button>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-3">
                                      {graphFilterMod && (
                                        <button
                                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                          onClick={() => setGraphFilterMod(null)}
                                        >
                                          Clear mod filter
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => setOpenPairs(allExpanded ? [] : allPairKeys)}
                                      >
                                        {allExpanded ? 'Collapse all' : 'Expand all'}
                                      </button>
                                    </div>
                                  </div>

                                  {/* Pairs list */}
                                  {filteredPairs.length > 0 ? (
                                    <div className="max-h-[min(calc(100vh-420px),70vh)] min-h-[200px] overflow-y-auto rounded-lg border border-border/20 pr-1">
                                      <Accordion type="multiple" value={openPairs} onValueChange={setOpenPairs} className="space-y-1.5 p-1.5">
                                        {filteredPairs.map((pair, pairIdx) => {
                                          const pairKey = `${pair.modA.modId}--${pair.modB.modId}`
                                          const totalFiles = pair.files.length
                                          const showAll = expandedFilePairs.has(pairKey)
                                          const visibleFiles = showAll ? pair.files : pair.files.slice(0, CONFLICT_FILE_LIMIT)
                                          const hiddenCount = showAll ? 0 : totalFiles - Math.min(totalFiles, CONFLICT_FILE_LIMIT)
                                          const maxSeverity = pair.highCount > 0 ? 'high' : pair.mediumCount > 0 ? 'medium' : 'low'
                                          const posA = loadOrderMap.get(pair.modA.modId)
                                          const posB = loadOrderMap.get(pair.modB.modId)
                                          const winner = posA != null && posB != null ? (posA > posB ? 'A' : posB > posA ? 'B' : null) : null
                                          return (
                                            <AccordionItem key={pairKey} value={pairKey} className={`border rounded-lg px-0 overflow-hidden border-l-2 conflict-pair-enter ${
                                              maxSeverity === 'high' ? 'border-l-destructive/40' : maxSeverity === 'medium' ? 'border-l-warning/30' : 'border-l-primary/25'
                                            }`} style={{ animationDelay: `${Math.min(pairIdx * 50, 400)}ms` }}>
                                              <AccordionTrigger className="px-4 py-3 hover:no-underline [&[data-state=open]>div>.chevron]:rotate-180">
                                                <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                                                    maxSeverity === 'high' ? 'bg-destructive severity-pulse' : maxSeverity === 'medium' ? 'bg-warning' : 'bg-primary/60'
                                                  }`} aria-hidden="true" />
                                                  <span className="sr-only">{maxSeverity} severity conflict:</span>
                                                  <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 text-sm font-medium">
                                                      <span className="truncate max-w-[40%]" title={pair.modA.modName}>
                                                        {pair.modA.modName}
                                                        {posA != null && (
                                                          <Tooltip>
                                                            <TooltipTrigger asChild>
                                                              <span className="ml-1 text-[11px] font-normal text-muted-foreground/70 cursor-help">#{posA}</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="text-xs">Load order position — higher # loads last and takes priority</TooltipContent>
                                                          </Tooltip>
                                                        )}
                                                      </span>
                                                      <span className="text-muted-foreground font-normal text-xs shrink-0">vs</span>
                                                      <span className="truncate max-w-[40%]" title={pair.modB.modName}>
                                                        {pair.modB.modName}
                                                        {posB != null && (
                                                          <Tooltip>
                                                            <TooltipTrigger asChild>
                                                              <span className="ml-1 text-[11px] font-normal text-muted-foreground/70 cursor-help">#{posB}</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="text-xs">Load order position — higher # loads last and takes priority</TooltipContent>
                                                          </Tooltip>
                                                        )}
                                                      </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                      <span className="text-xs text-muted-foreground">
                                                        {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                                                      </span>
                                                      {pair.highCount > 0 && (
                                                        <Badge variant="destructive" className="text-[11px] leading-none h-[18px] px-1.5">{pair.highCount} high</Badge>
                                                      )}
                                                      {pair.mediumCount > 0 && (
                                                        <Badge variant="warning" className="text-[11px] leading-none h-[18px] px-1.5">{pair.mediumCount} med</Badge>
                                                      )}
                                                      {pair.lowCount > 0 && (
                                                        <Badge variant="secondary" className="text-[11px] leading-none h-[18px] px-1.5 border-primary/20 text-primary">{pair.lowCount} low</Badge>
                                                      )}
                                                      {winner && (
                                                        <span className="text-[11px] text-muted-foreground/70 shrink-0">
                                                          → {winner === 'A' ? pair.modA.modName : pair.modB.modName} loads last
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                              </AccordionTrigger>
                                              <AccordionContent>
                                                <div className="px-4 pb-3 pt-0.5 space-y-1">
                                                  <p className="text-[11px] text-muted-foreground/70 mb-2">
                                                    The last-loaded mod's version of each file takes effect — click a file to compare
                                                  </p>
                                                  {visibleFiles.map((f, fIdx) => (
                                                    <FileDiffViewer
                                                      key={fIdx}
                                                      file={f.file}
                                                      modAId={pair.modA.modId}
                                                      modBId={pair.modB.modId}
                                                      modAName={pair.modA.modName}
                                                      modBName={pair.modB.modName}
                                                      severity={f.severity}
                                                    />
                                                  ))}
                                                  {hiddenCount > 0 && (
                                                    <button
                                                      onClick={() => setExpandedFilePairs(prev => {
                                                        const next = new Set(prev)
                                                        next.add(pairKey)
                                                        return next
                                                      })}
                                                      className="text-[11px] text-muted-foreground/70 hover:text-foreground text-center pt-2 w-full transition-colors"
                                                    >
                                                      Show {hiddenCount} more file{hiddenCount !== 1 ? 's' : ''}
                                                    </button>
                                                  )}
                                                </div>
                                              </AccordionContent>
                                            </AccordionItem>
                                          )
                                        })}
                                      </Accordion>
                                    </div>
                                  ) : (
                                    <div className="text-center py-4 text-xs text-muted-foreground/60">
                                      No pairs match this filter
                                    </div>
                                  )}
                                </>
                              )
                            })()}



                          </div>
                        )}

                        {/* ═══ DEPENDENCIES SUB-TAB ═══ */}
                        {conflictSubTab === 'dependencies' && (() => {
                          const missingDeps = conflicts.missingDeps || [];
                          const steamDeps = conflicts.steamDeps || [];
                          const totalDeps = missingDeps.length + steamDeps.length;

                          if (totalDeps === 0) {
                            return (
                              <div className="flex items-center justify-center py-10 text-muted-foreground">
                                <div className="text-center max-w-xs">
                                  <CheckCircle className="w-8 h-8 mx-auto text-success/70 mb-2" aria-hidden="true" />
                                  <p className="font-medium text-foreground text-sm">All dependencies satisfied</p>
                                  <p className="text-xs mt-1 text-muted-foreground">Every mod's required dependencies are present in your server config.</p>
                                </div>
                              </div>
                            );
                          }

                          const handleAddDep = async (workshopId: string, modId: string, key: string) => {
                            setDepAdding(prev => [...prev, key]);
                            try {
                              await modsApi.addMissingDep(workshopId, modId);
                              setDepAddResults(prev => ({ ...prev, [key]: 'added' as const }));
                            } catch {
                              setDepAddResults(prev => ({ ...prev, [key]: 'error' as const }));
                            } finally {
                              setDepAdding(prev => prev.filter(k => k !== key));
                            }
                          };

                          // Build unified flat list from both sources
                          type DepRow = {
                            key: string
                            requiredBy: string
                            requiredByWsId: string
                            depName: string
                            depWorkshopId: string | null
                            source: 'local' | 'steam'
                          }

                          const rows: DepRow[] = []

                          // Steam deps (best quality — exact workshop IDs from Steam API)
                          for (const sd of steamDeps) {
                            const key = `steam-${sd.parentWorkshopId}-${sd.childWorkshopId}`
                            rows.push({
                              key,
                              requiredBy: sd.parentName,
                              requiredByWsId: sd.parentWorkshopId,
                              depName: sd.childName,
                              depWorkshopId: sd.childWorkshopId,
                              source: 'steam',
                            })
                          }

                          // Local mod.info deps (fallback — may overlap with steam deps)
                          for (const dep of missingDeps) {
                            // Skip if already covered by a steam dep from same parent
                            const alreadyCovered = steamDeps.some(sd =>
                              sd.parentWorkshopId === dep.workshopId && dep.resolvedWorkshopId && sd.childWorkshopId === dep.resolvedWorkshopId
                            )
                            if (alreadyCovered) continue
                            const key = `local-${dep.workshopId}-${dep.missingDep}`
                            rows.push({
                              key,
                              requiredBy: dep.modName,
                              requiredByWsId: dep.workshopId,
                              depName: dep.resolvedModName || dep.missingDep,
                              depWorkshopId: dep.resolvedWorkshopId || null,
                              source: 'local',
                            })
                          }

                          const addableRows = rows.filter(r => r.depWorkshopId && depAddResults[r.key] !== 'added')
                          const addedCount = rows.filter(r => depAddResults[r.key] === 'added').length

                          const handleFixAll = async () => {
                            if (addableRows.length === 0) return
                            setFixingAllDeps(true)
                            try {
                              await modsApi.addAllResolvedDeps(
                                addableRows.map(r => ({ workshopId: r.depWorkshopId!, modId: r.depName }))
                              )
                              for (const r of addableRows) {
                                setDepAddResults(prev => ({ ...prev, [r.key]: 'added' as const }))
                              }
                            } catch { /* handled */ }
                            finally { setFixingAllDeps(false) }
                          }

                          return (
                            <div className="space-y-3">
                              {/* Header with Fix All */}
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">
                                  {rows.length} missing{addedCount > 0 && <span className="text-green-400 ml-1">({addedCount} added)</span>}
                                </span>
                                {addableRows.length > 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleFixAll}
                                    disabled={fixingAllDeps}
                                    className="h-7 text-xs"
                                  >
                                    {fixingAllDeps ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5 mr-1.5" />}
                                    Add All ({addableRows.length})
                                  </Button>
                                )}
                              </div>

                              {/* Flat list — one row per dependency */}
                              <div className="rounded-lg border border-border/30 overflow-hidden divide-y divide-border/15 max-h-[min(calc(100vh-380px),70vh)] min-h-[200px] overflow-y-auto">
                                {rows.map((row) => {
                                  const added = depAddResults[row.key] === 'added'
                                  const adding = depAdding.includes(row.key)
                                  const errored = depAddResults[row.key] === 'error'

                                  return (
                                    <div key={row.key} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${added ? 'bg-green-500/5' : 'bg-background/30 hover:bg-muted/10'}`}>
                                      {/* Status dot */}
                                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                                        added ? 'bg-green-400' : row.depWorkshopId ? 'bg-amber-400' : 'bg-red-400'
                                      }`} />

                                      {/* Dep name + required-by (two-line) */}
                                      <div className="flex-1 min-w-0">
                                        <span className={`text-sm font-medium block truncate ${added ? 'text-green-400/80 line-through' : 'text-foreground/90'}`}>
                                          {row.depName}
                                        </span>
                                        <span className="text-[11px] text-muted-foreground/60 block truncate">
                                          required by{' '}
                                          <a href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${row.requiredByWsId}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-muted-foreground/70 hover:text-foreground underline decoration-muted-foreground/30 hover:decoration-foreground/50 transition-colors"
                                          >{row.requiredBy}</a>
                                          {row.source === 'steam' && <span className="ml-1.5 text-accent/50">via Workshop</span>}
                                        </span>
                                      </div>

                                      {/* Action */}
                                      <div className="shrink-0 flex items-center gap-1.5">
                                        {added ? (
                                          <span className="text-xs text-green-400/70 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Added</span>
                                        ) : errored ? (
                                          <span className="text-xs text-red-400/70">Failed</span>
                                        ) : row.depWorkshopId ? (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleAddDep(row.depWorkshopId!, row.depName, row.key)}
                                            disabled={adding}
                                            className="h-7 px-2.5 text-xs"
                                          >
                                            {adding ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                                            Add
                                          </Button>
                                        ) : (
                                          <a
                                            href={`https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(row.depName)}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 h-7 px-2.5 text-xs rounded-md border border-border/40 text-muted-foreground hover:text-foreground transition-colors"
                                          >
                                            <ExternalLink className="w-3 h-3" /> Find on Steam
                                          </a>
                                        )}
                                        {row.depWorkshopId && (
                                          <a href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${row.depWorkshopId}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors p-1"
                                            title="View on Steam Workshop">
                                            <ExternalLink className="w-3.5 h-3.5" />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Single mod remove confirmation */}
      <AlertDialog open={!!confirmRemoveMod} onOpenChange={(open) => { if (!open) setConfirmRemoveMod(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this mod?</AlertDialogTitle>
            <AlertDialogDescription>
              This will untrack the mod and remove it from the server INI config. The workshop files on disk won't be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmRemoveMod) handleRemoveMod(confirmRemoveMod); setConfirmRemoveMod(null) }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk remove confirmation */}
      <AlertDialog open={confirmBulkRemove} onOpenChange={setConfirmBulkRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedMods.size} mod{selectedMods.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will untrack all selected mods and remove them from the server INI config. Workshop files on disk won't be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { handleBulkRemove(); setConfirmBulkRemove(false) }}
            >
              Remove {selectedMods.size} mod{selectedMods.size !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
