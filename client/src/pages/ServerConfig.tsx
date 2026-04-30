import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { copyText } from '@/lib/utils'
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
  Puzzle,
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
  Undo2,
  Globe,
  Swords,
  MessageSquare,
  Users,
  Home,
  Package,
  Cloud,
  Mic,
  MessageCircle,
  Terminal,
  Archive,
  Car,
  Shield,
  Wrench,
  Radio,
  Clock,
  Gem,
  Heart,
  Crosshair,
  Leaf,
  Compass,
  Skull,
  TrendingUp,
  BarChart,
  Layers,
  type LucideIcon
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
import { serverFilesApi, panelBridgeApi, SpawnPointsByProfession, SpawnRegion, SandboxData, ConfigTemplate } from '@/lib/api'
import { getUserErrorMessage } from '@/lib/errorMessage'
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
type SandboxScalar = string | number | boolean | null | undefined
type SandboxRecord = Record<string, SandboxScalar>

/** Merge schema defaults into parsed INI settings so schema-defined keys always exist */
function mergeSchemaDefaults(parsed: Record<string, string>): Record<string, string> {
  const merged = { ...parsed }
  for (const setting of INI_SCHEMA) {
    if (!(setting.key in merged)) {
      merged[setting.key] = String(setting.default ?? '')
    }
  }
  return merged
}

// Auth-aware image preview (img tags can't send Bearer tokens)
function AuthImage({ filePath, alt, className }: { filePath: string; alt?: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const blobRef = useRef<string | null>(null)
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    serverFilesApi.fetchImagePreview(filePath).then(url => {
      if (cancelled) { URL.revokeObjectURL(url); return }
      if (blobRef.current) URL.revokeObjectURL(blobRef.current)
      blobRef.current = url
      setBlobUrl(url)
    }).catch(() => {})
    return () => {
      cancelled = true
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null }
    }
  }, [filePath])
  if (!blobUrl) return null
  return <img src={blobUrl} alt={alt || 'Preview'} className={className} />
}

// --- Optimized Row Components ---

