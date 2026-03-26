// Server Status Types
export interface ServerStatus {
  running: boolean
  players: number
  maxPlayers: number
  uptime: string
  memory: string
  cpu: string
  version: string
  serverName: string
}

// Player Types
export interface Player {
  username: string
  steamId?: string
  ping?: number
  accessLevel?: string
  online?: boolean
  lastSeen?: string
  x?: number
  y?: number
  z?: number
}

export interface PlayerAction {
  type: 'kick' | 'ban' | 'unban' | 'setAccess' | 'teleport' | 'heal' | 'godmode'
  username: string
  reason?: string
  accessLevel?: string
  coords?: { x: number; y: number; z: number }
}

// RCON Types
export interface RconCommand {
  command: string
  response?: string
  timestamp?: string
  success?: boolean
}

export interface CommandHistory {
  id: number
  command: string
  response: string
  executed_at: string
  success: number
}

// Scheduler Types
export interface ScheduledTask {
  id: number
  name: string
  cron_expression: string
  command: string
  enabled: number
  last_run: string | null
  created_at: string
}

export interface CronPreset {
  name: string
  cron: string
}

// Mod Types
export interface TrackedMod {
  id: number
  workshop_id: string
  name: string
  server_id?: number | null
  last_updated: string | null
  last_checked: string | null
  update_available: number
  created_at: string
}

export interface ModUpdateInfo {
  workshopId: string
  name: string
  localTimestamp: string
  latestTimestamp: string
}

export interface ModStatus {
  running: boolean
  totalModsTracked: number
  updatesAvailable: number
  lastCheck: string | null
  lastUpdateDetected: string | null
  checkInterval: number
  autoRestartEnabled: boolean
  workshopAcfConfigured: boolean
  workshopAcfPath: string | null
  totalModsInWorkshop: number
  modsNeedingUpdate: ModUpdateInfo[]
  restartWarningMinutes: number
  delayIfPlayersOnline: boolean
  maxDelayMinutes: number
  pendingRestart: boolean
}

// Settings Types
export interface AppSettings {
  rconHost: string
  rconPort: string
  rconPassword: string
  serverPath: string
  serverConfigPath: string
  zomboidDataPath: string
  modCheckInterval: string
  modAutoRestart: boolean
  modRestartDelay: string
  darkMode: boolean
  autoReconnect: boolean
  reconnectInterval: string
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// Event Types
export interface ServerEvent {
  type: 'player_join' | 'player_leave' | 'restart' | 'save' | 'error' | 'warning' | 'info'
  message: string
  timestamp: string
  data?: Record<string, unknown>
}

// Vehicle Types
export interface VehicleInfo {
  id: string
  name: string
  category: string
}

// Weather Types
export type WeatherType = 'sunny' | 'rain' | 'storm' | 'fog' | 'cloudy'

// Access Levels
export type AccessLevel = 'none' | 'observer' | 'gm' | 'overseer' | 'moderator' | 'admin'

export const ACCESS_LEVELS: AccessLevel[] = ['none', 'observer', 'gm', 'overseer', 'moderator', 'admin']

// Mod Conflict Scanner Types
export interface ConflictScanResult {
  totalConflicts: number
  identicalSkipped: number
  additiveSkipped?: number
  pzAdditiveSkipped?: number
  pzAdditiveBreakdown?: {
    sandbox: number
    scripts: number
    clothing: number
    fileguidtable: number
    translate: number
  }
  pairs: ConflictPair[]
  totalPairs: number
  modsScanned: number
  modsNotFound?: number
  modsSkippedInactive?: number
  totalWorkshopIds?: number
  missingDeps: MissingDependency[]
  steamDeps?: SteamDependency[]
  modLoadOrder: string[]
  warnings?: string[]
  scanDurationMs?: number
}

export interface ConflictPair {
  modA: ConflictModRef
  modB: ConflictModRef
  files: ConflictFile[]
  highCount: number
  mediumCount: number
  lowCount: number
}

export interface ConflictModRef {
  workshopId: string
  modId: string
  modName: string
}

export interface ConflictFile {
  file: string
  category: string
  categoryLabel?: string
  severity: 'high' | 'medium' | 'low'
}

export interface MissingDependency {
  modId: string
  modName: string
  workshopId: string
  missingDep: string
  resolvedWorkshopId?: string
  resolvedModName?: string
}

export interface SteamDependency {
  parentWorkshopId: string
  parentName: string
  childWorkshopId: string
  childName: string
  source: 'steam'
}

// SSE streaming scan event types
export interface ScanStreamInit {
  totalWorkshopIds: number
  modLoadOrder: string[]
}

export interface ScanStreamModScanned {
  modId: string
  modName: string
  workshopId: string
  fileCount: number
  modsScanned: number
  totalWorkshopIds: number
  progress: number  // 0-60
}

export interface ScanStreamConflictFound {
  file: string
  severity: 'high' | 'medium' | 'low'
  categoryLabel: string
  mods: string[]
  conflictsSoFar: number
}

export interface ScanStreamPhase {
  phase: 'hashing' | 'grouping'
  progress: number
}

// PZ Command Categories
export interface CommandCategory {
  name: string
  commands: string[]
}

export const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    name: 'Server',
    commands: ['save', 'quit', 'servermsg', 'setaccesslevel', 'reloadoptions']
  },
  {
    name: 'Players',
    commands: ['players', 'kick', 'banuser', 'banid', 'unbanuser', 'unbanid', 'adduser']
  },
  {
    name: 'Admin',
    commands: ['grantadmin', 'removeadmin', 'setaccesslevel', 'invisible', 'godmod', 'noclip']
  },
  {
    name: 'Items',
    commands: ['additem', 'addxp', 'addvehicle', 'createhorde', 'gunshot']
  },
  {
    name: 'Weather',
    commands: ['changeoption', 'startrain', 'stoprain', 'startstorm']
  },
  {
    name: 'World',
    commands: ['chopper', 'helicopter', 'lightning', 'thunder']
  }
]
