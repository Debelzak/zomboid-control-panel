import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import {
  Settings,
  FileText,
  MapPin,
  Map,
  Save,
  RefreshCw,
  Search,
  Code,
  FormInput,
  Loader2,
  CheckCircle,
  AlertCircle,
  History,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ExternalLink,
  Download,
  Upload,
  RotateCcw,
  AlertTriangle,
  Copy,
  Check,
  Filter,
  Bookmark,
  FolderOpen,
  X,
  Undo2
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { reportClientError } from '@/lib/client-errors'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/components/ui/use-toast'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
// AlertDialog imports available if needed for save confirmation
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PageHeader } from '@/components/PageHeader'
// DropdownMenu imports available if needed
import { serverFilesApi, SpawnPointsByProfession, SpawnRegion, SandboxData, ConfigTemplate } from '@/lib/api'
import { EmptyState } from '@/components/EmptyState'
import {
  INI_SCHEMA,
  INI_CATEGORIES,
  SANDBOX_SCHEMA,
  SANDBOX_CATEGORIES,
  IniSetting,
  SandboxSetting,
  groupByCategory
} from '@/lib/serverConfigSchema'

type EditorMode = 'structured' | 'raw'

// --- Optimized Row Components ---

const IniSettingRow = memo(({ 
  setting, 
  value, 
  originalValue,
  onChange,
  onReset
}: { 
  setting: IniSetting; 
  value: string;
  originalValue?: string;
  onChange: (key: string, value: string) => void;
  onReset?: (key: string) => void;
}) => {
  const isModified = originalValue !== undefined && value !== originalValue
  const isDifferentFromDefault = setting.default !== undefined && String(value) !== String(setting.default)

  // Multiline settings
  if (setting.type === 'multiline') {
    return (
      <div className={`grid gap-2 rounded-md border-b py-3 pr-4 transition-colors last:border-0 ${
        isModified ? 'border-l-2 border-l-warning bg-warning/5 pl-3' : ''
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">{setting.label}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
          </div>
          {isModified && onReset && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-warning hover:text-warning" onClick={() => onReset(setting.key)}>
              <Undo2 className="w-3 h-3 mr-1" /> Reset
            </Button>
          )}
        </div>
        <Textarea
          value={value}
          onChange={(e) => onChange(setting.key, e.target.value)}
          className={`min-h-[80px] resize-y ${isModified ? 'border-warning/40' : ''}`}
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <code className="bg-muted px-1 rounded">{setting.key}</code>
          {setting.default !== undefined && (
            <span className={isDifferentFromDefault ? 'text-warning' : ''}>Default: {String(setting.default)}</span>
          )}
        </div>
      </div>
    )
  }

  // Standard settings
  return (
    <div className={`grid gap-2 rounded-md border-b py-3 pr-4 transition-colors last:border-0 ${
      isModified ? 'border-l-2 border-l-warning bg-warning/5 pl-3' : ''
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{setting.label}</Label>
            {isModified && (
              <Badge variant="warning" className="h-5 text-xs">modified</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{setting.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isModified && onReset && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-warning hover:text-warning" onClick={() => onReset(setting.key)} aria-label={`Reset ${setting.label} to loaded value`}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to loaded value</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className="w-full sm:w-48">
            {setting.type === 'boolean' ? (
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-muted-foreground">{String(value).toLowerCase() === 'true' ? 'On' : 'Off'}</span>
                <Switch
                  checked={String(value).toLowerCase() === 'true'}
                  onCheckedChange={(checked) => onChange(setting.key, checked ? 'true' : 'false')}
                />
              </div>
            ) : setting.type === 'select' && setting.options ? (
              <Select value={String(value)} onValueChange={(val) => onChange(setting.key, val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {setting.options.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : setting.type === 'number' ? (
              <div>
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '') {
                      onChange(setting.key, '')
                      return
                    }
                    onChange(setting.key, val)
                  }}
                  min={setting.min}
                  max={setting.max}
                  className={`text-right ${isModified ? 'border-warning/40' : ''}`}
                />
                {(setting.min !== undefined || setting.max !== undefined) && (
                  <div className="text-xs text-muted-foreground/60 text-right mt-0.5">
                    {setting.min !== undefined && setting.max !== undefined
                      ? `${setting.min} – ${setting.max}`
                      : setting.min !== undefined
                      ? `min: ${setting.min}`
                      : `max: ${setting.max}`}
                  </div>
                )}
              </div>
            ) : (
              <Input
                value={String(value)}
                onChange={(e) => onChange(setting.key, e.target.value)}
                className={isModified ? 'border-warning/40' : ''}
                maxLength={512}
              />
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <code className="bg-muted px-1 rounded">{setting.key}</code>
        {setting.default !== undefined && (
          <span className={isDifferentFromDefault ? 'text-warning' : ''}>Default: {String(setting.default)}</span>
        )}
      </div>
    </div>
  )
}, (prev, next) => {
  return prev.value === next.value && prev.setting === next.setting && prev.originalValue === next.originalValue
})
IniSettingRow.displayName = 'IniSettingRow'

const SandboxSettingRow = memo(({ 
  setting, 
  value, 
  originalValue,
  onChange,
  onReset
}: { 
  setting: SandboxSetting; 
  value: any;
  originalValue?: any;
  onChange: (key: string, value: any) => void;
  onReset?: (key: string) => void;
}) => {
  const isModified = originalValue !== undefined && JSON.stringify(value) !== JSON.stringify(originalValue)
  const isDifferentFromDefault = setting.default !== undefined && JSON.stringify(value) !== JSON.stringify(setting.default)

  return (
    <div className={`grid gap-2 rounded-md border-b py-3 pr-4 transition-colors last:border-0 ${
      isModified ? 'border-l-2 border-l-warning bg-warning/5 pl-3' : ''
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">{setting.label}</Label>
            {isModified && (
              <Badge variant="warning" className="h-5 text-xs">modified</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{setting.description}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <code className="bg-muted px-1 rounded">{setting.key}</code>
            {setting.default !== undefined && (
              <span className={isDifferentFromDefault ? 'text-warning' : ''}>Default: {String(setting.default)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isModified && onReset && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-warning hover:text-warning" onClick={() => onReset(setting.key)} aria-label={`Reset ${setting.label} to loaded value`}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to loaded value</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className="w-full sm:w-48">
            {setting.type === 'boolean' ? (
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-muted-foreground">{Boolean(value) ? 'On' : 'Off'}</span>
                <Switch
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => onChange(setting.key, checked)}
                />
              </div>
            ) : setting.type === 'select' && setting.options ? (
              <Select value={String(value || '')} onValueChange={(v) => onChange(setting.key, Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {setting.options.map(opt => (
                    <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div>
                <Input
                  type="number"
                  value={value !== undefined ? String(value) : ''}
                  onChange={(e) => onChange(setting.key, e.target.value)}
                  min={setting.min}
                  max={setting.max}
                  step={setting.max && setting.max <= 1 ? 0.1 : 1}
                  className={`text-right ${isModified ? 'border-warning/40' : ''}`}
                />
                {(setting.min !== undefined || setting.max !== undefined) && (
                  <div className="text-xs text-muted-foreground/60 text-right mt-0.5">
                    {setting.min !== undefined && setting.max !== undefined
                      ? `${setting.min} – ${setting.max}`
                      : setting.min !== undefined
                      ? `min: ${setting.min}`
                      : `max: ${setting.max}`}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}, (prev, next) => {
  return prev.value === next.value && prev.setting === next.setting && prev.originalValue === next.originalValue
})
SandboxSettingRow.displayName = 'SandboxSettingRow'

function ConfigSummaryCard({
  icon,
  value,
  label,
  detail,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  detail?: React.ReactNode
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
            {detail ? <div className="mt-1 text-xs text-muted-foreground/80">{detail}</div> : null}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function ServerConfig() {
  const [activeTab, setActiveTab] = useState('ini')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editorMode, setEditorMode] = useState<EditorMode>('structured')
  
  // File paths info
  const [pathsInfo, setPathsInfo] = useState<{
    configPath: string
    serverName: string
    exists: { ini: boolean; sandbox: boolean; spawnpoints: boolean; spawnregions: boolean }
  } | null>(null)
  
  // Data states
  const [iniSettings, setIniSettings] = useState<Record<string, string>>({})
  const [sandboxData, setSandboxData] = useState<SandboxData | null>(null)
  const [spawnPoints, setSpawnPoints] = useState<SpawnPointsByProfession>({})
  const [spawnRegions, setSpawnRegions] = useState<SpawnRegion[]>([])
  
  // Raw content for raw editing mode
  const [rawContent, setRawContent] = useState('')
  
  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['general']))
  
  // Backups dialog
  const [showBackups, setShowBackups] = useState(false)
  const [backups, setBackups] = useState<{ filename: string; size: number; created: string }[]>([])
  const [backupFilter, setBackupFilter] = useState<'all' | 'ini' | 'sandbox' | 'spawnpoints' | 'spawnregions'>('all')
  
  // Templates dialog
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<ConfigTemplate[]>([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateDesc, setNewTemplateDesc] = useState('')
  const [saveTemplateIni, setSaveTemplateIni] = useState(true)
  const [saveTemplateSandbox, setSaveTemplateSandbox] = useState(true)
  
  // Track original data for change detection
  const [originalIniSettings, setOriginalIniSettings] = useState<Record<string, string>>({})
  const [originalSandboxData, setOriginalSandboxData] = useState<SandboxData | null>(null)
  const [originalRawContent, setOriginalRawContent] = useState('')
  
  // Copy state
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const { toast } = useToast()

  // Load initial data
  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      // Load paths info first
      const paths = await serverFilesApi.getPaths()
      setPathsInfo(paths)

      // Load files that exist
      if (paths.exists.ini) {
        const iniData = await serverFilesApi.getIni()
        setIniSettings(iniData.settings)
        setOriginalIniSettings(iniData.settings)
      }

      if (paths.exists.sandbox) {
        const sandboxRes = await serverFilesApi.getSandbox()
        setSandboxData(sandboxRes.sandbox)
        setOriginalSandboxData(sandboxRes.sandbox)
      }

      if (paths.exists.spawnpoints) {
        const spawnRes = await serverFilesApi.getSpawnPoints()
        setSpawnPoints(spawnRes.spawnpoints)
      }

      if (paths.exists.spawnregions) {
        const regionsRes = await serverFilesApi.getSpawnRegions()
        setSpawnRegions(regionsRes.spawnregions)
      }
      setLoadError(null)
    } catch (error) {
      reportClientError('Failed to load config.', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load server config.')
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load server config',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  // Track if raw content is loading
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_loadingRaw, setLoadingRaw] = useState(false)
  
  // Load raw content when switching to raw mode
  const loadRawContent = async (type: 'ini' | 'sandbox' | 'spawnpoints' | 'spawnregions') => {
    setLoadingRaw(true)
    try {
      const data = await serverFilesApi.getRaw(type)
      setRawContent(data.content)
      setOriginalRawContent(data.content)
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load raw content',
        variant: 'destructive'
      })
      // Reset to structured mode on error
      setEditorMode('structured')
    } finally {
      setLoadingRaw(false)
    }
  }

  // Check for unsaved changes
  const hasIniChanges = useMemo(() => {
    if (editorMode === 'raw' && activeTab === 'ini') {
      return rawContent !== originalRawContent
    }
    return JSON.stringify(iniSettings) !== JSON.stringify(originalIniSettings)
  }, [editorMode, activeTab, rawContent, originalRawContent, iniSettings, originalIniSettings])

  const hasSandboxChanges = useMemo(() => {
    if (editorMode === 'raw' && activeTab === 'sandbox') {
      return rawContent !== originalRawContent
    }
    return JSON.stringify(sandboxData) !== JSON.stringify(originalSandboxData)
  }, [editorMode, activeTab, rawContent, originalRawContent, sandboxData, originalSandboxData])

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    if (hasIniChanges || hasSandboxChanges) {
      window.addEventListener('beforeunload', handler)
    }
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasIniChanges, hasSandboxChanges])

  // Create manual backup
  const handleCreateBackup = async (type: 'ini' | 'sandbox' | 'spawnpoints' | 'spawnregions') => {
    try {
      const data = await serverFilesApi.getRaw(type)
      const blob = new Blob([data.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${data.filename}_${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Downloaded', description: `Backup saved: ${data.filename}` })
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to download backup', variant: 'destructive' })
    }
  }

  // Copy raw content to clipboard
  const handleCopyRaw = async () => {
    try {
      await navigator.clipboard.writeText(rawContent)
      setCopied(true)
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Copied', description: 'Content copied to clipboard' })
    } catch {
      toast({ title: 'Error', description: 'Failed to copy', variant: 'destructive' })
    }
  }

  // Save handlers
  const handleSaveIni = async () => {
    setSaving(true)
    try {
      if (editorMode === 'raw') {
        await serverFilesApi.saveRaw('ini', rawContent)
        setOriginalRawContent(rawContent)
      } else {
        await serverFilesApi.saveIni(iniSettings)
        setOriginalIniSettings({ ...iniSettings })
      }
      
      // Try to reload via RCON, but don't fail if RCON is not connected
      try {
        await serverFilesApi.saveAndReload()
        toast({ title: 'Saved & Reloaded', description: 'Server settings saved and reloaded.' })
      } catch {
        // File was saved, but RCON reload failed - that's okay
        toast({ title: 'Saved', description: 'Settings saved. Restart server to apply changes.' })
      }
      
      if (editorMode === 'raw') {
        loadData() // Refresh structured data
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSandbox = async () => {
    setSaving(true)
    try {
      if (editorMode === 'raw') {
        await serverFilesApi.saveRaw('sandbox', rawContent)
        setOriginalRawContent(rawContent)
      } else if (sandboxData) {
        // Create a deep copy to sanitize numbers
        const cleanData = JSON.parse(JSON.stringify(sandboxData)) as SandboxData
        
        // Ensure numbers are actually numbers (not strings from input keys)
        SANDBOX_SCHEMA.forEach(setting => {
          if (setting.type === 'number') {
            const section = (setting.section || 'settings') as keyof SandboxData
            if (cleanData[section]) {
              const sectionData = cleanData[section] as Record<string, any>
              const raw = sectionData[setting.key]
              if (typeof raw === 'string') {
                const num = parseFloat(raw)
                sectionData[setting.key] = isNaN(num) ? (Number(setting.default) || 0) : num
              }
            }
          }
        })
        
        await serverFilesApi.saveSandbox(cleanData)
        // Update local state to match sanitized data
        setSandboxData(cleanData)
        setOriginalSandboxData(cleanData)
      }
      
      // Try to reload via RCON, but don't fail if RCON is not connected
      try {
        await serverFilesApi.saveAndReload()
        toast({ title: 'Saved & Reloaded', description: 'Sandbox settings saved and reloaded.' })
      } catch {
        // File was saved, but RCON reload failed - that's okay
        toast({ title: 'Saved', description: 'Settings saved. Restart server to apply changes.' })
      }
      
      if (editorMode === 'raw') {
        loadData()
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSpawnPoints = async () => {
    setSaving(true)
    try {
      if (editorMode === 'raw') {
        await serverFilesApi.saveRaw('spawnpoints', rawContent)
      } else {
        await serverFilesApi.saveSpawnPoints(spawnPoints)
      }
      toast({ title: 'Saved', description: 'Spawn points saved' })
      if (editorMode === 'raw') {
        loadData()
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSpawnRegions = async () => {
    setSaving(true)
    try {
      if (editorMode === 'raw') {
        await serverFilesApi.saveRaw('spawnregions', rawContent)
      } else {
        await serverFilesApi.saveSpawnRegions(spawnRegions)
      }
      toast({ title: 'Saved', description: 'Spawn regions saved' })
      if (editorMode === 'raw') {
        loadData()
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }

  // Filter settings by search
  const filteredIniSettings = useMemo(() => {
    if (!searchQuery) return groupByCategory(INI_SCHEMA)
    const lower = searchQuery.toLowerCase()
    const filtered = INI_SCHEMA.filter(s =>
      s.key.toLowerCase().includes(lower) ||
      s.label.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower)
    )
    return groupByCategory(filtered)
  }, [searchQuery])

  const filteredSandboxSettings = useMemo(() => {
    if (!searchQuery) return groupByCategory(SANDBOX_SCHEMA)
    const lower = searchQuery.toLowerCase()
    const filtered = SANDBOX_SCHEMA.filter(s =>
      s.key.toLowerCase().includes(lower) ||
      s.label.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower)
    )
    return groupByCategory(filtered)
  }, [searchQuery])

  // Load backups
  const loadBackups = async () => {
    try {
      const data = await serverFilesApi.getBackups()
      setBackups(data.backups)
      setShowBackups(true)
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load backups', variant: 'destructive' })
    }
  }

  // Restore backup
  const handleRestoreBackup = async (filename: string) => {
    try {
      await serverFilesApi.restoreBackup(filename)
      toast({ title: 'Restored', description: `Restored from ${filename}` })
      setShowBackups(false)
      loadData()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to restore',
        variant: 'destructive'
      })
    }
  }

  // Load templates
  const loadTemplates = async () => {
    setTemplateLoading(true)
    try {
      const data = await serverFilesApi.getTemplates()
      setTemplates(data.templates)
      setShowTemplates(true)
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load templates', variant: 'destructive' })
    } finally {
      setTemplateLoading(false)
    }
  }

  // Save current config as template
  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast({ title: 'Error', description: 'Template name is required', variant: 'destructive' })
      return
    }
    
    setTemplateLoading(true)
    try {
      const result = await serverFilesApi.saveAsTemplate({
        name: newTemplateName.trim(),
        description: newTemplateDesc.trim(),
        includeIni: saveTemplateIni,
        includeSandbox: saveTemplateSandbox
      })
      toast({ title: 'Saved', description: result.message })
      setShowSaveTemplate(false)
      setNewTemplateName('')
      setNewTemplateDesc('')
      // Refresh template list if dialog is open
      if (showTemplates) {
        const data = await serverFilesApi.getTemplates()
        setTemplates(data.templates)
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save template',
        variant: 'destructive'
      })
    } finally {
      setTemplateLoading(false)
    }
  }

  // Apply template
  const handleApplyTemplate = async (id: string) => {
    setTemplateLoading(true)
    try {
      const result = await serverFilesApi.applyTemplate(id)
      toast({ 
        title: 'Applied', 
        description: result.message 
      })
      setShowTemplates(false)
      loadData() // Reload the config data
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to apply template',
        variant: 'destructive'
      })
    } finally {
      setTemplateLoading(false)
    }
  }

  // Delete template
  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return
    
    try {
      await serverFilesApi.deleteTemplate(id)
      toast({ title: 'Deleted', description: `Template "${name}" deleted` })
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete template',
        variant: 'destructive'
      })
    }
  }

  // Optimized update handlers
  const updateIniValue = useCallback((key: string, value: string) => {
    setIniSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  const updateSandboxValue = useCallback((key: string, value: any) => {
    setSandboxData(prev => {
      if (!prev) return prev
      // Determine section - this requires us to know the section, but we only have the key
      // We can scan the schema to find the section, or rely on the passed section prop if we had one
      // Since SandboxSettingRow doesn't know the section, we need to find it
      // OPTIMIZATION: In a real app we'd pass section to the row, or map keys to sections
      
      const category = SANDBOX_SCHEMA.find(s => s.key === key)?.section || 'settings'
      
      const sectionData = { ...(prev[category as keyof SandboxData] as Record<string, unknown> || {}) }
      sectionData[key] = value
      return { ...prev, [category]: sectionData } as SandboxData
    })
  }, [])

  const expandAll = () => {
    const all = activeTab === 'ini' 
      ? INI_CATEGORIES.map(c => c.id) 
      : SANDBOX_CATEGORIES.map(c => c.id)
    setExpandedCategories(new Set(all))
  }

  const collapseAll = () => {
    setExpandedCategories(new Set())
  }

  // Reset individual INI setting to original loaded value
  const resetIniValue = useCallback((key: string) => {
    if (originalIniSettings[key] !== undefined) {
      setIniSettings(prev => ({ ...prev, [key]: originalIniSettings[key] }))
    }
  }, [originalIniSettings])

  // Reset individual Sandbox setting to original loaded value
  const resetSandboxValue = useCallback((key: string) => {
    if (!originalSandboxData || !sandboxData) return
    // Find the setting in schema to determine section
    const schemaSetting = SANDBOX_SCHEMA.find(s => s.key === key)
    if (!schemaSetting) return
    const section = (schemaSetting.section || 'settings') as keyof SandboxData
    const originalSection = originalSandboxData[section] as Record<string, any> | undefined
    if (originalSection && originalSection[key] !== undefined) {
      setSandboxData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          [section]: {
            ...(prev[section] as Record<string, any>),
            [key]: originalSection[key]
          }
        }
      })
    }
  }, [originalSandboxData, sandboxData])

  // Count changed INI settings
  const changedIniCount = useMemo(() => {
    let count = 0
    for (const key of Object.keys(iniSettings)) {
      if (originalIniSettings[key] !== undefined && iniSettings[key] !== originalIniSettings[key]) count++
    }
    return count
  }, [iniSettings, originalIniSettings])

  // Count changed Sandbox settings
  const changedSandboxCount = useMemo(() => {
    if (!sandboxData || !originalSandboxData) return 0
    let count = 0
    SANDBOX_SCHEMA.forEach(setting => {
      const section = (setting.section || 'settings') as keyof SandboxData
      const curr = (sandboxData[section] as Record<string, any>)?.[setting.key]
      const orig = (originalSandboxData[section] as Record<string, any>)?.[setting.key]
      if (JSON.stringify(curr) !== JSON.stringify(orig)) count++
    })
    return count
  }, [sandboxData, originalSandboxData])

  // Search results count
  const searchResultsCount = useMemo(() => {
    if (!searchQuery) return 0
    if (activeTab === 'ini') {
      return Object.values(filteredIniSettings).reduce((acc, settings) => acc + settings.length, 0)
    }
    if (activeTab === 'sandbox') {
      return Object.values(filteredSandboxSettings).reduce((acc, settings) => acc + settings.length, 0)
    }
    return 0
  }, [searchQuery, activeTab, filteredIniSettings, filteredSandboxSettings])

  // Ctrl+S keyboard shortcut — use refs to avoid stale closure
  const handleSaveIniRef = useRef(handleSaveIni)
  const handleSaveSandboxRef = useRef(handleSaveSandbox)
  useEffect(() => { handleSaveIniRef.current = handleSaveIni }, [handleSaveIni])
  useEffect(() => { handleSaveSandboxRef.current = handleSaveSandbox }, [handleSaveSandbox])
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeTab === 'ini' && hasIniChanges) {
          handleSaveIniRef.current()
        } else if (activeTab === 'sandbox' && hasSandboxChanges) {
          handleSaveSandboxRef.current()
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search settings"]')
        searchInput?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, hasIniChanges, hasSandboxChanges])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Stats calculations
  const iniSettingsCount = Object.keys(iniSettings).length
  const sandboxSettingsCount = sandboxData ? Object.keys(sandboxData.settings || {}).length : 0
  const spawnPointsCount = Object.values(spawnPoints).reduce((acc, points) => acc + points.length, 0)
  const professionsCount = Object.keys(spawnPoints).length

  return (
    <div className="space-y-6 page-transition">
      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration data could not be fully loaded</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">{loadError}</span>
            <Button variant="outline" size="sm" onClick={loadData} className="self-start">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <PageHeader
        title="Server Configuration"
        description="Fine-tune your server settings, sandbox variables, and spawn points"
        icon={<Settings className="h-5 w-5 text-primary" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(hasIniChanges || hasSandboxChanges) && (
              <Badge variant="warning" className="animate-pulse">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Unsaved Changes
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={loadTemplates}>
              <Bookmark className="mr-2 h-4 w-4" /> Templates
            </Button>
            <Button variant="outline" size="sm" onClick={loadBackups}>
              <History className="mr-2 h-4 w-4" /> Backups
            </Button>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      <Card className="border-border/60 bg-card/80">
        <CardContent className="space-y-4 p-4">
          {pathsInfo && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="max-w-full font-mono text-xs">
                <FolderOpen className="mr-1 h-3 w-3" />
                {pathsInfo.serverName}
              </Badge>
              <span className="min-w-0 break-all text-xs text-muted-foreground sm:max-w-md">
                {pathsInfo.configPath}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 stagger-in">
            <ConfigSummaryCard
              icon={<Settings className="h-5 w-5" />}
              value={iniSettingsCount}
              label="Server Settings"
              detail={pathsInfo?.exists.ini ? 'Loaded' : 'Not found'}
            />
            <ConfigSummaryCard
              icon={<FileText className="h-5 w-5" />}
              value={sandboxSettingsCount}
              label="Sandbox Variables"
              detail={pathsInfo?.exists.sandbox ? 'Loaded' : 'Not found'}
            />
            <ConfigSummaryCard
              icon={<MapPin className="h-5 w-5" />}
              value={spawnPointsCount}
              label="Spawn Points"
              detail={`Across ${professionsCount} profession${professionsCount !== 1 ? 's' : ''}`}
            />
            <ConfigSummaryCard
              icon={<Map className="h-5 w-5" />}
              value={spawnRegions.length}
              label="Spawn Regions"
              detail="Available towns"
            />
          </div>
        </CardContent>
      </Card>

      {/* Search and Editor Mode */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search settings by name, key, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background/50"
            aria-label="Search server settings"
            maxLength={128}
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setSearchQuery('')}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        {searchQuery && (activeTab === 'ini' || activeTab === 'sandbox') && (
          <Badge variant="secondary" className="text-xs">
            {searchResultsCount} result{searchResultsCount !== 1 ? 's' : ''}
          </Badge>
        )}
        
        {/* View Controls */}
        <div className="flex items-center gap-2">
          {editorMode === 'structured' && (activeTab === 'ini' || activeTab === 'sandbox') && (
            <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/30">
              <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs">
                <ChevronDown className="w-3 h-3 mr-1" /> Expand
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs">
                <ChevronRight className="w-3 h-3 mr-1" /> Collapse
              </Button>
            </div>
          )}
          
          <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/30">
            <Button
              variant={editorMode === 'structured' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setEditorMode('structured')}
              className="gap-1.5"
            >
              <FormInput className="w-4 h-4" /> Structured
            </Button>
            <Button
              variant={editorMode === 'raw' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => {
                setEditorMode('raw')
                // Load raw content for current tab
                const typeMap: Record<string, 'ini' | 'sandbox' | 'spawnpoints' | 'spawnregions'> = {
                  ini: 'ini',
                  sandbox: 'sandbox',
                  spawnpoints: 'spawnpoints',
                  spawnregions: 'spawnregions'
                }
                loadRawContent(typeMap[activeTab] || 'ini')
              }}
            >
              <Code className="w-4 h-4 mr-1" /> Raw
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v)
        if (editorMode === 'raw') {
          const typeMap: Record<string, 'ini' | 'sandbox' | 'spawnpoints' | 'spawnregions'> = {
            ini: 'ini',
            sandbox: 'sandbox',
            spawnpoints: 'spawnpoints',
            spawnregions: 'spawnregions'
          }
          loadRawContent(typeMap[v] || 'ini')
        }
      }}>
        <div className="overflow-x-auto pb-1">
        <TabsList className="inline-flex h-auto min-w-max gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
          <TabsTrigger value="ini" className="min-h-10 shrink-0 rounded-md px-3">
            <Settings className="w-4 h-4" />
            <span className="font-medium">Server Settings</span>
            {changedIniCount > 0 && (
              <Badge variant="warning" className="h-4 px-1.5 py-0 text-xs">
                {changedIniCount}
              </Badge>
            )}
            {hasIniChanges && activeTab !== 'ini' && (
              <span className="h-2 w-2 rounded-full bg-warning animate-pulse" title="Unsaved changes" />
            )}
            {pathsInfo?.exists.ini ? (
              <CheckCircle className="w-3 h-3 text-primary" />
            ) : (
              <AlertCircle className="w-3 h-3 text-warning" />
            )}
          </TabsTrigger>
          <TabsTrigger value="sandbox" className="min-h-10 shrink-0 rounded-md px-3">
            <FileText className="w-4 h-4" />
            <span className="font-medium">Sandbox</span>
            {changedSandboxCount > 0 && (
              <Badge variant="warning" className="h-4 px-1.5 py-0 text-xs">
                {changedSandboxCount}
              </Badge>
            )}
            {hasSandboxChanges && activeTab !== 'sandbox' && (
              <span className="h-2 w-2 rounded-full bg-warning animate-pulse" title="Unsaved changes" />
            )}
            {pathsInfo?.exists.sandbox ? (
              <CheckCircle className="w-3 h-3 text-primary" />
            ) : (
              <AlertCircle className="w-3 h-3 text-warning" />
            )}
          </TabsTrigger>
          <TabsTrigger value="spawnpoints" className="min-h-10 shrink-0 rounded-md px-3">
            <MapPin className="w-4 h-4" />
            <span className="font-medium">Spawn Points</span>
          </TabsTrigger>
          <TabsTrigger value="spawnregions" className="min-h-10 shrink-0 rounded-md px-3">
            <Map className="w-4 h-4" />
            <span className="font-medium">Spawn Regions</span>
          </TabsTrigger>
        </TabsList>
        </div>

        {/* INI Settings Tab */}
        <TabsContent value="ini" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-1.5 text-primary">
                      <Settings className="w-4 h-4" />
                    </div>
                    Server Settings (INI)
                    {hasIniChanges && (
                      <Badge variant="warning">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Unsaved
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Configure server behavior, network, and player settings
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCreateBackup('ini')} aria-label="Download INI backup">
                          <Download className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download INI backup</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <a
                    href="https://pzwiki.net/wiki/Server_settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 px-2 py-1 rounded border bg-muted/30"
                  >
                    <ExternalLink className="w-3 h-3" /> PZ Wiki
                  </a>
                  <Button onClick={handleSaveIni} disabled={saving}>
                    {saving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save & Reload
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {editorMode === 'raw' ? (
                <div className="relative">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="absolute top-2 right-2 z-10"
                          onClick={handleCopyRaw}
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copied ? 'Copied!' : 'Copy to clipboard'}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Textarea
                    value={rawContent}
                    onChange={(e) => setRawContent(e.target.value)}
                    className="h-[calc(100vh-380px)] min-h-[400px] resize-y font-mono text-sm"
                    spellCheck={false}
                  />
                </div>
              ) : (
                <ScrollArea className="h-[calc(100vh-380px)] min-h-[400px] pr-4">
                  {INI_CATEGORIES.map(category => {
                    const settings = filteredIniSettings[category.id] || []
                    if (settings.length === 0) return null
                    
                    const isExpanded = expandedCategories.has(category.id)
                    
                    return (
                      <div key={category.id} className="mb-3">
                        <button
                          onClick={() => toggleCategory(category.id)}
                          className={`flex items-center gap-3 w-full py-2.5 px-4 rounded-lg transition-all duration-200 ${
                            isExpanded 
                              ? 'border border-primary/30 bg-primary/10 shadow-sm' 
                              : 'bg-muted/50 hover:bg-muted border border-transparent'
                          }`}
                        >
                          <div className={`p-1 rounded transition-colors ${isExpanded ? 'bg-primary/20 text-primary' : 'bg-muted'}`}>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </div>
                          <span className={`font-medium ${isExpanded ? 'text-primary' : ''}`}>{category.label}</span>
                          <Badge variant={isExpanded ? "default" : "secondary"} className="ml-auto">
                            {settings.length}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="mt-3 ml-4 space-y-1 border-l-2 border-primary/30 pl-4">
                            {settings.map(setting => (
                              <IniSettingRow 
                                key={setting.key} 
                                setting={setting} 
                                value={iniSettings[setting.key] || ''} 
                                originalValue={originalIniSettings[setting.key]}
                                onChange={updateIniValue}
                                onReset={resetIniValue}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sandbox Tab */}
        <TabsContent value="sandbox" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-1.5 text-primary">
                      <FileText className="w-4 h-4" />
                    </div>
                    Sandbox Settings
                    {hasSandboxChanges && (
                      <Badge variant="warning">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Unsaved
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Configure world generation, zombies, and survival settings
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCreateBackup('sandbox')} aria-label="Download Sandbox backup">
                          <Download className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download Sandbox backup</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button onClick={handleSaveSandbox} disabled={saving}>
                    {saving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save & Reload
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {editorMode === 'raw' ? (
                <div className="relative">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="absolute top-2 right-2 z-10"
                          onClick={handleCopyRaw}
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copied ? 'Copied!' : 'Copy to clipboard'}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Textarea
                    value={rawContent}
                    onChange={(e) => setRawContent(e.target.value)}
                    className="h-[calc(100vh-380px)] min-h-[400px] resize-y font-mono text-sm"
                    spellCheck={false}
                  />
                </div>
              ) : (
                <ScrollArea className="h-[calc(100vh-380px)] min-h-[400px] pr-4">
                  {SANDBOX_CATEGORIES.map(category => {
                    const settings = filteredSandboxSettings[category.id] || []
                    if (settings.length === 0) return null
                    
                    const isExpanded = expandedCategories.has(category.id)
                    
                    return (
                      <div key={category.id} className="mb-3">
                        <button
                          onClick={() => toggleCategory(category.id)}
                          className={`flex items-center gap-3 w-full py-2.5 px-4 rounded-lg transition-all duration-200 ${
                            isExpanded 
                              ? 'border border-primary/30 bg-primary/10 shadow-sm' 
                              : 'bg-muted/50 hover:bg-muted border border-transparent'
                          }`}
                        >
                          <div className={`p-1 rounded transition-colors ${isExpanded ? 'bg-primary/20 text-primary' : 'bg-muted'}`}>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </div>
                          <span className={`font-medium ${isExpanded ? 'text-primary' : ''}`}>{category.label}</span>
                          <Badge variant={isExpanded ? "default" : "secondary"} className="ml-auto">
                            {settings.length}
                          </Badge>
                        </button>
                        {isExpanded && (
                          <div className="mt-3 ml-4 space-y-1 border-l-2 border-primary/30 pl-4">
                            {settings.map(setting => (
                              <SandboxSettingRow 
                                key={setting.key} 
                                setting={setting} 
                                value={(sandboxData?.[(setting.section || 'settings') as keyof SandboxData] as Record<string, any>)?.[setting.key]}
                                originalValue={(originalSandboxData?.[(setting.section || 'settings') as keyof SandboxData] as Record<string, any>)?.[setting.key]}
                                onChange={updateSandboxValue}
                                onReset={resetSandboxValue}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Spawn Points Tab */}
        <TabsContent value="spawnpoints" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-1.5 text-primary">
                      <MapPin className="w-4 h-4" />
                    </div>
                    Spawn Points
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Player spawn locations - typically managed by mods
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCreateBackup('spawnpoints')} aria-label="Download Spawn Points backup">
                          <Download className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download Spawnpoints backup</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <a
                    href="https://map.projectzomboid.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 px-2 py-1 rounded border bg-muted/30"
                  >
                    <ExternalLink className="w-3 h-3" /> Map Coordinates
                  </a>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {editorMode === 'raw' ? (
                <div className="relative">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="absolute top-2 right-2 z-10"
                          onClick={handleCopyRaw}
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-primary" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copied ? 'Copied!' : 'Copy to clipboard'}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Textarea
                    value={rawContent}
                    onChange={(e) => setRawContent(e.target.value)}
                    className="h-[400px] resize-y font-mono text-sm"
                    spellCheck={false}
                  />
                  <div className="flex justify-end mt-3">
                    <Button onClick={handleSaveSpawnPoints} disabled={saving}>
                      {saving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                    <MapPin className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">Spawn Points Managed by Mods</h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Spawn point configuration is typically handled by mods like "Spawn Select" or similar.
                    Switch to <strong>Raw</strong> mode to view or edit the file directly if needed.
                  </p>
                  <div className="mt-6">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditorMode('raw')
                        loadRawContent('spawnpoints')
                      }}
                    >
                      <Code className="w-4 h-4 mr-2" />
                      View Raw File
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Spawn Regions Tab */}
        <TabsContent value="spawnregions" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-1.5 text-primary">
                      <Map className="w-4 h-4" />
                    </div>
                    Spawn Regions
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Define available spawn regions (cities/towns) - these determine where players can choose to spawn
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCreateBackup('spawnregions')} aria-label="Download Spawn Regions backup">
                          <Download className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download Spawnregions backup</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button onClick={handleSaveSpawnRegions} disabled={saving}>
                    {saving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {editorMode === 'raw' ? (
                <Textarea
                  value={rawContent}
                  onChange={(e) => setRawContent(e.target.value)}
                  className="h-[400px] resize-y font-mono text-sm"
                  spellCheck={false}
                />
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSpawnRegions([...spawnRegions, { name: '', file: 'media/maps/' }])}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add Map Region
                    </Button>
                  </div>
                  
                  {spawnRegions.length === 0 ? (
                    <EmptyState type="noData" title="No spawn regions found" description="Try switching to Raw mode to view the file contents" compact />
                  ) : (
                    <div className="space-y-2">
                      {spawnRegions.map((region, index) => (
                        <div key={index} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                          <span className="text-sm font-medium sm:w-8">#{index + 1}</span>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div>
                                <Label className="text-xs">Display Name</Label>
                                <Input
                                  value={region.name}
                                  onChange={(e) => {
                                    const newRegions = [...spawnRegions]
                                    newRegions[index] = { ...region, name: e.target.value }
                                    setSpawnRegions(newRegions)
                                  }}
                                  placeholder="e.g., Muldraugh, KY"
                                  maxLength={64}
                                />
                              </div>
                              <div>
                                <Label className="text-xs flex items-center gap-2">
                                  {region.isServerFile ? 'Server File' : 'Map File Path'}
                                  {region.isServerFile && (
                                    <Badge variant="secondary" className="text-xs">serverfile</Badge>
                                  )}
                                </Label>
                                <Input
                                  value={region.file}
                                  onChange={(e) => {
                                    const newRegions = [...spawnRegions]
                                    newRegions[index] = { ...region, file: e.target.value }
                                    setSpawnRegions(newRegions)
                                  }}
                                  placeholder={region.isServerFile ? "ServerName_spawnpoints.lua" : "media/maps/Muldraugh, KY/spawnpoints.lua"}
                                  className="font-mono text-xs"
                                  maxLength={512}
                                />
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 self-end text-destructive hover:text-destructive sm:self-center"
                            onClick={() => setSpawnRegions(spawnRegions.filter((_, i) => i !== index))}
                            aria-label={`Delete spawn region ${region.name || index + 1}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Backups Dialog */}
      <Dialog open={showBackups} onOpenChange={setShowBackups}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5" />
              Configuration Backups
            </DialogTitle>
            <DialogDescription>
              Restore a previous version of your configuration files. Backups are created automatically when you save.
            </DialogDescription>
          </DialogHeader>
          
          {/* Filter tabs */}
          <div className="flex items-center gap-2 border-b pb-3">
            <span className="text-sm text-muted-foreground mr-2">
              <Filter className="w-4 h-4 inline mr-1" />
              Filter:
            </span>
            {(['all', 'ini', 'sandbox', 'spawnpoints', 'spawnregions'] as const).map((filter) => (
              <Button
                key={filter}
                variant={backupFilter === filter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setBackupFilter(filter)}
                className="capitalize"
              >
                {filter === 'all' ? 'All Files' : filter}
              </Button>
            ))}
          </div>
          
          <ScrollArea className="h-[400px]">
            {backups.length === 0 ? (
              <EmptyState type="noData" title="No backups available yet" description="Backups are created automatically when you save any config file" compact />
            ) : (
              <div className="space-y-2">
                {backups
                  .filter(backup => {
                    if (backupFilter === 'all') return true
                    const filename = backup.filename.toLowerCase()
                    if (backupFilter === 'ini') return filename.includes('_ini_') || filename.endsWith('.ini')
                    if (backupFilter === 'sandbox') return filename.includes('sandbox')
                    if (backupFilter === 'spawnpoints') return filename.includes('spawnpoints')
                    if (backupFilter === 'spawnregions') return filename.includes('spawnregions')
                    return true
                  })
                  .map((backup) => {
                    // Determine file type from filename
                    const filename = backup.filename.toLowerCase()
                    let fileType = 'config'
                    let typeColor = 'bg-muted-foreground'
                    if (filename.includes('_ini_') || filename.endsWith('.ini')) {
                      fileType = 'INI'
                      typeColor = 'bg-primary'
                    } else if (filename.includes('sandbox')) {
                      fileType = 'Sandbox'
                      typeColor = 'bg-chart-4'
                    } else if (filename.includes('spawnpoints')) {
                      fileType = 'SpawnPoints'
                      typeColor = 'bg-accent-foreground'
                    } else if (filename.includes('spawnregions')) {
                      fileType = 'SpawnRegions'
                      typeColor = 'bg-warning'
                    }
                    
                    return (
                      <div key={backup.filename} className="flex flex-col gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3 sm:items-center">
                          <Badge className={`${typeColor} text-white text-xs`}>{fileType}</Badge>
                          <div className="min-w-0">
                            <p className="break-all text-sm font-medium font-mono">{backup.filename}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(backup.created).toLocaleString()} • {Math.round(backup.size / 1024)}KB
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRestoreBackup(backup.filename)}
                                >
                                  <Upload className="w-4 h-4 mr-1" />
                                  Restore
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Replace current file with this backup</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                    )
                  })}
                {backups.filter(backup => {
                  if (backupFilter === 'all') return true
                  const filename = backup.filename.toLowerCase()
                  if (backupFilter === 'ini') return filename.includes('_ini_') || filename.endsWith('.ini')
                  if (backupFilter === 'sandbox') return filename.includes('sandbox')
                  if (backupFilter === 'spawnpoints') return filename.includes('spawnpoints')
                  if (backupFilter === 'spawnregions') return filename.includes('spawnregions')
                  return true
                }).length === 0 && backups.length > 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No backups found for "{backupFilter}" files.</p>
                    <Button variant="link" size="sm" onClick={() => setBackupFilter('all')}>
                      Show all backups
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {backups.length} backup{backups.length !== 1 ? 's' : ''} total
            </p>
            <Button variant="outline" onClick={() => setShowBackups(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Templates Dialog */}
      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="w-5 h-5" />
              Config Templates
            </DialogTitle>
            <DialogDescription>
              Save your current configuration as a template or load a saved template.
            </DialogDescription>
          </DialogHeader>
          
          {/* Save as Template button */}
          <div className="flex items-center justify-between border-b pb-3">
            <span className="text-sm text-muted-foreground">
              {templates.length} template{templates.length !== 1 ? 's' : ''} saved
            </span>
            <Button onClick={() => setShowSaveTemplate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Save Current as Template
            </Button>
          </div>
          
          <ScrollArea className="h-[400px]">
            {templates.length === 0 ? (
              <EmptyState type="noData" title="No templates saved yet" description="Click 'Save Current as Template' to create your first template" compact />
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div key={template.id} className="rounded-lg border p-4 transition-colors hover:bg-muted/50">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-medium">{template.name}</h4>
                          <Badge variant="secondary" className="text-xs">
                            {template.type === 'both' ? 'INI + Sandbox' : template.type.toUpperCase()}
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="mt-1 break-words text-sm text-muted-foreground">{template.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>Created: {new Date(template.created).toLocaleDateString()}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            {template.hasIni && <CheckCircle className="w-3 h-3 text-primary" />}
                            {template.hasIni && 'INI'}
                          </span>
                          {template.hasIni && template.hasSandbox && <span>•</span>}
                          <span className="flex items-center gap-1">
                            {template.hasSandbox && <CheckCircle className="w-3 h-3 text-primary" />}
                            {template.hasSandbox && 'Sandbox'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:ml-4 sm:self-start">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="default"
                                size="sm"
                                disabled={templateLoading}
                                onClick={() => handleApplyTemplate(template.id)}
                              >
                                {templateLoading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <>
                                    <FolderOpen className="w-4 h-4 mr-1" />
                                    Apply
                                  </>
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Load this template (creates backup first)</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteTemplate(template.id, template.name)}
                                aria-label={`Delete template ${template.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete this template</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplates(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Template Dialog */}
      <Dialog open={showSaveTemplate} onOpenChange={setShowSaveTemplate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="w-5 h-5" />
              Save as Template
            </DialogTitle>
            <DialogDescription>
              Save your current INI and/or Sandbox settings as a reusable template.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                placeholder="e.g., PvE Casual, Hardcore Survival..."
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value.slice(0, 60))}
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">{newTemplateName.length}/60 characters</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="template-desc">Description (optional)</Label>
              <Textarea
                id="template-desc"
                placeholder="Describe what this template is for..."
                value={newTemplateDesc}
                onChange={(e) => setNewTemplateDesc(e.target.value.slice(0, 240))}
                className="min-h-[80px] resize-y"
                maxLength={240}
              />
              <p className="text-xs text-muted-foreground">{newTemplateDesc.length}/240 characters</p>
            </div>
            
            <div className="space-y-3">
              <Label>Include in Template</Label>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">Server Settings (INI)</p>
                  <p className="text-xs text-muted-foreground">Network, players, RCON, server behavior</p>
                </div>
                <Switch
                  checked={saveTemplateIni}
                  onCheckedChange={setSaveTemplateIni}
                />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium">Sandbox Settings</p>
                  <p className="text-xs text-muted-foreground">World, zombies, loot, survival settings</p>
                </div>
                <Switch
                  checked={saveTemplateSandbox}
                  onCheckedChange={setSaveTemplateSandbox}
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveTemplate(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveTemplate} 
              disabled={templateLoading || !newTemplateName.trim() || (!saveTemplateIni && !saveTemplateSandbox)}
            >
              {templateLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
