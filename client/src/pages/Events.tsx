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
  ChevronDown
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { rconApi, serverApi, playersApi, panelBridgeApi } from '@/lib/api'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { BridgeStatusBadge } from '@/components/BridgeStatusBadge'
import { cn } from '@/lib/utils'

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
  vehicleRepair: { label: 'Vehicle Repair', description: 'Repair vehicle by id.', args: '{\n  "vehicleId": 123\n}' },
  vehicleSetAlarm: { label: 'Vehicle Alarm', description: 'Enable/disable and trigger alarm state.', args: '{\n  "vehicleId": 123,\n  "enabled": true\n}' },
  vehicleSetSiren: { label: 'Vehicle Siren', description: 'Set siren mode.', args: '{\n  "vehicleId": 123,\n  "mode": 1\n}' },
  vehicleSetTrunkLocked: { label: 'Vehicle Trunk Lock', description: 'Lock/unlock trunk.', args: '{\n  "vehicleId": 123,\n  "locked": true\n}' },
  triggerSwarmEvent: { label: 'Trigger Swarm Event', description: 'Spawn zombies in rectangular area.', args: '{\n  "count": 25,\n  "x1": 10500,\n  "y1": 9800,\n  "x2": 10600,\n  "y2": 9900\n}' },
  runEventSequence: { label: 'Run Event Sequence', description: 'Run chained chat/weather/swarm/utilities/noise sequence.', args: '{\n  "steps": [\n    { "kind": "chat", "message": "Event incoming", "channel": "general" },\n    { "kind": "weather", "weatherType": "storm", "duration": 2 }\n  ]\n}' },
  getInfrastructureSnapshot: { label: 'Infrastructure Snapshot', description: 'Read hydro/weather state and optional sample point.', args: '{\n  "x": 10500,\n  "y": 9800,\n  "z": 0\n}' },
  addLamppost: { label: 'Add Lamppost', description: 'Add temporary light source.', args: '{\n  "x": 10500,\n  "y": 9800,\n  "z": 0,\n  "r": 1.0,\n  "g": 0.85,\n  "b": 0.6,\n  "radius": 8\n}' },
  removeLamppost: { label: 'Remove Lamppost', description: 'Remove temporary light source.', args: '{\n  "x": 10500,\n  "y": 9800,\n  "z": 0\n}' },
  moderationKickUser: { label: 'Kick User', description: 'Kick player via BanSystem.', args: '{\n  "username": "PlayerName",\n  "reason": "Rule violation"\n}' },
  moderationBanUser: { label: 'Ban User', description: 'Ban or unban player.', args: '{\n  "username": "PlayerName",\n  "reason": "Rule violation",\n  "ban": true\n}' },
  moderationBanIP: { label: 'Ban IP', description: 'Ban or unban IP address.', args: '{\n  "ip": "127.0.0.1",\n  "reason": "Abuse",\n  "ban": true\n}' },
  moderationBanSteamID: { label: 'Ban SteamID', description: 'Ban or unban SteamID.', args: '{\n  "steamId": "76561198000000000",\n  "reason": "Abuse",\n  "ban": true\n}' },
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
  const [bridgeOperationArgs, setBridgeOperationArgs] = useState<string>(bridgeOperationTemplates.getSafehouses.args)
  const [bridgeOperationResult, setBridgeOperationResult] = useState<string>('Run a command to view response output.')
  
  // Utilities status
  const [utilitiesStatus, setUtilitiesStatus] = useState<{
    hydroPowerOn: boolean
    powerOn: boolean
    waterOn: boolean
    elecShut: string
    waterShut: string
  } | null>(null)
  
  const { toast } = useToast()

  // Collapsible section state — weather open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    weather: true,
    environment: false,
    sound: false,
    world: false,
    bridgeOps: false,
  })
  const toggleSection = (id: string) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))

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
      
      // If connected, fetch climate floats
      if (status.modConnected) {
        try {
          const floatsResult = await panelBridgeApi.getClimateFloats()
          if (!mountedRef.current) return
          if (floatsResult.success && floatsResult.data?.floats) {
            // Update individual state from current values
            const floats = floatsResult.data.floats
            const findFloat = (id: number) => floats.find((f: { id: number; value: number }) => f.id === id)?.value
            setFogIntensity(Math.round((findFloat(5) ?? 0) * 100))
            setWindIntensity(Math.round((findFloat(6) ?? 0) * 100))
            setTemperature(Math.round(findFloat(4) ?? 20))
            setCloudIntensity(Math.round((findFloat(8) ?? 0) * 100))
            setHumidity(Math.round((findFloat(12) ?? 0.5) * 100))
            setPrecipitationIntensity(Math.round((findFloat(3) ?? 0) * 100))
          }
        } catch {
          // Secondary fetch — silent fallback to stale data
        }
        
        // Also fetch current game time
        try {
          const timeResult = await panelBridgeApi.getGameTime()
          if (!mountedRef.current) return
          if (timeResult.success && timeResult.data) {
            setGameHour(Math.floor(timeResult.data.hour))
            setGameDay(timeResult.data.day)
            setGameMonth(timeResult.data.month)
          }
        } catch {
          // Secondary fetch — silent fallback to stale data
        }
        
        // Fetch utilities status
        try {
          const utilitiesResult = await panelBridgeApi.getUtilitiesStatus()
          if (!mountedRef.current) return
          if (utilitiesResult.success && utilitiesResult.data) {
            setUtilitiesStatus(utilitiesResult.data)
          }
        } catch {
          // Secondary fetch — silent fallback to stale data
        }
      }
    } catch (error) {
      if (mountedRef.current) setBridgeConnected(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchPlayers()
    checkBridgeStatus()
    const interval = setInterval(fetchPlayers, 30000)
    const bridgeInterval = setInterval(checkBridgeStatus, 10000)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
      clearInterval(bridgeInterval)
    }
  }, [fetchPlayers, checkBridgeStatus])

  // Bridge weather commands
  const handleBridgeAction = async (action: string, fn: () => Promise<unknown>) => {
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
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast({
        title: `${action} failed`,
        description: `${message}. Check bridge/server connection and try again.`,
        variant: 'destructive',
      })
    } finally {
      setBridgeLoading(null)
    }
  }

  // Utilities action handler with status refresh
  const handleUtilitiesAction = async (action: string, fn: () => Promise<unknown>) => {
    await handleBridgeAction(action, async () => {
      await fn()
      // Refresh utilities status after action
      try {
        const result = await panelBridgeApi.getUtilitiesStatus()
        if (result.success && result.data) {
          setUtilitiesStatus(result.data)
        }
      } catch {
        // Ignore refresh errors
      }
    })
  }

  const executeCommand = async (command: string) => {
    const result = await rconApi.execute(command)
    if (!result.success) {
      throw new Error(result.error || 'Command failed')
    }
    return result
  }

  const handleAction = async (action: string, fn: () => Promise<unknown>) => {
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
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast({
        title: `${action} failed`,
        description: `${message}. Verify command settings and try again.`,
        variant: 'destructive',
      })
    } finally {
      setLoading(null)
    }
  }

  const getTargetPlayer = () => targetAll ? undefined : selectedPlayer || undefined
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
  
  // Zombie commands
  const createHorde = (count: number, username?: string) => 
    serverApi.createHorde(count, username)
  
  // createhorde2: spawns zombies behind the player (more cinematic)
  const createHorde2 = (count: number, username?: string) => 
    executeCommand(username ? `createhorde2 ${count} "${username}"` : `createhorde2 ${count}`)
  
  // removezombies: clears all zombies from the map
  const removeZombies = () => serverApi.removeZombies()
  
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

  const runBridgeOperation = async () => {
    if (!bridgeConnected) {
      toast({
        title: 'Bridge not connected',
        description: 'Connect PanelBridge in Settings before running advanced operations.',
        variant: 'destructive',
      })
      return
    }

    let parsedArgs: Record<string, unknown> = {}
    try {
      const trimmed = bridgeOperationArgs.trim()
      parsedArgs = trimmed ? JSON.parse(trimmed) : {}
      if (typeof parsedArgs !== 'object' || parsedArgs === null || Array.isArray(parsedArgs)) {
        throw new Error('Args must be a JSON object')
      }
    } catch (error) {
      toast({
        title: 'Invalid JSON args',
        description: error instanceof Error ? error.message : 'Please provide valid JSON.',
        variant: 'destructive',
      })
      return
    }

    setBridgeLoading(bridgeOperation)
    try {
      const response = await panelBridgeApi.sendCommand(bridgeOperation, parsedArgs)
      setBridgeOperationResult(JSON.stringify(response, null, 2))
      toast({
        title: `${bridgeOperationTemplates[bridgeOperation]?.label || bridgeOperation} executed`,
        description: 'Command sent successfully. See output panel for details.',
        variant: 'success' as const,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setBridgeOperationResult(JSON.stringify({ success: false, error: message }, null, 2))
      toast({
        title: 'Bridge operation failed',
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
        description="Run live world events, weather, and admin actions"
        icon={<Zap className="w-5 h-5 text-primary" />}
        actions={
          <div className="flex items-center gap-2">
            <BridgeStatusBadge connected={bridgeConnected} />
            <Button variant="outline" onClick={fetchPlayers} className="gap-2">
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
            <p>Advanced controls for weather, climate, time, infrastructure, and precision sound require <strong className="text-foreground">PanelBridge.lua</strong>. Basic RCON actions still work without it.</p>
            <Link to="/settings" className="inline-flex text-sm text-primary underline hover:text-foreground">Open Bridge Setup</Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Target Selection */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-4 h-4 text-primary" />
            Event Target
          </CardTitle>
          <CardDescription>Choose a global/random target or a specific online player</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={targetAll}
                onCheckedChange={setTargetAll}
                id="target-all"
              />
              <Label htmlFor="target-all" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Use Global/Random Target
              </Label>
            </div>
          </div>
          
          {!targetAll && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Select Player
              </Label>
              <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue placeholder="Select an online player" />
                </SelectTrigger>
                <SelectContent>
                  {players.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No players online</div>
                  ) : (
                    players.map((player) => (
                      <SelectItem key={player.name} value={player.name}>
                        <span className="truncate block max-w-[200px]">{player.name}</span>
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
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 stagger-in">
        {/* ── Weather Section ── */}
        <Collapsible open={openSections.weather} onOpenChange={() => toggleSection('weather')} className="md:col-span-2">
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", openSections.weather && "rotate-180")} />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Weather</span>
            <div className="flex-1 border-t border-border/40 ml-2" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        {/* Weather Controls */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="w-4 h-4 text-primary" />
              Weather Controls
            </CardTitle>
            <CardDescription>Quick weather controls through RCON</CardDescription>
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
        <Card className={!bridgeConnected ? 'opacity-60 pointer-events-none' : ''}>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Snowflake className="w-4 h-4 text-primary" />
              Advanced Weather
            </CardTitle>
            <CardDescription>Panel Bridge controls for blizzards, tropical storms, and snow state</CardDescription>
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
                  <Label className="flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-primary" />
                    Quick Weather Toggles
                  </Label>
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

        {/* Climate Controls (v1.1.0) - spans full width */}
        <Card className={`lg:col-span-2 ${!bridgeConnected ? 'opacity-60' : ''}`}>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="w-4 h-4 text-primary" />
                  Climate Controls
                </CardTitle>
                <CardDescription>Apply world-wide climate overrides. Use Reset to return to sandbox behavior.</CardDescription>
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
                <Label className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-primary" />
                  Rain & Lightning
                </Label>
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
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ── Time & Environment Section ── */}
        <Collapsible open={openSections.environment} onOpenChange={() => toggleSection('environment')} className="md:col-span-2">
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", openSections.environment && "rotate-180")} />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Time & Environment</span>
            <div className="flex-1 border-t border-border/40 ml-2" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">

        {/* Game Time Control (v1.1.0) */}
        <Card className={!bridgeConnected ? 'opacity-60 pointer-events-none' : ''}>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="w-4 h-4 text-primary" />
              Game Time
            </CardTitle>
            <CardDescription>Set server-wide in-game hour, day, and month</CardDescription>
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
                    <Label className="text-xs">Day</Label>
                    <Input
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
                    <Label className="text-xs">Month</Label>
                    <Select value={String(gameMonth)} onValueChange={(v) => setGameMonth(parseInt(v))}>
                      <SelectTrigger>
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
        <Card className={!bridgeConnected ? 'opacity-60 pointer-events-none' : ''}>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4 text-primary" />
              Infrastructure
            </CardTitle>
            <CardDescription>Panel Bridge controls for global power and water state</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="space-y-4">
                {/* Current Status Display - Always visible */}
                <div className="flex items-center justify-center gap-6 p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Zap className={`w-5 h-5 ${utilitiesStatus?.powerOn ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-sm font-medium">Power:</span>
                    <span className={`text-sm font-bold ${utilitiesStatus === null ? 'text-muted-foreground' : utilitiesStatus.powerOn ? 'text-primary' : 'text-destructive'}`}>
                      {utilitiesStatus === null ? 'Checking...' : utilitiesStatus.powerOn ? 'On' : 'Off'}
                    </span>
                  </div>
                  <div className="w-px h-6 bg-border" />
                  <div className="flex items-center gap-2">
                    <Droplets className={`w-5 h-5 ${utilitiesStatus?.waterOn ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-sm font-medium">Water:</span>
                    <span className={`text-sm font-bold ${utilitiesStatus === null ? 'text-muted-foreground' : utilitiesStatus.waterOn ? 'text-primary' : 'text-destructive'}`}>
                      {utilitiesStatus === null ? 'Checking...' : utilitiesStatus.waterOn ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
                
                <p className="text-sm text-muted-foreground">
                  These actions apply instantly to the full world and affect every player.
                </p>
                
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={() => handleUtilitiesAction('Restore Utilities', () => panelBridgeApi.restoreUtilities())}
                    disabled={bridgeLoading !== null}
                    className="h-11 gap-2"
                  >
                    {bridgeLoading === 'Restore Utilities' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    Restore Power + Water
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleUtilitiesAction('Shut Off Utilities', () => panelBridgeApi.shutOffUtilities())}
                    disabled={bridgeLoading !== null}
                    className="h-11 gap-2"
                  >
                    {bridgeLoading === 'Shut Off Utilities' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudOff className="w-4 h-4" />}
                    Cut Power + Water
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={() => handleUtilitiesAction('Restore Power', () => panelBridgeApi.restoreUtilities(true, false))}
                    disabled={bridgeLoading !== null}
                    className="h-11 gap-2"
                  >
                    {bridgeLoading === 'Restore Power' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    Restore Power
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleUtilitiesAction('Restore Water', () => panelBridgeApi.restoreUtilities(false, true))}
                    disabled={bridgeLoading !== null}
                    className="h-11 gap-2"
                  >
                    {bridgeLoading === 'Restore Water' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplets className="w-4 h-4" />}
                    Restore Water
                  </Button>
                </div>
              </div>
          </CardContent>
        </Card>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ── Sound Section ── */}
        <Collapsible open={openSections.sound} onOpenChange={() => toggleSection('sound')} className="md:col-span-2">
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", openSections.sound && "rotate-180")} />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Sound</span>
            <div className="flex-1 border-t border-border/40 ml-2" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">

        {/* Sound Events */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Volume2 className="w-4 h-4 text-primary" />
              Sound Events
            </CardTitle>
            <CardDescription>Trigger world sounds that pull zombie movement</CardDescription>
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
        <Card className={!bridgeConnected ? 'opacity-60 pointer-events-none' : ''}>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="w-4 h-4 text-primary" />
              Advanced Sound Controls
            </CardTitle>
            <CardDescription>Panel Bridge sound lures at player location or exact world coordinates</CardDescription>
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
                  <Label className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Sound at Player Location
                  </Label>
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
                  <Label className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Sound at World Coordinates
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">World X</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 10500"
                        value={soundX}
                        onChange={(e) => setSoundX(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">World Y</Label>
                      <Input
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
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ── Combat & World Section ── */}
        <Collapsible open={openSections.world} onOpenChange={() => toggleSection('world')} className="md:col-span-2">
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", openSections.world && "rotate-180")} />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Combat & World</span>
            <div className="flex-1 border-t border-border/40 ml-2" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">

        {/* Zombie Events */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Skull className="w-4 h-4 text-primary" />
              Zombie Events
            </CardTitle>
            <CardDescription>Spawn, redirect, or clear zombies in loaded areas</CardDescription>
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
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" />
              Time Speed
            </CardTitle>
            <CardDescription>Control the game time multiplier</CardDescription>
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
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="w-4 h-4 text-primary" />
              Teleport
            </CardTitle>
            <CardDescription>Teleport players to locations or other players</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Teleport to Player */}
              <div className="space-y-4">
                <h4 className="font-medium flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Teleport Player to Player
                </h4>
                <div className="space-y-2">
                  <Label>Player to move</Label>
                  <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                    <SelectTrigger>
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
                  <Label>Move to player</Label>
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
                <h4 className="font-medium flex items-center gap-2">
                  <Navigation className="w-4 h-4" />
                  Teleport to Coordinates
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">X</Label>
                    <Input
                      type="number"
                      placeholder="10000"
                      value={teleportX}
                      onChange={(e) => setTeleportX(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Y</Label>
                    <Input
                      type="number"
                      placeholder="11000"
                      value={teleportY}
                      onChange={(e) => setTeleportY(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Z (Level)</Label>
                    <Input
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
            <CardTitle className="flex items-center gap-2 text-base">
              <Car className="w-4 h-4 text-primary" />
              Vehicle Spawn
            </CardTitle>
            <CardDescription>Summon vehicles for players</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Vehicle Type</Label>
              <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                <SelectTrigger>
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
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="w-4 h-4 text-primary" />
              Server Announcement
            </CardTitle>
            <CardDescription>Broadcast messages to all players</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Message</Label>
              <Input
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
          </CollapsibleContent>
        </Collapsible>

        {/* ── Bridge Operations Section ── */}
        <Collapsible open={openSections.bridgeOps} onOpenChange={() => toggleSection('bridgeOps')} className="md:col-span-2">
          <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", openSections.bridgeOps && "rotate-180")} />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Bridge Operations</span>
            <div className="flex-1 border-t border-border/40 ml-2" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pt-4">
              <Card className={!bridgeConnected ? 'opacity-80' : ''}>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="w-4 h-4 text-primary" />
                    New PanelBridge Functions
                  </CardTitle>
                  <CardDescription>
                    Access safehouse, faction, vehicle, swarm, infrastructure, and moderation handlers from the GUI.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Operation</Label>
                      <Select
                        value={bridgeOperation}
                        onValueChange={(value) => {
                          setBridgeOperation(value)
                          setBridgeOperationArgs(bridgeOperationTemplates[value].args)
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select operation" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(bridgeOperationTemplates).map(([action, meta]) => (
                            <SelectItem key={action} value={action}>{meta.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {bridgeOperationTemplates[bridgeOperation]?.description}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>JSON Args</Label>
                      <Textarea
                        value={bridgeOperationArgs}
                        onChange={(e) => setBridgeOperationArgs(e.target.value)}
                        className="min-h-[140px] font-mono text-xs"
                        spellCheck={false}
                      />
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

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={runBridgeOperation}
                      disabled={bridgeLoading !== null || !bridgeConnected}
                      className="h-11 gap-2"
                    >
                      {bridgeLoading === bridgeOperation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Run Operation
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setBridgeOperationResult('Run a command to view response output.')}
                      className="h-11"
                    >
                      Clear Output
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Response Output</Label>
                    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words">
{bridgeOperationResult}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}
