import { useState, useCallback, useEffect, useRef } from 'react'
import { 
  Zap,
  Crosshair,
  Volume2,
  CloudLightning,
  Cloud,
  CloudRain,
  CloudOff,
  Skull,
  Bell,
  Users,
  User,
  Loader2,
  RefreshCw,
  Target,
  MapPin,
  Clock,
  Navigation,
  Car,
  Megaphone,
  Snowflake,
  Wind,
  Thermometer,
  AlertTriangle,
  Droplets,
  Sun,
  Moon,
  Eye,
  Gauge,
  RotateCcw,
  Calendar,
  Sunrise,
  Sunset,
  Wrench,
  ShieldCheck,
  Lock,
  Unlock,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Info
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { rconApi, serverApi, playersApi, panelBridgeApi } from '@/lib/api'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { BridgeStatusBadge } from '@/components/BridgeStatusBadge'
import { cn } from '@/lib/utils'
import { getUserErrorMessage } from '@/lib/errorMessage'

interface Player {
  name: string
  online: boolean
}

function getEventSuccessCopy(action: string) {
  switch (action) {
    case 'Start rain':
    case 'Start Rain':
      return { title: 'Rain Started', description: 'Rain is now active on the server.' }
    case 'Stop rain':
    case 'Stop Rain':
      return { title: 'Rain Stopped', description: 'Rainfall has been cleared.' }
    case 'Start storm':
    case 'Trigger storm':
      return { title: 'Storm Triggered', description: 'A storm event is now active.' }
    case 'Tropical Storm':
    case 'Trigger tropical storm':
      return { title: 'Tropical Storm Triggered', description: 'High-intensity weather is now active.' }
    case 'Blizzard':
    case 'Trigger blizzard':
      return { title: 'Blizzard Triggered', description: 'A blizzard event is now active.' }
    case 'Stop weather':
    case 'Stop All Weather':
      return { title: 'Weather Cleared', description: 'All forced weather conditions removed.' }
    case 'Enable Snow':
      return { title: 'Snowfall Enabled', description: 'Snow precipitation is now active.' }
    case 'Disable Snow':
      return { title: 'Snowfall Disabled', description: 'Snow precipitation turned off.' }
    case 'Reset Climate':
      return { title: 'Climate Reset', description: 'All climate overrides cleared.' }
    case 'Set Fog':
      return { title: 'Fog Updated', description: 'Fog density applied to the server.' }
    case 'Set Wind':
      return { title: 'Wind Updated', description: 'Wind intensity applied to the server.' }
    case 'Set Temperature':
      return { title: 'Temperature Updated', description: 'Temperature applied to the server.' }
    case 'Set Clouds':
      return { title: 'Cloud Cover Updated', description: 'Cloud intensity applied to the server.' }
    case 'Set Humidity':
      return { title: 'Humidity Updated', description: 'Humidity level applied to the server.' }
    case 'Set Precipitation':
      return { title: 'Precipitation Updated', description: 'Precipitation intensity applied to the server.' }
    case 'Set Time':
      return { title: 'Time Updated', description: 'In-game date and time adjusted.' }
    case 'Restore Utilities':
      return { title: 'Utilities Restored', description: 'Power and water are back online.' }
    case 'Shut Off Utilities':
      return { title: 'Utilities Shut Down', description: 'Power and water have been cut.' }
    case 'Restore Power':
      return { title: 'Power Restored', description: 'Electrical service is back online.' }
    case 'Restore Water':
      return { title: 'Water Restored', description: 'Water service is back online.' }
    case 'Helicopter':
      return { title: 'Helicopter Triggered', description: 'A helicopter event is now active.' }
    case 'Gunshot':
    case 'Gunshot Sound':
    case 'Gunshot at Coords':
      return { title: 'Gunshot Triggered', description: 'A gunshot sound has been created.' }
    case 'Alarm':
    case 'Alarm Sound':
    case 'Alarm at Coords':
      return { title: 'Alarm Triggered', description: 'An alarm has been triggered.' }
    case 'Custom Noise':
    case 'Noise at Coords':
      return { title: 'Noise Created', description: 'A custom sound lure has been placed.' }
    case 'Lightning':
      return { title: 'Lightning Triggered', description: 'A lightning strike has been called.' }
    case 'Thunder':
      return { title: 'Thunder Triggered', description: 'A thunder event is now active.' }
    case 'Create horde':
      return { title: 'Horde Spawned', description: 'A zombie group has been created.' }
    case 'Create horde (behind)':
      return { title: 'Rear Horde Spawned', description: 'A zombie group spawned behind the target.' }
    case 'Remove all zombies':
      return { title: 'Zombies Cleared', description: 'All zombies removed from loaded cells.' }
    case 'Set time speed':
      return { title: 'Time Speed Updated', description: 'The time multiplier has been changed.' }
    case 'Teleport':
    case 'Teleport self':
    case 'Teleport player':
      return { title: 'Teleport Complete', description: 'The target has been moved.' }
    case 'Spawn vehicle':
      return { title: 'Vehicle Spawned', description: 'Vehicle delivered to the target player.' }
    case 'Send announcement':
      return { title: 'Announcement Sent', description: 'Message broadcast to all players.' }
    case 'Apply All Climate':
      return { title: 'Climate Applied', description: 'All climate parameters updated.' }
    default:
      return { title: 'Action Complete', description: `${action} completed successfully.` }
  }
}

// Vehicle presets for GM
const vehicles = [
  { id: 'Base.VanAmbulance', name: 'Ambulance' },
  { id: 'Base.PickUpVanLightsPolice', name: 'Police Van' },
  { id: 'Base.CarLightsPolice', name: 'Police Car' },
  { id: 'Base.PickUpTruckMccoy', name: 'Pickup Truck' },
  { id: 'Base.Van', name: 'Van' },
  { id: 'Base.ModernCar', name: 'Modern Car' },
  { id: 'Base.SportsCar', name: 'Sports Car' },
  { id: 'Base.SUV', name: 'SUV' },
  { id: 'Base.StepVan', name: 'Step Van' },
  { id: 'Base.Taxi', name: 'Taxi' },
]

const bridgeOperationTemplates: Record<string, { label: string; description: string; args: string }> = {
  getSafehouses: { label: 'List Safehouses', description: 'Get all safehouses and metadata.', args: '{}' },
  safehouseAddPlayer: { label: 'Safehouse Add Player', description: 'Add a player to a safehouse.', args: '{\n  "safehouseRef": "SafehouseIdOrTitle",\n  "username": "PlayerName"\n}' },
  safehouseRemovePlayer: { label: 'Safehouse Remove Player', description: 'Remove a player from a safehouse.', args: '{\n  "safehouseRef": "SafehouseIdOrTitle",\n  "username": "PlayerName"\n}' },
  safehouseSetOwner: { label: 'Safehouse Set Owner', description: 'Transfer safehouse ownership.', args: '{\n  "safehouseRef": "SafehouseIdOrTitle",\n  "owner": "PlayerName"\n}' },
  safehouseSetRespawn: { label: 'Safehouse Respawn Toggle', description: 'Enable/disable respawn in safehouse for player.', args: '{\n  "safehouseRef": "SafehouseIdOrTitle",\n  "username": "PlayerName",\n  "enabled": true\n}' },
  getFactions: { label: 'List Factions', description: 'Get all factions and members.', args: '{}' },
  createFaction: { label: 'Create Faction', description: 'Create a new faction.', args: '{\n  "name": "FactionName",\n  "owner": "PlayerName"\n}' },
  factionAddPlayer: { label: 'Faction Add Player', description: 'Add player to faction.', args: '{\n  "factionName": "FactionName",\n  "username": "PlayerName"\n}' },
  factionRemovePlayer: { label: 'Faction Remove Player', description: 'Remove player from faction.', args: '{\n  "factionName": "FactionName",\n  "username": "PlayerName"\n}' },
  factionSetTag: { label: 'Faction Set Tag', description: 'Set short faction tag.', args: '{\n  "factionName": "FactionName",\n  "tag": "TAG"\n}' },
  removeFaction: { label: 'Remove Faction', description: 'Delete faction.', args: '{\n  "factionName": "FactionName"\n}' },
  getVehiclesDetailed: { label: 'List Vehicles', description: 'List loaded vehicles with telemetry.', args: '{}' },
  triggerSwarmEvent: { label: 'Trigger Swarm Event', description: 'Spawn zombies in rectangular area.', args: '{\n  "count": 25,\n  "x1": 10500,\n  "y1": 9800,\n  "x2": 10600,\n  "y2": 9900\n}' },
  runEventSequence: { label: 'Run Event Sequence', description: 'Run chained chat/weather/swarm/utilities/noise sequence.', args: '{\n  "steps": [\n    { "kind": "chat", "message": "Event incoming", "channel": "general" },\n    { "kind": "weather", "weatherType": "storm", "duration": 2 }\n  ]\n}' },
  getInfrastructureSnapshot: { label: 'Infrastructure Snapshot', description: 'Read hydro/weather state and optional sample point.', args: '{\n  "x": 10500,\n  "y": 9800,\n  "z": 0\n}' },

  moderationKickUser: { label: 'Kick User', description: 'Kick player via BanSystem.', args: '{\n  "username": "PlayerName",\n  "reason": "Rule violation"\n}' },
  moderationBanUser: { label: 'Ban User', description: 'Ban or unban player.', args: '{\n  "username": "PlayerName",\n  "reason": "Rule violation",\n  "ban": true\n}' },
  moderationBanIP: { label: 'Ban IP', description: 'Ban or unban IP address.', args: '{\n  "ip": "127.0.0.1",\n  "reason": "Abuse",\n  "ban": true\n}' },
  moderationBanSteamID: { label: 'Ban SteamID', description: 'Ban or unban SteamID.', args: '{\n  "steamId": "76561198000000000",\n  "reason": "Abuse",\n  "ban": true\n}' },
}

type BridgeFieldType = 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'combo'

interface BridgeFormField {
  key: string
  label: string
  type: BridgeFieldType
  required?: boolean
  placeholder?: string
  help?: string
  min?: number
  max?: number
  step?: number
  maxLength?: number
  pattern?: RegExp
  patternHint?: string
  castAs?: 'number'
  options?: Array<{ value: string; label: string }>
  defaultValue?: string
}

interface BridgeOperationForm {
  fields: BridgeFormField[]
  buildArgs?: (values: Record<string, string>) => Record<string, unknown>
}

interface BridgeResultData {
  operation: string
  success: boolean
  data: unknown
  error?: string
  timestamp: string
}

const bridgeOperationForms: Record<string, BridgeOperationForm> = {
  getSafehouses: { fields: [] },
  safehouseAddPlayer: {
    fields: [
      { key: 'safehouseRef', label: 'Safehouse', type: 'combo', required: true, placeholder: 'Select safehouse' },
      { key: 'username', label: 'Player Username', type: 'combo', required: true, placeholder: 'Select player' },
    ],
  },
  safehouseRemovePlayer: {
    fields: [
      { key: 'safehouseRef', label: 'Safehouse', type: 'combo', required: true, placeholder: 'Select safehouse' },
      { key: 'username', label: 'Player Username', type: 'combo', required: true, placeholder: 'Select player' },
    ],
  },
  safehouseSetOwner: {
    fields: [
      { key: 'safehouseRef', label: 'Safehouse', type: 'combo', required: true, placeholder: 'Select safehouse' },
      { key: 'owner', label: 'New Owner', type: 'combo', required: true, placeholder: 'Select player' },
    ],
  },
  safehouseSetRespawn: {
    fields: [
      { key: 'safehouseRef', label: 'Safehouse', type: 'combo', required: true, placeholder: 'Select safehouse' },
      { key: 'username', label: 'Player Username', type: 'combo', required: true, placeholder: 'Select player' },
      { key: 'enabled', label: 'Allow Respawn', type: 'boolean', defaultValue: 'true' },
    ],
  },
  getFactions: { fields: [] },
  createFaction: {
    fields: [
      { key: 'name', label: 'Faction Name', type: 'text', required: true, placeholder: 'FactionName', maxLength: 64 },
      { key: 'owner', label: 'Owner Username', type: 'combo', required: true, placeholder: 'Select player' },
    ],
  },
  factionAddPlayer: {
    fields: [
      { key: 'factionName', label: 'Faction Name', type: 'combo', required: true, placeholder: 'Select faction' },
      { key: 'username', label: 'Player Username', type: 'combo', required: true, placeholder: 'Select player' },
    ],
  },
  factionRemovePlayer: {
    fields: [
      { key: 'factionName', label: 'Faction Name', type: 'combo', required: true, placeholder: 'Select faction' },
      { key: 'username', label: 'Player Username', type: 'combo', required: true, placeholder: 'Select player' },
    ],
  },
  factionSetTag: {
    fields: [
      { key: 'factionName', label: 'Faction Name', type: 'combo', required: true, placeholder: 'Select faction' },
      {
        key: 'tag',
        label: 'Tag',
        type: 'text',
        required: true,
        placeholder: 'TAG',
        maxLength: 12,
        pattern: /^[A-Za-z0-9_-]{1,12}$/,
        patternHint: 'Use 1-12 characters: letters, numbers, underscore, or dash.',
      },
    ],
  },
  removeFaction: {
    fields: [
      { key: 'factionName', label: 'Faction Name', type: 'combo', required: true, placeholder: 'Select faction' },
    ],
  },
  getVehiclesDetailed: { fields: [] },
  triggerSwarmEvent: {
    fields: [
      { key: 'count', label: 'Zombie Count', type: 'number', required: true, defaultValue: '25', min: 1, max: 500 },
      { key: 'x1', label: 'X1', type: 'number', required: true, defaultValue: '10500' },
      { key: 'y1', label: 'Y1', type: 'number', required: true, defaultValue: '9800' },
      { key: 'x2', label: 'X2', type: 'number', required: true, defaultValue: '10600' },
      { key: 'y2', label: 'Y2', type: 'number', required: true, defaultValue: '9900' },
    ],
  },
  runEventSequence: {
    fields: [
      {
        key: 'preset',
        label: 'Sequence Preset',
        type: 'select',
        required: true,
        defaultValue: 'storm_alert',
        options: [
          { value: 'storm_alert', label: 'Storm Alert Sequence' },
          { value: 'panic_noise', label: 'Panic Noise Sequence' },
          { value: 'utilities_shutdown', label: 'Utilities Shutdown Sequence' },
        ],
      },
      { key: 'message', label: 'Broadcast Message', type: 'text', defaultValue: 'Event incoming', maxLength: 240 },
    ],
    buildArgs: (values) => {
      const preset = values.preset || 'storm_alert'
      const message = values.message?.trim() || 'Event incoming'

      if (preset === 'panic_noise') {
        return {
          steps: [
            { kind: 'chat', message, channel: 'general' },
            { kind: 'noise', radius: 120, volume: 100 },
          ],
        }
      }

      if (preset === 'utilities_shutdown') {
        return {
          steps: [
            { kind: 'chat', message, channel: 'general' },
            { kind: 'utilities', power: false, water: false },
          ],
        }
      }

      return {
        steps: [
          { kind: 'chat', message, channel: 'general' },
          { kind: 'weather', weatherType: 'storm', duration: 2 },
        ],
      }
    },
  },
  getInfrastructureSnapshot: {
    fields: [
      { key: 'x', label: 'X (optional)', type: 'number', placeholder: '10500' },
      { key: 'y', label: 'Y (optional)', type: 'number', placeholder: '9800' },
      { key: 'z', label: 'Z (optional)', type: 'number', defaultValue: '0', placeholder: '0' },
    ],
    buildArgs: (values) => {
      const x = values.x?.trim()
      const y = values.y?.trim()
      const z = values.z?.trim()
      if (!x || !y) return {}
      return {
        x: Number(x),
        y: Number(y),
        z: z ? Number(z) : 0,
      }
    },
  },
  moderationKickUser: {
    fields: [
      { key: 'username', label: 'Username', type: 'combo', required: true, placeholder: 'Select player' },
      { key: 'reason', label: 'Reason', type: 'combo', defaultValue: 'Rule violation' },
    ],
  },
  moderationBanUser: {
    fields: [
      { key: 'username', label: 'Username', type: 'combo', required: true, placeholder: 'Select player' },
      { key: 'reason', label: 'Reason', type: 'combo', defaultValue: 'Rule violation' },
      { key: 'ban', label: 'Ban User', type: 'boolean', defaultValue: 'true' },
    ],
  },
  moderationBanIP: {
    fields: [
      {
        key: 'ip',
        label: 'IP Address',
        type: 'text',
        required: true,
        placeholder: '127.0.0.1',
        pattern: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
        patternHint: 'Enter a valid IPv4 address (example: 127.0.0.1).',
      },
      { key: 'reason', label: 'Reason', type: 'combo', defaultValue: 'Abuse' },
      { key: 'ban', label: 'Ban IP', type: 'boolean', defaultValue: 'true' },
    ],
  },
  moderationBanSteamID: {
    fields: [
      {
        key: 'steamId',
        label: 'Steam ID',
        type: 'text',
        required: true,
        placeholder: '76561198000000000',
        maxLength: 17,
        pattern: /^\d{17}$/,
        patternHint: 'Steam ID must be exactly 17 digits.',
      },
      { key: 'reason', label: 'Reason', type: 'combo', defaultValue: 'Abuse' },
      { key: 'ban', label: 'Ban SteamID', type: 'boolean', defaultValue: 'true' },
    ],
  },
}

const bridgeOperationGroups = [
  {
    id: 'territory',
    label: 'Territory',
    description: 'Safehouse and faction administration.',
    operations: ['getSafehouses', 'safehouseAddPlayer', 'safehouseRemovePlayer', 'safehouseSetOwner', 'safehouseSetRespawn', 'getFactions', 'createFaction', 'factionAddPlayer', 'factionRemovePlayer', 'factionSetTag', 'removeFaction'],
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    description: 'Repair, alarms, sirens, and storage locks.',
    operations: ['getVehiclesDetailed'],
  },
  {
    id: 'events',
    label: 'Events',
    description: 'Swarm, infrastructure, and scripted sequences.',
    operations: ['triggerSwarmEvent', 'runEventSequence', 'getInfrastructureSnapshot'],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    description: 'Kick and ban actions through BanSystem.',
    operations: ['moderationKickUser', 'moderationBanUser', 'moderationBanIP', 'moderationBanSteamID'],
  },
] as const

const formatPanelTimestamp = (date: Date): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

// ============================================
// STRUCTURED RESULT DISPLAY
// ============================================

interface BridgeResultDisplayProps {
  result: BridgeResultData
  loading: string | null
  onInlineAction: (action: string, args: Record<string, unknown>, label: string) => Promise<void>
  players: Player[]
}

function BridgeResultDisplay({ result, loading, onInlineAction, players }: BridgeResultDisplayProps) {
  const [showRaw, setShowRaw] = useState(false)
  const { operation, success, data, error, timestamp } = result
  const isLoading = loading !== null

  if (!success) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <X className="h-4 w-4" />
          Operation Failed
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{error || 'Unknown error'}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">{timestamp}</p>
      </div>
    )
  }

  // Vehicle list
  if (operation === 'getVehiclesDetailed') {
    const vehicles = (data as { vehicles?: unknown[] })?.vehicles ?? []
    if (vehicles.length === 0) {
      return (
        <ResultCard title="No Vehicles Found" icon={<Car className="h-4 w-4" />} timestamp={timestamp}>
          <p className="text-sm text-muted-foreground">No vehicles are currently loaded in any active cell.</p>
        </ResultCard>
      )
    }
    return (
      <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{vehicles.length} Vehicle{vehicles.length !== 1 ? 's' : ''} Loaded</span>
          </div>
          <span className="text-xs text-muted-foreground">{timestamp}</span>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left">
                <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">ID</th>
                <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Type</th>
                <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Location</th>
                <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Battery</th>
                <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="pb-2 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(vehicles as Array<Record<string, unknown>>).map((v) => {
                const vid = Number(v.id)
                const script = String(v.scriptName || '').replace('Base.', '')
                const vx = Math.round(Number(v.x) || 0)
                const vy = Math.round(Number(v.y) || 0)
                const battery = Math.round((Number(v.batteryCharge) || 0) * 100)
                const alarmed = Boolean(v.alarmed)
                const sirening = Boolean(v.sirening)
                const trunkLocked = Boolean(v.trunkLocked)
                return (
                  <tr key={vid} className="border-b border-border/30 last:border-0">
                    <td className="py-2.5 pr-3 font-mono text-xs text-foreground/80">{vid}</td>
                    <td className="py-2.5 pr-3 text-xs">{script || '—'}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-foreground/70">{vx}, {vy}</td>
                    <td className="py-2.5 pr-3">
                      <span className={cn('text-xs font-medium', battery > 50 ? 'text-success' : battery > 20 ? 'text-warning' : 'text-destructive')}>
                        {battery}%
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {alarmed && <Badge variant="outline" className="h-5 text-[10px] px-1.5 text-warning border-warning/30">Alarm</Badge>}
                        {sirening && <Badge variant="outline" className="h-5 text-[10px] px-1.5 text-info border-info/30">Siren</Badge>}
                        <Badge variant="outline" className={cn('h-5 text-[10px] px-1.5', trunkLocked ? 'text-foreground/60' : 'text-success border-success/30')}>
                          {trunkLocked ? 'Locked' : 'Open'}
                        </Badge>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={isLoading}
                          onClick={() => onInlineAction('vehicleRepair', { vehicleId: vid }, `Vehicle #${vid} repaired`)}>
                          <Wrench className="h-3 w-3" /> Repair
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={isLoading}
                          onClick={() => onInlineAction('vehicleSetAlarm', { vehicleId: vid, enabled: !alarmed }, alarmed ? `Alarm disabled on #${vid}` : `Alarm enabled on #${vid}`)}>
                          {alarmed ? 'Alarm Off' : 'Alarm On'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={isLoading}
                          onClick={() => onInlineAction('vehicleSetTrunkLocked', { vehicleId: vid, locked: !trunkLocked }, trunkLocked ? `Trunk unlocked on #${vid}` : `Trunk locked on #${vid}`)}>
                          {trunkLocked ? <><Unlock className="h-3 w-3" /> Unlock</> : <><Lock className="h-3 w-3" /> Lock</>}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Safehouse list
  if (operation === 'getSafehouses') {
    const safehouses = (data as { safehouses?: unknown[] })?.safehouses ?? []
    if (safehouses.length === 0) {
      return (
        <ResultCard title="No Safehouses Found" icon={<ShieldCheck className="h-4 w-4" />} timestamp={timestamp}>
          <p className="text-sm text-muted-foreground">No safehouses are claimed on this server.</p>
        </ResultCard>
      )
    }
    return (
      <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{safehouses.length} Safehouse{safehouses.length !== 1 ? 's' : ''}</span>
          </div>
          <span className="text-xs text-muted-foreground">{timestamp}</span>
        </div>
        <div className="space-y-2">
          {(safehouses as Array<Record<string, unknown>>).map((sh, i) => {
            const title = String(sh.title || sh.id || `Safehouse ${i + 1}`)
            const owner = String(sh.owner || '—')
            const members = Array.isArray(sh.members) ? sh.members : []
            const ref = String(sh.id ?? sh.title ?? '')
            return (
              <div key={ref || i} className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Owner: {owner} · {members.length} member{members.length !== 1 ? 's' : ''}</p>
                    {members.length > 0 && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">Members: {members.map(String).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {players.length > 0 && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={isLoading}
                        onClick={() => {
                          const username = players[0]?.name
                          if (username) onInlineAction('safehouseAddPlayer', { safehouseRef: ref, username }, `Added ${username} to ${title}`)
                        }}>
                        + Player
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Faction list
  if (operation === 'getFactions') {
    const factions = (data as { factions?: unknown[] })?.factions ?? []
    if (factions.length === 0) {
      return (
        <ResultCard title="No Factions Found" icon={<Users className="h-4 w-4" />} timestamp={timestamp}>
          <p className="text-sm text-muted-foreground">No factions exist on this server.</p>
        </ResultCard>
      )
    }
    return (
      <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{factions.length} Faction{factions.length !== 1 ? 's' : ''}</span>
          </div>
          <span className="text-xs text-muted-foreground">{timestamp}</span>
        </div>
        <div className="space-y-2">
          {(factions as Array<Record<string, unknown>>).map((f, i) => {
            const name = String(f.name || `Faction ${i + 1}`)
            const owner = String(f.owner || '—')
            const tag = String(f.tag || '')
            const members = Array.isArray(f.members) ? f.members : []
            return (
              <div key={name} className="rounded-md border border-border/50 bg-background/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{name}</p>
                      {tag && <Badge variant="outline" className="h-5 text-[10px] px-1.5">{tag}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Owner: {owner} · {members.length} member{members.length !== 1 ? 's' : ''}</p>
                    {members.length > 0 && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">Members: {members.map(String).join(', ')}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Infrastructure snapshot
  if (operation === 'getInfrastructureSnapshot') {
    const d = data as Record<string, unknown> | null
    if (!d) return <ResultCard title="No Data" icon={<Info className="h-4 w-4" />} timestamp={timestamp}><p className="text-sm text-muted-foreground">Empty response.</p></ResultCard>
    return (
      <ResultCard title="Infrastructure Snapshot" icon={<Gauge className="h-4 w-4" />} timestamp={timestamp}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(d).filter(([k]) => k !== 'success' && k !== 'message').map(([k, v]) => (
            <div key={k} className="space-y-0.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{k.replace(/([A-Z])/g, ' $1').trim()}</p>
              <p className="text-sm font-medium">{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v ?? '—')}</p>
            </div>
          ))}
        </div>
      </ResultCard>
    )
  }

  // Generic action results — extract message from common response shapes
  const msg = typeof data === 'string' ? data
    : (data as Record<string, unknown>)?.message ? String((data as Record<string, unknown>).message)
    : null

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Check className="h-4 w-4 text-primary" />
          {bridgeOperationTemplates[operation]?.label || operation}
        </div>
        <span className="text-xs text-muted-foreground">{timestamp}</span>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <button
        type="button"
        onClick={() => setShowRaw(!showRaw)}
        className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        aria-expanded={showRaw}
      >
        {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {showRaw ? 'Hide details' : 'Show details'}
      </button>
      {showRaw && (
        <pre className="max-h-48 overflow-auto rounded-md border border-border/50 bg-background/60 p-2.5 text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ResultCard({ title, icon, timestamp, children }: { title: string; icon: React.ReactNode; timestamp: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/15 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="text-sm font-medium">{title}</span>
        </div>
        <span className="text-xs text-muted-foreground">{timestamp}</span>
      </div>
      {children}
    </div>
  )
}

export default function Events() {
  const [loading, setLoading] = useState<string | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<string>('')
  const [targetAll, setTargetAll] = useState(true)
  
  // Weather controls
  const [rainIntensity, setRainIntensity] = useState(50)
  const [stormDuration, setStormDuration] = useState(1)
  
  // Horde controls
  const [hordeCount, setHordeCount] = useState(50)
  
  // Time controls
  const [timeSpeed, setTimeSpeed] = useState(1)
  
  // Teleport coordinates
  const [teleportX, setTeleportX] = useState('')
  const [teleportY, setTeleportY] = useState('')
  const [teleportZ, setTeleportZ] = useState('0')
  
  // Vehicle spawning
  const [selectedVehicle, setSelectedVehicle] = useState('Base.VanAmbulance')
  
  // Announcements
  const [announcement, setAnnouncement] = useState('')
  
  // Panel Bridge state
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [bridgeLoading, setBridgeLoading] = useState<string | null>(null)
  const [blizzardDuration, setBlizzardDuration] = useState(2)
  const [tropicalDuration, setTropicalDuration] = useState(2)
  
  // Climate controls
  const [fogIntensity, setFogIntensity] = useState(0)
  const [windIntensity, setWindIntensity] = useState(0)
  const [temperature, setTemperature] = useState(20)
  const [cloudIntensity, setCloudIntensity] = useState(0)
  const [humidity, setHumidity] = useState(50)
  const [precipitationIntensity, setPrecipitationIntensity] = useState(0)
  
  // Game time controls
  const [gameHour, setGameHour] = useState(12)
  const [gameDay, setGameDay] = useState(1)
  const [gameMonth, setGameMonth] = useState(7)
  
  // Sound controls
  const [soundRadius, setSoundRadius] = useState(100)
  const [soundVolume, setSoundVolume] = useState(100)
  const [soundX, setSoundX] = useState('')
  const [soundY, setSoundY] = useState('')

  // Bridge operations (new Lua handlers)
  const [bridgeOperation, setBridgeOperation] = useState<string>('getSafehouses')
  const [bridgeOperationFormValues, setBridgeOperationFormValues] = useState<Record<string, Record<string, string>>>(() => {
    return Object.fromEntries(
      Object.entries(bridgeOperationForms).map(([operation, form]) => {
        const seeded = Object.fromEntries(form.fields.map((field) => [field.key, field.defaultValue ?? '']))
        return [operation, seeded]
      })
    )
  })
  const [bridgeResultData, setBridgeResultData] = useState<BridgeResultData | null>(null)
  const [bridgeFormError, setBridgeFormError] = useState<string | null>(null)
  const [bridgeLastRunAt, setBridgeLastRunAt] = useState<string | null>(null)
  const [bridgeSafehouseOptions, setBridgeSafehouseOptions] = useState<Array<{ value: string; label: string }>>([])
  const [bridgeFactionOptions, setBridgeFactionOptions] = useState<Array<{ value: string; label: string }>>([])
  const [bridgeVehicleOptions, setBridgeVehicleOptions] = useState<Array<{ value: string; label: string }>>([])
  const [bridgeOptionsLoading, setBridgeOptionsLoading] = useState(false)
  const [bridgeOptionsError, setBridgeOptionsError] = useState<string | null>(null)
  const [bridgeOptionsLastUpdated, setBridgeOptionsLastUpdated] = useState<string | null>(null)
  const [bridgeOptionsRefreshTick, setBridgeOptionsRefreshTick] = useState(0)
  const [bridgeConnectionSummary, setBridgeConnectionSummary] = useState<string | null>(null)
  
  // Utilities status
  const [utilitiesStatus, setUtilitiesStatus] = useState<{
    hydroPowerOn: boolean
    powerOn: boolean
    waterOn: boolean
    elecShut: string
    waterShut: string
  } | null>(null)
  
  const { toast } = useToast()

  type EventSectionKey = 'weather' | 'environment' | 'sound' | 'world' | 'bridgeOps'

  const [activeIntent, setActiveIntent] = useState<EventSectionKey>('weather')

  const fetchPlayers = useCallback(async () => {
    try {
      const data = await playersApi.getPlayers()
      if (data.players) {
        setPlayers(data.players)
      }
    } catch {
      // Silently ignore — player list will refresh on next interval
    }
  }, [])

  const mountedRef = useRef(true)

  const checkBridgeStatus = useCallback(async () => {
    try {
      const status = await panelBridgeApi.getStatus()
      if (!mountedRef.current) return
      setBridgeConnected(status.modConnected)
      setBridgeConnectionSummary(status.connection?.summary || null)
      
      // If connected, fetch secondary data in parallel
      if (status.modConnected) {
        const [floatsRes, timeRes, utilitiesRes] = await Promise.allSettled([
          panelBridgeApi.getClimateFloats(),
          panelBridgeApi.getGameTime(),
          panelBridgeApi.getUtilitiesStatus(),
        ])
        if (!mountedRef.current) return

        if (floatsRes.status === 'fulfilled' && floatsRes.value.success && floatsRes.value.data?.floats) {
          const floats = floatsRes.value.data.floats
          const findFloat = (id: number) => floats.find((f: { id: number; value: number }) => f.id === id)?.value
          setFogIntensity(Math.round((findFloat(5) ?? 0) * 100))
          setWindIntensity(Math.round((findFloat(6) ?? 0) * 100))
          setTemperature(Math.round(findFloat(4) ?? 20))
          setCloudIntensity(Math.round((findFloat(8) ?? 0) * 100))
          setHumidity(Math.round((findFloat(12) ?? 0.5) * 100))
          setPrecipitationIntensity(Math.round((findFloat(3) ?? 0) * 100))
        }

        if (timeRes.status === 'fulfilled' && timeRes.value.success && timeRes.value.data) {
          setGameHour(Math.floor(timeRes.value.data.hour))
          setGameDay(timeRes.value.data.day)
          setGameMonth(timeRes.value.data.month)
        }

        if (utilitiesRes.status === 'fulfilled' && utilitiesRes.value.success && utilitiesRes.value.data) {
          setUtilitiesStatus(utilitiesRes.value.data)
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        setBridgeConnected(false)
        setBridgeConnectionSummary('Unable to read bridge status from the panel API.')
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchPlayers()
    checkBridgeStatus()
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') fetchPlayers()
    }, 30000)
    const bridgeInterval = setInterval(() => {
      if (document.visibilityState !== 'hidden') checkBridgeStatus()
    }, 10000)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
      clearInterval(bridgeInterval)
    }
  }, [fetchPlayers, checkBridgeStatus])

  useEffect(() => {
    if (!bridgeConnected) {
      setBridgeSafehouseOptions([])
      setBridgeFactionOptions([])
      setBridgeVehicleOptions([])
      setBridgeOptionsLoading(false)
      setBridgeOptionsError(null)
      setBridgeOptionsLastUpdated(null)
      return
    }

    let active = true
    const loadBridgeOptions = async () => {
      setBridgeOptionsLoading(true)
      try {
        const [safehouseResult, factionResult, vehicleResult] = await Promise.allSettled([
          panelBridgeApi.sendCommand('getSafehouses', {}),
          panelBridgeApi.sendCommand('getFactions', {}),
          panelBridgeApi.sendCommand('getVehiclesDetailed', {}),
        ])
        if (!active) return

        const failureReasons: string[] = []
        let updatedAnySource = false

        if (safehouseResult.status === 'fulfilled') {
          const safehousePayload = (safehouseResult.value as { data?: unknown })?.data ?? safehouseResult.value
          const safehouses = (safehousePayload as { safehouses?: Array<{ id?: unknown; title?: unknown }> })?.safehouses ?? []
          const safehouseOptions = safehouses
            .map((safehouse) => {
              const id = safehouse.id != null ? String(safehouse.id).trim() : ''
              const title = safehouse.title != null ? String(safehouse.title).trim() : ''
              const value = id || title
              if (!value) return null
              const label = title ? `${title}${id ? ` (${id})` : ''}` : value
              return { value, label }
            })
            .filter((option): option is { value: string; label: string } => Boolean(option))
          const dedupedSafehouses = Array.from(new Map(safehouseOptions.map((option) => [option.value, option])).values())
          setBridgeSafehouseOptions(dedupedSafehouses)
          updatedAnySource = true
        } else {
          failureReasons.push('safehouses')
        }

        if (factionResult.status === 'fulfilled') {
          const factionPayload = (factionResult.value as { data?: unknown })?.data ?? factionResult.value
          const factions = (factionPayload as { factions?: Array<{ name?: unknown; owner?: unknown }> })?.factions ?? []
          const factionOptions = factions
            .map((faction) => {
              const name = faction.name != null ? String(faction.name).trim() : ''
              if (!name) return null
              const owner = faction.owner != null ? String(faction.owner).trim() : ''
              return { value: name, label: owner ? `${name} (owner: ${owner})` : name }
            })
            .filter((option): option is { value: string; label: string } => Boolean(option))
          const dedupedFactions = Array.from(new Map(factionOptions.map((option) => [option.value, option])).values())
          setBridgeFactionOptions(dedupedFactions)
          updatedAnySource = true
        } else {
          failureReasons.push('factions')
        }

        if (vehicleResult.status === 'fulfilled') {
          const vehiclePayload = (vehicleResult.value as { data?: unknown })?.data ?? vehicleResult.value
          const vehicles = (vehiclePayload as { vehicles?: Array<{ id?: unknown; scriptName?: unknown; x?: unknown; y?: unknown }> })?.vehicles ?? []
          const vehicleOptions = vehicles
            .map((vehicle) => {
              const id = vehicle.id != null ? String(vehicle.id).trim() : ''
              if (!id) return null
              const script = vehicle.scriptName != null ? String(vehicle.scriptName).trim() : ''
              const x = vehicle.x != null ? String(vehicle.x).trim() : ''
              const y = vehicle.y != null ? String(vehicle.y).trim() : ''
              const coord = x && y ? ` @ ${x},${y}` : ''
              const label = `${id}${script ? ` (${script})` : ''}${coord}`
              return { value: id, label }
            })
            .filter((option): option is { value: string; label: string } => Boolean(option))
          const dedupedVehicles = Array.from(new Map(vehicleOptions.map((option) => [option.value, option])).values())
          setBridgeVehicleOptions(dedupedVehicles)
          updatedAnySource = true
        } else {
          failureReasons.push('vehicles')
        }

        if (failureReasons.length > 0) {
          setBridgeOptionsError(
            failureReasons.length === 3
              ? 'Could not refresh bridge lists. Existing options are preserved.'
              : `Some bridge lists failed to refresh (${failureReasons.join(', ')}).`
          )
        } else {
          setBridgeOptionsError(null)
        }

        if (updatedAnySource) {
          setBridgeOptionsLastUpdated(formatPanelTimestamp(new Date()))
        }
      } catch {
        if (!active) return
        setBridgeOptionsError('Could not refresh bridge lists. Existing options are preserved.')
      } finally {
        if (active) setBridgeOptionsLoading(false)
      }
    }

    void loadBridgeOptions()
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void loadBridgeOptions()
    }, 30000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bridgeConnected, bridgeOptionsRefreshTick])

  // Bridge weather commands
  const handleBridgeAction = useCallback(async (action: string, fn: () => Promise<unknown>) => {
    setBridgeLoading(action)
    try {
      await fn()
      const successCopy = getEventSuccessCopy(action)
      toast({
        title: successCopy.title,
        description: successCopy.description,
        variant: 'success' as const,
      })
    } catch (error) {
      const message = getUserErrorMessage(error, 'Bridge command failed.')
      toast({
        title: `${action} failed`,
        description: `${message}. Check bridge/server connection and try again.`,
        variant: 'destructive',
      })
    } finally {
      setBridgeLoading(null)
    }
  }, [toast])

  const executeCommand = useCallback(async (command: string) => {
    const result = await rconApi.execute(command)
    if (!result.success) {
      throw new Error(result.error || 'Command failed')
    }
    return result
  }, [])

  const handleAction = useCallback(async (action: string, fn: () => Promise<unknown>) => {
    setLoading(action)
    try {
      await fn()
      const successCopy = getEventSuccessCopy(action)
      toast({
        title: successCopy.title,
        description: successCopy.description,
        variant: 'success' as const,
      })
    } catch (error) {
      const message = getUserErrorMessage(error, 'Command failed.')
      toast({
        title: `${action} failed`,
        description: `${message}. Verify command settings and try again.`,
        variant: 'destructive',
      })
    } finally {
      setLoading(null)
    }
  }, [toast])

  const getTargetPlayer = useCallback(() => targetAll ? undefined : selectedPlayer || undefined, [targetAll, selectedPlayer])
  const parseCoord = (value: string): number | null => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.floor(n) : null
  }

  const soundCoordX = parseCoord(soundX)
  const soundCoordY = parseCoord(soundY)
  const hasValidSoundCoords = soundCoordX !== null && soundCoordY !== null

  const teleportCoordX = parseCoord(teleportX)
  const teleportCoordY = parseCoord(teleportY)
  const teleportCoordZ = parseCoord(teleportZ)
  const hasValidTeleportCoords = teleportCoordX !== null && teleportCoordY !== null && teleportCoordZ !== null

  // Weather commands
  const startRain = () => serverApi.startRain(rainIntensity)
  const stopRain = () => serverApi.stopRain()
  const startStorm = () => serverApi.startStorm(stormDuration)
  const stopWeather = () => serverApi.stopWeather()
  
  // Sound/Event commands
  // Note: chopper and gunshot target a RANDOM online player, not the selected player
  const triggerChopper = () => serverApi.triggerChopper()
  const triggerGunshot = () => serverApi.triggerGunshot()
  const triggerLightning = (username?: string) => serverApi.triggerLightning(username)
  const triggerThunder = (username?: string) => serverApi.triggerThunder(username)
  // Alarm triggers at admin's in-game position (admin must be online)
  const triggerAlarm = () => serverApi.alarm()
  
  // Zombie commands — use PanelBridge (CreateSwarm) for proper distance control
  const createHorde = (count: number, username?: string) => {
    if (!username) throw new Error('Target player required for horde spawn')
    return panelBridgeApi.spawnHordeNear(username, count)
  }
  
  // Spawn horde behind the player based on their facing direction
  const createHorde2 = (count: number, username?: string) => {
    if (!username) throw new Error('Target player required for horde spawn')
    return panelBridgeApi.spawnHordeBehind(username, count)
  }
  
  // Clear all zombies from loaded cells
  const removeZombies = () => panelBridgeApi.clearAllZombies()
  
  // Time commands
  const setGameTimeSpeed = () => executeCommand(`setTimeSpeed ${timeSpeed}`)
  
  // Teleport commands
  // teleportto only works if admin is in-game and teleports themselves
  // For teleporting other players, use teleport command with player name and coordinates
  const teleportToCoords = (x: number, y: number, z: number, targetPlayer?: string) => {
    if (targetPlayer) {
      // Teleport specific player to coordinates
      return executeCommand(`teleport "${targetPlayer}" ${x},${y},${z}`)
    }
    // Self-teleport (requires admin to be in-game)
    return executeCommand(`teleportto ${x},${y},${z}`)
  }
  const teleportPlayerToPlayer = (player1: string, player2: string) =>
    executeCommand(`teleport "${player1}" "${player2}"`)
    
  // Vehicle commands
  const spawnVehicle = (vehicleId: string, username: string) =>
    executeCommand(`addvehicle "${vehicleId}" "${username}"`)
  
  // Announcement
  const sendAnnouncement = () => serverApi.sendMessage(announcement)

  const getBridgeFieldValue = (fieldKey: string): string => bridgeOperationFormValues[bridgeOperation]?.[fieldKey] ?? ''

  const setBridgeFieldValue = (fieldKey: string, value: string) => {
    setBridgeOperationFormValues((prev) => ({
      ...prev,
      [bridgeOperation]: {
        ...(prev[bridgeOperation] ?? {}),
        [fieldKey]: value,
      },
    }))
    if (bridgeFormError) setBridgeFormError(null)
  }

  const buildBridgeArgsFromForm = (operation: string): Record<string, unknown> => {
    const form = bridgeOperationForms[operation]
    if (!form || form.fields.length === 0) return {}

    const values = bridgeOperationFormValues[operation] ?? {}
    const missingRequired = form.fields.find((field) => field.required && !String(values[field.key] ?? '').trim())
    if (missingRequired) {
      throw new Error(`${missingRequired.label} is required.`)
    }

    if (form.buildArgs) {
      return form.buildArgs(values)
    }

    const args: Record<string, unknown> = {}
    for (const field of form.fields) {
      const raw = values[field.key] ?? ''
      const trimmed = raw.trim()
      if (!trimmed && !field.required) continue

      if (field.type === 'number' || field.castAs === 'number') {
        const n = Number(trimmed)
        if (!Number.isFinite(n)) {
          throw new Error(`${field.label} must be a valid number.`)
        }
        if (typeof field.min === 'number' && n < field.min) {
          throw new Error(`${field.label} must be at least ${field.min}.`)
        }
        if (typeof field.max === 'number' && n > field.max) {
          throw new Error(`${field.label} must be at most ${field.max}.`)
        }
        args[field.key] = n
      } else if (field.type === 'boolean') {
        args[field.key] = trimmed === 'true'
      } else {
        if (typeof field.maxLength === 'number' && trimmed.length > field.maxLength) {
          throw new Error(`${field.label} must be ${field.maxLength} characters or fewer.`)
        }
        if (field.pattern && !field.pattern.test(trimmed)) {
          throw new Error(field.patternHint || `${field.label} is not in the expected format.`)
        }
        args[field.key] = trimmed
      }
    }

    return args
  }

  const bridgeActiveGroup = bridgeOperationGroups.find((group) => (group.operations as readonly string[]).includes(bridgeOperation))
  const currentBridgeForm = bridgeOperationForms[bridgeOperation]
  const currentBridgeFields = currentBridgeForm?.fields ?? []
  const currentBridgeHasComboFields = currentBridgeFields.some((field) => field.type === 'combo')
  const currentRequiredFieldCount = currentBridgeFields.filter((field) => field.required).length
  const currentCompletedRequiredFieldCount = currentBridgeFields.filter((field) => {
    if (!field.required) return false
    return Boolean(getBridgeFieldValue(field.key).trim())
  }).length
  const bridgeRunDisabledReason = !bridgeConnected
    ? 'Bridge is offline. Open Settings to reconnect PanelBridge.'
    : bridgeLoading !== null
      ? 'Operation in progress. Wait for completion before sending another command.'
      : bridgeFormError
        ? bridgeFormError
        : null

  const selectBridgeOperation = (nextOperation: string) => {
    setBridgeOperation(nextOperation)
    setBridgeFormError(null)
    setBridgeResultData(null)
    setBridgeLastRunAt(null)
  }

  const getBridgeComboOptions = (fieldKey: string): Array<{ value: string; label: string }> => {
    if (fieldKey === 'username' || fieldKey === 'owner') {
      return players.map((player) => ({ value: player.name, label: player.name }))
    }

    if (fieldKey === 'safehouseRef') {
      return bridgeSafehouseOptions
    }

    if (fieldKey === 'factionName') {
      return bridgeFactionOptions
    }

    if (fieldKey === 'vehicleId') {
      return bridgeVehicleOptions
    }

    if (fieldKey === 'reason') {
      return [
        { value: 'Rule violation', label: 'Rule violation' },
        { value: 'Abuse', label: 'Abuse' },
        { value: 'Harassment', label: 'Harassment' },
        { value: 'Cheating', label: 'Cheating' },
      ]
    }

    return []
  }

  const resetBridgeFormValues = () => {
    const form = bridgeOperationForms[bridgeOperation]
    if (!form) return
    const defaults = Object.fromEntries(form.fields.map((field) => [field.key, field.defaultValue ?? '']))
    setBridgeOperationFormValues((prev) => ({ ...prev, [bridgeOperation]: defaults }))
    setBridgeFormError(null)
  }

  const runInlineAction = async (action: string, args: Record<string, unknown>, label: string) => {
    setBridgeLoading(action)
    try {
      await panelBridgeApi.sendCommand(action, args)
      toast({
        title: `${label}`,
        description: 'Operation completed successfully.',
        variant: 'success' as const,
      })
      // Re-run the current list operation to refresh table data
      if (bridgeResultData?.operation) {
        try {
          const refreshed = await panelBridgeApi.sendCommand(bridgeResultData.operation, {})
          const payload = (refreshed as Record<string, unknown>)?.data ?? refreshed
          setBridgeResultData({
            operation: bridgeResultData.operation,
            success: true,
            data: payload,
            timestamp: formatPanelTimestamp(new Date()),
          })
        } catch { /* ignore refresh failure */ }
      }
      // Also refresh combo options
      setBridgeOptionsRefreshTick((prev) => prev + 1)
    } catch (error) {
      toast({
        title: `${label} failed`,
        description: getUserErrorMessage(error, 'Operation failed.'),
        variant: 'destructive',
      })
    } finally {
      setBridgeLoading(null)
    }
  }

  const runBridgeOperation = async () => {
    if (!bridgeConnected) {
      toast({
        title: 'Bridge Not Connected',
        description: 'Connect PanelBridge in Settings before running advanced operations.',
        variant: 'destructive',
      })
      return
    }

    let parsedArgs: Record<string, unknown> = {}
    try {
      parsedArgs = buildBridgeArgsFromForm(bridgeOperation)
      setBridgeFormError(null)
    } catch (error) {
      const message = getUserErrorMessage(error, 'Please complete required fields.')
      setBridgeFormError(message)
      toast({
        title: 'Missing or Invalid Fields',
        description: message,
        variant: 'destructive',
      })
      return
    }

    setBridgeLoading(bridgeOperation)
    setBridgeFormError(null)
    try {
      const response = await panelBridgeApi.sendCommand(bridgeOperation, parsedArgs)
      const payload = (response as Record<string, unknown>)?.data ?? response
      setBridgeResultData({
        operation: bridgeOperation,
        success: true,
        data: payload,
        timestamp: formatPanelTimestamp(new Date()),
      })
      setBridgeLastRunAt(formatPanelTimestamp(new Date()))
      // Refresh combo options for list operations
      if (['getSafehouses', 'getFactions', 'getVehiclesDetailed'].includes(bridgeOperation)) {
        setBridgeOptionsRefreshTick((prev) => prev + 1)
      }
      toast({
        title: `${bridgeOperationTemplates[bridgeOperation]?.label || bridgeOperation} executed`,
        description: 'Operation completed successfully.',
        variant: 'success' as const,
      })
    } catch (error) {
      const message = getUserErrorMessage(error, 'Bridge operation failed.')
      setBridgeResultData({
        operation: bridgeOperation,
        success: false,
        data: null,
        error: message,
        timestamp: formatPanelTimestamp(new Date()),
      })
      setBridgeLastRunAt(formatPanelTimestamp(new Date()))
      toast({
        title: 'Bridge Operation Failed',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setBridgeLoading(null)
    }
  }

  return (
    <div className="space-y-6 page-transition">
      <PageHeader
        title="Events"
        description="Trigger weather, sounds, zombies, and world actions on your live server"
        eyebrow="World Control"
        tone="world"
        icon={<Zap className="w-5 h-5 text-primary" />}
        actions={
          <div className="flex items-center gap-2">
            <BridgeStatusBadge connected={bridgeConnected} />
            <Button variant="command" onClick={fetchPlayers} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Refresh Players
            </Button>
          </div>
        }
      />

      {/* Single top-level bridge warning — shown once, not per-card */}
      {!bridgeConnected && (
        <Alert className="border-warning/40 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-warning">Panel Bridge Required</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>Advanced weather, climate, time, infrastructure, and precision sound controls require <strong className="text-foreground">PanelBridge.lua</strong>. Basic RCON actions still work.</p>
            <Link to="/settings" className="inline-flex text-sm text-primary underline hover:text-foreground">Open Bridge Setup</Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Target Selection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Event Target
              </CardTitle>
              <CardDescription className="mt-0.5">Choose a target player or target all. Pick an action below.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={targetAll}
                onCheckedChange={setTargetAll}
                id="target-all"
              />
              <Label htmlFor="target-all" className="flex items-center gap-2 whitespace-nowrap">
                <Users className="w-4 h-4" />
                Use Global/Random Target
              </Label>
            </div>
          </div>
        </CardHeader>
        {!targetAll && (
        <CardContent className="pt-0 space-y-2">
            <div className="space-y-2">
              <Label htmlFor="event-target-player" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Select Player
              </Label>
              <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                <SelectTrigger id="event-target-player" aria-label="Select player target" className="w-full max-w-xs">
                  <SelectValue placeholder="Select an online player" />
                </SelectTrigger>
                <SelectContent>
                  {players.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No players online</div>
                  ) : (
                    players.map((player) => (
                      <SelectItem key={player.name} value={player.name}>
                        <span className="block max-w-[200px] truncate" dir="auto" title={player.name}>{player.name}</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {players.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No players are currently online. Some events require an online player to target.
                </p>
              )}
            </div>
        </CardContent>
        )}
      </Card>

      {/* Tab Navigation */}
      <Tabs value={activeIntent} onValueChange={(v) => setActiveIntent(v as EventSectionKey)}>
        <TabsList className="flex h-auto flex-wrap gap-1 bg-muted/40 p-1 rounded-xl w-full">
          <TabsTrigger value="weather" className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
            <CloudRain className="w-3.5 h-3.5 shrink-0" />Weather
          </TabsTrigger>
          <TabsTrigger value="environment" className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
            <Clock className="w-3.5 h-3.5 shrink-0" />Time
          </TabsTrigger>
          <TabsTrigger value="sound" className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
            <Volume2 className="w-3.5 h-3.5 shrink-0" />Sound
          </TabsTrigger>
          <TabsTrigger value="world" className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
            <Skull className="w-3.5 h-3.5 shrink-0" />Combat & World
          </TabsTrigger>
          <TabsTrigger value="bridgeOps" className="flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
            <Crosshair className="w-3.5 h-3.5 shrink-0" />Admin Ops
          </TabsTrigger>
        </TabsList>

        {/* ── Weather Tab ── */}
        <TabsContent value="weather" className="mt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Weather Controls */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-primary" />
              Weather Controls
            </CardTitle>
            <CardDescription>Rain, storms, and clear sky controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Rain */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Rain Intensity: {rainIntensity}%</Label>
              </div>
              <Slider
                aria-label="Rain intensity"
                value={[rainIntensity]}
                onValueChange={([val]) => setRainIntensity(val)}
                min={1}
                max={100}
                step={1}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleAction('Start rain', startRain)}
                  disabled={loading !== null}
                  className="h-11 gap-2"
                >
                  {loading === 'Start rain' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudRain className="w-4 h-4" />}
                  Start Rain
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleAction('Stop rain', stopRain)}
                  disabled={loading !== null}
                  className="h-11 gap-2"
                >
                  {loading === 'Stop rain' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudOff className="w-4 h-4" />}
                  Stop Rain
                </Button>
              </div>
            </div>

            {/* Storm */}
            <div className="space-y-3 pt-3 border-t">
              <div className="flex items-center justify-between">
                <Label>Storm Duration: {stormDuration} game hour{stormDuration !== 1 ? 's' : ''}</Label>
              </div>
              <Slider
                aria-label="Storm duration"
                value={[stormDuration]}
                onValueChange={([val]) => setStormDuration(val)}
                min={1}
                max={24}
                step={1}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleAction('Start storm', startStorm)}
                  disabled={loading !== null}
                  className="h-11 gap-2"
                >
                  {loading === 'Start storm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudLightning className="w-4 h-4" />}
                  Start Storm
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleAction('Stop weather', stopWeather)}
                  disabled={loading !== null}
                  className="h-11 gap-2"
                >
                  {loading === 'Stop weather' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                  Clear Weather
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Weather Controls (via Panel Bridge) */}
        {bridgeConnected ? (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Snowflake className="w-4 h-4 text-primary" />
              Advanced Weather
            </CardTitle>
            <CardDescription>Blizzards, tropical storms, and snow toggles. Requires Bridge.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
                {/* Blizzard */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Snowflake className="w-4 h-4 text-primary" />
                      Blizzard Duration: {blizzardDuration} hour{blizzardDuration !== 1 ? 's' : ''}
                    </Label>
                  </div>
                  <Slider
                    aria-label="Blizzard duration"
                    value={[blizzardDuration]}
                    onValueChange={([val]) => setBlizzardDuration(val)}
                    min={1}
                    max={24}
                    step={1}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Blizzard', () => panelBridgeApi.triggerBlizzard(blizzardDuration))}
                    disabled={bridgeLoading !== null}
                    className="w-full h-11 gap-2"
                  >
                    {bridgeLoading === 'Blizzard' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Snowflake className="w-4 h-4" />}
                    Trigger Blizzard
                  </Button>
                </div>

                {/* Tropical Storm */}
                <div className="space-y-3 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Wind className="w-4 h-4 text-primary" />
                      Tropical Storm Duration: {tropicalDuration} hour{tropicalDuration !== 1 ? 's' : ''}
                    </Label>
                  </div>
                  <Slider
                    aria-label="Tropical storm duration"
                    value={[tropicalDuration]}
                    onValueChange={([val]) => setTropicalDuration(val)}
                    min={1}
                    max={24}
                    step={1}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Tropical Storm', () => panelBridgeApi.triggerTropicalStorm(tropicalDuration))}
                    disabled={bridgeLoading !== null}
                    className="w-full h-11 gap-2"
                  >
                    {bridgeLoading === 'Tropical Storm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wind className="w-4 h-4" />}
                    Trigger Tropical Storm
                  </Button>
                </div>

                {/* Quick Actions */}
                <div className="space-y-3 pt-3 border-t">
                  <p className="text-sm font-medium flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-primary" />
                    Quick Weather Toggles
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Enable Snow', () => panelBridgeApi.setSnow(true))}
                      disabled={bridgeLoading !== null}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Enable Snow' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Snowflake className="w-4 h-4" />}
                      Enable Snow
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Disable Snow', () => panelBridgeApi.setSnow(false))}
                      disabled={bridgeLoading !== null}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Disable Snow' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudRain className="w-4 h-4" />}
                      Disable Snow
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Stop All Weather', () => panelBridgeApi.stopWeather())}
                      disabled={bridgeLoading !== null}
                      className="h-11 gap-2 col-span-2 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                    >
                      {bridgeLoading === 'Stop All Weather' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                      Stop All Weather
                    </Button>
                  </div>
                </div>
          </CardContent>
        </Card>
        ) : (
          <Card className="border-dashed border-border/60 bg-card/30">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Snowflake className="w-6 h-6 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">Advanced Weather</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">Blizzards, tropical storms, and snow toggles need PanelBridge.lua running on the server.</p>
              <Link to="/settings" className="mt-3 inline-flex text-xs text-primary underline hover:text-foreground">Open Bridge Setup</Link>
            </CardContent>
          </Card>
        )}

        {/* Climate Controls (v1.1.0) - spans full width */}
        {bridgeConnected && (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-primary" />
                  Climate Controls
                </CardTitle>
                <CardDescription>Set fog, wind, temperature, clouds, and more across the whole map.</CardDescription>
              </div>
              {bridgeConnected && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleBridgeAction('Reset Climate', () => panelBridgeApi.resetClimateOverrides())}
                  disabled={bridgeLoading !== null}
                  className="gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className={!bridgeConnected ? 'pointer-events-none' : ''}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Fog */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-primary" />
                      Fog: {fogIntensity}%
                    </Label>
                  </div>
                  <Slider
                    aria-label="Fog intensity"
                    value={[fogIntensity]}
                    onValueChange={([val]) => setFogIntensity(val)}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Set Fog', () => panelBridgeApi.setClimateFloat(5, fogIntensity / 100))}
                    disabled={bridgeLoading !== null}
                    className="h-11 w-full gap-2"
                  >
                    Apply Fog
                  </Button>
                </div>

                {/* Wind */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Wind className="w-4 h-4 text-primary" />
                      Wind: {windIntensity}%
                    </Label>
                  </div>
                  <Slider
                    aria-label="Wind intensity"
                    value={[windIntensity]}
                    onValueChange={([val]) => setWindIntensity(val)}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Set Wind', () => panelBridgeApi.setClimateFloat(6, windIntensity / 100))}
                    disabled={bridgeLoading !== null}
                    className="h-11 w-full gap-2"
                  >
                    Apply Wind
                  </Button>
                </div>

                {/* Temperature */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-primary" />
                      Temperature: {temperature}°C
                    </Label>
                  </div>
                  <Slider
                    aria-label="Temperature"
                    value={[temperature]}
                    onValueChange={([val]) => setTemperature(val)}
                    min={-30}
                    max={45}
                    step={1}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Set Temperature', () => panelBridgeApi.setClimateFloat(4, temperature))}
                    disabled={bridgeLoading !== null}
                    className="h-11 w-full gap-2"
                  >
                    Apply Temperature
                  </Button>
                </div>

                {/* Clouds */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-primary" />
                      Clouds: {cloudIntensity}%
                    </Label>
                  </div>
                  <Slider
                    aria-label="Cloud intensity"
                    value={[cloudIntensity]}
                    onValueChange={([val]) => setCloudIntensity(val)}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Set Clouds', () => panelBridgeApi.setClimateFloat(8, cloudIntensity / 100))}
                    disabled={bridgeLoading !== null}
                    className="h-11 w-full gap-2"
                  >
                    Apply Clouds
                  </Button>
                </div>

                {/* Humidity */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Droplets className="w-4 h-4 text-primary" />
                      Humidity: {humidity}%
                    </Label>
                  </div>
                  <Slider
                    aria-label="Humidity"
                    value={[humidity]}
                    onValueChange={([val]) => setHumidity(val)}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Set Humidity', () => panelBridgeApi.setClimateFloat(12, humidity / 100))}
                    disabled={bridgeLoading !== null}
                    className="h-11 w-full gap-2"
                  >
                    Apply Humidity
                  </Button>
                </div>

                {/* Precipitation */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <CloudRain className="w-4 h-4 text-primary" />
                      Precipitation: {precipitationIntensity}%
                    </Label>
                  </div>
                  <Slider
                    aria-label="Precipitation intensity"
                    value={[precipitationIntensity]}
                    onValueChange={([val]) => setPrecipitationIntensity(val)}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Set Precipitation', () => panelBridgeApi.setClimateFloat(3, precipitationIntensity / 100))}
                    disabled={bridgeLoading !== null}
                    className="h-11 w-full gap-2"
                  >
                    Apply Precipitation
                  </Button>
                </div>
              </div>
            
            {/* Apply All Climate + Rain & Lightning Quick Actions */}
            {bridgeConnected && (
              <div className="mt-6 space-y-4">
                <Button
                  onClick={() => handleBridgeAction('Apply All Climate', async () => {
                    await Promise.all([
                      panelBridgeApi.setClimateFloat(5, fogIntensity / 100),
                      panelBridgeApi.setClimateFloat(6, windIntensity / 100),
                      panelBridgeApi.setClimateFloat(4, temperature),
                      panelBridgeApi.setClimateFloat(8, cloudIntensity / 100),
                      panelBridgeApi.setClimateFloat(12, humidity / 100),
                      panelBridgeApi.setClimateFloat(3, precipitationIntensity / 100),
                    ])
                  })}
                  disabled={bridgeLoading !== null}
                  className="w-full h-11 gap-2"
                >
                  {bridgeLoading === 'Apply All Climate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
                  Apply All Climate Values
                </Button>
                <div className="pt-4 border-t">
                <p className="text-sm font-medium flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-primary" />
                  Rain & Lightning
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Rain buttons use Panel Bridge. Lightning and thunder buttons use RCON and follow target rules.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Start Rain', () => panelBridgeApi.startRain(1.0))}
                    disabled={bridgeLoading !== null}
                    className="h-11 gap-2"
                  >
                    <CloudRain className="w-4 h-4" />
                    Start Rain
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleBridgeAction('Stop Rain', () => panelBridgeApi.stopRain())}
                    disabled={bridgeLoading !== null}
                    className="h-11 gap-2"
                  >
                    <CloudOff className="w-4 h-4" />
                    Stop Rain
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleAction('Lightning', () => triggerLightning(getTargetPlayer()))}
                    disabled={loading !== null}
                    className="h-11 gap-2"
                  >
                    {loading === 'Lightning' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    Lightning Strike
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleAction('Thunder', () => triggerThunder(getTargetPlayer()))}
                    disabled={loading !== null}
                    className="h-11 gap-2"
                  >
                    {loading === 'Thunder' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudLightning className="w-4 h-4" />}
                    Thunder Only
                  </Button>
                </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        )}
            </div>
        </TabsContent>

        {/* ── Time & Environment Tab ── */}
        <TabsContent value="environment" className="mt-5">
            {bridgeConnected ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Game Time Control (v1.1.0) */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Game Time
            </CardTitle>
            <CardDescription>Set the in-game clock, day, and month for all players.</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="space-y-4">
                {/* Hour */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      {gameHour >= 6 && gameHour < 20 ? (
                        <Sun className="w-4 h-4 text-primary" />
                      ) : (
                        <Moon className="w-4 h-4 text-primary" />
                      )}
                      Hour: {gameHour}:00
                    </Label>
                  </div>
                  <Slider
                    aria-label="Game hour"
                    value={[gameHour]}
                    onValueChange={([val]) => setGameHour(val)}
                    min={0}
                    max={23}
                    step={1}
                  />
                </div>

                {/* Quick time buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button variant={gameHour === 6 ? 'secondary' : 'outline'} size="sm" onClick={() => setGameHour(6)} className="h-10 gap-1.5">
                    <Sunrise className="w-3.5 h-3.5" /> Dawn
                  </Button>
                  <Button variant={gameHour === 12 ? 'secondary' : 'outline'} size="sm" onClick={() => setGameHour(12)} className="h-10 gap-1.5">
                    <Sun className="w-3.5 h-3.5" /> Noon
                  </Button>
                  <Button variant={gameHour === 18 ? 'secondary' : 'outline'} size="sm" onClick={() => setGameHour(18)} className="h-10 gap-1.5">
                    <Sunset className="w-3.5 h-3.5" /> Dusk
                  </Button>
                  <Button variant={gameHour === 0 ? 'secondary' : 'outline'} size="sm" onClick={() => setGameHour(0)} className="h-10 gap-1.5">
                    <Moon className="w-3.5 h-3.5" /> Midnight
                  </Button>
                </div>

                {/* Date controls */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label htmlFor="game-day" className="text-xs">Day</Label>
                    <Input
                      id="game-day"
                      aria-label="Game day"
                      type="number"
                      min={1}
                      max={31}
                      value={gameDay}
                      onChange={(e) => {
                        const parsed = parseInt(e.target.value, 10)
                        if (Number.isNaN(parsed)) {
                          setGameDay(1)
                          return
                        }
                        setGameDay(Math.min(31, Math.max(1, parsed)))
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="game-month" className="text-xs">Month</Label>
                    <Select value={String(gameMonth)} onValueChange={(v) => setGameMonth(parseInt(v))}>
                      <SelectTrigger id="game-month" aria-label="Game month">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">January</SelectItem>
                        <SelectItem value="2">February</SelectItem>
                        <SelectItem value="3">March</SelectItem>
                        <SelectItem value="4">April</SelectItem>
                        <SelectItem value="5">May</SelectItem>
                        <SelectItem value="6">June</SelectItem>
                        <SelectItem value="7">July</SelectItem>
                        <SelectItem value="8">August</SelectItem>
                        <SelectItem value="9">September</SelectItem>
                        <SelectItem value="10">October</SelectItem>
                        <SelectItem value="11">November</SelectItem>
                        <SelectItem value="12">December</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => handleBridgeAction('Set Time', () => panelBridgeApi.setGameTime({ hour: gameHour, day: gameDay, month: gameMonth }))}
                  disabled={bridgeLoading !== null}
                  className="w-full h-11 gap-2"
                >
                  {bridgeLoading === 'Set Time' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                  Apply Time & Date
                </Button>
                <p className="text-xs text-muted-foreground">
                  This updates world time for all players immediately.
                </p>
              </div>
          </CardContent>
        </Card>

        {/* Infrastructure (Power/Water) Control */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Infrastructure
            </CardTitle>
            <CardDescription>Toggle power and water for the whole world. Applies instantly to every player.</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="space-y-4">
                {/* B42 multiplayer notice — compact inline warning */}
                <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-200/90">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-400" />
                  <span>Not working in B42 multiplayer — sandbox changes don't propagate to connected clients.</span>
                </div>

                {/* Current status — compact row */}
                <div className="flex items-center gap-4 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Zap className={`w-4 h-4 ${utilitiesStatus?.powerOn ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-muted-foreground">Power</span>
                    <span className={`font-mono text-xs ${utilitiesStatus === null ? 'text-muted-foreground' : utilitiesStatus.powerOn ? 'text-primary' : 'text-destructive'}`}>
                      {utilitiesStatus === null ? '…' : utilitiesStatus.powerOn ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-1.5">
                    <Droplets className={`w-4 h-4 ${utilitiesStatus?.waterOn ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-muted-foreground">Water</span>
                    <span className={`font-mono text-xs ${utilitiesStatus === null ? 'text-muted-foreground' : utilitiesStatus.waterOn ? 'text-primary' : 'text-destructive'}`}>
                      {utilitiesStatus === null ? '…' : utilitiesStatus.waterOn ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>

                {/* 2×2 action matrix: rows = utility, cols = action */}
                <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-center px-1"></span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">Restore</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">Cut</span>

                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground pr-2">
                    <Zap className="w-3.5 h-3.5" /> Power
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!bridgeConnected || loading !== null}
                    onClick={() => handleAction('Restore Power', async () => {
                      await panelBridgeApi.restoreUtilities(true, false)
                      await checkBridgeStatus()
                    })}
                    className="h-9"
                  >
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!bridgeConnected || loading !== null}
                    onClick={() => handleAction('Shut Off Power', async () => {
                      await panelBridgeApi.shutOffUtilities(true, false)
                      await checkBridgeStatus()
                    })}
                    className="h-9 text-destructive hover:text-destructive"
                  >
                    Cut
                  </Button>

                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground pr-2">
                    <Droplets className="w-3.5 h-3.5" /> Water
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!bridgeConnected || loading !== null}
                    onClick={() => handleAction('Restore Water', async () => {
                      await panelBridgeApi.restoreUtilities(false, true)
                      await checkBridgeStatus()
                    })}
                    className="h-9"
                  >
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!bridgeConnected || loading !== null}
                    onClick={() => handleAction('Shut Off Water', async () => {
                      await panelBridgeApi.shutOffUtilities(false, true)
                      await checkBridgeStatus()
                    })}
                    className="h-9 text-destructive hover:text-destructive"
                  >
                    Cut
                  </Button>
                </div>

                {/* Both-at-once shortcuts */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!bridgeConnected || loading !== null}
                    onClick={() => handleAction('Restore Utilities', async () => {
                      await panelBridgeApi.restoreUtilities(true, true)
                      await checkBridgeStatus()
                    })}
                    className="h-9 gap-2 text-xs"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Restore both
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!bridgeConnected || loading !== null}
                    onClick={() => handleAction('Shut Off Utilities', async () => {
                      await panelBridgeApi.shutOffUtilities(true, true)
                      await checkBridgeStatus()
                    })}
                    className="h-9 gap-2 text-xs text-destructive hover:text-destructive"
                  >
                    <CloudOff className="w-3.5 h-3.5" />
                    Cut both
                  </Button>
                </div>
              </div>
          </CardContent>
        </Card>
            </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-8 text-center">
                <Calendar className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Time & Infrastructure Controls</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Game time, power, and water controls require PanelBridge</p>
              </div>
            )}
        </TabsContent>

        {/* ── Sound Tab ── */}
        <TabsContent value="sound" className="mt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Sound Events */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-primary" />
              Sound Events
            </CardTitle>
            <CardDescription>Attract zombies with gunshots, alarms, and custom noise.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Helicopter and gunshot use a random online player. Lightning and thunder follow your target selection above.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Button
                variant="outline"
                onClick={() => handleAction('Helicopter', triggerChopper)}
                disabled={loading !== null}
                className="h-11 gap-2"
              >
                {loading === 'Helicopter' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
                Helicopter
              </Button>
              <Button
                variant="outline"
                onClick={() => handleAction('Gunshot', triggerGunshot)}
                disabled={loading !== null}
                className="h-11 gap-2"
              >
                {loading === 'Gunshot' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                Gunshot
              </Button>
              <Button
                variant="outline"
                onClick={() => handleAction('Lightning', () => triggerLightning(getTargetPlayer()))}
                disabled={loading !== null}
                className="h-11 gap-2"
              >
                {loading === 'Lightning' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Lightning
              </Button>
              <Button
                variant="outline"
                onClick={() => handleAction('Thunder', () => triggerThunder(getTargetPlayer()))}
                disabled={loading !== null}
                className="h-11 gap-2"
              >
                {loading === 'Thunder' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudLightning className="w-4 h-4" />}
                Thunder
              </Button>
              <Button
                variant="outline"
                onClick={() => handleAction('Alarm', triggerAlarm)}
                disabled={loading !== null}
                className="h-11 gap-2 col-span-2"
                title="Requires admin to be in-game - triggers at admin's location"
              >
                {loading === 'Alarm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                Building Alarm
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Sound Controls (Panel Bridge v1.2.0) */}
        {bridgeConnected ? (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-primary" />
              Advanced Sound Controls
            </CardTitle>
            <CardDescription>Place sounds at a player or at exact map coordinates. Requires Bridge.</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="space-y-6">
                {/* Sound Parameters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-primary" />
                      Radius: {soundRadius}m
                    </Label>
                    <Slider
                      aria-label="Sound radius"
                      value={[soundRadius]}
                      onValueChange={([val]) => setSoundRadius(val)}
                      min={10}
                      max={300}
                      step={10}
                    />
                    <p className="text-xs text-muted-foreground">How far zombies can hear the sound</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-primary" />
                      Volume: {soundVolume}
                    </Label>
                    <Slider
                      aria-label="Sound volume"
                      value={[soundVolume]}
                      onValueChange={([val]) => setSoundVolume(val)}
                      min={10}
                      max={300}
                      step={10}
                    />
                    <p className="text-xs text-muted-foreground">Intensity of the noise</p>
                  </div>
                </div>

                {/* Quick Sound Triggers (at player location) */}
                <div className="space-y-3 pt-3 border-t">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Sound at Player Location
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {targetAll 
                      ? 'Select a specific player above before using these controls'
                      : `Sounds will play at ${selectedPlayer || 'the selected player'}'s location`
                    }
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Gunshot Sound', () => 
                        panelBridgeApi.triggerGunshotBridge({ username: selectedPlayer || undefined })
                      )}
                      disabled={bridgeLoading !== null || (targetAll || !selectedPlayer)}
                      title={targetAll ? 'Select a specific player target first' : !selectedPlayer ? 'Select a player first' : undefined}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Gunshot Sound' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                      Gunshot
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Alarm Sound', () => 
                        panelBridgeApi.triggerAlarmBridge({ username: selectedPlayer || undefined })
                      )}
                      disabled={bridgeLoading !== null || (targetAll || !selectedPlayer)}
                      title={targetAll ? 'Select a specific player target first' : !selectedPlayer ? 'Select a player first' : undefined}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Alarm Sound' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                      Alarm
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Custom Noise', () => 
                        panelBridgeApi.createNoise({ username: selectedPlayer, radius: soundRadius, volume: soundVolume })
                      )}
                      disabled={bridgeLoading !== null || (targetAll || !selectedPlayer)}
                      title={targetAll ? 'Select a specific player target first' : !selectedPlayer ? 'Select a player first' : undefined}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Custom Noise' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                      Custom Noise
                    </Button>
                  </div>
                </div>

                {/* Sound at Coordinates */}
                <div className="space-y-3 pt-3 border-t">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Sound at World Coordinates
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label htmlFor="sound-world-x" className="text-xs">World X</Label>
                      <Input
                          id="sound-world-x"
                          aria-label="Sound world X coordinate"
                        type="number"
                        placeholder="e.g. 10500"
                        value={soundX}
                        onChange={(e) => setSoundX(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="sound-world-y" className="text-xs">World Y</Label>
                      <Input
                          id="sound-world-y"
                          aria-label="Sound world Y coordinate"
                        type="number"
                        placeholder="e.g. 9800"
                        value={soundY}
                        onChange={(e) => setSoundY(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter valid numeric coordinates (examples: 10500 and 9800).
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Gunshot at Coords', () => 
                          panelBridgeApi.triggerGunshotBridge({ x: soundCoordX as number, y: soundCoordY as number })
                      )}
                        disabled={bridgeLoading !== null || !hasValidSoundCoords}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Gunshot at Coords' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                      Gunshot
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Alarm at Coords', () => 
                          panelBridgeApi.triggerAlarmBridge({ x: soundCoordX as number, y: soundCoordY as number })
                      )}
                        disabled={bridgeLoading !== null || !hasValidSoundCoords}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Alarm at Coords' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                      Alarm
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBridgeAction('Noise at Coords', () => 
                          panelBridgeApi.createNoise({ x: soundCoordX as number, y: soundCoordY as number, radius: soundRadius, volume: soundVolume })
                      )}
                        disabled={bridgeLoading !== null || !hasValidSoundCoords}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === 'Noise at Coords' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                      Custom Noise
                    </Button>
                  </div>
                </div>
              </div>
          </CardContent>
        </Card>
        ) : (
          <Card className="border-dashed border-border/60 bg-card/30">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Megaphone className="w-6 h-6 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">Advanced Sound Controls</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Coordinate-based sounds require PanelBridge</p>
            </CardContent>
          </Card>
        )}
            </div>
        </TabsContent>

        {/* ── Combat & World Tab ── */}
        <TabsContent value="world" className="mt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Zombie Events */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Skull className="w-4 h-4 text-primary" />
              Zombie Events
            </CardTitle>
            <CardDescription>Spawn, clear, or redirect zombies in currently loaded areas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Horde */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Horde Size: {hordeCount} zombies</Label>
              </div>
              <Slider
                aria-label="Horde size"
                value={[hordeCount]}
                onValueChange={([val]) => setHordeCount(val)}
                min={10}
                max={500}
                step={10}
              />
              <Button
                variant="outline"
                onClick={() => handleAction('Create horde', () => createHorde(hordeCount, getTargetPlayer()))}
                disabled={loading !== null || (!targetAll && !selectedPlayer)}
                className="w-full h-11 gap-2"
              >
                {loading === 'Create horde' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Skull className="w-4 h-4" />}
                Spawn Horde Near {targetAll ? 'Random Player' : selectedPlayer || 'Selected Player'}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleAction('Create horde (behind)', () => createHorde2(hordeCount, getTargetPlayer()))}
                disabled={loading !== null || (!targetAll && !selectedPlayer)}
                className="w-full h-11 gap-2"
              >
                {loading === 'Create horde (behind)' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Skull className="w-4 h-4" />}
                Spawn Horde Behind {targetAll ? 'Random Player' : selectedPlayer || 'Selected Player'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleAction('Remove all zombies', removeZombies)}
                disabled={loading !== null}
                className="w-full h-11 gap-2"
              >
                {loading === 'Remove all zombies' ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                Clear Loaded Zombies
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Time Speed Control */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Time Speed
            </CardTitle>
            <CardDescription>Speed up or slow down the in-game clock. Auto-resets to 1x on server restart.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Time Speed: {timeSpeed}x</Label>
              </div>
              <Slider
                aria-label="Time speed"
                value={[timeSpeed]}
                onValueChange={([val]) => setTimeSpeed(val)}
                min={1}
                max={100}
                step={1}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setTimeSpeed(1)}
                  variant={timeSpeed === 1 ? 'secondary' : 'outline'}
                  className="h-11"
                >
                  1x
                </Button>
                <Button
                  size="sm"
                  onClick={() => setTimeSpeed(5)}
                  variant={timeSpeed === 5 ? 'secondary' : 'outline'}
                  className="h-11"
                >
                  5x
                </Button>
                <Button
                  size="sm"
                  onClick={() => setTimeSpeed(10)}
                  variant={timeSpeed === 10 ? 'secondary' : 'outline'}
                  className="h-11"
                >
                  10x
                </Button>
                <Button
                  size="sm"
                  onClick={() => setTimeSpeed(24)}
                  variant={timeSpeed === 24 ? 'secondary' : 'outline'}
                  className="h-11"
                >
                  24x
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => handleAction('Set time speed', setGameTimeSpeed)}
                disabled={loading !== null}
                className="w-full h-11 gap-2"
              >
                {loading === 'Set time speed' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                Apply Time Speed
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Teleport */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              Teleport
            </CardTitle>
            <CardDescription>Move players to coordinates or to another player.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Teleport to Player */}
              <div className="space-y-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Teleport Player to Player
                </p>
                <div className="space-y-2">
                  <Label htmlFor="teleport-player-select">Player to move</Label>
                  <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                    <SelectTrigger id="teleport-player-select" aria-label="Player to move">
                      <SelectValue placeholder="Select player..." />
                    </SelectTrigger>
                    <SelectContent>
                      {players.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">No players online</div>
                      ) : (
                        players.map((player) => (
                          <SelectItem key={player.name} value={player.name}>
                            {player.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label id="teleport-target-player-label">Move to player</Label>
                  <div className="flex flex-wrap gap-2">
                    {players.filter(p => p.name !== selectedPlayer).map((player) => (
                      <Button
                        key={player.name}
                        variant="outline"
                        size="sm"
                        onClick={() => handleAction('Teleport', () => teleportPlayerToPlayer(selectedPlayer, player.name))}
                        disabled={loading !== null || !selectedPlayer}
                        className="h-10"
                      >
                        {player.name}
                      </Button>
                    ))}
                    {players.length <= 1 && (
                      <p className="text-sm text-muted-foreground">Need at least 2 players online</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Teleport to Coordinates */}
              <div className="space-y-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Navigation className="w-4 h-4" />
                  Teleport to Coordinates
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="teleport-x" className="text-xs">X</Label>
                    <Input
                      id="teleport-x"
                      aria-label="Teleport X coordinate"
                      type="number"
                      placeholder="10000"
                      value={teleportX}
                      onChange={(e) => setTeleportX(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="teleport-y" className="text-xs">Y</Label>
                    <Input
                      id="teleport-y"
                      aria-label="Teleport Y coordinate"
                      type="number"
                      placeholder="11000"
                      value={teleportY}
                      onChange={(e) => setTeleportY(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="teleport-z" className="text-xs">Z (Level)</Label>
                    <Input
                      id="teleport-z"
                      aria-label="Teleport Z level"
                      type="number"
                      placeholder="0"
                      value={teleportZ}
                      onChange={(e) => setTeleportZ(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleAction('Teleport self', () => teleportToCoords(teleportCoordX as number, teleportCoordY as number, teleportCoordZ as number))}
                    disabled={loading !== null || !hasValidTeleportCoords}
                    className="h-11 gap-2"
                    title="Teleport yourself (admin must be in-game)"
                  >
                    {loading === 'Teleport self' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                    Teleport Self
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleAction('Teleport player', () => teleportToCoords(teleportCoordX as number, teleportCoordY as number, teleportCoordZ as number, getTargetPlayer()))}
                    disabled={loading !== null || !hasValidTeleportCoords || targetAll || !selectedPlayer}
                    className="h-11 gap-2"
                    title="Teleport selected player to coordinates"
                  >
                    {loading === 'Teleport player' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                    Teleport {selectedPlayer || 'Player'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Common locations: Muldraugh (10500, 9700), West Point (11800, 6900), Riverside (6500, 5300)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vehicle Spawning */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Car className="w-4 h-4 text-primary" />
              Vehicle Spawn
            </CardTitle>
            <CardDescription>Spawn a vehicle near a player.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle-type-select">Vehicle Type</Label>
              <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                <SelectTrigger id="vehicle-type-select" aria-label="Vehicle type">
                  <SelectValue placeholder="Select vehicle..." />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Spawn for Player</Label>
              <div className="flex flex-wrap gap-2">
                {players.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No players online</p>
                ) : (
                  players.map((player) => (
                    <Button
                      key={player.name}
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction('Spawn vehicle', () => spawnVehicle(selectedVehicle, player.name))}
                      disabled={loading !== null}
                      className="h-10 gap-1.5"
                    >
                      <Car className="w-4 h-4" />
                      {player.name}
                    </Button>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Server Announcement */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-primary" />
              Server Announcement
            </CardTitle>
            <CardDescription>Send a message to every online player.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="announcement-message">Message</Label>
              <Input
                id="announcement-message"
                aria-label="Server announcement message"
                placeholder="Enter your announcement..."
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                maxLength={500}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => handleAction('Send announcement', sendAnnouncement)}
              disabled={loading !== null || !announcement.trim()}
              className="w-full h-11 gap-2"
            >
              {loading === 'Send announcement' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
              Broadcast Message
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAnnouncement('WARNING: Event incoming!')} className="h-10 gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> Event Warning
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAnnouncement('Check your inventory for a surprise!')} className="h-10 gap-2">
                <Bell className="h-4 w-4 text-primary" /> Loot Notice
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAnnouncement('Run! The horde is coming!')} className="h-10 gap-2">
                <Navigation className="h-4 w-4 text-primary" /> Horde Alert
              </Button>
            </div>
          </CardContent>
        </Card>
            </div>
        </TabsContent>

        {/* ── Bridge Operations Tab ── */}
        <TabsContent value="bridgeOps" className="mt-5">
            <div>
              <Card className={!bridgeConnected ? 'border-dashed border-border/60 bg-card/30' : ''}>
                <CardHeader className="pb-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <CardTitle className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-primary" />
                          Bridge Operations Console
                        </CardTitle>
                        <CardDescription>
                          Run safehouses, vehicles, moderation, and other Bridge commands directly.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={bridgeConnected ? 'success' : 'warning'}>
                          {bridgeConnected ? 'Bridge Online' : 'Bridge Offline'}
                        </Badge>
                        {bridgeActiveGroup && <Badge variant="secondary">{bridgeActiveGroup.label}</Badge>}
                        <Badge variant="outline">{Object.keys(bridgeOperationTemplates).length} operations</Badge>
                      </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.35fr)]">
                      <div className="space-y-4">
                        <div className="rounded-lg border border-border/70 bg-muted/25 p-4">
                          <div className="space-y-2">
                            <Label htmlFor="bridge-operation-select">Operation</Label>
                            <p className="text-xs leading-5 text-muted-foreground">
                              Choose an operation, fill in the required fields, and run it.
                            </p>
                          </div>
                      <Select
                        value={bridgeOperation}
                        onValueChange={selectBridgeOperation}
                      >
                        <SelectTrigger id="bridge-operation-select" aria-label="Select operation" disabled={bridgeLoading !== null} className="mt-3">
                          <SelectValue placeholder="Select operation" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(bridgeOperationTemplates).map(([action, meta]) => (
                            <SelectItem key={action} value={action}>{meta.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                        <div className="mt-3 rounded-md border border-border/60 bg-background/60 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">{bridgeOperationTemplates[bridgeOperation]?.label}</p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {bridgeOperationTemplates[bridgeOperation]?.description}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Operation Groups</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              Browse by category: territory, vehicles, events, and moderation.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {bridgeOperationGroups.map((group) => {
                            const active = group.id === bridgeActiveGroup?.id
                            return (
                              <div
                                key={group.id}
                                className={cn(
                                  'rounded-md border p-3 transition-colors',
                                  active
                                    ? 'border-primary/40 bg-primary/10 text-foreground'
                                    : 'border-border/60 bg-background/40 text-muted-foreground'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className={cn('text-sm font-medium', active ? 'text-foreground' : 'text-foreground/88')}>
                                    {group.label}
                                  </p>
                                  <Badge variant={active ? 'default' : 'outline'}>{group.operations.length}</Badge>
                                </div>
                                <p className="mt-2 text-xs leading-5">{group.description}</p>
                              </div>
                            )
                          })}
                        </div>
                        {bridgeActiveGroup && (
                          <div className="mt-4 rounded-md border border-border/60 bg-background/50 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-foreground">Quick picks: {bridgeActiveGroup.label}</p>
                              <Badge variant="outline">{bridgeActiveGroup.operations.length} options</Badge>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {bridgeActiveGroup.operations.map((operationKey) => {
                                const operationMeta = bridgeOperationTemplates[operationKey]
                                if (!operationMeta) return null

                                const isActive = operationKey === bridgeOperation
                                return (
                                  <Button
                                    key={operationKey}
                                    type="button"
                                    variant={isActive ? 'secondary' : 'outline'}
                                    size="sm"
                                    onClick={() => selectBridgeOperation(operationKey)}
                                    disabled={bridgeLoading !== null}
                                    className="h-9"
                                  >
                                    {operationMeta.label}
                                  </Button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-lg border border-border/70 bg-card/60 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <Label>Operation Inputs</Label>
                            <p id="bridge-args-help" className="mt-1 text-xs leading-5 text-muted-foreground">
                              Fill in the required fields. The panel validates your inputs before sending.
                            </p>
                          </div>
                          <Badge variant={bridgeFormError ? 'destructive' : 'outline'}>
                            {bridgeFormError ? 'Needs attention' : currentBridgeFields.length === 0 ? 'No inputs required' : 'Ready'}
                          </Badge>
                        </div>

                        {currentRequiredFieldCount > 0 && (
                          <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs text-muted-foreground">Required fields completed</p>
                              <p className="text-xs font-medium text-foreground">
                                {currentCompletedRequiredFieldCount}/{currentRequiredFieldCount}
                              </p>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full w-full rounded-full bg-primary transition-transform duration-200 ease-out"
                                style={{
                                  transform: `translateX(-${100 - Math.min(
                                    100,
                                    Math.round((currentCompletedRequiredFieldCount / currentRequiredFieldCount) * 100)
                                  )}%)`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {currentBridgeFields.length === 0 && (
                            <div className="sm:col-span-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-foreground/85">
                              This operation runs without additional inputs.
                            </div>
                          )}

                          {currentBridgeFields.map((field) => {
                            const value = getBridgeFieldValue(field.key)
                            const fieldId = `bridge-field-${field.key}`

                            if (field.type === 'boolean') {
                              return (
                                <div key={field.key} className="sm:col-span-2 rounded-md border border-border/60 bg-muted/20 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="space-y-1">
                                      <Label htmlFor={fieldId}>{field.label}</Label>
                                      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                                    </div>
                                    <Switch
                                      id={fieldId}
                                      checked={value === 'true'}
                                      onCheckedChange={(checked) => setBridgeFieldValue(field.key, checked ? 'true' : 'false')}
                                    />
                                  </div>
                                </div>
                              )
                            }

                            if (field.type === 'select') {
                              return (
                                <div key={field.key} className="space-y-1.5">
                                  <Label htmlFor={fieldId}>{field.label}{field.required ? ' *' : ''}</Label>
                                  <Select value={value || field.defaultValue || ''} onValueChange={(next) => setBridgeFieldValue(field.key, next)}>
                                    <SelectTrigger id={fieldId}>
                                      <SelectValue placeholder={field.placeholder || 'Select value'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(field.options ?? []).map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )
                            }

                            if (field.type === 'combo') {
                              const options = getBridgeComboOptions(field.key)
                              const hasOptions = options.length > 0
                              const showManualFallback = !hasOptions && !bridgeOptionsLoading

                              return (
                                <div key={field.key} className="space-y-1.5">
                                  <Label htmlFor={fieldId}>{field.label}{field.required ? ' *' : ''}</Label>
                                  <Select
                                    value={hasOptions ? value : ''}
                                    onValueChange={(next) => setBridgeFieldValue(field.key, next)}
                                    disabled={bridgeOptionsLoading || !hasOptions}
                                  >
                                    <SelectTrigger id={fieldId}>
                                      <SelectValue
                                        placeholder={
                                          bridgeOptionsLoading
                                            ? 'Loading server options...'
                                            : hasOptions
                                              ? (field.placeholder || 'Select value')
                                              : 'No server options available'
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {hasOptions ? (
                                        options.map((option) => (
                                          <SelectItem key={option.value} value={option.value} title={option.label}>
                                            <span className="block truncate" dir="auto" title={option.label}>{option.label}</span>
                                          </SelectItem>
                                        ))
                                      ) : (
                                        <div className="px-2 py-2 text-xs text-muted-foreground">
                                          {bridgeOptionsLoading ? 'Loading options from server...' : 'No options loaded from server yet.'}
                                        </div>
                                      )}
                                    </SelectContent>
                                  </Select>
                                  {showManualFallback && (
                                    <Input
                                      value={value}
                                      onChange={(e) => setBridgeFieldValue(field.key, e.target.value)}
                                      placeholder={field.placeholder || 'Type value manually'}
                                      aria-label={`${field.label} (manual entry)`}
                                    />
                                  )}
                                  <p className="text-xs text-muted-foreground">
                                    {hasOptions
                                      ? 'Loaded from server data.'
                                      : bridgeOptionsLoading
                                        ? 'Waiting for server/bridge data to populate this combo box.'
                                        : 'Server list unavailable. Manual entry is enabled for recovery.'}
                                  </p>
                                </div>
                              )
                            }

                            if (field.type === 'textarea') {
                              return (
                                <div key={field.key} className="space-y-1.5 sm:col-span-2">
                                  <Label htmlFor={fieldId}>{field.label}{field.required ? ' *' : ''}</Label>
                                  <Textarea
                                    id={fieldId}
                                    value={value}
                                    onChange={(e) => setBridgeFieldValue(field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    className="min-h-[96px]"
                                  />
                                </div>
                              )
                            }

                            return (
                              <div key={field.key} className="space-y-1.5">
                                <Label htmlFor={fieldId}>{field.label}{field.required ? ' *' : ''}</Label>
                                <Input
                                  id={fieldId}
                                  type={field.type === 'number' ? 'number' : 'text'}
                                  value={value}
                                  onChange={(e) => setBridgeFieldValue(field.key, e.target.value)}
                                  placeholder={field.placeholder}
                                  min={field.min}
                                  max={field.max}
                                  step={field.step}
                                  maxLength={field.maxLength}
                                />
                                {(field.help || field.maxLength) && (
                                  <p className="text-xs text-muted-foreground">
                                    {field.help ? `${field.help}${field.maxLength ? ' ' : ''}` : ''}
                                    {field.maxLength ? `${value.length}/${field.maxLength}` : ''}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {currentBridgeHasComboFields && (
                          <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-muted-foreground" aria-live="polite">
                                {bridgeOptionsLoading
                                  ? 'Refreshing bridge option lists...'
                                  : bridgeOptionsError
                                    ? bridgeOptionsError
                                    : bridgeOptionsLastUpdated
                                      ? `Bridge lists updated ${bridgeOptionsLastUpdated}`
                                      : 'Bridge lists not loaded yet.'}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (bridgeConnected && !bridgeOptionsLoading) {
                                    setBridgeOptionsLastUpdated(null)
                                    setBridgeOptionsError(null)
                                    setBridgeOptionsRefreshTick((prev) => prev + 1)
                                  }
                                }}
                                disabled={!bridgeConnected || bridgeOptionsLoading}
                                className="h-10 gap-1 sm:h-8"
                              >
                                <RefreshCw className={cn('h-3.5 w-3.5', bridgeOptionsLoading && 'animate-spin')} />
                                Refresh Lists
                              </Button>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            Fields are pre-filled from your inputs.
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {bridgeLastRunAt ? `Last run: ${bridgeLastRunAt}` : 'Not run yet'}
                          </span>
                        </div>
                      {bridgeConnectionSummary && (
                        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                          Bridge file link: {bridgeConnectionSummary}
                        </p>
                      )}
                      {bridgeFormError && (
                        <p id="bridge-args-error" className="mt-2 text-xs text-destructive">{bridgeFormError}</p>
                      )}
                      </div>
                    </div>
                  </div>

                  {!bridgeConnected && (
                    <Alert className="border-warning/40 bg-warning/10">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <AlertTitle className="text-warning">Bridge connection required</AlertTitle>
                      <AlertDescription>
                        These operations require a live PanelBridge connection. Configure it in Settings first.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={runBridgeOperation}
                      disabled={bridgeLoading !== null || !bridgeConnected || !!bridgeFormError}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === bridgeOperation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Run Operation
                    </Button>
                    <Button
                      variant="outline"
                      onClick={resetBridgeFormValues}
                      disabled={bridgeLoading !== null || currentBridgeFields.length === 0}
                      className="h-11"
                    >
                      Reset Fields
                    </Button>
                    {bridgeResultData && (
                      <Button
                        variant="outline"
                        onClick={() => setBridgeResultData(null)}
                        disabled={bridgeLoading !== null}
                        className="h-11"
                      >
                        Clear Results
                      </Button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {bridgeRunDisabledReason || 'Ready.'}
                  </p>

                  {/* Structured Result Display */}
                  {bridgeResultData && (
                    <BridgeResultDisplay
                      result={bridgeResultData}
                      loading={bridgeLoading}
                      onInlineAction={runInlineAction}
                      players={players}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
