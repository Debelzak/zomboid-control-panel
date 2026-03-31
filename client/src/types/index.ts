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
