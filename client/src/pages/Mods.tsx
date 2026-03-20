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
  Map,
  Library,
  Search,
  Filter,
  Settings2,
  Power,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Info,
  Layers,
  Save,
  FolderOpen,
  Loader2,
  GripVertical,
  MoreVertical
} from 'lucide-react'
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
import { modsApi } from '@/lib/api'
import { EmptyState } from '@/components/EmptyState'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
}

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
  const [showModOrderEditor, setShowModOrderEditor] = useState(false)
  const [savingModOrder, setSavingModOrder] = useState(false)
  const [draggedModIndex, setDraggedModIndex] = useState<number | null>(null)  
  // Expand/collapse states
  const [showMapsExpanded, setShowMapsExpanded] = useState(false)
  const [showWorkshopIdsExpanded, setShowWorkshopIdsExpanded] = useState(false)
  const [showModIdsExpanded, setShowModIdsExpanded] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Restart settings dialog
  const [restartSettingsOpen, setRestartSettingsOpen] = useState(false)
  const [restartWarningMinutes, setRestartWarningMinutes] = useState(5)
  const [delayIfPlayersOnline, setDelayIfPlayersOnline] = useState(false)
  const [maxDelayMinutes, setMaxDelayMinutes] = useState(30)
  
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
    type: 'duplicate' | 'missing_modid' | 'incompatible' | 'outdated_dependency'
    severity: 'error' | 'warning' | 'info'
    message: string
    modIds?: string[]
    workshopIds?: string[]
  }
  
  // Known incompatible mod pairs (workshop IDs)
  const knownIncompatibleMods: Array<{ mod1: string; mod2: string; reason: string }> = [
    // Add known incompatibilities here
    // { mod1: '123456', mod2: '789012', reason: 'Both modify the same game systems' },
  ]
  
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
    
    // Check for known incompatible mods
    for (const pair of knownIncompatibleMods) {
      if (iniConfig.workshopIds.includes(pair.mod1) && iniConfig.workshopIds.includes(pair.mod2)) {
        conflicts.push({
          type: 'incompatible',
          severity: 'error',
          message: `Incompatible mods: ${pair.reason}`,
          workshopIds: [pair.mod1, pair.mod2]
        })
      }
    }
    
    return conflicts
  }, [iniConfig])
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
      if (autoDiscoverTimeoutRef.current) {
        clearTimeout(autoDiscoverTimeoutRef.current)
      }
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
    } finally {
      setPresetsLoading(false)
    }
  }, [])
  
  // Initial data fetch + auto sync from server
  useEffect(() => {
    const initializeData = async () => {
      await Promise.allSettled([fetchData(), fetchPresets()])
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
        title: 'Error',
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
        title: 'Error',
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
        title: 'Error',
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
        title: 'Error',
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
        title: 'Invalid Input',
        description: 'Please enter a valid Workshop URL or numeric ID (e.g., 3616536783)',
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
          title: 'Mod Added',
          description: result.message + (result.mapFoldersAdded.length > 0 
            ? ` (Maps: ${result.mapFoldersAdded.join(', ')})` 
            : ''),
          variant: 'success' as const,
        })
      } else if (result.workshopAlreadyExisted) {
        toast({
          title: 'Already Configured',
          description: 'This mod is already in your server configuration',
        })
      } else {
        toast({
          title: 'Workshop ID Added',
          description: 'Workshop ID added. Mod IDs will be synced after server downloads the mod.',
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
        title: 'Error',
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
        title: 'Success',
        description: 'Mod removed from tracking and server config',
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Error',
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
        title: 'Error',
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
        title: 'Success',
        description: `Auto-restart ${status?.autoRestartEnabled ? 'disabled' : 'enabled'}`,
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Error',
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
        title: 'Success',
        description: `Synced ${result.synced || 0} mods from server configuration`,
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Error',
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
        title: 'Success',
        description: 'Update flags cleared',
      })
      fetchData()
    } catch (error) {
      toast({
        title: 'Error',
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
        title: 'Error',
        description: 'Please enter a collection URL or ID',
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
        title: 'Collection Loaded',
        description: `Found ${result.mods.length} mods in the collection`,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to import collection',
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
        title: 'Error',
        description: 'Please select at least one mod',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    try {
      const results = await Promise.allSettled(
        selectedModsList.map(async (mod) => {
          await modsApi.trackMod(mod.workshopId)
          return mod.workshopId
        })
      )

      const added = results.filter(result => result.status === 'fulfilled').length
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          reportClientWarning(`Failed to add mod ${selectedModsList[index].workshopId}.`, result.reason)
        }
      })

      setModsToInstall(prev => {
        const existing = new Set(prev.map(m => m.workshopId))
        const newMods = selectedModsList.filter(m => !existing.has(m.workshopId))
        return [...prev, ...newMods]
      })

      toast({
        title: 'Success',
        description: `Added ${added} mods for tracking`,
      })
      
      setCollectionDialogOpen(false)
      setCollectionMods([])
      setCollectionUrl('')
      fetchData()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add mods',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleWriteToIni = async () => {
    if (modsToInstall.length === 0) {
      toast({
        title: 'Error',
        description: 'No mods to configure',
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
        title: 'Error',
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
        title: 'Error',
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
        title: 'Error',
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

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      // Clear any existing timeout
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
      copiedTimeoutRef.current = setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      })
    }
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
        title: 'Error',
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
        title: 'Error',
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
                    <span className="text-xs">ACF Not Found</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Workshop ACF file not found</p>
                  <p className="text-xs text-muted-foreground">Configure server install path in Settings</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSyncFromServer} disabled={loading}>
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Sync
            </Button>
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
            <TabsList className="grid w-full grid-cols-2 sm:w-auto">
              <TabsTrigger value="mods" className="w-full">
                <Package className="w-4 h-4 mr-2" />
                Tracked Mods
              </TabsTrigger>
              <TabsTrigger value="config" className="w-full">
                <Settings2 className="w-4 h-4 mr-2" />
                Server Config
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
                      Import all mods from a Steam Workshop collection
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
                                />
                                <div className="flex-1 space-y-1 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-medium text-sm truncate">{mod.name}</span>
                                    {mod.isMap && (
                                      <Badge variant="secondary" className="text-xs">
                                        <Map className="w-3 h-3 mr-1" />
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
                      Add {collectionMods.filter(m => m.selected).length} Mods
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
                      Paste a Steam Workshop URL or ID. Mod IDs will be auto-discovered.
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
                                <Map className="w-3 h-3 mr-1" />
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
                          <div className="space-y-2">
                            <div className="rounded-md border border-border/70 bg-background/70 p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-xs font-medium">
                                  {discoveredMod.hasMultipleModIds
                                    ? `Mod IDs (${selectedModIds.size} of ${discoveredMod.modIds.length} selected)`
                                    : 'Mod ID'}
                                </Label>
                                {discoveredMod.hasMultipleModIds && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs px-2"
                                    onClick={() => setShowAdvancedIdSelection(!showAdvancedIdSelection)}
                                  >
                                    {showAdvancedIdSelection ? 'Hide Selection' : 'Review IDs'}
                                  </Button>
                                )}
                              </div>

                              {discoveredMod.hasMultipleModIds && !showAdvancedIdSelection ? (
                                <p className="text-xs text-muted-foreground mt-1.5">
                                  New IDs are pre-selected automatically. Open Review IDs to manually adjust selection.
                                </p>
                              ) : (
                                <>
                                  {discoveredMod.hasMultipleModIds && (
                                    <div className="mt-2 mb-2 flex flex-wrap gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-xs px-2"
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
                                        variant="ghost"
                                        className="h-7 text-xs px-2"
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
                                  <div className="space-y-1 max-h-40 overflow-y-auto rounded border bg-background p-1">
                                    {discoveredMod.modIds.map((modId) => {
                                      const isConfigured = discoveredMod.alreadyConfigured?.includes(modId)
                                      return (
                                        <div
                                          key={modId}
                                          role="button"
                                          tabIndex={0}
                                          aria-pressed={selectedModIds.has(modId)}
                                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                                            selectedModIds.has(modId)
                                              ? 'bg-primary/10 border border-primary'
                                              : isConfigured
                                                ? 'bg-muted/50 border border-transparent'
                                                : 'hover:bg-muted/50 border border-transparent'
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
                            <Map className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
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
                  <Button variant="destructive" size="sm" onClick={handleBulkRemove} disabled={loading}>
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
                                {configuredWorkshopIds.has(mod.workshop_id) ? 'Configured' : 'Tracked Only'}
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
                                onClick={() => handleRemoveMod(mod.workshop_id)}
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
              <Card className="border-border/70 bg-card shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Server INI Configuration
                </CardTitle>
                <CardDescription>
                  Current mod settings in your server's INI file
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {iniConfig?.configured ? (
                  <>
                    {/* Summary Stats */}
                    <div className="grid grid-cols-3 gap-4 stagger-in">
                      <div className="text-center p-3 rounded-lg border border-border/60 bg-secondary">
                        <div className="text-2xl font-bold">{iniConfig.totalMods}</div>
                        <div className="text-xs text-muted-foreground">Mods</div>
                      </div>
                      <div className="text-center p-3 rounded-lg border border-border/60 bg-secondary">
                        <div className="text-2xl font-bold">{iniConfig.workshopIds.length}</div>
                        <div className="text-xs text-muted-foreground">Workshop Items</div>
                      </div>
                      <div className="text-center p-3 rounded-lg border border-border/60 bg-secondary">
                        <div className="text-2xl font-bold">{iniConfig.maps.length}</div>
                        <div className="text-xs text-muted-foreground">Maps</div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Step 1: Detect and Sync</p>
                      <p className="text-xs text-muted-foreground">Resolve warnings and sync discovered mod IDs before applying changes.</p>
                    </div>
                    
                    {/* Conflict Warnings */}
                    {detectedConflicts.length > 0 && (
                      <div className="space-y-2">
                        {detectedConflicts.map((conflict, idx) => (
                          <div 
                            key={idx} 
                            className={`flex items-start gap-2 p-3 rounded-lg border ${
                              conflict.severity === 'error' ? 'bg-destructive/10 border-destructive/40' :
                              conflict.severity === 'warning' ? 'bg-warning/10 border-warning/40' :
                              'bg-primary/10 border-primary/30'
                            }`}
                          >
                            <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                              conflict.severity === 'error' ? 'text-destructive' :
                              conflict.severity === 'warning' ? 'text-warning' :
                              'text-primary'
                            }`} />
                            <div className="text-sm">
                              <span className={`font-medium ${
                                conflict.severity === 'error' ? 'text-destructive' :
                                conflict.severity === 'warning' ? 'text-warning' :
                                'text-primary'
                              }`}>
                                {conflict.type === 'duplicate' && 'Duplicate Mods'}
                                {conflict.type === 'missing_modid' && 'Missing Mod IDs'}
                                {conflict.type === 'incompatible' && 'Incompatible Mods'}
                                {conflict.type === 'outdated_dependency' && 'Outdated Dependency'}
                              </span>
                              <span className="text-muted-foreground">: {conflict.message}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Sync Mod IDs Button */}
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

                    <Separator />

                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Step 2: Review Maps</p>
                      <p className="text-xs text-muted-foreground">Verify map folders before changing identifiers or load order.</p>
                    </div>

                    {/* Maps List */}
                    <div>
                      <button
                        onClick={() => setShowMapsExpanded(!showMapsExpanded)}
                        className="flex items-center gap-2 text-sm font-medium mb-2 hover:text-primary transition-colors"
                      >
                        {showMapsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <Map className="w-4 h-4" />
                        Maps ({iniConfig.maps.length})
                      </button>
                      {showMapsExpanded && (
                        <div className="flex flex-wrap gap-1 ml-6">
                          {iniConfig.maps.map((map, i) => (
                            <Badge key={i} variant="secondary" className="text-xs max-w-[250px] truncate">
                              {map}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Step 3: Review IDs</p>
                      <p className="text-xs text-muted-foreground">Inspect Workshop items and resolved Mod IDs currently defined in the INI.</p>
                    </div>

                    {/* Workshop IDs List */}
                    <div>
                      <button
                        onClick={() => setShowWorkshopIdsExpanded(!showWorkshopIdsExpanded)}
                        className="flex items-center gap-2 text-sm font-medium mb-2 hover:text-primary transition-colors"
                      >
                        {showWorkshopIdsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <Package className="w-4 h-4" />
                        WorkshopItems= ({iniConfig.workshopIds?.length || 0})
                      </button>
                      {showWorkshopIdsExpanded && (
                        <div className="ml-6 space-y-2">
                          <div className="flex flex-wrap gap-1">
                            {iniConfig.workshopIds?.map((id, i) => (
                              <Badge key={i} variant="outline" className="text-xs font-mono">
                                {id}
                              </Badge>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded font-mono break-all">
                            WorkshopItems={iniConfig.workshopIds?.join(';') || ''}
                          </div>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Step 4: Tune Load Order</p>
                      <p className="text-xs text-muted-foreground">Reorder mods so dependencies load correctly, then save the load order.</p>
                    </div>

                    {/* Mod IDs List */}
                    <div>
                      <button
                        onClick={() => setShowModIdsExpanded(!showModIdsExpanded)}
                        className="flex items-center gap-2 text-sm font-medium mb-2 hover:text-primary transition-colors"
                      >
                        {showModIdsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <FileText className="w-4 h-4" />
                        Mods= ({iniConfig.modIds?.length || 0})
                      </button>
                      {showModIdsExpanded && (
                        <div className="ml-6 space-y-2">
                          <div className="flex flex-wrap gap-1">
                            {iniConfig.modIds?.map((id, i) => (
                              <Badge key={i} variant="outline" className="text-xs font-mono">
                                {id}
                              </Badge>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded font-mono break-all">
                            Mods={iniConfig.modIds?.join(';') || ''}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Mod Load Order */}
                    <div>
                      <button
                        onClick={() => setShowModOrderEditor(!showModOrderEditor)}
                        className="flex items-center gap-2 text-sm font-medium mb-2 hover:text-primary transition-colors"
                      >
                        {showModOrderEditor ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <Layers className="w-4 h-4" />
                        Mod Load Order ({orderedModIds.length})
                        {hasModOrderChanged && (
                            <Badge variant="warning" className="text-xs ml-2">
                            Modified
                          </Badge>
                        )}
                      </button>
                      {showModOrderEditor && (
                        <div className="space-y-2 ml-6">
                          <p className="text-xs text-muted-foreground mb-2">
                            Drag to reorder, or use the arrow buttons. Mods higher in the list load first.
                          </p>
                          <ScrollArea className="h-[min(48vh,20rem)] border rounded-lg p-2 sm:h-[min(52vh,24rem)]">
                            <div className="space-y-1">
                              {orderedModIds.map((modId, index) => (
                                <div
                                  key={modId}
                                  draggable
                                  onDragStart={() => handleDragStart(index)}
                                  onDragOver={(e) => handleDragOver(e, index)}
                                  onDragEnd={handleDragEnd}
                                  className={`flex items-center gap-2 p-2 rounded border bg-background hover:bg-muted/50 cursor-move transition-colors ${
                                    draggedModIndex === index ? 'opacity-50 border-primary' : ''
                                  }`}
                                >
                                  <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                  <span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
                                  <span className="text-sm font-mono flex-1 truncate">{modId}</span>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="iconDense"
                                      className="h-10 w-10 sm:h-10 sm:w-10"
                                      onClick={() => moveModUp(index)}
                                      disabled={index === 0}
                                      aria-label="Move mod up"
                                    >
                                      <ChevronRight className="w-3 h-3 rotate-[-90deg]" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="iconDense"
                                      className="h-10 w-10 sm:h-10 sm:w-10"
                                      onClick={() => moveModDown(index)}
                                      disabled={index === orderedModIds.length - 1}
                                      aria-label="Move mod down"
                                    >
                                      <ChevronRight className="w-3 h-3 rotate-90" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                          {hasModOrderChanged && (
                            <div className="flex justify-end gap-2 pt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setOrderedModIds(iniConfig.modIds)}
                              >
                                Reset
                              </Button>
                              <Button
                                size="sm"
                                onClick={handleSaveModOrder}
                                disabled={savingModOrder}
                              >
                                {savingModOrder ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <Save className="w-4 h-4 mr-2" />
                                    Save Order
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Step 5: Export or Apply</p>
                      <p className="text-xs text-muted-foreground">Copy the current config strings or write pending mod selections to the server INI.</p>
                    </div>

                    {/* Copy Buttons */}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          const text = orderedModIds.length > 0 ? orderedModIds.join(';') : (iniConfig?.modIds?.join(';') || '');
                          if (text) copyToClipboard(text, 'mods');
                        }}
                      >
                        {copiedField === 'mods' ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                        Copy Mods=
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          const text = iniConfig?.workshopIds?.join(';') || '';
                          if (text) copyToClipboard(text, 'workshop');
                        }}
                      >
                        {copiedField === 'workshop' ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                        Copy WorkshopItems=
                      </Button>
                    </div>

                    {/* Pending Mods to Install */}
                    {modsToInstall.length > 0 && (
                      <div className="space-y-3 rounded-lg border border-border/70 bg-secondary p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <Label className="flex items-center gap-2">
                            <Plus className="w-4 h-4" />
                            {modsToInstall.length} mods pending configuration
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
                              {mod.isMap && <Map className="w-3 h-3 ml-1" />}
                              <button
                                type="button"
                                aria-label={`Remove ${mod.name} from pending configuration`}
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
                  </>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{iniConfig?.error || 'Server configuration not found'}</p>
                    <p className="text-sm text-muted-foreground">Start the server once to generate the config file</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Mod Presets */}
            <Card className="border-border/70 bg-card shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Step 6: Save and Reuse</div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FolderOpen className="w-5 h-5" />
                      Mod Presets
                    </CardTitle>
                    <CardDescription>
                      Save and load different mod configurations
                    </CardDescription>
                  </div>
                  <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" disabled={!iniConfig?.configured} className="w-full sm:w-auto">
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
              </CardHeader>
              <CardContent>
                {presetsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : presets.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No presets saved yet</p>
                    <p className="text-sm">Save your current mod configuration to create a preset</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/50 p-3 transition-colors hover:bg-accent/22 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{preset.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {preset.workshopIds?.length || 0} mods • {preset.description || 'No description'}
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
              </CardContent>
            </Card>

            {/* Help Card */}
            <Card className="border-border/70 bg-card shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  Operator Safety Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-warning" />
                  <div>
                    <p className="font-medium text-foreground">Load Order Is Operationally Critical</p>
                    <p>Keep frameworks and dependencies above content mods. Incorrect order can cause silent failures.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Map className="w-4 h-4 mt-0.5 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">Map Mods Need Extra Attention</p>
                    <p>Always verify map folders and related IDs after imports so spawns and cells load correctly.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <RefreshCw className="w-4 h-4 mt-0.5 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">Run Sync Mod IDs After New Downloads</p>
                    <p>Workshop items without matching Mod IDs usually indicate mods are not fully downloaded yet.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Power className="w-4 h-4 mt-0.5 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">Auto-Restart Can Impact Active Players</p>
                    <p>Use warning and delay settings to avoid hard interruptions during high-pop sessions.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  )
}
