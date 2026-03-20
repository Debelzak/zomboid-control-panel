import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Map as MapIcon,
  Crosshair,
  Users,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  Loader2,
  Heart,
  Skull,
  Shield,
  CloudLightning,
  Volume2,
  X,
  Swords,
  Pill,
  UtensilsCrossed,
  Hammer,
  Wrench,
  Target,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { BridgeStatusBadge } from '@/components/BridgeStatusBadge'
import { Button } from '@/components/ui/button'
import { panelBridgeApi, updateApi, serversApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────
interface MapPlayer {
  username: string
  displayName?: string
  x: number // game-tile coordinate
  y: number
  z: number
  health?: number
  isAlive?: boolean
  isInfected?: boolean
  accessLevel?: string
  hunger?: number
  thirst?: number
  fatigue?: number
  // Animation state
  prevX?: number
  prevY?: number
  animProgress?: number
}

interface ContextMenu {
  screenX: number
  screenY: number
  worldX: number // game-tile coordinate for actions
  worldY: number
  player?: MapPlayer
}

interface AirdropMarker {
  x: number
  y: number
  preset: string
  time: number // Date.now()
}

// Airdrop preset definitions
const AIRDROP_PRESETS = [
  { id: 'military',  label: 'Military',   icon: Swords,           desc: 'Rifles, ammo, armor, comms' },
  { id: 'medical',   label: 'Medical',    icon: Pill,             desc: 'Bandages, antibiotics, first aid' },
  { id: 'food',      label: 'Food',       icon: UtensilsCrossed,  desc: 'Canned food, water, MREs' },
  { id: 'building',  label: 'Building',   icon: Hammer,           desc: 'Planks, nails, tools, rope' },
  { id: 'weapons',   label: 'Weapons',    icon: Target,           desc: 'Shotguns, melee weapons, holsters' },
  { id: 'tools',     label: 'Tools',      icon: Wrench,           desc: 'Axes, wrenches, blowtorch, tape' },
] as const

// ─── DZI Map Constants ────────────────────────────────────
// Camera: canvasX = dziPixelX * scale + offset.x
// Map tiles served via backend proxy to avoid CORS.

interface MapConfig {
  tileUrl: string
  tileSize: number
  fullWidth: number
  fullHeight: number
  maxLevel: number
  isoX0: number
  isoY0: number
  isoHalfSqr: number
  isoQuarterSqr: number
  defaultCenter: { x: number; y: number }
  label: string
}

const MAP_B42: MapConfig = {
  tileUrl: '/api/map/tiles',
  tileSize: 1024,
  fullWidth: 2314432,
  fullHeight: 1019072,
  maxLevel: 22,
  isoX0: 1036288,
  isoY0: -139296,
  isoHalfSqr: 64,
  isoQuarterSqr: 32,
  defaultCenter: { x: 1280000, y: 410000 },
  label: 'B42',
}

const MAP_B41: MapConfig = {
  tileUrl: '/api/map/b41tiles',
  tileSize: 1024,
  fullWidth: 2285184,
  fullHeight: 990400,
  maxLevel: 22, // ceil(log2(2285184)) = 22
  // Isometric projection from map.projectzomboid.com (multiply=2):
  // Origin derived from PxToTileOffset {x:-5577, y:10327}
  isoX0: 1017856,  // (5577 + 10327) * 64
  isoY0: -152000,  // (5577 - 10327) * 32
  isoHalfSqr: 64,  // 32 * multiply(2)
  isoQuarterSqr: 32, // 16 * multiply(2)
  defaultCenter: { x: 1100000, y: 400000 },
  label: 'B41',
}

const DZI_TILE_SIZE = 1024      // shared between both configs

const MIN_SCALE = 0.0003        // canvas px per DZI px (zoomed way out)
const MAX_SCALE = 1.0           // canvas px per DZI px (zoomed way in)
const POLL_INTERVAL = 3000
const MARKER_HIT_RADIUS = 14

// Known PZ landmarks (game-tile coordinates)
const PZ_LANDMARKS = [
  { name: 'Muldraugh',      gx: 10630, gy:  9800 },
  { name: 'West Point',     gx: 11900, gy:  6900 },
  { name: 'Rosewood',       gx:  8090, gy: 11500 },
  { name: 'Riverside',      gx:  6100, gy:  5400 },
  { name: 'Louisville',     gx: 12700, gy:  1700 },
  { name: 'March Ridge',    gx: 10100, gy: 12700 },
  { name: 'Valley Station', gx: 13200, gy:  5300 },
  { name: 'Ekron',          gx:  7460, gy:  9050 },
]

// ─── Component ────────────────────────────────────────────
export default function WorldMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapWrapperRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)
  const playersRef = useRef<MapPlayer[]>([])
  const drawRequestRef = useRef<number>(0)

  const [players, setPlayers] = useState<MapPlayer[]>([])
  const [, setMapCfg] = useState<MapConfig>(MAP_B42)
  const mapCfgRef = useRef<MapConfig>(MAP_B42)
  const [scale, setScale] = useState(0.001)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<MapPlayer | null>(null)
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [bridgeLoading, setBridgeLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hoveredPlayer, setHoveredPlayer] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, offX: 0, offY: 0 })
  const [cursorWorldPos, setCursorWorldPos] = useState<{ x: number; y: number } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const actionLoadingRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const [airdropMarkers, setAirdropMarkers] = useState<AirdropMarker[]>([])

  const { toast } = useToast()

  // Detect B41 vs B42 on mount — check gameVersion + branch
  useEffect(() => {
    let cancelled = false
    async function detect() {
      try {
        const [statusRes, serverRes] = await Promise.allSettled([
          updateApi.getStatus(),
          serversApi.getActive(),
        ])
        if (cancelled) return

        let isB41 = false
        if (statusRes.status === 'fulfilled' && statusRes.value.gameVersion) {
          isB41 = statusRes.value.gameVersion.startsWith('41.')
        }
        if (!isB41 && serverRes.status === 'fulfilled') {
          const branch = serverRes.value.server?.branch
          if (branch && /b41/i.test(branch)) isB41 = true
        }

        if (isB41) {
          setMapCfg(MAP_B41)
          mapCfgRef.current = MAP_B41
          // Clear tile cache when switching maps
          tileCacheRef.current = {}
        }
      } catch { /* best-effort */ }
    }
    detect()
    return () => { cancelled = true }
  }, [])

  // Track mounted state to guard async callbacks
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Reduced motion preference
  const prefersReducedMotion = useRef(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    prefersReducedMotion.current = mq.matches
    const handler = (e: MediaQueryListEvent) => { prefersReducedMotion.current = e.matches }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Refs for use in animation loop (avoid stale closures)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const airdropMarkersRef = useRef(airdropMarkers)
  airdropMarkersRef.current = airdropMarkers

  // ─── Map tile cache ─────────────────────────────────────
  const tileCacheRef = useRef<Record<string, HTMLImageElement | null>>({})

  // Cap concurrent tile loads to avoid flooding the network
  const pendingTileLoadsRef = useRef(0)
  const MAX_CONCURRENT_TILES = 8

  const loadDziTile = useCallback((level: number, col: number, row: number) => {
    const key = `${level}/${col}_${row}`
    if (key in tileCacheRef.current) return
    if (pendingTileLoadsRef.current >= MAX_CONCURRENT_TILES) return
    tileCacheRef.current[key] = null
    pendingTileLoadsRef.current++
    const img = new window.Image()
    img.onload = () => {
      tileCacheRef.current[key] = img
      pendingTileLoadsRef.current--
      if (drawRequestRef.current === 0) {
        drawRequestRef.current = requestAnimationFrame(() => { drawRequestRef.current = 0 })
      }
    }
    img.onerror = () => {
      pendingTileLoadsRef.current--
    }
    img.src = `${mapCfgRef.current.tileUrl}/${level}/${col}_${row}.jpg`
  }, [])

  // ─── Coordinate transforms (DZI pixel ↔ canvas, game-tile ↔ DZI) ─
  const dziToCanvas = useCallback(
    (dziX: number, dziY: number, s?: number, off?: { x: number; y: number }) => {
      const sc = s ?? scaleRef.current
      const o = off ?? offsetRef.current
      return { x: dziX * sc + o.x, y: dziY * sc + o.y }
    }, []
  )

  const canvasToDzi = useCallback(
    (cx: number, cy: number, s?: number, off?: { x: number; y: number }) => {
      const sc = s ?? scaleRef.current
      const o = off ?? offsetRef.current
      return { x: (cx - o.x) / sc, y: (cy - o.y) / sc }
    }, []
  )

  // Player game-tile → canvas pixel (isometric projection)
  const playerToScreen = useCallback(
    (gx: number, gy: number, s?: number, off?: { x: number; y: number }) => {
      const dzi = gameTileToDzi(gx, gy, mapCfgRef.current)
      return dziToCanvas(dzi.x, dzi.y, s, off)
    }, [dziToCanvas]
  )

  // Canvas pixel → game-tile (inverse isometric)
  const screenToTile = useCallback(
    (cx: number, cy: number, s?: number, off?: { x: number; y: number }) => {
      const dzi = canvasToDzi(cx, cy, s, off)
      return dziToGameTile(dzi.x, dzi.y, mapCfgRef.current)
    }, [canvasToDzi]
  )

  // ─── Data fetching ──────────────────────────────────────
  const fetchPlayerPositions = useCallback(async () => {
    try {
      const res = await panelBridgeApi.getServerInfo()
      const rawPlayers = res.success && res.data?.players
        ? (Array.isArray(res.data.players) ? res.data.players : Object.values(res.data.players))
        : null
      if (rawPlayers) {
        setBridgeConnected(true)
        setPlayers((prev) => {
          const prevMap = new globalThis.Map(prev.map((p) => [p.username || p.displayName, p]))
          return rawPlayers.map((p: any) => {
            const key = p.name || p.username
            const old = prevMap.get(key)
            return {
              username: key,
              displayName: p.displayName || key,
              x: p.x, y: p.y, z: p.z ?? 0,
              health: p.health,
              isAlive: p.isAlive ?? true,
              isInfected: p.isInfected,
              accessLevel: p.accessLevel,
              hunger: p.hunger, thirst: p.thirst, fatigue: p.fatigue,
              prevX: old ? old.x : p.x,
              prevY: old ? old.y : p.y,
              animProgress: old && (old.x !== p.x || old.y !== p.y) ? 0 : 1,
            }
          })
        })
      }
    } catch {
      setBridgeConnected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const checkBridgeStatus = useCallback(async () => {
    setBridgeLoading(true)
    try {
      const res = await panelBridgeApi.getStatus()
      setBridgeConnected(res.modConnected === true)
    } catch {
      setBridgeConnected(false)
    } finally {
      setBridgeLoading(false)
    }
  }, [])

  // ─── Polling ────────────────────────────────────────────
  useEffect(() => {
    checkBridgeStatus()
    fetchPlayerPositions()
  }, [fetchPlayerPositions, checkBridgeStatus])

  useEffect(() => {
    if (!bridgeConnected) return
    const interval = setInterval(fetchPlayerPositions, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [bridgeConnected, fetchPlayerPositions])

  useEffect(() => { playersRef.current = players }, [players])

  // ─── Canvas rendering ───────────────────────────────────
  const drawMap = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasSize.width === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // DPR-aware sizing for sharp rendering on high-DPI displays
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(canvasSize.width * dpr)
    canvas.height = Math.floor(canvasSize.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const W = canvasSize.width
    const H = canvasSize.height
    const s = scaleRef.current
    const off = offsetRef.current

    // High-quality image interpolation
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // Dark background
    ctx.fillStyle = '#0a0c0b'
    ctx.fillRect(0, 0, W, H)

    // ── DZI map tiles ──
    const mc = mapCfgRef.current
    const level = Math.max(0, Math.min(mc.maxLevel, Math.round(mc.maxLevel + Math.log2(s))))
    const levelScale = Math.pow(2, mc.maxLevel - level)
    const levelW = Math.ceil(mc.fullWidth / levelScale)
    const levelH = Math.ceil(mc.fullHeight / levelScale)

    // Visible DZI full-res pixel range
    const visMinDziX = -off.x / s
    const visMaxDziX = (W - off.x) / s
    const visMinDziY = -off.y / s
    const visMaxDziY = (H - off.y) / s

    // Convert to level-pixel tile indices
    const minCol = Math.max(0, Math.floor(visMinDziX / levelScale / DZI_TILE_SIZE))
    const maxCol = Math.min(Math.ceil(levelW / DZI_TILE_SIZE) - 1, Math.floor(visMaxDziX / levelScale / DZI_TILE_SIZE))
    const minRow = Math.max(0, Math.floor(visMinDziY / levelScale / DZI_TILE_SIZE))
    const maxRow = Math.min(Math.ceil(levelH / DZI_TILE_SIZE) - 1, Math.floor(visMaxDziY / levelScale / DZI_TILE_SIZE))

    ctx.save()
    ctx.globalAlpha = 0.9
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        loadDziTile(level, col, row)
        const img = tileCacheRef.current[`${level}/${col}_${row}`]
        if (img) {
          const dx = col * DZI_TILE_SIZE * levelScale * s + off.x
          const dy = row * DZI_TILE_SIZE * levelScale * s + off.y
          const dw = img.naturalWidth * levelScale * s
          const dh = img.naturalHeight * levelScale * s
          ctx.drawImage(img, dx, dy, dw, dh)
        }
      }
    }
    ctx.restore()

    // ── Landmark labels ──
    const markerSize = Math.max(4, Math.min(10, s * 1500))
    const fontSize = Math.max(9, Math.min(14, s * 3000))
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'

    for (const lm of PZ_LANDMARKS) {
      const p = playerToScreen(lm.gx, lm.gy, s, off)
      if (p.x < -100 || p.x > W + 100 || p.y < -50 || p.y > H + 50) continue

      // Glow
      ctx.beginPath()
      ctx.arc(p.x, p.y, markerSize * 2, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fill()

      // Diamond
      ctx.beginPath()
      ctx.moveTo(p.x, p.y - markerSize * 0.7)
      ctx.lineTo(p.x + markerSize * 0.7, p.y)
      ctx.lineTo(p.x, p.y + markerSize * 0.7)
      ctx.lineTo(p.x - markerSize * 0.7, p.y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fill()

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.fillText(lm.name, p.x, p.y - markerSize - 4)
    }

    // ── Player markers ──
    const currentPlayers = playersRef.current
    const now = performance.now()
    const mRadius = Math.max(4, Math.min(8, s * 1200))

    for (const player of currentPlayers) {
      // Interpolate position (skip if reduced motion)
      let drawX = player.x
      let drawY = player.y
      if (!prefersReducedMotion.current && player.animProgress !== undefined && player.animProgress < 1) {
        const t = easeOutCubic(Math.min(1, player.animProgress))
        drawX = (player.prevX ?? player.x) + (player.x - (player.prevX ?? player.x)) * t
        drawY = (player.prevY ?? player.y) + (player.y - (player.prevY ?? player.y)) * t
      }

      const p = playerToScreen(drawX, drawY, s, off)
      if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) continue

      const isHovered = hoveredPlayer === player.username
      const isSelected = selectedPlayer?.username === player.username
      const isAdmin = player.accessLevel && player.accessLevel !== '' && player.accessLevel !== 'none'
      const pinScale = isHovered ? 1.15 : 1
      const headR = mRadius * 0.65 * pinScale
      const bodyH = mRadius * 1.1 * pinScale
      const bodyW = mRadius * 1.2 * pinScale
      const pinCenterY = p.y - bodyH * 0.2 // shift pin up so point sits at coords

      // Pulse ring (skip if reduced motion)
      if (!prefersReducedMotion.current) {
        const pulsePhase = (now / 1500 + (player.username.charCodeAt(0) / 26)) % 1
        const pulseRadius = mRadius + 4 + pulsePhase * 8
        const pulseAlpha = 0.3 * (1 - pulsePhase)
        ctx.beginPath()
        ctx.arc(p.x, pinCenterY, pulseRadius, 0, Math.PI * 2)
        ctx.strokeStyle = getPlayerColor(player, pulseAlpha)
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Outer glow
      if (isHovered || isSelected) {
        ctx.beginPath()
        ctx.arc(p.x, pinCenterY, mRadius + 5, 0, Math.PI * 2)
        ctx.fillStyle = getPlayerColor(player, 0.18)
        ctx.fill()
      }

      // Drop shadow
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = 5
      ctx.shadowOffsetX = 1
      ctx.shadowOffsetY = 2

      const color = getPlayerColor(player, 0.92)

      // Body (teardrop / triangular torso pointing down)
      ctx.beginPath()
      ctx.moveTo(p.x - bodyW, pinCenterY)          // left shoulder
      ctx.lineTo(p.x, pinCenterY + bodyH + headR)   // bottom point
      ctx.lineTo(p.x + bodyW, pinCenterY)            // right shoulder
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()

      // Head circle
      ctx.beginPath()
      ctx.arc(p.x, pinCenterY - headR * 0.4, headR, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      ctx.restore() // remove shadow for inner details

      // Dark outline
      ctx.beginPath()
      ctx.moveTo(p.x - bodyW, pinCenterY)
      ctx.lineTo(p.x, pinCenterY + bodyH + headR)
      ctx.lineTo(p.x + bodyW, pinCenterY)
      ctx.closePath()
      ctx.arc(p.x, pinCenterY - headR * 0.4, headR, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Inner head highlight
      ctx.beginPath()
      ctx.arc(p.x - headR * 0.25, pinCenterY - headR * 0.65, headR * 0.35, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.fill()

      // Admin star
      if (isAdmin) {
        ctx.fillStyle = 'rgba(251,191,36,0.9)'
        drawStar(ctx, p.x + mRadius + 4, pinCenterY - headR - 3, 3.5, 5)
      }

      // Username label
      const labelY = pinCenterY - headR - mRadius * 0.5 - 4
      const labelAlpha = isHovered || isSelected ? 1 : 0.8
      ctx.font = `600 ${Math.max(10, Math.min(13, s * 2500))}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 3
      ctx.shadowOffsetY = 1
      ctx.fillStyle = `rgba(255,255,255,${labelAlpha})`
      ctx.fillText(player.displayName || player.username, p.x, labelY)
      ctx.restore()

      // Health bar
      if (player.health !== undefined && s > 0.0005) {
        const barW = 24
        const barH = 3
        const barX = p.x - barW / 2
        const barY = pinCenterY + bodyH + headR + 4
        const healthPct = Math.max(0, Math.min(100, player.health)) / 100

        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.beginPath()
        ctx.roundRect(barX, barY, barW, barH, 1.5)
        ctx.fill()
        ctx.fillStyle =
          healthPct > 0.5 ? 'rgba(74,222,128,0.8)' :
          healthPct > 0.25 ? 'rgba(251,191,36,0.8)' :
          'rgba(248,113,113,0.8)'
        ctx.beginPath()
        ctx.roundRect(barX, barY, barW * healthPct, barH, 1.5)
        ctx.fill()
      }
    }

    // ── Airdrop markers ──
    const markers = airdropMarkersRef.current
    const nowMs = Date.now()
    for (const marker of markers) {
      const age = nowMs - marker.time
      const fadeAlpha = Math.max(0, 1 - age / 300_000) // fade over 5 min
      if (fadeAlpha <= 0) continue

      const ap = playerToScreen(marker.x, marker.y, s, off)
      if (ap.x < -40 || ap.x > W + 40 || ap.y < -40 || ap.y > H + 40) continue

      const dropSize = Math.max(6, Math.min(16, s * 2000))

      // Pulsing ring (first 30s)
      if (age < 30_000 && !prefersReducedMotion.current) {
        const pulse = ((now / 800) % 1)
        const ringR = dropSize + 8 + pulse * 14
        ctx.beginPath()
        ctx.arc(ap.x, ap.y, ringR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(251,191,36,${0.4 * (1 - pulse) * fadeAlpha})`
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Ground shadow (ellipse below crate)
      ctx.save()
      ctx.globalAlpha = fadeAlpha * 0.25
      ctx.beginPath()
      ctx.ellipse(ap.x, ap.y + dropSize * 1.1, dropSize * 1.2, dropSize * 0.3, 0, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,1)'
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.globalAlpha = fadeAlpha

      const bs = dropSize * 0.7
      const crateTop = ap.y - bs * 0.3
      const crateBottom = ap.y + bs * 1.1
      const crateH = crateBottom - crateTop

      // Crate body (rounded rect)
      ctx.beginPath()
      ctx.roundRect(ap.x - bs, crateTop, bs * 2, crateH, 2)
      ctx.fillStyle = 'rgba(140,100,40,0.92)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(90,65,20,0.95)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Crate cross straps
      ctx.beginPath()
      ctx.moveTo(ap.x, crateTop)
      ctx.lineTo(ap.x, crateBottom)
      ctx.moveTo(ap.x - bs, crateTop + crateH * 0.45)
      ctx.lineTo(ap.x + bs, crateTop + crateH * 0.45)
      ctx.strokeStyle = 'rgba(200,160,60,0.7)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Parachute lines from crate top corners + center to canopy
      const canopyY = crateTop - dropSize * 1.6
      const canopyW = dropSize * 1.8
      ctx.beginPath()
      ctx.moveTo(ap.x - bs, crateTop)
      ctx.lineTo(ap.x - canopyW, canopyY)
      ctx.moveTo(ap.x + bs, crateTop)
      ctx.lineTo(ap.x + canopyW, canopyY)
      ctx.moveTo(ap.x, crateTop)
      ctx.lineTo(ap.x, canopyY)
      ctx.strokeStyle = `rgba(220,200,160,${0.5 * fadeAlpha})`
      ctx.lineWidth = 0.8
      ctx.stroke()

      // Parachute canopy (arc)
      ctx.beginPath()
      ctx.moveTo(ap.x - canopyW, canopyY)
      ctx.quadraticCurveTo(ap.x, canopyY - dropSize * 1.2, ap.x + canopyW, canopyY)
      ctx.strokeStyle = `rgba(251,191,36,${0.85 * fadeAlpha})`
      ctx.lineWidth = 2.5
      ctx.stroke()

      // Canopy fill (subtle)
      ctx.beginPath()
      ctx.moveTo(ap.x - canopyW, canopyY)
      ctx.quadraticCurveTo(ap.x, canopyY - dropSize * 1.2, ap.x + canopyW, canopyY)
      ctx.lineTo(ap.x - canopyW, canopyY)
      ctx.closePath()
      ctx.fillStyle = `rgba(251,191,36,${0.12 * fadeAlpha})`
      ctx.fill()

      ctx.restore()

      // Label
      const presetDef = AIRDROP_PRESETS.find((p) => p.id === marker.preset)
      if (presetDef && s > 0.0004) {
        ctx.save()
        const fontSize = Math.max(9, Math.min(12, s * 2200))
        ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(0,0,0,0.7)'
        ctx.shadowBlur = 3
        ctx.shadowOffsetY = 1
        ctx.fillStyle = `rgba(251,191,36,${0.9 * fadeAlpha})`
        ctx.fillText(presetDef.label, ap.x, ap.y - dropSize * 2.2)
        ctx.restore()
      }
    }

    // Empty state
    if (currentPlayers.length === 0) {
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText('No players on the map', W / 2, H / 2 - 8)
      ctx.font = '400 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillText('Player positions appear when PanelBridge is connected', W / 2, H / 2 + 10)
    }

    // Crosshair at cursor
    if (cursorWorldPos && !isDragging) {
      const cp = playerToScreen(cursorWorldPos.x, cursorWorldPos.y, s, off)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(cp.x - 12, cp.y)
      ctx.lineTo(cp.x + 12, cp.y)
      ctx.moveTo(cp.x, cp.y - 12)
      ctx.lineTo(cp.x, cp.y + 12)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [canvasSize, loadDziTile, playerToScreen, hoveredPlayer, selectedPlayer, cursorWorldPos, isDragging])

  // ─── Animation loop ─────────────────────────────────────
  useEffect(() => {
    let running = true
    const animate = () => {
      if (!running) return
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.animProgress !== undefined && p.animProgress < 1) {
            return { ...p, animProgress: Math.min(1, p.animProgress + 0.06) }
          }
          return p
        })
      )
      drawMap()
      animFrameRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
      if (drawRequestRef.current) {
        cancelAnimationFrame(drawRequestRef.current)
        drawRequestRef.current = 0
      }
    }
  }, [drawMap])

  // ─── Canvas resize ──────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setCanvasSize({ width: Math.floor(width), height: Math.floor(height) })
        }
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // ─── Set initial view centered on Knox County ───────────
  const hasInitRef = useRef(false)
  useEffect(() => {
    if (hasInitRef.current || canvasSize.width === 0) return
    hasInitRef.current = true
    const c = mapCfgRef.current.defaultCenter
    const s = 0.001
    setOffset({
      x: canvasSize.width / 2 - c.x * s,
      y: canvasSize.height / 2 - c.y * s,
    })
  }, [canvasSize])

  // ─── Fit to players ─────────────────────────────────────
  const fitToPlayers = useCallback(() => {
    const W = canvasSize.width
    const H = canvasSize.height
    if (W === 0 || H === 0) return

    if (players.length === 0) {
      // Reset to default Knox County view
      const c = mapCfgRef.current.defaultCenter
      const s = 0.001
      setScale(s)
      setOffset({
        x: W / 2 - c.x * s,
        y: H / 2 - c.y * s,
      })
      return
    }

    // Find player bounds in DZI pixel coords
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of players) {
      const dzi = gameTileToDzi(p.x, p.y, mapCfgRef.current)
      minX = Math.min(minX, dzi.x)
      minY = Math.min(minY, dzi.y)
      maxX = Math.max(maxX, dzi.x)
      maxY = Math.max(maxY, dzi.y)
    }

    const pad = 50000 // DZI pixels of padding
    minX -= pad; minY -= pad; maxX += pad; maxY += pad

    const rangeX = maxX - minX
    const rangeY = maxY - minY
    const newScale = Math.min(W / rangeX, H / rangeY, MAX_SCALE)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setScale(newScale)
    setOffset({ x: W / 2 - centerX * newScale, y: H / 2 - centerY * newScale })
  }, [players, canvasSize])

  // Auto-fit on first player data
  const hasFittedRef = useRef(false)
  useEffect(() => {
    if (players.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true
      fitToPlayers()
    }
  }, [players, fitToPlayers])

  // ─── Wheel zoom (non-passive) ─────────────────────────
  // Attached to the map wrapper (not just canvas) so overlays don't eat the event.
  // Uses refs for immediate read/write to avoid stale-state drift during rapid scrolling.
  useEffect(() => {
    const wrapper = mapWrapperRef.current
    if (!wrapper) return
    const canvas = canvasRef.current

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = (canvas ?? wrapper).getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15

      const prevScale = scaleRef.current
      const prevOff = offsetRef.current
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScale * factor))
      const ratio = newScale / prevScale
      const newOffset = {
        x: mx - (mx - prevOff.x) * ratio,
        y: my - (my - prevOff.y) * ratio,
      }

      // Update refs immediately so the next rapid wheel tick reads correct values
      scaleRef.current = newScale
      offsetRef.current = newOffset

      setScale(newScale)
      setOffset(newOffset)
    }

    wrapper.addEventListener('wheel', onWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel)
  }, [])

  // ─── Mouse interactions ─────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true)
      setDragStart({ x: e.clientX, y: e.clientY, offX: offsetRef.current.x, offY: offsetRef.current.y })
      setContextMenu(null)
    }
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      if (isDragging) {
        setOffset({
          x: dragStart.offX + (e.clientX - dragStart.x),
          y: dragStart.offY + (e.clientY - dragStart.y),
        })
        return
      }

      // Cursor world position (game tiles)
      const wp = screenToTile(mx, my)
      setCursorWorldPos(wp)

      // Hit test players
      let found: string | null = null
      for (const player of playersRef.current) {
        const p = playerToScreen(player.x, player.y)
        const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2)
        if (dist < MARKER_HIT_RADIUS) {
          found = player.username
          break
        }
      }
      setHoveredPlayer(found)
    },
    [isDragging, dragStart, screenToTile, playerToScreen]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        const dx = Math.abs(e.clientX - dragStart.x)
        const dy = Math.abs(e.clientY - dragStart.y)
        setIsDragging(false)

        if (dx < 3 && dy < 3) {
          const canvas = canvasRef.current
          if (!canvas) return
          const rect = canvas.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top

          for (const player of playersRef.current) {
            const p = playerToScreen(player.x, player.y)
            const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2)
            if (dist < MARKER_HIT_RADIUS) {
              setSelectedPlayer(player)
              return
            }
          }
          setSelectedPlayer(null)
        }
      }
    },
    [isDragging, dragStart, playerToScreen]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const wp = screenToTile(mx, my)

      let clickedPlayer: MapPlayer | undefined
      for (const player of playersRef.current) {
        const p = playerToScreen(player.x, player.y)
        const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2)
        if (dist < MARKER_HIT_RADIUS) {
          clickedPlayer = player
          break
        }
      }

      setContextMenu({
        screenX: mx,
        screenY: my,
        worldX: wp.x,
        worldY: wp.y,
        player: clickedPlayer,
      })
    },
    [screenToTile, playerToScreen]
  )

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false)
    setHoveredPlayer(null)
    setCursorWorldPos(null)
  }, [])

  // ─── Zoom controls ─────────────────────────────────────
  const zoomIn = () => {
    const cx = canvasSize.width / 2
    const cy = canvasSize.height / 2
    const prev = scaleRef.current
    const next = Math.min(MAX_SCALE, prev * 1.4)
    const ratio = next / prev
    const o = offsetRef.current
    const newOffset = { x: cx - (cx - o.x) * ratio, y: cy - (cy - o.y) * ratio }
    scaleRef.current = next
    offsetRef.current = newOffset
    setScale(next)
    setOffset(newOffset)
  }
  const zoomOut = () => {
    const cx = canvasSize.width / 2
    const cy = canvasSize.height / 2
    const prev = scaleRef.current
    const next = Math.max(MIN_SCALE, prev / 1.4)
    const ratio = next / prev
    const o = offsetRef.current
    const newOffset = { x: cx - (cx - o.x) * ratio, y: cy - (cy - o.y) * ratio }
    scaleRef.current = next
    offsetRef.current = newOffset
    setScale(next)
    setOffset(newOffset)
  }

  // ─── Keyboard controls ─────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const PAN_STEP = 40
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setOffset((prev) => ({ ...prev, y: prev.y + PAN_STEP }))
          break
        case 'ArrowDown':
          e.preventDefault()
          setOffset((prev) => ({ ...prev, y: prev.y - PAN_STEP }))
          break
        case 'ArrowLeft':
          e.preventDefault()
          setOffset((prev) => ({ ...prev, x: prev.x + PAN_STEP }))
          break
        case 'ArrowRight':
          e.preventDefault()
          setOffset((prev) => ({ ...prev, x: prev.x - PAN_STEP }))
          break
        case '+':
        case '=':
          e.preventDefault()
          zoomIn()
          break
        case '-':
          e.preventDefault()
          zoomOut()
          break
        case 'Escape':
          setContextMenu(null)
          setSelectedPlayer(null)
          break
      }
    },
    [zoomIn, zoomOut]
  )

  // Escape key dismisses context menu globally (even without canvas focus)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null)
        setSelectedPlayer(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Click outside context menu to dismiss
  useEffect(() => {
    if (!contextMenu) return
    const onClick = (e: MouseEvent) => {
      const menu = mapWrapperRef.current?.querySelector('[role="menu"]')
      if (menu && !menu.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', onClick, true)
    return () => document.removeEventListener('mousedown', onClick, true)
  }, [contextMenu])

  // ─── Actions ────────────────────────────────────────────
  const triggerLightningAt = useCallback(
    async (x: number, y: number) => {
      setActionLoading('lightning')
      try {
        const res = await panelBridgeApi.triggerLightning(x, y, true, true, true)
        if (res.success) {
          toast({ title: 'Lightning strike', description: `Struck at ${x}, ${y}` })
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to trigger lightning', variant: 'destructive' })
      } finally {
        setActionLoading(null)
        setContextMenu(null)
      }
    },
    [toast]
  )

  const createNoiseAt = useCallback(
    async (x: number, y: number) => {
      setActionLoading('noise')
      try {
        const res = await panelBridgeApi.playWorldSound(x, y, 0, 200, 100)
        if (res.success) {
          toast({ title: 'Noise created', description: `Sound at ${x}, ${y} — attracting zombies` })
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to create noise', variant: 'destructive' })
      } finally {
        setActionLoading(null)
        setContextMenu(null)
      }
    },
    [toast]
  )

  const callAirdrop = useCallback(
    async (x: number, y: number, preset: typeof AIRDROP_PRESETS[number]['id']) => {
      if (actionLoadingRef.current) return // prevent double-submit (ref avoids stale closure)
      actionLoadingRef.current = 'airdrop'
      setActionLoading('airdrop')
      try {
        const res = await panelBridgeApi.triggerAirdrop({ x, y, preset, announce: true, attractZombies: true })
        if (!mountedRef.current) return
        if (res.success) {
          const presetDef = AIRDROP_PRESETS.find((p) => p.id === preset)
          const label = presetDef?.label ?? preset
          const data = res.data as Record<string, unknown> | undefined
          const itemCount = typeof data?.itemCount === 'number' ? data.itemCount : undefined
          const failed = typeof data?.failed === 'number' ? data.failed : 0
          const coords = `${Math.round(x)}, ${Math.round(y)}`
          let desc = itemCount
            ? `${itemCount} items dropped at ${coords}`
            : `Supply drop at ${coords}`
          if (failed > 0) {
            desc += ` (${failed} failed)`
          }
          toast({ title: `${label} airdrop deployed`, description: desc })
          setAirdropMarkers((prev) => {
            const next = [...prev, { x, y, preset, time: Date.now() }]
            return next.length > 50 ? next.slice(-50) : next // cap at 50 markers
          })
        } else {
          toast({ title: 'Airdrop failed', description: res.error || 'Area may not be loaded — a player must be nearby', variant: 'destructive' })
        }
      } catch (err) {
        if (!mountedRef.current) return
        const msg = err instanceof Error ? err.message : 'Failed to call airdrop'
        toast({ title: 'Airdrop error', description: msg, variant: 'destructive' })
      } finally {
        actionLoadingRef.current = null
        if (mountedRef.current) {
          setActionLoading(null)
          setContextMenu(null)
        }
      }
    },
    [toast]
  )

  // Clean up expired airdrop markers (older than 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 300_000
      setAirdropMarkers((prev) => {
        const filtered = prev.filter((m) => m.time > cutoff)
        return filtered.length === prev.length ? prev : filtered // stable ref if unchanged
      })
    }, 15_000)
    return () => clearInterval(interval)
  }, [])

  // Pan to player (from player list click)
  const panToPlayer = useCallback((p: MapPlayer) => {
    const W = canvasSize.width
    const H = canvasSize.height
    if (W === 0) return
    const dzi = gameTileToDzi(p.x, p.y, mapCfgRef.current)
    const viewScale = Math.max(scale, 0.01) // zoom in if too far out
    setScale(viewScale)
    setOffset({ x: W / 2 - dzi.x * viewScale, y: H / 2 - dzi.y * viewScale })
    setSelectedPlayer(p)
  }, [canvasSize, scale])

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="space-y-4 page-transition">
      <PageHeader
        title="World Map"
        description="Live player positions on the Knox County map. Right-click for actions."
        icon={<MapIcon className="w-5 h-5" />}
        actions={
          <div className="flex items-center gap-2">
            <BridgeStatusBadge connected={bridgeConnected} loading={bridgeLoading} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPlayerPositions()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div ref={mapWrapperRef} className="relative rounded-xl border border-border/60 overflow-hidden bg-[#0a0c0b]">
        {/* Zoom controls */}
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
          <button
            onClick={zoomIn}
            aria-label="Zoom in"
            className="w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border/60 flex items-center justify-center hover:bg-muted transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={zoomOut}
            aria-label="Zoom out"
            className="w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border/60 flex items-center justify-center hover:bg-muted transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={fitToPlayers}
            aria-label="Fit to players"
            className="w-8 h-8 rounded-lg bg-background/80 backdrop-blur border border-border/60 flex items-center justify-center hover:bg-muted transition-colors"
            title="Fit to players"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Player list panel */}
        <div className="absolute top-3 right-3 z-10 w-52">
          <div className="rounded-lg bg-background/85 backdrop-blur border border-border/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              {players.length} Online
            </div>
            {players.length > 0 ? (
              <div className="max-h-60 overflow-y-auto">
                {players.map((p) => (
                  <button
                    key={p.username}
                    onClick={() => panToPlayer(p)}
                    className={cn(
                      'w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs hover:bg-muted/60 transition-colors',
                      selectedPlayer?.username === p.username && 'bg-muted/40'
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-none"
                      style={{ backgroundColor: getPlayerColor(p, 0.9) }}
                    />
                    <span className="truncate flex-1">{p.displayName || p.username}</span>
                    {p.health !== undefined && (
                      <span className={cn(
                        'text-[10px] tabular-nums',
                        p.health > 50 ? 'text-green-400' : p.health > 25 ? 'text-amber-400' : 'text-red-400'
                      )}>
                        {Math.round(p.health)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                {loading ? 'Loading...' : bridgeConnected ? 'No players online' : 'Bridge not connected'}
              </div>
            )}
          </div>
        </div>

        {/* Coordinate display */}
        <div className="absolute bottom-3 left-3 z-10">
          <div className="rounded-lg bg-background/80 backdrop-blur border border-border/60 px-3 py-1.5 text-[11px] font-mono text-muted-foreground tabular-nums">
            {cursorWorldPos ? (
              <span>
                <Crosshair className="w-3 h-3 inline mr-1 opacity-50" />
                {cursorWorldPos.x}, {cursorWorldPos.y}
              </span>
            ) : (
              <span className="opacity-50">Hover to see coordinates</span>
            )}
            <span className="mx-2 opacity-30">|</span>
            <span className="opacity-50">{(scale / 0.001 * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Selected player detail card */}
        {selectedPlayer && (
          <div className="absolute bottom-3 right-3 z-10 w-56">
            <div className="rounded-lg bg-background/90 backdrop-blur border border-border/60 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getPlayerColor(selectedPlayer, 0.9) }}
                  />
                  <span className="text-sm font-semibold truncate">
                    {selectedPlayer.displayName || selectedPlayer.username}
                  </span>
                </div>
                <button onClick={() => setSelectedPlayer(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-3 py-2 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Position</span>
                  <span className="font-mono tabular-nums">{Math.round(selectedPlayer.x)}, {Math.round(selectedPlayer.y)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Floor</span>
                  <span className="font-mono tabular-nums">{selectedPlayer.z}</span>
                </div>
                {selectedPlayer.health !== undefined && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Health</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max(0, Math.min(100, selectedPlayer.health))}%`,
                            backgroundColor:
                              selectedPlayer.health > 50 ? 'rgb(74,222,128)'
                              : selectedPlayer.health > 25 ? 'rgb(251,191,36)'
                              : 'rgb(248,113,113)',
                          }}
                        />
                      </div>
                      <span className="font-mono tabular-nums w-8 text-right">{Math.round(selectedPlayer.health)}%</span>
                    </div>
                  </div>
                )}
                {selectedPlayer.accessLevel && selectedPlayer.accessLevel !== 'none' && selectedPlayer.accessLevel !== '' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Role</span>
                    <span className="text-amber-400 capitalize">{selectedPlayer.accessLevel}</span>
                  </div>
                )}
                {selectedPlayer.isInfected && (
                  <div className="flex items-center gap-1 text-red-400">
                    <Skull className="w-3 h-3" />
                    <span>Infected</span>
                  </div>
                )}
              </div>
              <div className="px-3 py-2 border-t border-border/40 flex gap-1.5">
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs gap-1 flex-1"
                  disabled={actionLoading !== null}
                  onClick={() => {
                    setActionLoading('heal-card')
                    panelBridgeApi.sendCommand('healPlayer', { username: selectedPlayer.username })
                      .then(() => { toast({ title: 'Healed', description: `${selectedPlayer.username} healed` }); fetchPlayerPositions() })
                      .catch(() => toast({ title: 'Error', variant: 'destructive' }))
                      .finally(() => setActionLoading(null))
                  }}
                >
                  <Heart className="w-3 h-3" /> Heal
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 text-xs gap-1 flex-1"
                  disabled={actionLoading !== null}
                  onClick={() => {
                    setActionLoading('god-card')
                    panelBridgeApi.sendCommand('setGodMode', { username: selectedPlayer.username, enabled: true })
                      .then(() => toast({ title: 'God mode enabled' }))
                      .catch(() => toast({ title: 'Error', variant: 'destructive' }))
                      .finally(() => setActionLoading(null))
                  }}
                >
                  <Shield className="w-3 h-3" /> God
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            ref={(el) => {
              // Auto-focus first menu item on open for keyboard accessibility
              if (el) {
                const first = el.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
                first?.focus()
              }
            }}
            role="menu"
            aria-label="Map actions"
            className="absolute z-20 min-w-[240px] max-h-[min(420px,80vh)] overflow-y-auto rounded-lg bg-background/95 backdrop-blur-md border border-border/60 shadow-xl ring-1 ring-black/10 p-1"
            style={{
              left: contextMenu.screenX,
              top: contextMenu.screenY,
              transform: [
                contextMenu.screenX > (canvasSize.width || 800) - 240 ? 'translateX(-100%)' : '',
                contextMenu.screenY > (canvasSize.height || 600) - 420 ? 'translateY(-100%)' : '',
              ].filter(Boolean).join(' ') || undefined,
              animation: 'popoverEnter 0.15s ease-out',
            }}
            onKeyDown={(e) => {
              const items = e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
              const focused = document.activeElement as HTMLElement
              const idx = Array.from(items).indexOf(focused as HTMLButtonElement)
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                items[(idx + 1) % items.length]?.focus()
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                items[(idx - 1 + items.length) % items.length]?.focus()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setContextMenu(null)
              }
            }}
          >
            <div className="px-2 py-1 text-[11px] font-mono text-muted-foreground/50 border-b border-border/20 tabular-nums select-none">
              {Math.round(contextMenu.worldX)}, {Math.round(contextMenu.worldY)}
            </div>

            {contextMenu.player && (
              <>
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border/20 truncate select-none">
                  Player: <strong className="text-foreground">{contextMenu.player.username}</strong>
                </div>
                <ContextMenuItem
                  icon={<Heart className="w-3.5 h-3.5" />}
                  label="Heal player"
                  onClick={() => {
                    panelBridgeApi.sendCommand('healPlayer', { username: contextMenu.player!.username })
                      .then(() => { toast({ title: 'Healed', description: `${contextMenu.player!.username} healed` }); fetchPlayerPositions() })
                      .catch(() => toast({ title: 'Error', variant: 'destructive' }))
                    setContextMenu(null)
                  }}
                />
              </>
            )}

            <div className="border-t border-border/20 pt-0.5">
              <ContextMenuItem
                icon={<CloudLightning className="w-3.5 h-3.5" />}
                label="Lightning strike"
                loading={actionLoading === 'lightning'}
                onClick={() => triggerLightningAt(contextMenu.worldX, contextMenu.worldY)}
              />
              <ContextMenuItem
                icon={<Volume2 className="w-3.5 h-3.5" />}
                label="Create noise"
                loading={actionLoading === 'noise'}
                onClick={() => createNoiseAt(contextMenu.worldX, contextMenu.worldY)}
              />
            </div>

            <div className="border-t border-border/20 pt-0.5">
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-amber-500/70 font-semibold select-none">
                Airdrop
              </div>
              {AIRDROP_PRESETS.map((preset) => (
                <ContextMenuItem
                  key={preset.id}
                  icon={<preset.icon className="w-3.5 h-3.5" />}
                  label={preset.label}
                  description={preset.desc}
                  loading={actionLoading === 'airdrop'}
                  disabled={!bridgeConnected}
                  onClick={() => callAirdrop(contextMenu.worldX, contextMenu.worldY, preset.id)}
                />
              ))}
              {!bridgeConnected && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground/50 italic flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500/60 flex-none" />
                  Bridge offline — drops unavailable
                </div>
              )}
            </div>
          </div>
        )}

        {/* Canvas */}
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: 'calc(100vh - 180px)', minHeight: '500px' }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label="World map showing Knox County with player positions. Use arrow keys to pan, plus/minus to zoom."
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onContextMenu={handleContextMenu}
            onKeyDown={handleKeyDown}
            className={cn('block w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-primary/50', isDragging ? 'cursor-grabbing' : hoveredPlayer ? 'cursor-pointer' : 'cursor-grab')}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────
function ContextMenuItem({ icon, label, onClick, loading, description, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; loading?: boolean; description?: string; disabled?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={loading || disabled}
      title={description}
      className="w-full px-2 py-1.5 text-xs flex items-center gap-2.5 rounded-md hover:bg-muted/60 active:bg-muted/80 transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:bg-muted/60 focus-visible:outline-none"
    >
      {loading
        ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-none" />
        : <span className="flex-none w-4 flex items-center justify-center">{icon}</span>}
      <span className="flex flex-col min-w-0 text-left">
        <span className="truncate">{label}</span>
        {description && <span className="text-[10px] text-muted-foreground/60 truncate leading-tight">{description}</span>}
      </span>
    </button>
  )
}

function getPlayerColor(player: MapPlayer, alpha: number): string {
  if (!player.isAlive && player.isAlive !== undefined) return `rgba(120,120,120,${alpha})`
  if (player.isInfected) return `rgba(248,113,113,${alpha})`
  if (player.accessLevel && player.accessLevel !== '' && player.accessLevel !== 'none')
    return `rgba(251,191,36,${alpha})`
  return `rgba(96,165,250,${alpha})`
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, points: number) {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? r : r * 0.5
    const angle = (Math.PI * 2 * i) / (points * 2) - Math.PI / 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Game tile → DZI full-res pixel (isometric projection)
function gameTileToDzi(gx: number, gy: number, cfg: MapConfig) {
  return {
    x: cfg.isoX0 + (gx - gy) * cfg.isoHalfSqr,
    y: cfg.isoY0 + (gx + gy) * cfg.isoQuarterSqr,
  }
}

// DZI full-res pixel → game tile (inverse isometric)
function dziToGameTile(dziX: number, dziY: number, cfg: MapConfig) {
  const dx = dziX - cfg.isoX0
  const dy = dziY - cfg.isoY0
  return {
    x: dx / (2 * cfg.isoHalfSqr) + dy / (2 * cfg.isoQuarterSqr),
    y: -dx / (2 * cfg.isoHalfSqr) + dy / (2 * cfg.isoQuarterSqr),
  }
}
