import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { reportClientError } from '@/lib/client-errors'
import { 
  Users, 
  UserX, 
  Ban, 
  Shield, 
  UserPlus, 
  UserMinus,
  Car,
  Sparkles,
  Ghost,
  Eye,
  Layers,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Download,
  Upload,
  Copy,
  Check,
  MapPin,
  Mic,
  MicOff,
  Search,
  TrendingUp,
  Clock,
  Zap,
  ChevronRight,
  MoreHorizontal,
  StickyNote,
  Tag,
  X,
  Plus,
  Save,
  Trash2
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/components/ui/use-toast'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { playersApi, panelBridgeApi } from '@/lib/api'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

interface Player {
  name: string
  online: boolean
}

const ACCESS_LEVELS = ['admin', 'moderator', 'overseer', 'gm', 'observer', 'none']

// Common teleport locations in Project Zomboid
const TELEPORT_PRESETS = [
  { name: 'Muldraugh', x: '10500', y: '9700', z: '0' },
  { name: 'West Point', x: '11800', y: '6900', z: '0' },
  { name: 'Riverside', x: '6500', y: '5300', z: '0' },
  { name: 'Rosewood', x: '8000', y: '11300', z: '0' },
  { name: 'Louisville', x: '12500', y: '3500', z: '0' },
  { name: 'March Ridge', x: '9900', y: '12800', z: '0' },
  { name: 'Ekron', x: '4500', y: '9000', z: '0' },
  { name: 'Military Base', x: '10300', y: '12900', z: '0' },
]

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function ActionTile({
  icon,
  label,
  disabled,
  emphasis = 'default',
  compact = false,
}: {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  emphasis?: 'default' | 'danger'
  compact?: boolean
}) {
  return (
    <div
      className={[
        'flex w-full items-center justify-center rounded-xl border text-center transition-colors',
        compact ? 'min-h-14 flex-row gap-1.5 px-2.5 py-2' : 'min-h-20 flex-col gap-2 px-3 py-3',
        emphasis === 'danger'
          ? 'border-destructive/30 text-destructive hover:bg-destructive/5'
          : 'border-border/60 hover:bg-accent/40',
        disabled ? 'opacity-50' : '',
      ].join(' ')}
    >
      {icon}
      <span className={compact ? 'text-[11px] font-medium' : 'text-xs font-medium'}>{label}</span>
    </div>
  )
}

export default function Players() {
  const [players, setPlayers] = useState<Player[]>([])
  const [vehicles, setVehicles] = useState<string[]>([])
  const [perks, setPerks] = useState<string[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const { toast } = useToast()

  // Stats tracking
  const [peakPlayers, setPeakPlayers] = useState(0)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Dialog states
  const [kickDialogOpen, setKickDialogOpen] = useState(false)
  const [banDialogOpen, setBanDialogOpen] = useState(false)
  const [banConfirmOpen, setBanConfirmOpen] = useState(false)
  const [unbanDialogOpen, setUnbanDialogOpen] = useState(false)
  const [teleportDialogOpen, setTeleportDialogOpen] = useState(false)
  const [steamIdBanDialogOpen, setSteamIdBanDialogOpen] = useState(false)
  const [voiceBanDialogOpen, setVoiceBanDialogOpen] = useState(false)
  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false)

  // Form states
  const [kickReason, setKickReason] = useState('')
  const [banReason, setBanReason] = useState('')
  const [banIp, setBanIp] = useState(false)
  const [accessLevel, setAccessLevel] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCount, setItemCount] = useState(1)
  const [selectedPerk, setSelectedPerk] = useState('')
  const [xpAmount, setXpAmount] = useState(100)
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [unbanUsername, setUnbanUsername] = useState('')
  const [unbanSteamIdDialogOpen, setUnbanSteamIdDialogOpen] = useState(false)
  const [unbanSteamId, setUnbanSteamId] = useState('')
  const [bannedSteamIds, setBannedSteamIds] = useState<Array<{ steamId: string; banned_at: string; reason?: string }>>([])
  const [loadingBans, setLoadingBans] = useState(false)
  
  // Add User states
  const [addUserUsername, setAddUserUsername] = useState('')
  const [addUserPassword, setAddUserPassword] = useState('')
  
  // Teleport states
  const [teleportX, setTeleportX] = useState('')
  const [teleportY, setTeleportY] = useState('')
  const [teleportZ, setTeleportZ] = useState('0')
  const [teleportTarget, setTeleportTarget] = useState('')
  
  // SteamID Ban states
  const [banSteamId, setBanSteamId] = useState('')
  const [steamBanReason, setSteamBanReason] = useState('')
  
  // Voice Ban states
  const [voiceBanUsername, setVoiceBanUsername] = useState('')
  const [voiceBanEnabled, setVoiceBanEnabled] = useState(true)
  
  // Power states (local tracking since server doesn't report these)
  const [playerPowers, setPlayerPowers] = useState<Record<string, { godMode: boolean; invisible: boolean; noclip: boolean }>>({})
  
  // Player search filter
  const [playerSearchFilter, setPlayerSearchFilter] = useState('')
  
  // Character Export/Import states
  const [characterData, setCharacterData] = useState<string>('')
  const [importCharacterData, setImportCharacterData] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  
  // Bridge status for character export/import
  const [bridgeConnected, setBridgeConnected] = useState(false)
  
  // Ref for copy timeout cleanup
  const copiedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])
  
  // Activity Log states
  interface ActivityLog {
    id: number
    player_name: string
    action: string
    details: string | null
    logged_at: string
  }
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logPlayerFilter, setLogPlayerFilter] = useState('')
  
  // Player Notes & Tags states
  interface PlayerNote {
    playerName: string
    note: string
    tags: string[]
    updated_at: string
  }
  interface PlayerStat {
    playerName: string
    total_playtime_seconds: number
    session_count: number
    first_seen: string
    last_seen: string
  }
  const [playerNotes, setPlayerNotes] = useState<Record<string, PlayerNote>>({})
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerStat>>({})
  const [currentNote, setCurrentNote] = useState('')
  const [currentTags, setCurrentTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [notesLoading, setNotesLoading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [playersLoadError, setPlayersLoadError] = useState<string | null>(null)
  const [toolsLoadError, setToolsLoadError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)

  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback
  
  // Filter players by search term (memoized to avoid recalculation on every render)
  const filteredPlayers = useMemo(() => 
    players.filter(player => 
      player.name.toLowerCase().includes(playerSearchFilter.toLowerCase())
    ),
    [players, playerSearchFilter]
  )

  // Update peak players
  useEffect(() => {
    if (players.length > peakPlayers) {
      setPeakPlayers(players.length)
    }
  }, [players.length, peakPlayers])

  const fetchPlayers = useCallback(async () => {
    try {
      const data = await playersApi.getPlayers()
      if (data.players) {
        setPlayers(data.players)
        setLastRefresh(new Date())
      }
      setPlayersLoadError(null)
    } catch (error) {
      reportClientError('Failed to fetch players.', error)
      setPlayersLoadError(getErrorMessage(error, 'Failed to load players.'))
    }
  }, [])
  
  const fetchActivityLogs = useCallback(async (playerFilter?: string) => {
    setLogsLoading(true)
    try {
      const data = await playersApi.getActivityLogs(playerFilter, 200)
      if (data.logs) {
        setActivityLogs(data.logs)
      }
      setLogsError(null)
    } catch (error) {
      reportClientError('Failed to fetch activity logs.', error)
      setLogsError(getErrorMessage(error, 'Failed to load activity logs.'))
    } finally {
      setLogsLoading(false)
    }
  }, [])
  
  const fetchNotesAndStats = useCallback(async () => {
    setNotesLoading(true)
    try {
      const [notesData, statsData] = await Promise.all([
        playersApi.getNotes(),
        playersApi.getStats()
      ])
      // Convert arrays to lookup objects
      const notesMap: Record<string, PlayerNote> = {}
      if (notesData.notes) {
        notesData.notes.forEach((n: PlayerNote) => { notesMap[n.playerName] = n })
      }
      const statsMap: Record<string, PlayerStat> = {}
      if (statsData.stats) {
        statsData.stats.forEach((s: PlayerStat) => { statsMap[s.playerName] = s })
      }
      setPlayerNotes(notesMap)
      setPlayerStats(statsMap)
      setNotesError(null)
    } catch (error) {
      reportClientError('Failed to fetch notes and stats.', error)
      setNotesError(getErrorMessage(error, 'Failed to load player notes and stats.'))
    } finally {
      setNotesLoading(false)
    }
  }, [])
  
  const handleSaveNote = async () => {
    if (!selectedPlayer) return
    const normalizedNote = currentNote.trim()
    setSavingNote(true)
    try {
      await playersApi.saveNote(selectedPlayer, normalizedNote, currentTags)
      toast({
        title: 'Note saved',
        description: `Note for ${selectedPlayer} has been saved`,
        variant: 'success' as const,
      })
      // Update local state
      setPlayerNotes(prev => ({
        ...prev,
        [selectedPlayer]: {
          playerName: selectedPlayer,
          note: normalizedNote,
          tags: currentTags,
          updated_at: new Date().toISOString()
        }
      }))
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save note',
        variant: 'destructive',
      })
    } finally {
      setSavingNote(false)
    }
  }
  
  const handleDeleteNote = async () => {
    if (!selectedPlayer) return
    setSavingNote(true)
    try {
      await playersApi.deleteNote(selectedPlayer)
      toast({
        title: 'Note deleted',
        description: `Note for ${selectedPlayer} has been deleted`,
        variant: 'success' as const,
      })
      // Update local state
      setPlayerNotes(prev => {
        const updated = { ...prev }
        delete updated[selectedPlayer]
        return updated
      })
      setCurrentNote('')
      setCurrentTags([])
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete note',
        variant: 'destructive',
      })
    } finally {
      setSavingNote(false)
    }
  }
  
  const addTag = () => {
    const tag = newTag.trim().toLowerCase().slice(0, 24)
    if (tag && !currentTags.includes(tag) && currentTags.length < 10) {
      setCurrentTags([...currentTags, tag])
    }
    setNewTag('')
  }
  
  const removeTag = (tag: string) => {
    setCurrentTags(currentTags.filter(t => t !== tag))
  }
  
  // Format playtime in human-readable format
  const formatPlaytime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  const fetchData = useCallback(async () => {
    try {
      const [vehiclesData, perksData] = await Promise.all([
        playersApi.getVehicles(),
        playersApi.getPerks()
      ])
      setVehicles(vehiclesData.vehicles || [])
      setPerks(perksData.perks || [])
      setToolsLoadError(null)
    } catch (error) {
      reportClientError('Failed to fetch player data.', error)
      setToolsLoadError(getErrorMessage(error, 'Failed to load player tools and reference data.'))
    } finally {
      setInitialLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchPlayers(), fetchData(), fetchNotesAndStats()]).catch(err => {
      reportClientError('Failed to load initial player data.', err)
    })
    // Check bridge status for character export/import
    panelBridgeApi.getStatus().then(status => {
      setBridgeConnected(Boolean(status.modConnected && status.isRunning))
    }).catch(() => setBridgeConnected(false))
    const interval = setInterval(fetchPlayers, 15000)
    return () => clearInterval(interval)
  }, [fetchPlayers, fetchData, fetchNotesAndStats])
  
  // Load note/tags when selected player changes
  useEffect(() => {
    if (selectedPlayer && playerNotes[selectedPlayer]) {
      setCurrentNote(playerNotes[selectedPlayer].note)
      setCurrentTags(playerNotes[selectedPlayer].tags || [])
    } else {
      setCurrentNote('')
      setCurrentTags([])
    }
  }, [selectedPlayer, playerNotes])

  const handleAction = async (action: string, fn: () => Promise<unknown>, closeDialog?: () => void) => {
    setLoading(true)
    try {
      await fn()
      toast({
        title: 'Success',
        description: `${action} completed`,
        variant: 'success' as const,
      })
      fetchPlayers()
      closeDialog?.()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Action failed',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKick = () => {
    if (!selectedPlayer) return
    handleAction('Kick player', () => playersApi.kick(selectedPlayer, kickReason), () => {
      setKickDialogOpen(false)
      setKickReason('')
    })
  }

  const handleBan = () => {
    if (!selectedPlayer) return
    handleAction('Ban player', () => playersApi.ban(selectedPlayer, banIp, banReason), () => {
      setBanDialogOpen(false)
      setBanConfirmOpen(false)
      setBanReason('')
      setBanIp(false)
    })
  }

  const handleUnban = () => {
    if (!unbanUsername) return
    handleAction('Unban player', () => playersApi.unban(unbanUsername), () => {
      setUnbanUsername('')
      setUnbanDialogOpen(false)
    })
  }

  const handleUnbanSteamId = () => {
    if (!unbanSteamId) return
    handleAction('Unban SteamID', () => playersApi.unbanSteamId(unbanSteamId), () => {
      setUnbanSteamId('')
      setUnbanSteamIdDialogOpen(false)
      setBannedSteamIds(prev => prev.filter(b => b.steamId !== unbanSteamId))
    })
  }

  const fetchBannedSteamIds = useCallback(async () => {
    setLoadingBans(true)
    try {
      const res = await playersApi.getSteamIdBans()
      setBannedSteamIds(res.bans || [])
    } catch {
      // Silently fail — list will be empty, manual input still works
    } finally {
      setLoadingBans(false)
    }
  }, [])

  const handleTeleport = () => {
    if (!teleportTarget || !teleportX || !teleportY) return
    handleAction('Teleport player', () => playersApi.teleport(teleportTarget, {
      x: Number(teleportX),
      y: Number(teleportY),
      z: Number(teleportZ || '0')
    }), () => {
      setTeleportDialogOpen(false)
      setTeleportX('')
      setTeleportY('')
      setTeleportZ('0')
    })
  }

  const handleSteamIdBan = () => {
    if (!banSteamId) return
    handleAction('Ban SteamID', () => playersApi.banSteamId(banSteamId), () => {
      setSteamIdBanDialogOpen(false)
      setBanSteamId('')
      setSteamBanReason('')
    })
  }

  const handleVoiceBan = () => {
    if (!voiceBanUsername) return
    handleAction(voiceBanEnabled ? 'Voice ban' : 'Voice unban', 
      () => playersApi.voiceBan(voiceBanUsername, voiceBanEnabled), () => {
        setVoiceBanDialogOpen(false)
        setVoiceBanUsername('')
      })
  }

  const handleAddUser = () => {
    if (!addUserUsername.trim() || !addUserPassword.trim()) {
      toast({
        title: 'Error',
        description: 'Username and password are required',
        variant: 'destructive',
      })
      return
    }
    if (addUserPassword.length < 4) {
      toast({
        title: 'Error',
        description: 'Password must be at least 4 characters',
        variant: 'destructive',
      })
      return
    }
    handleAction('Add user', () => playersApi.addUser(addUserUsername.trim(), addUserPassword), () => {
      setAddUserDialogOpen(false)
      setAddUserUsername('')
      setAddUserPassword('')
    })
  }

  const handleSetAccessLevel = () => {
    if (!selectedPlayer || !accessLevel) return
    handleAction('Set access level', () => playersApi.setAccessLevel(selectedPlayer, accessLevel))
  }

  const handleAddItem = async () => {
    if (!itemName) return
    const name = itemName
    const count = itemCount
    setItemName('')
    setItemCount(1)
    await handleAction('Add item', () => playersApi.addItem(selectedPlayer || null, name, count))
  }

  const handleAddXp = () => {
    if (!selectedPlayer || !selectedPerk) return
    handleAction('Add XP', () => playersApi.addXp(selectedPlayer, selectedPerk, xpAmount))
  }

  const handleAddVehicle = () => {
    if (!selectedVehicle) return
    handleAction('Spawn vehicle', () => playersApi.addVehicle(selectedVehicle, selectedPlayer || undefined))
  }

  const handleGodMode = (enabled: boolean) => {
    const player = selectedPlayer
    if (!player) return
    handleAction(enabled ? 'Enable god mode' : 'Disable god mode', 
      async () => {
        await playersApi.setGodMode(player, enabled)
        setPlayerPowers(prev => ({
          ...prev,
          [player]: { ...prev[player], godMode: enabled }
        }))
      })
  }

  const handleInvisible = (enabled: boolean) => {
    const player = selectedPlayer
    if (!player) return
    handleAction(enabled ? 'Enable invisible' : 'Disable invisible',
      async () => {
        await playersApi.setInvisible(player, enabled)
        setPlayerPowers(prev => ({
          ...prev,
          [player]: { ...prev[player], invisible: enabled }
        }))
      })
  }

  const handleNoclip = (enabled: boolean) => {
    const player = selectedPlayer
    if (!player) return
    handleAction(enabled ? 'Enable noclip' : 'Disable noclip',
      async () => {
        await playersApi.setNoclip(player, enabled)
        setPlayerPowers(prev => ({
          ...prev,
          [player]: { ...prev[player], noclip: enabled }
        }))
      })
  }

  // Get selected player's current powers
  const selectedPlayerPowers = selectedPlayer ? playerPowers[selectedPlayer] : null

  return (
    <div className="space-y-6 page-transition">
      {/* Header */}
      <PageHeader
        title="Players"
        description="Manage connected players and their permissions"
        icon={<Users className="w-5 h-5 text-primary" />}
        actions={
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-xs text-muted-foreground">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <Button onClick={fetchPlayers} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        }
      />

      {(playersLoadError || toolsLoadError) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Players page is partially unavailable</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">
              {playersLoadError || toolsLoadError}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchPlayers()
                fetchData()
              }}
              className="self-start"
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Stats summary */}
      {players.length > 0 && (
      <div className="flex flex-wrap items-center gap-6 stagger-in">
        <SummaryCard icon={<Users className="h-5 w-5" />} label="Online Now" value={players.length} />
        <SummaryCard icon={<TrendingUp className="h-5 w-5" />} label="Peak Today" value={peakPlayers} />
      </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Player List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" />
                Online Players
              </CardTitle>
              <Badge variant="secondary">{players.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search players..."
                value={playerSearchFilter}
                onChange={(e) => setPlayerSearchFilter(e.target.value)}
                className="pl-9"
                aria-label="Search players"
              />
            </div>
            
            <ScrollArea className="h-[250px] sm:h-[320px]">
              {initialLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : players.length === 0 ? (
                <EmptyState type="noPlayers" title="No players online" description="Players will appear here when they join the server" compact />
              ) : filteredPlayers.length === 0 ? (
                <EmptyState type="noResults" title={`No matches for "${playerSearchFilter}"`} description="Try a different search term" compact />
              ) : (
                <div className="space-y-1">
                  {filteredPlayers.map((player) => {
                    const isSelected = selectedPlayer === player.name
                    const powers = playerPowers[player.name]
                    const hasPowers = powers && (powers.godMode || powers.invisible || powers.noclip)
                    const note = playerNotes[player.name]
                    const stat = playerStats[player.name]
                    
                    return (
                      <button
                        key={player.name}
                        type="button"
                        className={`group w-full text-left p-3 rounded-lg border cursor-pointer transition-[background-color,border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${
                          isSelected
                            ? 'bg-primary/10 border-primary shadow-sm'
                            : 'hover:bg-muted/50 border-transparent hover:border-border'
                        }`}
                        onClick={() => setSelectedPlayer(player.name)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" aria-hidden="true" />
                            <span className="font-medium truncate">{player.name}</span>
                            <span className="sr-only">Online</span>
                            {note && note.tags && note.tags.length > 0 && (
                              <div className="flex gap-1">
                                {note.tags.slice(0, 2).map(tag => (
                                  <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0 h-4">
                                    {tag}
                                  </Badge>
                                ))}
                                {note.tags.length > 2 && (
                                  <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
                                    +{note.tags.length - 2}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {stat && (
                              <span className="text-xs text-muted-foreground mr-1">
                                {formatPlaytime(stat.total_playtime_seconds)}
                              </span>
                            )}
                            {note && <StickyNote className="w-3 h-3 text-muted-foreground" />}
                            {hasPowers && (
                              <div className="flex gap-0.5">
                                {powers.godMode && (
                                  <Badge variant="secondary" className="px-1 py-0 text-xs">
                                    <Ghost className="w-3 h-3" />
                                  </Badge>
                                )}
                                {powers.invisible && (
                                  <Badge variant="secondary" className="px-1 py-0 text-xs">
                                    <Eye className="w-3 h-3" />
                                  </Badge>
                                )}
                                {powers.noclip && (
                                  <Badge variant="secondary" className="px-1 py-0 text-xs">
                                    <Layers className="w-3 h-3" />
                                  </Badge>
                                )}
                              </div>
                            )}
                            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
            
            {/* Manual entry */}
            <div className="pt-3 border-t space-y-2">
              <Label className="text-xs text-muted-foreground">Or enter username manually:</Label>
              <Input
                placeholder="Username"
                value={selectedPlayer}
                onChange={(e) => setSelectedPlayer(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Player Actions */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {selectedPlayer ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
                      {selectedPlayer}
                    </>
                  ) : (
                    'Player Actions'
                  )}
                </CardTitle>
                <CardDescription>
                  {selectedPlayer ? 'Manage this player' : 'Select a player to manage'}
                </CardDescription>
              </div>
              
              {/* Quick Actions */}
              {selectedPlayer && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setKickDialogOpen(true)}
                    className="gap-1"
                    title="Kick"
                  >
                    <UserX className="w-4 h-4" />
                    <span className="hidden sm:inline">Kick</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTeleportDialogOpen(true)}
                    className="gap-1"
                    title="Teleport"
                  >
                    <MapPin className="w-4 h-4" />
                    <span className="hidden sm:inline">Teleport</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleGodMode(!selectedPlayerPowers?.godMode)} disabled={loading}>
                        <Ghost className="w-4 h-4 mr-2" />
                        {selectedPlayerPowers?.godMode ? 'Disable' : 'Enable'} God Mode
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleInvisible(!selectedPlayerPowers?.invisible)} disabled={loading}>
                        <Eye className="w-4 h-4 mr-2" />
                        {selectedPlayerPowers?.invisible ? 'Disable' : 'Enable'} Invisible
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleNoclip(!selectedPlayerPowers?.noclip)} disabled={loading}>
                        <Layers className="w-4 h-4 mr-2" />
                        {selectedPlayerPowers?.noclip ? 'Disable' : 'Enable'} Noclip
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => handleAction('Add to whitelist', () => playersApi.addToWhitelist(selectedPlayer))}
                        disabled={loading}
                      >
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add to Whitelist
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleAction('Remove from whitelist', () => playersApi.removeFromWhitelist(selectedPlayer))}
                        disabled={loading}
                      >
                        <UserMinus className="w-4 h-4 mr-2" />
                        Remove from Whitelist
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => setBanDialogOpen(true)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Ban className="w-4 h-4 mr-2" />
                        Ban Player
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
            
            {/* Power Status Bar */}
            {selectedPlayer && selectedPlayerPowers && (selectedPlayerPowers.godMode || selectedPlayerPowers.invisible || selectedPlayerPowers.noclip) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Active powers:</span>
                {selectedPlayerPowers.godMode && (
                  <Badge variant="secondary" className="text-xs">God Mode</Badge>
                )}
                {selectedPlayerPowers.invisible && (
                  <Badge variant="secondary" className="text-xs">Invisible</Badge>
                )}
                {selectedPlayerPowers.noclip && (
                  <Badge variant="secondary" className="text-xs">Noclip</Badge>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="moderation">
              <div className="overflow-x-auto pb-1">
                <TabsList className="inline-flex h-auto min-w-max gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
                  <TabsTrigger value="moderation" className="min-h-9 shrink-0 text-xs px-3">Moderation</TabsTrigger>
                  <TabsTrigger value="items" className="min-h-9 shrink-0 text-xs px-3">Items & XP</TabsTrigger>
                  <TabsTrigger value="vehicles" className="min-h-9 shrink-0 text-xs px-3">Vehicles</TabsTrigger>
                  <TabsTrigger value="powers" className="min-h-9 shrink-0 text-xs px-3">Powers</TabsTrigger>
                  <TabsTrigger value="import-export" className="min-h-9 shrink-0 text-xs px-3">Import/Export</TabsTrigger>
                  <TabsTrigger value="notes" className="min-h-9 shrink-0 text-xs px-3">Notes</TabsTrigger>
                  <TabsTrigger value="activity" className="min-h-9 shrink-0 text-xs px-3" onClick={() => fetchActivityLogs()}>Activity</TabsTrigger>
                </TabsList>
              </div>

              {/* Moderation Tab */}
              <TabsContent value="moderation" className="space-y-4 mt-4">
                {/* Primary actions — visible when a player is selected */}
                {selectedPlayer ? (
                <div className="grid grid-cols-3 gap-3">
                  {/* Kick */}
                  <Dialog open={kickDialogOpen} onOpenChange={setKickDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" disabled={!selectedPlayer} className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<UserX className="w-5 h-5" />} label="Kick" disabled={!selectedPlayer} />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Kick Player</DialogTitle>
                        <DialogDescription>
                          Kick {selectedPlayer} from the server
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="kick-reason">Reason (optional)</Label>
                          <Input
                            id="kick-reason"
                            value={kickReason}
                            onChange={(e) => setKickReason(e.target.value)}
                            placeholder="Enter reason..."
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="destructive" onClick={handleKick} disabled={loading}>
                          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Kick Player
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Ban */}
                  <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" disabled={!selectedPlayer} className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<Ban className="w-5 h-5" />} label="Ban" disabled={!selectedPlayer} emphasis="danger" />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-destructive" />
                          Ban Player
                        </DialogTitle>
                        <DialogDescription>
                          Ban {selectedPlayer} from the server
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="ban-reason">Reason (optional)</Label>
                          <Input
                            id="ban-reason"
                            value={banReason}
                            onChange={(e) => setBanReason(e.target.value)}
                            placeholder="Enter reason..."
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="banIp"
                            checked={banIp}
                            onCheckedChange={(checked) => setBanIp(checked === true)}
                          />
                          <Label htmlFor="banIp">Also ban IP address</Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setBanDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button variant="destructive" onClick={() => setBanConfirmOpen(true)}>
                          Continue to Ban
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Ban Confirmation */}
                  <AlertDialog open={banConfirmOpen} onOpenChange={setBanConfirmOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently ban <strong>{selectedPlayer}</strong> from the server
                          {banIp ? ' and their IP address' : ''}.
                          {banReason && <><br />Reason: {banReason}</>}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleBan}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Yes, Ban Player
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  {/* Access Level */}
                  <Dialog>
                    <DialogTrigger asChild>
                      <button type="button" disabled={!selectedPlayer} className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<Shield className="w-5 h-5" />} label="Access Level" disabled={!selectedPlayer} />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Set Access Level</DialogTitle>
                        <DialogDescription>
                          Change access level for {selectedPlayer}
                        </DialogDescription>
                      </DialogHeader>
                      <div>
                        <Label htmlFor="access-level">Access Level</Label>
                        <Select value={accessLevel} onValueChange={setAccessLevel}>
                          <SelectTrigger id="access-level">
                            <SelectValue placeholder="Select level..." />
                          </SelectTrigger>
                          <SelectContent>
                            {ACCESS_LEVELS.map((level) => (
                              <SelectItem key={level} value={level}>
                                {level.charAt(0).toUpperCase() + level.slice(1)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleSetAccessLevel} disabled={loading || !accessLevel}>
                          Set Level
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Teleport */}
                  <Dialog open={teleportDialogOpen} onOpenChange={setTeleportDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" disabled={!selectedPlayer} className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<MapPin className="w-5 h-5" />} label="Teleport" disabled={!selectedPlayer} />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>Teleport Player</DialogTitle>
                        <DialogDescription>
                          Teleport {selectedPlayer} to coordinates
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="teleport-target">Target Player</Label>
                          <Input
                            id="teleport-target"
                            value={teleportTarget || selectedPlayer}
                            onChange={(e) => setTeleportTarget(e.target.value)}
                            placeholder="Player to teleport"
                          />
                        </div>
                        
                        {/* Quick Location Presets */}
                        <div>
                          <Label className="text-xs text-muted-foreground mb-2 block">Quick Locations</Label>
                          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                            {TELEPORT_PRESETS.map((preset) => (
                              <Button
                                key={preset.name}
                                variant="outline"
                                size="sm"
                                className="h-8 min-w-0 text-xs"
                                onClick={() => {
                                  setTeleportX(preset.x)
                                  setTeleportY(preset.y)
                                  setTeleportZ(preset.z)
                                }}
                              >
                                {preset.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label htmlFor="teleport-x">X</Label>
                            <Input
                              id="teleport-x"
                              type="number"
                              value={teleportX}
                              onChange={(e) => setTeleportX(e.target.value)}
                              placeholder="10500"
                              min={-100000}
                              max={100000}
                            />
                          </div>
                          <div>
                            <Label htmlFor="teleport-y">Y</Label>
                            <Input
                              id="teleport-y"
                              type="number"
                              value={teleportY}
                              onChange={(e) => setTeleportY(e.target.value)}
                              placeholder="9700"
                              min={-100000}
                              max={100000}
                            />
                          </div>
                          <div>
                            <Label htmlFor="teleport-z">Z</Label>
                            <Input
                              id="teleport-z"
                              type="number"
                              value={teleportZ}
                              onChange={(e) => setTeleportZ(e.target.value)}
                              placeholder="0"
                              min={0}
                              max={20}
                            />
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => {
                            if (!teleportTarget) setTeleportTarget(selectedPlayer)
                            handleTeleport()
                          }} 
                          disabled={loading || !teleportX || !teleportY}
                        >
                          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Teleport
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                ) : (
                <div className="rounded-lg border border-dashed border-border/50 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">Select a player to manage</p>
                </div>
                )}

                {/* Secondary actions — less frequent operations */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {/* Voice Ban */}
                  <Dialog open={voiceBanDialogOpen} onOpenChange={setVoiceBanDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<MicOff className="w-4 h-4" />} label="Voice Ban" compact />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Voice Ban</DialogTitle>
                        <DialogDescription>
                          Mute or unmute a player's voice chat
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Username</Label>
                          <Input
                            value={voiceBanUsername || selectedPlayer}
                            onChange={(e) => setVoiceBanUsername(e.target.value)}
                            placeholder="Enter username..."
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="voiceBanEnabled"
                            checked={voiceBanEnabled}
                            onCheckedChange={(checked) => setVoiceBanEnabled(checked === true)}
                          />
                          <Label htmlFor="voiceBanEnabled">
                            {voiceBanEnabled ? 'Ban from voice chat' : 'Unban from voice chat'}
                          </Label>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          onClick={() => {
                            if (!voiceBanUsername) setVoiceBanUsername(selectedPlayer)
                            handleVoiceBan()
                          }}
                          disabled={loading || (!voiceBanUsername && !selectedPlayer)}
                        >
                          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          {voiceBanEnabled ? (
                            <><MicOff className="w-4 h-4 mr-2" /> Mute</>
                          ) : (
                            <><Mic className="w-4 h-4 mr-2" /> Unmute</>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* SteamID Ban */}
                  <Dialog open={steamIdBanDialogOpen} onOpenChange={setSteamIdBanDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<Ban className="w-4 h-4" />} label="SteamID Ban" emphasis="danger" compact />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-destructive" />
                          Ban by SteamID
                        </DialogTitle>
                        <DialogDescription>
                          Ban a player by their Steam ID (useful for offline bans)
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Steam ID</Label>
                          <Input
                            value={banSteamId}
                            onChange={(e) => setBanSteamId(e.target.value)}
                            placeholder="76561198XXXXXXXXX"
                          />
                        </div>
                        <div>
                          <Label>Reason (optional)</Label>
                          <Input
                            value={steamBanReason}
                            onChange={(e) => setSteamBanReason(e.target.value)}
                            placeholder="Enter ban reason..."
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setSteamIdBanDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button 
                          variant="destructive" 
                          onClick={handleSteamIdBan}
                          disabled={loading || !banSteamId}
                        >
                          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Ban SteamID
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Add User */}
                  <Dialog open={addUserDialogOpen} onOpenChange={setAddUserDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<UserPlus className="w-4 h-4" />} label="Add User" compact />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add User</DialogTitle>
                        <DialogDescription>
                          Create a new user account for whitelist servers
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Username</Label>
                          <Input
                            value={addUserUsername}
                            onChange={(e) => setAddUserUsername(e.target.value)}
                            placeholder="Enter username..."
                            maxLength={64}
                          />
                        </div>
                        <div>
                          <Label>Password</Label>
                          <Input
                            type="password"
                            value={addUserPassword}
                            onChange={(e) => setAddUserPassword(e.target.value)}
                            placeholder="Enter password (min 4 characters)..."
                            maxLength={128}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAddUserDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button 
                          onClick={handleAddUser}
                          disabled={loading || !addUserUsername.trim() || addUserPassword.length < 4}
                        >
                          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          Add User
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Unban */}
                  <Dialog open={unbanDialogOpen} onOpenChange={setUnbanDialogOpen}>
                    <DialogTrigger asChild>
                      <button type="button" className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<UserPlus className="w-4 h-4" />} label="Unban" compact />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Unban Player</DialogTitle>
                      </DialogHeader>
                      <div>
                        <Label htmlFor="unban-username">Username</Label>
                        <Input
                          id="unban-username"
                          value={unbanUsername}
                          onChange={(e) => setUnbanUsername(e.target.value)}
                          placeholder="Enter username to unban..."
                        />
                      </div>
                      <DialogFooter>
                        <Button onClick={handleUnban} disabled={loading || !unbanUsername}>
                          Unban Player
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Unban SteamID */}
                  <Dialog open={unbanSteamIdDialogOpen} onOpenChange={(open) => {
                    setUnbanSteamIdDialogOpen(open)
                    if (open) fetchBannedSteamIds()
                    else setUnbanSteamId('')
                  }}>
                    <DialogTrigger asChild>
                      <button type="button" className="block h-auto w-full p-0 text-left">
                        <ActionTile icon={<UserPlus className="w-4 h-4" />} label="Unban SteamID" compact />
                      </button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Unban SteamID</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        {bannedSteamIds.length > 0 && (
                          <div>
                            <Label>Select banned SteamID</Label>
                            <Select value={unbanSteamId} onValueChange={setUnbanSteamId}>
                              <SelectTrigger>
                                <SelectValue placeholder={loadingBans ? 'Loading...' : 'Select a banned SteamID...'} />
                              </SelectTrigger>
                              <SelectContent>
                                {bannedSteamIds.map((ban) => (
                                  <SelectItem key={ban.steamId} value={ban.steamId}>
                                    {ban.steamId}
                                    {ban.banned_at && <span className="ml-2 text-xs text-muted-foreground">{new Date(ban.banned_at).toLocaleDateString()}</span>}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div>
                          <Label htmlFor="unban-steamid">{bannedSteamIds.length > 0 ? 'Or enter manually' : 'Steam ID'}</Label>
                          <Input
                            id="unban-steamid"
                            value={unbanSteamId}
                            onChange={(e) => setUnbanSteamId(e.target.value)}
                            placeholder="Enter Steam ID to unban..."
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleUnbanSteamId} disabled={loading || !unbanSteamId}>
                          Unban SteamID
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </TabsContent>
              <TabsContent value="items" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Add Item */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Add Item
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <Label className="text-xs">Item Name</Label>
                          <Input
                            value={itemName}
                            onChange={(e) => setItemName(e.target.value)}
                            placeholder="e.g., Base.Axe"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Count</Label>
                          <Input
                            type="number"
                            value={itemCount}
                            onChange={(e) => setItemCount(parseInt(e.target.value) || 1)}
                            min={1}
                            max={100}
                          />
                        </div>
                      </div>
                      <Button onClick={handleAddItem} disabled={loading || !itemName} size="sm" className="w-full">
                        <Sparkles className="w-4 h-4 mr-2" />
                        Give Item
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Add XP */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Add XP
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Perk</Label>
                          <Select value={selectedPerk} onValueChange={setSelectedPerk}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select perk..." />
                            </SelectTrigger>
                            <SelectContent>
                              {perks.map((perk) => (
                                <SelectItem key={perk} value={perk}>
                                  {perk}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            value={xpAmount}
                            onChange={(e) => setXpAmount(parseInt(e.target.value) || 0)}
                            min={1}
                            max={10000}
                          />
                        </div>
                      </div>
                      <Button 
                        onClick={handleAddXp} 
                        disabled={loading || !selectedPlayer || !selectedPerk}
                        size="sm"
                        className="w-full"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Give XP
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Vehicles Tab */}
              <TabsContent value="vehicles" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      Spawn Vehicle
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-xs">Vehicle Type</Label>
                      <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select vehicle..." />
                        </SelectTrigger>
                        <SelectContent>
                          {vehicles.map((vehicle) => (
                            <SelectItem key={vehicle} value={vehicle}>
                              {vehicle.replace('Base.', '')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleAddVehicle} disabled={loading || !selectedVehicle} size="sm">
                      <Car className="w-4 h-4 mr-2" />
                      Spawn Vehicle
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Powers Tab */}
              <TabsContent value="powers" className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground">
                  Toggle special abilities for {selectedPlayer || 'the selected player'}.
                </p>
                <div className="grid gap-3">
                  {/* God Mode */}
                  <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/50 p-4 transition-colors hover:bg-accent/30">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                        <Ghost className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-medium">God Mode</p>
                        <p className="text-xs text-muted-foreground">Invulnerable to damage</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedPlayer && selectedPlayerPowers?.godMode !== undefined && (
                        <Badge variant={selectedPlayerPowers.godMode ? 'default' : 'secondary'} className="text-xs">
                          {selectedPlayerPowers.godMode ? 'ON' : 'OFF'}
                        </Badge>
                      )}
                      <Button
                        variant={selectedPlayerPowers?.godMode ? 'default' : 'outline'}
                        size="sm"
                        disabled={!selectedPlayer || loading}
                        onClick={() => handleGodMode(!selectedPlayerPowers?.godMode)}
                      >
                        {selectedPlayerPowers?.godMode ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Invisible */}
                  <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/50 p-4 transition-colors hover:bg-accent/30">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                        <Eye className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-medium">Invisible</p>
                        <p className="text-xs text-muted-foreground">Hidden from other players</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedPlayer && selectedPlayerPowers?.invisible !== undefined && (
                        <Badge variant={selectedPlayerPowers.invisible ? 'default' : 'secondary'} className="text-xs">
                          {selectedPlayerPowers.invisible ? 'ON' : 'OFF'}
                        </Badge>
                      )}
                      <Button
                        variant={selectedPlayerPowers?.invisible ? 'default' : 'outline'}
                        size="sm"
                        disabled={!selectedPlayer || loading}
                        onClick={() => handleInvisible(!selectedPlayerPowers?.invisible)}
                      >
                        {selectedPlayerPowers?.invisible ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Noclip */}
                  <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/50 p-4 transition-colors hover:bg-accent/30">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                        <Layers className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-medium">Noclip</p>
                        <p className="text-xs text-muted-foreground">Walk through walls</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedPlayer && selectedPlayerPowers?.noclip !== undefined && (
                        <Badge variant={selectedPlayerPowers.noclip ? 'default' : 'secondary'} className="text-xs">
                          {selectedPlayerPowers.noclip ? 'ON' : 'OFF'}
                        </Badge>
                      )}
                      <Button
                        variant={selectedPlayerPowers?.noclip ? 'default' : 'outline'}
                        size="sm"
                        disabled={!selectedPlayer || loading}
                        onClick={() => handleNoclip(!selectedPlayerPowers?.noclip)}
                      >
                        {selectedPlayerPowers?.noclip ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Import/Export Tab */}
              <TabsContent value="import-export" className="space-y-4 mt-4">
                {!bridgeConnected && (
                  <Alert className="border-warning/40 bg-warning/10">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <AlertTitle className="text-warning">Bridge Offline</AlertTitle>
                    <AlertDescription>
                      Character export and import require PanelBridge to be connected.{' '}
                      <Link to="/settings" className="text-primary underline hover:text-foreground">Open Bridge Setup</Link>
                    </AlertDescription>
                  </Alert>
                )}
                <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-4", !bridgeConnected && 'opacity-60 pointer-events-none')}>
                  {/* Export */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Download className="w-4 h-4" />
                        Export Character
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Export player's XP, perks, and skills
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Button
                        variant="outline"
                        disabled={!selectedPlayer || exporting}
                        onClick={async () => {
                          setExporting(true)
                          try {
                            const { panelBridgeApi } = await import('@/lib/api')
                            const response = await panelBridgeApi.exportCharacter(selectedPlayer)
                            const exportData = response.data || response
                            const jsonStr = JSON.stringify(exportData, null, 2)
                            setCharacterData(jsonStr)
                            toast({
                              title: 'Character Exported',
                              description: `Exported character data for ${selectedPlayer}`,
                            })
                          } catch (error) {
                            toast({
                              title: 'Export Failed',
                              description: error instanceof Error ? error.message : 'Failed to export character',
                              variant: 'destructive',
                            })
                          } finally {
                            setExporting(false)
                          }
                        }}
                        size="sm"
                        className="w-full"
                      >
                        {exporting ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 mr-2" />
                        )}
                        Export {selectedPlayer || 'Player'}
                      </Button>
                      
                      {characterData && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Character Data</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                navigator.clipboard.writeText(characterData)
                                setCopied(true)
                                if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
                                copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
                              }}
                            >
                              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </Button>
                          </div>
                          <Textarea
                            readOnly
                            value={characterData}
                            className="h-32 resize-none font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                              const blob = new Blob([characterData], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `${selectedPlayer}_character.json`
                              a.click()
                              URL.revokeObjectURL(url)
                            }}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download File
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* Import */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        Import Character
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Restore XP, perks, and skills
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        value={importCharacterData}
                        onChange={(e) => setImportCharacterData(e.target.value)}
                        placeholder='Paste character JSON here...'
                        className="h-24 resize-none font-mono text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          disabled={importing || !selectedPlayer || !importCharacterData.trim()}
                          onClick={async () => {
                            let data
                            try {
                              data = JSON.parse(importCharacterData)
                            } catch {
                              toast({
                                title: 'Invalid JSON',
                                description: 'The character data is not valid JSON format',
                                variant: 'destructive',
                              })
                              return
                            }
                            
                            setImporting(true)
                            try {
                              const { panelBridgeApi } = await import('@/lib/api')
                              await panelBridgeApi.importCharacter(selectedPlayer, data)
                              toast({
                                title: 'Character Imported',
                                description: `Applied character data to ${selectedPlayer}`,
                              })
                              setImportCharacterData('')
                            } catch (error) {
                              toast({
                                title: 'Import Failed',
                                description: error instanceof Error ? error.message : 'Failed to import character',
                                variant: 'destructive',
                              })
                            } finally {
                              setImporting(false)
                            }
                          }}
                          size="sm"
                          className="flex-1"
                        >
                          {importing ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4 mr-2" />
                          )}
                          Apply
                        </Button>
                        <label className="cursor-pointer">
                          <Button variant="outline" size="sm" asChild>
                            <span>
                              <Upload className="w-4 h-4 mr-1" />
                              File
                            </span>
                          </Button>
                          <input
                            type="file"
                            accept=".json"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) {
                                const reader = new FileReader()
                                reader.onload = (ev) => {
                                  setImportCharacterData(ev.target?.result as string || '')
                                }
                                reader.readAsText(file)
                              }
                              e.target.value = ''
                            }}
                          />
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground">Player must be online.</p>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Notes & Tags Tab */}
              <TabsContent value="notes" className="space-y-4 mt-4">
                {notesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : !selectedPlayer ? (
                  <EmptyState type="noData" title="Select a player to view or add notes" />
                ) : (
                  <div className="space-y-4">
                    {/* Player Stats Card */}
                    {playerStats[selectedPlayer] && (
                      <Card className="border-border/60 bg-muted/20">
                        <CardContent className="pt-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-primary" />
                              <div>
                                <div className="text-muted-foreground text-xs">Total Playtime</div>
                                <div className="font-medium">{formatPlaytime(playerStats[selectedPlayer].total_playtime_seconds)}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-4 h-4 text-primary" />
                              <div>
                                <div className="text-muted-foreground text-xs">Sessions</div>
                                <div className="font-medium">{playerStats[selectedPlayer].session_count}</div>
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">First Seen</div>
                              <div className="font-medium text-xs">{new Date(playerStats[selectedPlayer].first_seen).toLocaleDateString()}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Last Seen</div>
                              <div className="font-medium text-xs">{new Date(playerStats[selectedPlayer].last_seen).toLocaleString()}</div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    
                    {/* Tags */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <Tag className="w-4 h-4" />
                        Tags
                      </Label>
                      <div className="flex flex-wrap gap-2 min-h-[32px]">
                        {currentTags.map(tag => (
                          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeTag(tag)}
                              className="ml-1 rounded p-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              aria-label={`Remove ${tag} tag`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </Badge>
                        ))}
                        <div className="flex items-center gap-1">
                          <Input
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value.slice(0, 24))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                addTag()
                              }
                            }}
                            placeholder="Add tag..."
                            className="h-8 w-28 text-xs"
                            maxLength={24}
                          />
                          <Button size="sm" variant="ghost" onClick={addTag} className="h-8 w-8 p-0" aria-label="Add tag">
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Common tags: trusted, suspicious, new, vip, builder, griefer, afk. Up to 10 tags, 24 characters each.
                      </p>
                    </div>
                    
                    {/* Note */}
                    <div className="space-y-2">
                      {notesError && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Notes could not be loaded</AlertTitle>
                          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="min-w-0 break-words">{notesError}</span>
                            <Button variant="outline" size="sm" onClick={() => fetchNotesAndStats()} className="self-start">
                              <RefreshCw className="mr-2 h-4 w-4" /> Retry
                            </Button>
                          </AlertDescription>
                        </Alert>
                      )}
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <StickyNote className="w-4 h-4" />
                        Admin Note
                      </Label>
                      <Textarea
                        value={currentNote}
                        onChange={(e) => setCurrentNote(e.target.value.slice(0, 1000))}
                        placeholder="Add notes about this player..."
                        className="min-h-[120px] resize-y"
                        maxLength={1000}
                      />
                      <p className="text-xs text-muted-foreground">{currentNote.length}/1000 characters</p>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex justify-between items-center pt-2">
                      <div className="text-xs text-muted-foreground">
                        {playerNotes[selectedPlayer]?.updated_at && (
                          <span>Last updated: {new Date(playerNotes[selectedPlayer].updated_at).toLocaleString()}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {playerNotes[selectedPlayer] && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDeleteNote}
                            disabled={savingNote}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={handleSaveNote}
                          disabled={savingNote || (!currentNote.trim() && currentTags.length === 0)}
                        >
                          {savingNote ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                          Save Note
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Activity Log Tab */}
              <TabsContent value="activity" className="space-y-4 mt-4">
                {logsError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Activity log unavailable</AlertTitle>
                    <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 break-words">{logsError}</span>
                      <Button variant="outline" size="sm" onClick={() => fetchActivityLogs(logPlayerFilter || undefined)} className="self-start">
                        <RefreshCw className="mr-2 h-4 w-4" /> Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter by player name..."
                      value={logPlayerFilter}
                      onChange={(e) => setLogPlayerFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') fetchActivityLogs(logPlayerFilter || undefined)
                      }}
                      className="pl-9"
                      aria-label="Filter activity logs by player name"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchActivityLogs(logPlayerFilter || undefined)}
                    disabled={logsLoading}
                    className="w-full sm:w-auto"
                  >
                    {logsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>
                
                <div className="rounded-md border max-h-[350px] overflow-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium text-xs">Time</th>
                        <th className="text-left p-2 font-medium text-xs">Player</th>
                        <th className="text-left p-2 font-medium text-xs">Action</th>
                        <th className="text-left p-2 font-medium text-xs">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {activityLogs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-muted-foreground text-sm">
                            {logsLoading ? 'Loading...' : 'No activity logs'}
                          </td>
                        </tr>
                      ) : (
                        activityLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-muted/50">
                            <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">
                              {new Date(log.logged_at).toLocaleString()}
                            </td>
                            <td className="p-2 text-xs font-medium break-words">{log.player_name}</td>
                            <td className="p-2">
                              <Badge
                                variant={
                                  log.action === 'connect'
                                    ? 'success'
                                    : log.action === 'disconnect' || log.action === 'ban'
                                      ? 'destructive'
                                      : log.action === 'kick'
                                        ? 'warning'
                                        : 'secondary'
                                }
                                className="text-xs"
                              >
                                {log.action}
                              </Badge>
                            </td>
                            <td className="max-w-[220px] p-2 text-xs text-muted-foreground break-words">
                              {log.details || '-'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