const IniSettingRow = memo(({ 
  setting, 
  value, 
  originalValue,
  onChange,
  onReset,
  onBrowse
}: { 
  setting: IniSetting; 
  value: string;
  originalValue?: string;
  onChange: (key: string, value: string) => void;
  onReset?: (key: string) => void;
  onBrowse?: (key: string, extensions?: string[]) => void;
}) => {
  const isModified = originalValue !== undefined && value !== originalValue
  const isDifferentFromDefault = setting.default !== undefined && String(value) !== String(setting.default)

  // Multiline settings
  if (setting.type === 'multiline') {
    return (
      <div className={`perf-content-auto grid gap-2 rounded-md border-b py-3 pl-3 pr-4 transition-colors last:border-0 ${
        isModified ? 'border-l-2 border-l-warning bg-warning/5' : 'border-l-2 border-l-transparent hover:bg-muted/20'
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
    <div className={`perf-content-auto grid gap-2 rounded-md border-b py-3 pl-3 pr-4 transition-colors last:border-0 ${
      isModified ? 'border-l-2 border-l-warning bg-warning/5' : 'border-l-2 border-l-transparent hover:bg-muted/20'
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
                  <Button variant="ghost" size="icon" className="h-11 w-11 text-warning hover:text-warning sm:h-9 sm:w-9" onClick={() => onReset(setting.key)} aria-label={`Reset ${setting.label} to loaded value`}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to loaded value</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <div className={`w-full ${setting.type === 'filepath' ? 'sm:w-72' : 'sm:w-48'}`}>
            {setting.type === 'boolean' ? (
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-muted-foreground">{String(value).toLowerCase() === 'true' ? 'On' : 'Off'}</span>
                <Switch
                  checked={String(value).toLowerCase() === 'true'}
                  onCheckedChange={(checked) => onChange(setting.key, checked ? 'true' : 'false')}
                  aria-label={setting.label || setting.key}
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
            ) : setting.type === 'filepath' ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={String(value)}
                    onChange={(e) => onChange(setting.key, e.target.value)}
                    className={`flex-1 font-mono text-xs ${isModified ? 'border-warning/40' : ''}`}
                    placeholder="No image selected"
                    maxLength={512}
                  />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => onBrowse?.(setting.key, setting.fileExtensions)} aria-label="Browse for file">
                          <FolderOpen className="w-3.5 h-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Browse for file</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {value && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onChange(setting.key, '')} aria-label="Clear image">
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Clear image</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {value && (
                  <div className="rounded-md border bg-muted/30 p-1.5 max-w-[200px]">
                    <AuthImage
                      filePath={value}
                      alt={setting.label}
                      className="rounded max-h-[80px] w-auto object-contain"
                    />
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
  return prev.value === next.value && prev.setting === next.setting && prev.originalValue === next.originalValue && prev.onBrowse === next.onBrowse
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
  value: SandboxScalar;
  originalValue?: SandboxScalar;
  onChange: (key: string, value: SandboxScalar) => void;
  onReset?: (key: string) => void;
}) => {
  const isModified = originalValue !== undefined && JSON.stringify(value) !== JSON.stringify(originalValue)
  const isDifferentFromDefault = setting.default !== undefined && JSON.stringify(value) !== JSON.stringify(setting.default)

  return (
    <div className={`perf-content-auto grid gap-2 rounded-md border-b py-3 pl-3 pr-4 transition-colors last:border-0 ${
      isModified ? 'border-l-2 border-l-warning bg-warning/5' : 'border-l-2 border-l-transparent hover:bg-muted/20'
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
                  <Button variant="ghost" size="icon" className="h-11 w-11 text-warning hover:text-warning sm:h-9 sm:w-9" onClick={() => onReset(setting.key)} aria-label={`Reset ${setting.label} to loaded value`}>
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
                  aria-label={setting.label || setting.key}
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

function StatChip({
  icon,
  value,
  label,
  ok,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  ok?: boolean
}) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  const isZero = !Number.isNaN(numericValue) && numericValue === 0
  const muted = isZero || ok === false
  return (
    <span
      className={`inline-flex items-center gap-1.5 normal-case tracking-normal ${muted ? 'opacity-55' : ''}`}
      title={ok === false ? `${label}: file not found` : undefined}
    >
      <span className={muted ? 'text-muted-foreground/50' : 'text-primary/70'}>{icon}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{value}</span>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {ok === false && (
        <AlertCircle className="h-3 w-3 text-warning" aria-label="Not found" />
      )}
    </span>
  )
}

// Map of icon names used by INI/Sandbox category schemas to lucide components.
// Each entry also has a hue token used to subtly tint the sidebar icon so categories
// are scannable by shape+color without going neon.
const CATEGORY_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  // INI categories
  Settings: { icon: Settings, tone: 'text-primary/80' },
  Globe: { icon: Globe, tone: 'text-sky-400/80' },
  Swords: { icon: Swords, tone: 'text-rose-400/80' },
  MessageSquare: { icon: MessageSquare, tone: 'text-cyan-400/80' },
  Users: { icon: Users, tone: 'text-amber-300/80' },
  Home: { icon: Home, tone: 'text-emerald-300/80' },
  Package: { icon: Package, tone: 'text-orange-300/80' },
  Puzzle: { icon: Puzzle, tone: 'text-violet-400/80' },
  Cloud: { icon: Cloud, tone: 'text-sky-300/80' },
  Mic: { icon: Mic, tone: 'text-pink-300/80' },
  MessageCircle: { icon: MessageCircle, tone: 'text-indigo-300/80' },
  Terminal: { icon: Terminal, tone: 'text-emerald-400/80' },
  Archive: { icon: Archive, tone: 'text-amber-400/80' },
  Car: { icon: Car, tone: 'text-yellow-300/80' },
  Shield: { icon: Shield, tone: 'text-blue-300/80' },
  Filter: { icon: Filter, tone: 'text-slate-300/80' },
  Radio: { icon: Radio, tone: 'text-fuchsia-300/80' },
  FileText: { icon: FileText, tone: 'text-zinc-300/80' },
  Wrench: { icon: Wrench, tone: 'text-stone-300/80' },
  // Sandbox categories
  Clock: { icon: Clock, tone: 'text-amber-300/80' },
  Gem: { icon: Gem, tone: 'text-fuchsia-300/80' },
  Heart: { icon: Heart, tone: 'text-rose-300/80' },
  Crosshair: { icon: Crosshair, tone: 'text-rose-400/80' },
  Leaf: { icon: Leaf, tone: 'text-emerald-300/80' },
  Map: { icon: Map, tone: 'text-emerald-400/80' },
  Compass: { icon: Compass, tone: 'text-cyan-300/80' },
  Skull: { icon: Skull, tone: 'text-rose-300/80' },
  TrendingUp: { icon: TrendingUp, tone: 'text-orange-300/80' },
  BarChart: { icon: BarChart, tone: 'text-amber-300/80' },
  Layers: { icon: Layers, tone: 'text-stone-300/80' },
}

function CategoryIcon({ name, isActive, className }: { name?: string; isActive?: boolean; className?: string }) {
  const entry = name ? CATEGORY_ICONS[name] : undefined
  const Icon = entry?.icon ?? Settings
  return <Icon className={`${className ?? 'h-4 w-4'} ${isActive ? 'text-primary' : entry?.tone ?? 'text-muted-foreground/70'}`} />
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
  
  // Active category in the vertical rail (one-at-a-time, tab-style)
  const [activeIniCategory, setActiveIniCategory] = useState<string>(() => {
    try { return localStorage.getItem('serverconfig-ini-cat') || 'general' } catch { return 'general' }
  })
  const [activeSandboxCategory, setActiveSandboxCategory] = useState<string>(() => {
    try { return localStorage.getItem('serverconfig-sandbox-cat') || 'time' } catch { return 'time' }
  })
  useEffect(() => { try { localStorage.setItem('serverconfig-ini-cat', activeIniCategory) } catch { /* ignore */ } }, [activeIniCategory])
  useEffect(() => { try { localStorage.setItem('serverconfig-sandbox-cat', activeSandboxCategory) } catch { /* ignore */ } }, [activeSandboxCategory])
  
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
  
  // Mod Settings (live from PanelBridge)
  const [modSettings, setModSettings] = useState<Record<string, Array<{
    name?: string; shortName?: string; tableName?: string; value?: unknown;
    type?: string; min?: number; max?: number; default?: unknown;
    enumValues?: string[]; selectedIndex?: number; translatedName?: string;
    tooltip?: string; tooltipText?: string; pageName?: string;
  }>> | null>(null)
  const [modSettingsGroups, setModSettingsGroups] = useState<Array<{ name: string; count: number }>>([])
  const [modSettingsLoading, setModSettingsLoading] = useState(false)
  const [modSettingsError, setModSettingsError] = useState<string | null>(null)
  const [modSettingsSearch, setModSettingsSearch] = useState('')
  const [modSettingsModifiedOnly, setModSettingsModifiedOnly] = useState(false)
  const [expandedModGroups, setExpandedModGroups] = useState<Set<string>>(new Set())
  const [modSettingsLastLoaded, setModSettingsLastLoaded] = useState<Date | null>(null)
  const modSettingsAbortRef = useRef<AbortController | null>(null)
  const modSettingsSearchRef = useRef<HTMLInputElement | null>(null)
  const [savingOptions, setSavingOptions] = useState<Set<string>>(new Set())

  // Shared helper: is this mod option modified from its default?
  const isOptModified = useCallback((opt: { default?: unknown; value?: unknown }) => {
    if (opt.default === undefined || opt.default === null) return false
    const d = opt.default, v = opt.value
    if (typeof d === 'number' && typeof v === 'number') return Math.abs(d - v) >= 0.0001
    return String(d) !== String(v)
  }, [])

  // Total count of modified mod options across all groups
  const modifiedModSettingsCount = useMemo(() => {
    if (!modSettings) return 0
    let c = 0
    for (const opts of Object.values(modSettings)) {
      for (const o of opts) if (isOptModified(o)) c++
    }
    return c
  }, [modSettings, isOptModified])

  // Memoize filtered mod settings groups to avoid duplicate filter logic
  const filteredModGroups = useMemo(() => {
    if (!modSettings || !modSettingsGroups.length) return []
    const q = modSettingsSearch.toLowerCase().trim()
    return modSettingsGroups
      .map(group => {
        let opts = modSettings[group.name] || []
        if (modSettingsModifiedOnly) opts = opts.filter(isOptModified)
        if (q) {
          const groupMatches = group.name.toLowerCase().includes(q)
          if (!groupMatches) {
            opts = opts.filter(o =>
              (o.name || '').toLowerCase().includes(q) ||
              (o.shortName || '').toLowerCase().includes(q) ||
              (o.translatedName || '').toLowerCase().includes(q) ||
              (o.tooltip || '').toLowerCase().includes(q) ||
              (o.tooltipText || '').toLowerCase().includes(q)
            )
          }
        }
        return { ...group, filteredOpts: opts }
      })
      .filter(g => g.filteredOpts.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [modSettings, modSettingsGroups, modSettingsSearch, modSettingsModifiedOnly, isOptModified])
  
  // Copy state
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // File browser state (for image path fields)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  const [fileBrowserKey, setFileBrowserKey] = useState('')  // which INI key we're picking a file for
  const [fileBrowserPath, setFileBrowserPath] = useState('')
  const [fileBrowserDirs, setFileBrowserDirs] = useState<string[]>([])
  const [fileBrowserFiles, setFileBrowserFiles] = useState<{ name: string; ext: string }[]>([])
  const [fileBrowserParent, setFileBrowserParent] = useState<string | null>(null)
  const [fileBrowserLoading, setFileBrowserLoading] = useState(false)
  const [fileBrowserExtensions, setFileBrowserExtensions] = useState<string[]>([])
  const [fileBrowserSelected, setFileBrowserSelected] = useState<string | null>(null)

  const { toast } = useToast()

  // Load initial data
  useEffect(() => {
    loadData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only init

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
        const merged = mergeSchemaDefaults(iniData.settings)
        setIniSettings(merged)
        setOriginalIniSettings(merged)
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
      setLoadError(getUserErrorMessage(error, 'Failed to load server config.'))
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to load server config.'),
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  // Track if raw content is loading
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
        description: getUserErrorMessage(error, 'Failed to load raw content.'),
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
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to download backup.'),
        variant: 'destructive'
      })
    }
  }

  // Copy raw content to clipboard
  const handleCopyRaw = async () => {
    try {
      await copyText(rawContent)
      setCopied(true)
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Copied', description: 'Content copied to clipboard' })
    } catch (error) {
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to copy content to clipboard.'),
        variant: 'destructive'
      })
    }
  }

  // Save handlers

  // Load mod sandbox options from PanelBridge
  const loadModSettings = useCallback(async () => {
    // Abort any in-flight request
    modSettingsAbortRef.current?.abort()
    const controller = new AbortController()
    modSettingsAbortRef.current = controller
    setModSettingsLoading(true)
    setModSettingsError(null)
    try {
      const response = await panelBridgeApi.sendCommand('getAllSandboxOptions', {}) as {
        success?: boolean
        data?: {
          options: Record<string, Array<{
            name?: string; shortName?: string; tableName?: string; value?: unknown;
            type?: string; min?: number; max?: number; default?: unknown;
            enumValues?: string[]; selectedIndex?: number; translatedName?: string;
            tooltip?: string; tooltipText?: string; pageName?: string;
          }>>
          groups: Array<{ name: string; count: number }>
          totalCount: number
          enumerated: boolean
        }
        error?: string
      }
      if (response?.success && response.data) {
        setModSettings(response.data.options)
        setModSettingsGroups(response.data.groups)
        setModSettingsLastLoaded(new Date())
        setModSettingsError(null)
      } else {
        setModSettingsError(response?.error || 'Failed to load mod settings. Is PanelBridge connected?')
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setModSettingsError(getUserErrorMessage(error, 'Failed to load mod settings. Check PanelBridge connection.'))
    } finally {
      if (!controller.signal.aborted) setModSettingsLoading(false)
    }
  }, [])

  // Auto-load mod settings the first time the user opens the tab.
  // After an error, we don't auto-retry — the user can click "Retry".
  useEffect(() => {
    if (activeTab === 'modsettings' && !modSettings && !modSettingsLoading && !modSettingsError) {
      loadModSettings()
    }
  }, [activeTab, modSettings, modSettingsLoading, modSettingsError, loadModSettings])

  // Keyboard shortcut: '/' focuses the mod settings search when the tab is active.
  // Skip when the user is already typing in a field or has a modifier held.
  useEffect(() => {
    if (activeTab !== 'modsettings') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (modSettingsSearchRef.current) {
        e.preventDefault()
        modSettingsSearchRef.current.focus()
        modSettingsSearchRef.current.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab])

  const handleOptionChange = useCallback(async (optName: string, newValue: unknown, groupName: string) => {
    // Prevent duplicate inflight requests for the same option
    setSavingOptions(prev => {
      if (prev.has(optName)) return prev
      const next = new Set(prev)
      next.add(optName)
      return next
    })
    try {
      const response = await panelBridgeApi.sendCommand('setSandboxOption', { name: optName, value: newValue }) as {
        success?: boolean
        data?: { name: string; value: unknown; type: string }
        error?: string
      }
      if (response?.success && response.data) {
        const confirmedVal = response.data.value ?? newValue
        setModSettings(prev => {
          if (!prev) return prev
          const updated = { ...prev }
          const groupOpts = updated[groupName]
          if (groupOpts) {
            updated[groupName] = groupOpts.map(o => {
              if (o.name !== optName) return o
              const patched = { ...o, value: confirmedVal }
              // Sync selectedIndex for enums so the dropdown reflects the new value
              if (o.type === 'enum' && typeof confirmedVal === 'number') {
                patched.selectedIndex = confirmedVal
              }
              return patched
            })
          }
          return updated
        })
        toast({ title: 'Option Updated', description: `${optName} set successfully` })
      } else {
        toast({ title: 'Failed to Update', description: response?.error || 'Unknown error', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Error', description: getUserErrorMessage(error, 'Failed to set option'), variant: 'destructive' })
    } finally {
      setSavingOptions(prev => {
        const next = new Set(prev)
        next.delete(optName)
        return next
      })
    }
  }, [toast])

  // File browser: open the dialog for a specific INI key
  const openFileBrowser = useCallback(async (key: string, extensions?: string[]) => {
    setFileBrowserKey(key)
    setFileBrowserExtensions(extensions || ['.png', '.jpg', '.jpeg'])
    setFileBrowserSelected(null)
    setFileBrowserOpen(true)
    setFileBrowserLoading(true)
    try {
      // Start browsing from server config path (or current value's directory)
      const currentValue = iniSettings[key]
      let startPath: string | undefined
      if (currentValue) {
        // Try the directory of the current value
        const lastSlash = Math.max(currentValue.lastIndexOf('/'), currentValue.lastIndexOf('\\'))
        if (lastSlash > 0) startPath = currentValue.substring(0, lastSlash)
      }
      const data = await serverFilesApi.browseFiles(startPath, extensions)
      setFileBrowserPath(data.currentPath)
      setFileBrowserDirs(data.directories)
      setFileBrowserFiles(data.files)
      setFileBrowserParent(data.parent)
    } catch {
      toast({ title: 'Error', description: 'Failed to browse files', variant: 'destructive' })
    } finally {
      setFileBrowserLoading(false)
    }
  }, [iniSettings, toast])

  // File browser: navigate to a directory
  const browseTo = useCallback(async (dirPath: string) => {
    setFileBrowserLoading(true)
    setFileBrowserSelected(null)
    try {
      const data = await serverFilesApi.browseFiles(dirPath, fileBrowserExtensions)
      setFileBrowserPath(data.currentPath)
      setFileBrowserDirs(data.directories)
      setFileBrowserFiles(data.files)
      setFileBrowserParent(data.parent)
    } catch {
      toast({ title: 'Error', description: 'Failed to navigate', variant: 'destructive' })
    } finally {
      setFileBrowserLoading(false)
    }
  }, [fileBrowserExtensions, toast])

  // File browser: confirm selection
  const confirmFileBrowserSelection = useCallback(() => {
    if (fileBrowserSelected && fileBrowserKey) {
      setIniSettings(prev => ({ ...prev, [fileBrowserKey]: fileBrowserSelected }))
      setFileBrowserOpen(false)
    }
  }, [fileBrowserSelected, fileBrowserKey])

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
      
      // Refresh from server to ensure frontend matches the saved file
      try {
        if (editorMode === 'raw') {
          loadData()
        } else {
          const iniData = await serverFilesApi.getIni()
          const merged = mergeSchemaDefaults(iniData.settings)
          setIniSettings(merged)
          setOriginalIniSettings(merged)
        }
      } catch { /* silent refresh — local state is still valid */ }
    } catch (error) {
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to save settings.'),
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
              const sectionData = cleanData[section] as SandboxRecord
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
      
      // Refresh from server to ensure frontend matches the saved file
      try {
        if (editorMode === 'raw') {
          loadData()
        } else {
          const sandboxRes = await serverFilesApi.getSandbox()
          setSandboxData(sandboxRes.sandbox)
          setOriginalSandboxData(sandboxRes.sandbox)
        }
      } catch { /* silent refresh — local state is still valid */ }
    } catch (error) {
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to save settings.'),
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
        description: getUserErrorMessage(error, 'Failed to save spawn points.'),
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
        description: getUserErrorMessage(error, 'Failed to save spawn regions.'),
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
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

  // Find sandbox settings not covered by the schema (mod settings, etc.)
  const uncategorizedSandboxKeys = useMemo(() => {
    if (!sandboxData) return []
    const schemaKeys = new Set(SANDBOX_SCHEMA.map(s => `${s.section || 'settings'}.${s.key}`))
    const uncategorized: { section: string; key: string; value: string | number | boolean }[] = []
    
    for (const sectionName of Object.keys(sandboxData)) {
      if (sectionName === 'VERSION') continue
      const sectionData = sandboxData[sectionName as keyof SandboxData]
      if (typeof sectionData !== 'object' || sectionData === null) continue
      for (const [key, value] of Object.entries(sectionData as Record<string, string | number | boolean>)) {
        if (!schemaKeys.has(`${sectionName}.${key}`)) {
          const lower = searchQuery?.toLowerCase() || ''
          if (!searchQuery || key.toLowerCase().includes(lower) || String(value).toLowerCase().includes(lower)) {
            uncategorized.push({ section: sectionName, key, value })
          }
        }
      }
    }
    return uncategorized.sort((a, b) => {
      if (a.section !== b.section) return a.section.localeCompare(b.section)
      return a.key.localeCompare(b.key)
    })
  }, [sandboxData, searchQuery])

  // Load backups
  const loadBackups = async () => {
    try {
      const data = await serverFilesApi.getBackups()
      setBackups(data.backups)
      setShowBackups(true)
    } catch (error) {
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to load backups.'),
        variant: 'destructive'
      })
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
        description: getUserErrorMessage(error, 'Failed to restore backup.'),
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
      toast({
        title: 'Error',
        description: getUserErrorMessage(error, 'Failed to load templates.'),
        variant: 'destructive'
      })
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
        description: getUserErrorMessage(error, 'Failed to save template.'),
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
        description: getUserErrorMessage(error, 'Failed to apply template.'),
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
        description: getUserErrorMessage(error, 'Failed to delete template.'),
        variant: 'destructive'
      })
    }
  }

  // Optimized update handlers
  const updateIniValue = useCallback((key: string, value: string) => {
    setIniSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  const updateSandboxValue = useCallback((key: string, value: SandboxScalar) => {
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

  // Reset individual INI setting to original loaded value
  const resetIniValue = useCallback((key: string) => {
    if (originalIniSettings[key] !== undefined) {
      setIniSettings(prev => ({ ...prev, [key]: originalIniSettings[key] }))
    }
  }, [originalIniSettings])

  // Discard all unsaved INI changes (sticky save bar)
  const discardIniChanges = useCallback(() => {
    setIniSettings({ ...originalIniSettings })
  }, [originalIniSettings])

  // Discard all unsaved Sandbox changes (sticky save bar)
  const discardSandboxChanges = useCallback(() => {
    if (originalSandboxData) setSandboxData(JSON.parse(JSON.stringify(originalSandboxData)))
  }, [originalSandboxData])

  // Reset individual Sandbox setting to original loaded value
  const resetSandboxValue = useCallback((key: string) => {
    if (!originalSandboxData || !sandboxData) return
    // Find the setting in schema to determine section
    const schemaSetting = SANDBOX_SCHEMA.find(s => s.key === key)
    if (!schemaSetting) return
    const section = (schemaSetting.section || 'settings') as keyof SandboxData
    const originalSection = originalSandboxData[section] as SandboxRecord | undefined
    if (originalSection && originalSection[key] !== undefined) {
      setSandboxData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          [section]: {
            ...(prev[section] as SandboxRecord),
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
      const curr = (sandboxData[section] as SandboxRecord)?.[setting.key]
      const orig = (originalSandboxData[section] as SandboxRecord)?.[setting.key]
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
  // Sync refs on every render so keyboard shortcut always calls latest version
  handleSaveIniRef.current = handleSaveIni
  handleSaveSandboxRef.current = handleSaveSandbox
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
    <div className="space-y-5 page-transition pb-24">
      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration data could not be fully loaded</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words" dir="auto" title={loadError}>{loadError}</span>
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
          <div className="flex flex-wrap items-center gap-1.5">
            {(hasIniChanges || hasSandboxChanges) && (
              <Badge variant="warning" className="animate-pulse">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Unsaved Changes
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={loadTemplates}>
              <Bookmark className="h-4 w-4" /> Templates
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={loadBackups}>
              <History className="h-4 w-4" /> Backups
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={loadData}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      <Card className="border-border/60 border-l-2 border-l-primary/70 bg-card/80">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {pathsInfo && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-6 items-center gap-1.5 rounded border border-primary/30 bg-primary/10 px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                  <FolderOpen className="h-3 w-3" />
                  {pathsInfo.serverName}
                </span>
                <span
                  className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                  title={pathsInfo.configPath}
                  dir="ltr"
                >
                  {pathsInfo.configPath}
                </span>
              </div>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <StatChip
                icon={<Settings className="h-3 w-3" />}
                value={iniSettingsCount}
                label="Server"
                ok={pathsInfo?.exists.ini}
              />
              <span className="h-3 w-px bg-border/60" aria-hidden />
              <StatChip
                icon={<FileText className="h-3 w-3" />}
                value={sandboxSettingsCount}
                label="Sandbox"
                ok={pathsInfo?.exists.sandbox}
              />
              <span className="h-3 w-px bg-border/60" aria-hidden />
              <StatChip
                icon={<MapPin className="h-3 w-3" />}
                value={spawnPointsCount}
                label={`Spawns · ${professionsCount} prof${professionsCount === 1 ? '' : 's'}`}
              />
              <span className="h-3 w-px bg-border/60" aria-hidden />
              <StatChip
                icon={<Map className="h-3 w-3" />}
                value={spawnRegions.length}
                label="Regions"
              />
            </div>
          </div>
        </CardContent>
      </Card>

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
            {!pathsInfo?.exists.ini && (
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
            {!pathsInfo?.exists.sandbox && (
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
          <TabsTrigger value="modsettings" className="min-h-10 shrink-0 rounded-md px-3">
            <Puzzle className="w-4 h-4" />
            <span className="font-medium">Mod Settings</span>
            {modifiedModSettingsCount > 0 && (
              <Badge variant="warning" className="h-4 px-1.5 py-0 text-xs" title={`${modifiedModSettingsCount} option${modifiedModSettingsCount === 1 ? '' : 's'} differ from default`}>
                {modifiedModSettingsCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        </div>

        {/* INI Settings Tab */}
        <TabsContent value="ini" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="border-b border-border/50 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex h-6 items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3 w-3" /> INI
                </span>
                <CardDescription className="min-w-0 flex-1 truncate text-xs">
                  Configure server behavior, network, and player settings
                </CardDescription>
                {hasIniChanges && (
                  <Badge variant="warning" className="h-6">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {changedIniCount} unsaved
                  </Badge>
                )}
                <div className="flex items-center gap-2 sm:ml-auto">
                  <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
                    <Button
                      variant={editorMode === 'structured' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setEditorMode('structured')}
                      className="h-8 gap-1.5 px-2 text-xs"
                      aria-pressed={editorMode === 'structured'}
                    >
                      <FormInput className="h-3.5 w-3.5" /> Structured
                    </Button>
                    <Button
                      variant={editorMode === 'raw' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        setEditorMode('raw')
                        loadRawContent('ini')
                      }}
                      className="h-8 gap-1.5 px-2 text-xs"
                      aria-pressed={editorMode === 'raw'}
                    >
                      <Code className="h-3.5 w-3.5" /> Raw
                    </Button>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCreateBackup('ini')} aria-label="Download INI backup">
                          <Download className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download INI backup</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <a
                    href="https://pzwiki.net/wiki/Server_settings"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-9 items-center gap-1 rounded border bg-muted/30 px-2 text-xs text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="h-3 w-3" /> PZ Wiki <span className="sr-only">(opens in new tab)</span>
                  </a>
                  <Button onClick={handleSaveIni} disabled={saving} size="sm" className="h-9">
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save &amp; Reload
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
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
                <div className="min-h-[400px]">
                  {/* Scoped search — applies to all categories on this tab */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-md">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search server settings…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 bg-background/50 pl-9"
                        aria-label="Search server settings"
                        maxLength={128}
                      />
                      {searchQuery && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                          onClick={() => setSearchQuery('')}
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {searchQuery && (
                      <Badge variant="secondary" className="h-6 text-xs">
                        {searchResultsCount} result{searchResultsCount !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                  {iniSettings['DoLuaChecksum']?.toLowerCase() === 'true' && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Lua Checksum is enabled</AlertTitle>
                      <AlertDescription>
                        PanelBridge modifies server-side Lua files. With Lua Checksum enabled, clients will fail verification and cannot connect. Disable <strong>DoLuaChecksum</strong> in the Mods category to allow players to join.
                      </AlertDescription>
                    </Alert>
                  )}
                  {searchQuery ? (
                    // Search mode: flat results across all categories, grouped by category label
                    <ScrollArea className="h-[calc(100vh-420px)] min-h-[360px] pr-4">
                      {INI_CATEGORIES.map(category => {
                        const settings = filteredIniSettings[category.id] || []
                        if (settings.length === 0) return null
                        return (
                          <div key={category.id} className="mb-5">
                            <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-baseline gap-2 bg-card/95 px-1 py-1.5 backdrop-blur">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {category.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70">
                                {settings.length} match{settings.length === 1 ? '' : 'es'}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {settings.map(setting => (
                                <IniSettingRow
                                  key={setting.key}
                                  setting={setting}
                                  value={iniSettings[setting.key] || ''}
                                  originalValue={originalIniSettings[setting.key]}
                                  onChange={updateIniValue}
                                  onReset={resetIniValue}
                                  onBrowse={openFileBrowser}
                                />
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      {searchResultsCount === 0 && (
                        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                          No settings match &ldquo;{searchQuery}&rdquo;.
                        </div>
                      )}
                    </ScrollArea>
                  ) : (
                    // Rail mode: vertical category nav + single active category content
                    <div className="grid gap-0 md:grid-cols-[252px_minmax(0,1fr)]">
                      <nav
                        aria-label="Server settings categories"
                        className="-mx-2 flex gap-0.5 overflow-x-auto px-2 pb-2 md:mx-0 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-border/50 md:pb-0 md:pr-3 md:pt-1 md:max-h-[calc(100vh-420px)] md:min-h-[360px]"
                      >
                        {INI_CATEGORIES.map(category => {
                          const count = (filteredIniSettings[category.id] || []).length
                          if (count === 0) return null
                          const isActive = activeIniCategory === category.id
                          return (
                            <button
                              key={category.id}
                              type="button"
                              onClick={() => setActiveIniCategory(category.id)}
                              aria-current={isActive ? 'page' : undefined}
                              className={`group relative flex shrink-0 items-center gap-2 whitespace-nowrap border-l-2 px-3 py-2 text-left text-sm transition-colors md:whitespace-normal ${
                                isActive
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-transparent text-muted-foreground hover:border-primary/30 hover:bg-muted/40 hover:text-foreground'
                              }`}
                            >
                              <CategoryIcon name={category.icon} isActive={isActive} className="h-4 w-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate font-medium">{category.label}</span>
                              <span className={`shrink-0 min-w-[1.5rem] rounded text-center px-1 py-0.5 text-[10px] font-mono tabular-nums ${
                                isActive ? 'text-primary/80' : 'bg-muted text-muted-foreground'
                              }`}>
                                {count}
                              </span>
                            </button>
                          )
                        })}
                      </nav>
                      <ScrollArea className="h-[calc(100vh-420px)] min-h-[360px] md:pl-5 pr-4">
                        {(() => {
                          const settings = filteredIniSettings[activeIniCategory] || []
                          const active = INI_CATEGORIES.find(c => c.id === activeIniCategory)
                          if (settings.length === 0) {
                            return (
                              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                No settings in this category.
                              </div>
                            )
                          }
                          return (
                            <div>
                              <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-baseline justify-between border-b border-border/50 bg-card/95 px-1 pb-2 pt-1 backdrop-blur">
                                <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">
                                  {active?.label}
                                </h3>
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {settings.length} setting{settings.length === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="space-y-1">
                                {settings.map(setting => (
                                  <IniSettingRow
                                    key={setting.key}
                                    setting={setting}
                                    value={iniSettings[setting.key] || ''}
                                    originalValue={originalIniSettings[setting.key]}
                                    onChange={updateIniValue}
                                    onReset={resetIniValue}
                                    onBrowse={openFileBrowser}
                                  />
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sandbox Tab */}
        <TabsContent value="sandbox" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="border-b border-border/50 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex h-6 items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Code className="h-3 w-3" /> Lua
                </span>
                <CardDescription className="min-w-0 flex-1 truncate text-xs">
                  Configure world generation, zombies, and survival settings
                </CardDescription>
                {hasSandboxChanges && (
                  <Badge variant="warning" className="h-6">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {changedSandboxCount} unsaved
                  </Badge>
                )}
                <div className="flex items-center gap-2 sm:ml-auto">
                  <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
                    <Button
                      variant={editorMode === 'structured' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setEditorMode('structured')}
                      className="h-8 gap-1.5 px-2 text-xs"
                      aria-pressed={editorMode === 'structured'}
                    >
                      <FormInput className="h-3.5 w-3.5" /> Structured
                    </Button>
                    <Button
                      variant={editorMode === 'raw' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        setEditorMode('raw')
                        loadRawContent('sandbox')
                      }}
                      className="h-8 gap-1.5 px-2 text-xs"
                      aria-pressed={editorMode === 'raw'}
                    >
                      <Code className="h-3.5 w-3.5" /> Raw
                    </Button>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCreateBackup('sandbox')} aria-label="Download Sandbox backup">
                          <Download className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Download Sandbox backup</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button onClick={handleSaveSandbox} disabled={saving} size="sm" className="h-9">
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save &amp; Reload
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
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
                <div className="min-h-[400px]">
                  {/* Scoped search — applies to all categories on this tab */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 sm:max-w-md">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search sandbox settings…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 bg-background/50 pl-9"
                        aria-label="Search sandbox settings"
                        maxLength={128}
                      />
                      {searchQuery && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                          onClick={() => setSearchQuery('')}
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {searchQuery && (
                      <Badge variant="secondary" className="h-6 text-xs">
                        {searchResultsCount} result{searchResultsCount !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                  {searchQuery ? (
                    // Search mode: flat, grouped by category label
                    <ScrollArea className="h-[calc(100vh-420px)] min-h-[360px] pr-4">
                      {SANDBOX_CATEGORIES.map(category => {
                        const settings = filteredSandboxSettings[category.id] || []
                        if (settings.length === 0) return null
                        return (
                          <div key={category.id} className="mb-5">
                            <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-baseline gap-2 bg-card/95 px-1 py-1.5 backdrop-blur">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {category.label}
                              </span>
                              <span className="text-[10px] text-muted-foreground/70">
                                {settings.length} match{settings.length === 1 ? '' : 'es'}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {settings.map(setting => (
                                <SandboxSettingRow
                                  key={setting.key}
                                  setting={setting}
                                  value={(sandboxData?.[(setting.section || 'settings') as keyof SandboxData] as SandboxRecord)?.[setting.key]}
                                  originalValue={(originalSandboxData?.[(setting.section || 'settings') as keyof SandboxData] as SandboxRecord)?.[setting.key]}
                                  onChange={updateSandboxValue}
                                  onReset={resetSandboxValue}
                                />
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      {searchResultsCount === 0 && (
                        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                          No settings match &ldquo;{searchQuery}&rdquo;.
                        </div>
                      )}
                    </ScrollArea>
                  ) : (
                    // Rail mode: vertical category nav + single active category content
                    <div className="grid gap-0 md:grid-cols-[252px_minmax(0,1fr)]">
                      <nav
                        aria-label="Sandbox categories"
                        className="-mx-2 flex gap-0.5 overflow-x-auto px-2 pb-2 md:mx-0 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-border/50 md:pb-0 md:pr-3 md:pt-1 md:max-h-[calc(100vh-420px)] md:min-h-[360px]"
                      >
                        {SANDBOX_CATEGORIES.map(category => {
                          const count = (filteredSandboxSettings[category.id] || []).length
                          if (count === 0) return null
                          const isActive = activeSandboxCategory === category.id
                          return (
                            <button
                              key={category.id}
                              type="button"
                              onClick={() => setActiveSandboxCategory(category.id)}
                              aria-current={isActive ? 'page' : undefined}
                              className={`group relative flex shrink-0 items-center gap-2 whitespace-nowrap border-l-2 px-3 py-2 text-left text-sm transition-colors md:whitespace-normal ${
                                isActive
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-transparent text-muted-foreground hover:border-primary/30 hover:bg-muted/40 hover:text-foreground'
                              }`}
                            >
                              <CategoryIcon name={category.icon} isActive={isActive} className="h-4 w-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate font-medium">{category.label}</span>
                              <span className={`shrink-0 min-w-[1.5rem] rounded text-center px-1 py-0.5 text-[10px] font-mono tabular-nums ${
                                isActive ? 'text-primary/80' : 'bg-muted text-muted-foreground'
                              }`}>
                                {count}
                              </span>
                            </button>
                          )
                        })}
                        {uncategorizedSandboxKeys.length > 0 && (() => {
                          const isActive = activeSandboxCategory === 'uncategorized'
                          return (
                            <button
                              key="uncategorized"
                              type="button"
                              onClick={() => setActiveSandboxCategory('uncategorized')}
                              aria-current={isActive ? 'page' : undefined}
                              className={`group relative mt-1 flex shrink-0 items-center gap-2 whitespace-nowrap border-l-2 px-3 py-2 text-left text-sm transition-colors md:mt-2 md:whitespace-normal md:border-t md:border-t-border/50 md:pt-3 ${
                                isActive
                                  ? 'border-l-amber-500 bg-amber-500/10 text-amber-500'
                                  : 'border-l-transparent text-muted-foreground hover:border-l-amber-500/30 hover:bg-amber-500/5 hover:text-amber-500/80'
                              }`}
                              title="Settings from mods or keys not recognized by the schema"
                            >
                              <span className="min-w-0 flex-1 truncate font-medium">Uncategorized / Mods</span>
                              <span className={`shrink-0 min-w-[1.5rem] rounded text-center px-1 py-0.5 text-[10px] font-mono tabular-nums ${
                                isActive ? 'text-amber-500/80' : 'bg-muted text-muted-foreground'
                              }`}>
                                {uncategorizedSandboxKeys.length}
                              </span>
                            </button>
                          )
                        })()}
                      </nav>
                      <ScrollArea className="h-[calc(100vh-420px)] min-h-[360px] md:pl-5 pr-4">
                        {(() => {
                          if (activeSandboxCategory === 'uncategorized') {
                            if (uncategorizedSandboxKeys.length === 0) {
                              return (
                                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                  No uncategorized settings.
                                </div>
                              )
                            }
                            return (
                              <div>
                                <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-baseline justify-between border-b border-amber-500/30 bg-card/95 px-1 pb-2 pt-1 backdrop-blur">
                                  <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-500">
                                    Uncategorized / Mod Settings
                                  </h3>
                                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                    {uncategorizedSandboxKeys.length} key{uncategorizedSandboxKeys.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                                <p className="mb-3 text-xs text-muted-foreground">
                                  Keys from installed mods or sandbox options not recognized by the schema. Edit with care.
                                </p>
                                <div className="space-y-1">
                                  {uncategorizedSandboxKeys.map(({ section, key, value }) => {
                                    const origSection = originalSandboxData?.[section as keyof SandboxData]
                                    const origValue = typeof origSection === 'object' ? (origSection as Record<string, unknown>)?.[key] : undefined
                                    const isModified = value !== origValue
                                    return (
                                      <div key={`${section}.${key}`} className={`flex items-center justify-between py-2 px-3 rounded-md transition-colors ${isModified ? 'bg-amber-500/10 border border-amber-500/20' : 'hover:bg-muted/50'}`}>
                                        <div className="flex-1 min-w-0 mr-4">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-sm font-medium truncate" title={key}>{key}</span>
                                            {section !== 'settings' && (
                                              <code className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">{section}</code>
                                            )}
                                            {isModified && (
                                              <button
                                                onClick={() => {
                                                  if (origValue !== undefined) {
                                                    setSandboxData(prev => {
                                                      if (!prev) return prev
                                                      const s = { ...(prev[section as keyof SandboxData] as Record<string, unknown> || {}) }
                                                      s[key] = origValue
                                                      return { ...prev, [section]: s } as SandboxData
                                                    })
                                                  }
                                                }}
                                                className="text-xs text-amber-500 hover:text-amber-400"
                                                title="Undo change"
                                              >↩</button>
                                            )}
                                          </div>
                                        </div>
                                        <Input
                                          className="w-48 h-8 text-sm flex-shrink-0"
                                          value={String(value)}
                                          maxLength={500}
                                          onChange={e => {
                                            const raw = e.target.value
                                            let parsed: string | number | boolean = raw
                                            if (raw === 'true') parsed = true
                                            else if (raw === 'false') parsed = false
                                            else if (raw !== '' && !isNaN(Number(raw))) parsed = Number(raw)
                                            setSandboxData(prev => {
                                              if (!prev) return prev
                                              const s = { ...(prev[section as keyof SandboxData] as Record<string, unknown> || {}) }
                                              s[key] = parsed
                                              return { ...prev, [section]: s } as SandboxData
                                            })
                                          }}
                                        />
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          }
                          const settings = filteredSandboxSettings[activeSandboxCategory] || []
                          const active = SANDBOX_CATEGORIES.find(c => c.id === activeSandboxCategory)
                          if (settings.length === 0) {
                            return (
                              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                No settings in this category.
                              </div>
                            )
                          }
                          return (
                            <div>
                              <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-baseline justify-between border-b border-border/50 bg-card/95 px-1 pb-2 pt-1 backdrop-blur">
                                <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">
                                  {active?.label}
                                </h3>
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {settings.length} setting{settings.length === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="space-y-1">
                                {settings.map(setting => (
                                  <SandboxSettingRow
                                    key={setting.key}
                                    setting={setting}
                                    value={(sandboxData?.[(setting.section || 'settings') as keyof SandboxData] as SandboxRecord)?.[setting.key]}
                                    originalValue={(originalSandboxData?.[(setting.section || 'settings') as keyof SandboxData] as SandboxRecord)?.[setting.key]}
                                    onChange={updateSandboxValue}
                                    onReset={resetSandboxValue}
                                  />
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                      </ScrollArea>
                    </div>
                  )}
                </div>
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
                        <Button variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => handleCreateBackup('spawnpoints')} aria-label="Download Spawn Points backup">
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
                    <ExternalLink className="w-3 h-3" /> Map Coordinates <span className="sr-only">(opens in new tab)</span>
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
                        <Button variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => handleCreateBackup('spawnregions')} aria-label="Download Spawn Regions backup">
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
                <div className="space-y-3">
                  {spawnRegions.length === 0 ? (
                    <EmptyState type="noData" title="No spawn regions found" description="Try switching to Raw mode to view the file contents" compact />
                  ) : (
                    <div className="space-y-2">
                      {spawnRegions.map((region, index) => (
                        <div key={index} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
                          <div className="flex items-center gap-2 sm:w-[220px] sm:flex-shrink-0">
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted/40 px-1.5 text-xs font-mono font-medium text-muted-foreground">
                              {index + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Display Name</Label>
                              <Input
                                value={region.name}
                                onChange={(e) => {
                                  const newRegions = [...spawnRegions]
                                  newRegions[index] = { ...region, name: e.target.value }
                                  setSpawnRegions(newRegions)
                                }}
                                placeholder="e.g., Muldraugh, KY"
                                maxLength={64}
                                className="mt-0.5 h-9"
                              />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                              {region.isServerFile ? 'Server File' : 'Map File Path'}
                              {region.isServerFile && (
                                <Badge variant="secondary" className="text-[10px] py-0">serverfile</Badge>
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
                              className="mt-0.5 h-9 font-mono text-xs"
                              maxLength={512}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 self-end text-muted-foreground hover:text-destructive sm:self-start sm:mt-[18px]"
                            onClick={() => setSpawnRegions(spawnRegions.filter((_, i) => i !== index))}
                            aria-label={`Delete spawn region ${region.name || index + 1}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSpawnRegions([...spawnRegions, { name: '', file: 'media/maps/' }])}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add Map Region
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mod Settings Tab (Live from PanelBridge) */}
        <TabsContent value="modsettings" className="mt-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <div className="rounded-lg border border-primary/20 bg-primary/10 p-1.5 text-primary">
                      <Puzzle className="w-4 h-4" />
                    </div>
                    Mod Sandbox Options
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Live sandbox settings registered by mods, read from the running server via PanelBridge.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadModSettings}
                    disabled={modSettingsLoading}
                    className="gap-2"
                  >
                    {modSettingsLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    {modSettings ? 'Refresh' : 'Load from Server'}
                  </Button>
                </div>
              </div>

              {modSettings && modSettingsGroups.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      ref={modSettingsSearchRef}
                      placeholder="Search mod settings…  (press /)"
                      value={modSettingsSearch}
                      onChange={(e) => setModSettingsSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setModSettingsSearch(''); e.currentTarget.blur() } }}
                      className="pl-9 pr-8"
                      maxLength={200}
                    />
                    {modSettingsSearch && (
                      <button
                        onClick={() => setModSettingsSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <Button
                    variant={modSettingsModifiedOnly ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setModSettingsModifiedOnly(v => !v)}
                    disabled={modifiedModSettingsCount === 0 && !modSettingsModifiedOnly}
                    className="shrink-0 h-9 gap-1.5"
                    aria-pressed={modSettingsModifiedOnly}
                    title={modifiedModSettingsCount === 0 ? 'No options differ from default' : 'Show only options changed from default'}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    Modified
                    {modifiedModSettingsCount > 0 && (
                      <Badge variant={modSettingsModifiedOnly ? 'secondary' : 'warning'} className="ml-0.5 h-4 px-1.5 py-0 text-xs">
                        {modifiedModSettingsCount}
                      </Badge>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const allVisible = filteredModGroups.length > 0 && filteredModGroups.every(g => expandedModGroups.has(g.name))
                      if (allVisible) {
                        setExpandedModGroups(new Set())
                      } else {
                        setExpandedModGroups(new Set(filteredModGroups.map(g => g.name)))
                      }
                    }}
                    className="shrink-0 text-xs gap-1.5"
                  >
                    {filteredModGroups.length > 0 && filteredModGroups.every(g => expandedModGroups.has(g.name)) ? (
                      <><ChevronDown className="w-3.5 h-3.5" /> Collapse All</>
                    ) : (
                      <><ChevronRight className="w-3.5 h-3.5" /> Expand All</>
                    )}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!modSettings && !modSettingsLoading && !modSettingsError && (
                <EmptyState
                  type="noMods"
                  title="Loading mod settings…"
                  description="Fetching sandbox options from all installed mods via PanelBridge. The PZ server must be running with PanelBridge active."
                />
              )}

              {modSettingsError && (
                <Alert variant={modSettings ? 'default' : 'destructive'} className="mb-3">
                  <AlertCircle className="w-4 h-4" />
                  <AlertTitle>{modSettings ? 'Refresh failed — showing previous data' : 'Failed to load mod settings'}</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-3">
                    <span className="break-words min-w-0">{modSettingsError}</span>
                    <Button variant="outline" size="sm" onClick={loadModSettings} disabled={modSettingsLoading} className="shrink-0 gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5" /> Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {modSettingsLoading && (
                <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading sandbox options from server...</span>
                </div>
              )}

              {modSettings && modSettingsGroups.length === 0 && !modSettingsLoading && (
                <EmptyState
                  type="noMods"
                  title="No sandbox options found"
                  description="The server returned no sandbox options. This may happen if no mods register custom sandbox settings, or the API isn't available in this PZ build."
                />
              )}

              {modSettings && modSettingsGroups.length > 0 && (
                <ScrollArea className="h-[calc(100vh-440px)] min-h-[400px] pr-4">
                  <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                    <Badge variant="secondary">
                      {modSettingsSearch || modSettingsModifiedOnly ? `${filteredModGroups.length} / ${modSettingsGroups.length}` : modSettingsGroups.length} groups
                    </Badge>
                    <Badge variant="secondary">
                      {modSettingsSearch || modSettingsModifiedOnly
                        ? `${filteredModGroups.reduce((s, g) => s + g.filteredOpts.length, 0)} / ${modSettingsGroups.reduce((s, g) => s + g.count, 0)}`
                        : modSettingsGroups.reduce((s, g) => s + g.count, 0)
                      } options
                    </Badge>
                    {modifiedModSettingsCount > 0 && (
                      <Badge variant="warning" className="gap-1" title="Options that differ from their default value">
                        <AlertTriangle className="w-3 h-3" />
                        {modifiedModSettingsCount} modified
                      </Badge>
                    )}
                    {modSettingsLastLoaded && (
                      <span className="text-xs text-muted-foreground/60 ml-auto">
                        Loaded {modSettingsLastLoaded.toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {filteredModGroups
                    .map(group => {
                      // When the user is actively filtering, force groups open so matches
                      // are immediately visible (otherwise hits hide behind collapsed headers).
                      const isFiltering = !!modSettingsSearch.trim() || modSettingsModifiedOnly
                      const isExpanded = isFiltering || expandedModGroups.has(group.name)
                      const filteredOpts = group.filteredOpts
                      // Modified count for this whole group (not just visible/filtered)
                      const groupAllOpts = modSettings[group.name] || []
                      const groupModifiedCount = groupAllOpts.reduce((c, o) => c + (isOptModified(o) ? 1 : 0), 0)

                      return (
                        <div key={group.name} className="mb-3">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedModGroups(prev => {
                                const next = new Set(prev)
                                if (next.has(group.name)) next.delete(group.name)
                                else next.add(group.name)
                                return next
                              })
                            }}
                            aria-expanded={isExpanded}
                            className={`flex items-center gap-3 w-full py-2.5 px-4 rounded-lg transition-[background-color,border-color,box-shadow,color] duration-200 ${
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
                            <span className={`font-medium truncate min-w-0 ${isExpanded ? 'text-primary' : ''}`} title={group.name}>{group.name}</span>
                            {groupModifiedCount > 0 && (
                              <Badge variant="warning" className="h-5 px-1.5 py-0 text-[10px] font-mono shrink-0" title={`${groupModifiedCount} option${groupModifiedCount === 1 ? '' : 's'} differ from default`}>
                                {groupModifiedCount} mod
                              </Badge>
                            )}
                            <Badge variant={isExpanded ? "default" : "secondary"} className="ml-auto">
                              {filteredOpts.length}
                            </Badge>
                          </button>
                          {isExpanded && (
                            <div className="mt-3 ml-4 space-y-1 border-l-2 border-primary/30 pl-4">
                              {filteredOpts.map((opt, idx) => {
                                // Build a clean display name: prefer translatedName, fall back to shortName with "Sandbox_" stripped
                                const rawDisplayName = opt.shortName || opt.name || `Option ${idx}`
                                const displayName = (opt.translatedName && opt.translatedName !== rawDisplayName)
                                  ? opt.translatedName
                                  : rawDisplayName.replace(/^Sandbox_/i, '').replace(/_/g, ' ')
                                // Parse description from tooltipText: strip trailing "\nDefault = ..." line
                                const rawTooltip = opt.tooltipText || opt.tooltip || ''
                                const description = rawTooltip
                                  .replace(/\\n/g, '\n')
                                  .replace(/\n?Default\s*=\s*.*/i, '')
                                  .trim()
                                const rawVal = opt.value
                                let displayValue: string
                                if (rawVal === undefined || rawVal === null) {
                                  displayValue = '—'
                                } else if (typeof rawVal === 'number') {
                                  displayValue = Number.isInteger(rawVal) ? String(rawVal) : rawVal.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
                                } else {
                                  displayValue = String(rawVal)
                                }
                                const typeLabel = opt.type || 'unknown'
                                const boolValue = typeLabel === 'boolean'
                                  ? (rawVal === true || rawVal === 'true' || rawVal === 1)
                                  : false
                                const isSaving = opt.name ? savingOptions.has(opt.name) : false
                                const isModified = isOptModified(opt)

                                return (
                                  <div
                                    key={`${opt.name || 'opt'}-${idx}`}
                                    className={`flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 gap-4 ${isSaving ? 'opacity-60 pointer-events-none' : ''}`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm truncate" title={opt.name || displayName}>
                                        {displayName}
                                      </div>
                                      {description && (
                                        <div className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2" title={rawTooltip}>
                                          {description}
                                        </div>
                                      )}
                                      {opt.name && opt.name !== displayName && (
                                        <div className="text-[10px] text-muted-foreground/40 font-mono truncate mt-0.5" title={opt.name}>{opt.name}</div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {typeLabel === 'boolean' ? (
                                        <div className="flex items-center gap-2">
                                          <Switch
                                            checked={boolValue}
                                            onCheckedChange={(checked) => opt.name && !isSaving && handleOptionChange(opt.name, checked, group.name)}
                                            disabled={isSaving}
                                            aria-label={`${displayName}: ${boolValue ? 'ON' : 'OFF'}`}
                                          />
                                          <span className={`text-xs font-mono ${boolValue ? 'text-primary' : 'text-muted-foreground'}`}>
                                            {boolValue ? 'ON' : 'OFF'}
                                          </span>
                                        </div>
                                      ) : typeLabel === 'enum' && opt.enumValues && opt.enumValues.length > 0 ? (
                                        <Select
                                          value={opt.selectedIndex !== undefined ? String(opt.selectedIndex) : displayValue}
                                          onValueChange={(val) => {
                                            if (!opt.name || isSaving) return
                                            const idx = parseInt(val, 10)
                                            if (isNaN(idx)) return
                                            handleOptionChange(opt.name, idx, group.name)
                                          }}
                                          disabled={isSaving}
                                        >
                                          <SelectTrigger className="h-7 w-full sm:w-[180px] text-xs font-mono" aria-label={displayName}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {opt.enumValues.map((ev, ei) => (
                                              <SelectItem key={ei} value={String(ei)} className="text-xs font-mono">
                                                {ev}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      ) : typeLabel === 'number' || typeLabel === 'double' || typeLabel === 'integer' ? (
                                        <Input
                                          key={`${opt.name}-${displayValue}`}
                                          type="number"
                                          className="h-7 w-full sm:w-[100px] text-xs font-mono text-right"
                                          defaultValue={displayValue}
                                          min={opt.min}
                                          max={opt.max}
                                          step={typeLabel === 'double' ? 0.01 : 1}
                                          disabled={isSaving}
                                          aria-label={displayName}
                                          onBlur={(e) => {
                                            let num = parseFloat(e.target.value)
                                            if (isNaN(num) || !opt.name) return
                                            if (opt.min !== undefined) num = Math.max(opt.min, num)
                                            if (opt.max !== undefined) num = Math.min(opt.max, num)
                                            if (num === rawVal) return
                                            e.target.value = String(num)
                                            handleOptionChange(opt.name, num, group.name)
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              (e.target as HTMLInputElement).blur()
                                            }
                                          }}
                                        />
                                      ) : (
                                        <Input
                                          key={`${opt.name}-${displayValue}`}
                                          type="text"
                                          className="h-7 w-full sm:w-[160px] text-xs font-mono"
                                          defaultValue={displayValue}
                                          disabled={isSaving}
                                          aria-label={displayName}
                                          onBlur={(e) => {
                                            if (e.target.value !== String(rawVal) && opt.name) {
                                              handleOptionChange(opt.name, e.target.value, group.name)
                                            }
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              (e.target as HTMLInputElement).blur()
                                            }
                                          }}
                                        />
                                      )}
                                      {opt.min !== undefined && opt.max !== undefined && (
                                        <span className="text-xs text-muted-foreground/60 whitespace-nowrap">
                                          {opt.min}–{opt.max}
                                        </span>
                                      )}
                                      {isModified && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              className="text-xs text-muted-foreground/50 hover:text-primary whitespace-nowrap flex items-center gap-1"
                                              onClick={() => opt.name && opt.default !== undefined && handleOptionChange(opt.name, opt.default, group.name)}
                                              disabled={isSaving}
                                              title={`Reset to default: ${opt.default}`}
                                            >
                                              <Undo2 className="w-3 h-3" />
                                              <span>def: {String(opt.default)}</span>
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent side="left">
                                            <p>Reset to default: {String(opt.default)}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                      {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  {filteredModGroups.length === 0 && (modSettingsSearch || modSettingsModifiedOnly) && (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                      {modSettingsModifiedOnly && !modSettingsSearch ? (
                        <>
                          <Filter className="w-5 h-5 opacity-50" />
                          <p className="text-sm">No options have been modified from their defaults.</p>
                          <Button variant="ghost" size="sm" onClick={() => setModSettingsModifiedOnly(false)} className="text-xs">
                            Show all options
                          </Button>
                        </>
                      ) : (
                        <>
                          <Search className="w-5 h-5 opacity-50" />
                          <p className="text-sm">No settings match &ldquo;{modSettingsSearch.length > 60 ? modSettingsSearch.slice(0, 60) + '…' : modSettingsSearch}&rdquo;{modSettingsModifiedOnly ? ' in modified options' : ''}</p>
                          <div className="flex gap-2">
                            {modSettingsSearch && (
                              <Button variant="ghost" size="sm" onClick={() => setModSettingsSearch('')} className="text-xs">
                                Clear search
                              </Button>
                            )}
                            {modSettingsModifiedOnly && (
                              <Button variant="ghost" size="sm" onClick={() => setModSettingsModifiedOnly(false)} className="text-xs">
                                Show all options
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sticky save bar — appears when there are unsaved changes on the active tab */}
      {((activeTab === 'ini' && hasIniChanges) || (activeTab === 'sandbox' && hasSandboxChanges)) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:px-6 sm:pb-5">
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-lg border border-warning/40 bg-card/95 px-4 py-2.5 shadow-lg shadow-black/30 backdrop-blur supports-[backdrop-filter]:bg-card/80 motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warning/15 text-warning">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">
                {activeTab === 'ini' ? changedIniCount : changedSandboxCount}{' '}
                unsaved {((activeTab === 'ini' ? changedIniCount : changedSandboxCount) === 1) ? 'change' : 'changes'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {activeTab === 'ini' ? 'Server INI' : 'Sandbox (Lua)'} · Ctrl+S to save · changes apply on reload
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={activeTab === 'ini' ? discardIniChanges : discardSandboxChanges}
              disabled={saving}
              className="h-8 text-muted-foreground hover:text-destructive"
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Discard
            </Button>
            <Button
              size="sm"
              onClick={activeTab === 'ini' ? handleSaveIni : handleSaveSandbox}
              disabled={saving}
              className="h-8"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save &amp; Reload
            </Button>
          </div>
        </div>
      )}
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
                            <p className="break-all text-sm font-medium font-mono" dir="auto" title={backup.filename}>{backup.filename}</p>
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
                          <h4 className="font-medium break-words" dir="auto" title={template.name}>{template.name}</h4>
                          <Badge variant="secondary" className="text-xs">
                            {template.type === 'both' ? 'INI + Sandbox' : template.type.toUpperCase()}
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="mt-1 break-words text-sm text-muted-foreground" dir="auto" title={template.description}>{template.description}</p>
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
                                className="h-11 w-11 text-destructive hover:text-destructive sm:h-9 sm:w-9"
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
                  aria-label="Include server settings in template"
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
                  aria-label="Include sandbox settings in template"
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

      {/* File Browser Dialog */}
      <Dialog open={fileBrowserOpen} onOpenChange={setFileBrowserOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              Select Image File
            </DialogTitle>
            <DialogDescription>
              Browse to find a PNG image file for your server.
            </DialogDescription>
          </DialogHeader>

          {/* Current path breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs font-mono bg-muted/50 rounded-md px-3 py-2 overflow-x-auto">
            <span className="text-muted-foreground truncate" title={fileBrowserPath}>{fileBrowserPath || 'Loading...'}</span>
          </div>

          {/* File listing */}
          <ScrollArea className="flex-1 min-h-[300px] max-h-[400px] border rounded-md">
            {fileBrowserLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {/* Parent directory */}
                {fileBrowserParent && (
                  <button
                    onClick={() => browseTo(fileBrowserParent!)}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-md hover:bg-muted/70 text-sm transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-muted-foreground">..</span>
                  </button>
                )}

                {/* Directories */}
                {fileBrowserDirs.map(dir => (
                  <button
                    key={`d-${dir}`}
                    onClick={() => browseTo(fileBrowserPath + (fileBrowserPath.endsWith('/') || fileBrowserPath.endsWith('\\') ? '' : (fileBrowserPath.includes('/') ? '/' : '\\')) + dir)}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-md hover:bg-muted/70 text-sm transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="truncate">{dir}</span>
                  </button>
                ))}

                {/* Files */}
                {fileBrowserFiles.map(file => {
                  const fullPath = fileBrowserPath + (fileBrowserPath.endsWith('/') || fileBrowserPath.endsWith('\\') ? '' : (fileBrowserPath.includes('/') ? '/' : '\\')) + file.name
                  const isSelected = fileBrowserSelected === fullPath
                  return (
                    <button
                      key={`f-${file.name}`}
                      onClick={() => setFileBrowserSelected(fullPath)}
                      onDoubleClick={() => {
                        setFileBrowserSelected(fullPath)
                        setIniSettings(prev => ({ ...prev, [fileBrowserKey]: fullPath }))
                        setFileBrowserOpen(false)
                      }}
                      className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors ${
                        isSelected ? 'bg-primary/15 border border-primary/30 ring-1 ring-primary/20' : 'hover:bg-muted/70'
                      }`}
                    >
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate flex-1 text-left">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{file.ext}</span>
                    </button>
                  )
                })}

                {/* Empty state */}
                {fileBrowserDirs.length === 0 && fileBrowserFiles.length === 0 && !fileBrowserParent && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No image files found in this directory
                  </div>
                )}
                {fileBrowserDirs.length === 0 && fileBrowserFiles.length === 0 && fileBrowserParent && (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No image files here &mdash; try a different folder
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Preview + selection info */}
          {fileBrowserSelected && (
            <div className="flex items-start gap-3 bg-muted/30 rounded-md p-3 border">
              <div className="rounded-md border bg-background p-1 shrink-0">
                <AuthImage
                  filePath={fileBrowserSelected}
                  alt="Preview"
                  className="max-h-[64px] max-w-[120px] object-contain rounded"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{fileBrowserSelected.split(/[/\\]/).pop()}</p>
                <p className="text-xs text-muted-foreground font-mono truncate mt-0.5" title={fileBrowserSelected}>{fileBrowserSelected}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFileBrowserOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmFileBrowserSelection} disabled={!fileBrowserSelected}>
              <Check className="w-4 h-4 mr-2" />
              Select File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
