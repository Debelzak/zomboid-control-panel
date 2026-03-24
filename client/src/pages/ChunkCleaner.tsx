import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { 
  Map, 
  Trash2, 
  RefreshCw,
  AlertTriangle,
  Save,
  ZoomIn,
  ZoomOut,
  Move,
  Square,
  Info,
  Database,
  FileBox,
  Maximize,
  Image,
  ImageOff,
  FolderOpen
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/use-toast'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { chunksApi, serversApi } from '@/lib/api'

interface SaveInfo {
  name: string
  modified: string
  chunkCount: number
  size: number
  sizeFormatted: string
}

interface ChunkInfo {
  file: string
  x: number
  y: number
  size: number
  modified: string
  source?: string
}

interface ChunkBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface SaveStats {
  saveName: string
  totalSize: number
  totalSizeFormatted: string
  folders: Record<string, { fileCount: number; size: number; sizeFormatted: string }>
  playersDbSize?: number
  vehiclesDbSize?: number
}

// Camera: screenX = worldX * scale + offset.x
// Each chunk occupies 1x1 in world space (world unit = 1 chunk)
const MIN_SCALE = 0.1    // px per chunk (zoomed way out)
const MAX_SCALE = 60     // px per chunk (zoomed way in)
const MIN_FIT_SCALE = 2  // minimum px/chunk when auto-fitting — chunks must be visible
const MAP_TILE_SIZE = 100 // each grabofus tile covers 100x100 chunks
const MAP_TILES_CDN = 'https://grabofus.github.io/zomboid-chunk-cleaner/assets'

// B42 DZI map tiles from b42map.com (pzmap2dzi top-down view)
const B42_DZI_CDN = 'https://b42map.com/map_data/base_top'
const B42_DZI_FULL_W = 19968   // full-resolution image width in pixels
const B42_DZI_FULL_H = 16128   // full-resolution image height in pixels
const B42_DZI_TILE_PX = 256    // DZI tile size in pixels
const B42_DZI_MAX_LEVEL = 15   // ceil(log2(max(W,H)))
// B42: 1 PZ cell = 256 tiles, pzmap2dzi renders 256 px/cell → 1 tile = 1 DZI px
// After B42→B41 conversion (×0.8), 1 B41-equiv chunk = 10 DZI px
const B42_CHUNK_TO_DZI_PX = 10

// Known PZ city / landmark positions (in chunk coordinates)
// Derived from map.projectzomboid.com overlays.json POI centroids (game-tile ÷ 10)
const PZ_LANDMARKS: { name: string; x: number; y: number }[] = [
  { name: 'Muldraugh',      x: 1063, y:  980 },
  { name: 'West Point',     x: 1190, y:  690 },
  { name: 'Rosewood',       x:  809, y: 1150 },
  { name: 'Riverside',      x:  610, y:  540 },
  { name: 'Louisville',     x: 1270, y:  170 },
  { name: 'March Ridge',    x: 1010, y: 1270 },
  { name: 'Valley Station', x: 1320, y:  530 },
]

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export default function ChunkCleaner() {
  const [saves, setSaves] = useState<SaveInfo[]>([])
  const [selectedSave, setSelectedSave] = useState<string>('')
  const [chunks, setChunks] = useState<ChunkInfo[]>([])
  const [bounds, setBounds] = useState<ChunkBounds | null>(null)
  const [stats, setStats] = useState<SaveStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingSaves, setLoadingSaves] = useState(false)
  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set())
  const { toast } = useToast()
  
  // Custom path override for manual folder navigation
  const [customPath, setCustomPath] = useState<string>('')
  const [customPathInput, setCustomPathInput] = useState<string>('')
  const [debugInfo, setDebugInfo] = useState<{ zomboidDataPath?: string; savesPath?: string; exists?: boolean } | null>(null)
  
  // Canvas refs  
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  
  // Camera state: screen = world * scale + offset
  const [scale, setScale] = useState(4)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  
  // Interaction state
  const [tool, setTool] = useState<'select' | 'pan'>('select')
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null)
  
  // Hover state as ref (avoids re-render on every mouse move)
  const hoverWorldRef = useRef<{ x: number; y: number } | null>(null)
  const drawRequestRef = useRef(0)
  
  // Map tile state
  const [showMap, setShowMap] = useState(true)
  const tileCacheRef = useRef<Record<string, HTMLImageElement | null>>({})
  const tileLoadCountRef = useRef(0)
  
  // UI collapse states
  const [showCustomPath, setShowCustomPath] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  
  // Chunk limit warning
  const [limitReached, setLimitReached] = useState(false)
  
  // Guard against stale chunk-load responses when user switches saves quickly
  const loadIdRef = useRef(0)
  
  // B42 save detection
  const [isB42Save, setIsB42Save] = useState(false)
  
  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createBackup, setCreateBackup] = useState(true)
  const [deleting, setDeleting] = useState(false)

  // O(1) chunk lookup by coordinate key "x_y"
  const chunkMap = useMemo(() => {
    const lookup: Record<string, ChunkInfo> = {}
    for (const chunk of chunks) lookup[`${chunk.x}_${chunk.y}`] = chunk
    return lookup
  }, [chunks])

  // Total size of selected chunks (memoized for display)
  const selectedSize = useMemo(() => {
    let total = 0
    for (const chunk of chunks) {
      if (selectedChunks.has(`${chunk.x}_${chunk.y}`)) total += chunk.size || 0
    }
    return total
  }, [chunks, selectedChunks])

  // Whether the canvas container is in the DOM
  const hasCanvas = !!selectedSave && !loading && chunks.length > 0
  const hasSaves = saves.length > 0
  const activePathLabel = customPath || debugInfo?.zomboidDataPath || 'Active server data path'

  // ─── Coordinate transforms ───
  const screenToWorld = useCallback((sx: number, sy: number) => ({
    x: (sx - offset.x) / scale,
    y: (sy - offset.y) / scale
  }), [scale, offset])
  
  const getCanvasMousePos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  // ─── Data loading ───
  const fetchSaves = useCallback(async (pathOverride?: string) => {
    setLoadingSaves(true)
    try {
      const pathToUse = pathOverride ?? (customPath || undefined)
      const result = await chunksApi.getSaves(pathToUse)
      setSaves(result.saves || [])
      if (result.debug) setDebugInfo(result.debug)
      return result.saves || []
    } catch (error) {
      toast({
        title: 'Could not load saves',
        description: error instanceof Error ? error.message : 'Failed to load save folders.',
        variant: 'destructive',
      })
      return []
    } finally {
      setLoadingSaves(false)
    }
  }, [customPath, toast])

  // On mount: fetch saves and auto-select the active server's save
  useEffect(() => {
    (async () => {
      const savesList = await fetchSaves()
      if (savesList.length === 0) return
      try {
        const { server } = await serversApi.getActive()
        if (server?.serverName) {
          const match = savesList.find((s: SaveInfo) => s.name === server.serverName)
          if (match) setSelectedSave(match.name)
        }
      } catch {
        // No active server configured — user picks manually
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyCustomPath = useCallback(async () => {
    const nextPath = customPathInput.trim()
    if (!nextPath) return
    setCustomPath(nextPath)
    setSelectedSave('')
    await fetchSaves(nextPath)
  }, [customPathInput, fetchSaves])

  const resetToDefaultPath = useCallback(async () => {
    setCustomPath('')
    setCustomPathInput('')
    setSelectedSave('')
    setDebugInfo(null)
    await fetchSaves('')
  }, [fetchSaves])

  const loadChunks = useCallback(async () => {
    if (!selectedSave) return
    const thisLoadId = ++loadIdRef.current
    setLoading(true)
    setChunks([])
    setBounds(null)
    setStats(null)
    setSelectedChunks(new Set())
    setLimitReached(false)
    
    try {
      const pathToUse = customPath || undefined
      // Load chunks and stats independently so a stats failure doesn't block the map
      const [chunksSettled, statsSettled] = await Promise.allSettled([
        chunksApi.getChunks(selectedSave, pathToUse),
        chunksApi.getStats(selectedSave, pathToUse)
      ])
      
      // Discard stale response if user switched saves while loading
      if (thisLoadId !== loadIdRef.current) return
      
      if (chunksSettled.status === 'rejected') {
        throw chunksSettled.reason
      }
      const chunksResult = chunksSettled.value
      const statsResult = statsSettled.status === 'fulfilled' ? statsSettled.value : null
      
      // B42 saves use map/{X}/{Y}.bin with 8×8 tile chunks.
      // B41 saves use flat files with 10×10 tile chunks.
      // The grabofus map tiles use B41 chunk space (1 chunk = 10 tiles).
      // Convert B42 → B41: multiply by 0.8  (8/10).
      // The 'file' field is preserved unchanged for deletion operations.
      const rawChunks: ChunkInfo[] = Array.isArray(chunksResult.chunks) ? chunksResult.chunks : []
      const isB42 = chunksResult.isB42 === true || (rawChunks.length > 0 && rawChunks[0].file?.includes('/'))
      setIsB42Save(isB42)
      if (isB42 && rawChunks.length > 0) {
        for (const c of rawChunks) {
          c.x = Math.floor(c.x * 8 / 10)
          c.y = Math.floor(c.y * 8 / 10)
        }
        // Recompute bounds from converted coords
        if (chunksResult.bounds) {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
          for (const c of rawChunks) {
            minX = Math.min(minX, c.x)
            maxX = Math.max(maxX, c.x)
            minY = Math.min(minY, c.y)
            maxY = Math.max(maxY, c.y)
          }
          chunksResult.bounds = { minX, maxX, minY, maxY }
        }
      }
      setChunks(rawChunks)
      setBounds(chunksResult.bounds ?? null)
      setStats(statsResult)
      setLimitReached(chunksResult.limitReached === true)
    } catch (error) {
      if (thisLoadId !== loadIdRef.current) return
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load chunks',
        variant: 'destructive',
      })
    } finally {
      if (thisLoadId === loadIdRef.current) setLoading(false)
    }
  }, [selectedSave, customPath, toast])

  useEffect(() => {
    if (selectedSave) loadChunks()
  }, [selectedSave, loadChunks])

  // ─── Fit view to show all chunks ───
  const fitView = useCallback(() => {
    if (!chunks.length) return

    // Use canvasSize if available, otherwise read container dimensions directly
    let W = canvasSize.width
    let H = canvasSize.height
    if (W === 0 || H === 0) {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      W = Math.floor(rect.width)
      H = Math.floor(rect.height)
      if (W === 0 || H === 0) return
      setCanvasSize({ width: W, height: H })
    }

    // Use P5/P95 percentile bounds to exclude outliers that stretch the view
    const xs = chunks.map(c => c.x).sort((a, b) => a - b)
    const ys = chunks.map(c => c.y).sort((a, b) => a - b)
    const p5 = Math.floor(chunks.length * 0.02)
    const p95 = Math.min(chunks.length - 1, Math.floor(chunks.length * 0.98))
    const fitMinX = xs[p5]
    const fitMaxX = xs[p95]
    const fitMinY = ys[p5]
    const fitMaxY = ys[p95]

    const rangeX = fitMaxX - fitMinX + 1
    const rangeY = fitMaxY - fitMinY + 1
    const padding = 50
    const fitScale = Math.min(
      (W - padding * 2) / rangeX,
      (H - padding * 2) / rangeY
    )
    // Enforce MIN_FIT_SCALE so chunks are always visible (at least 2px each)
    // If the data is too spread out to show everything at 2px/chunk, we zoom
    // to the densest area and the user can pan to see outliers.
    const newScale = Math.max(MIN_FIT_SCALE, Math.min(MAX_SCALE, fitScale))
    const centerX = (fitMinX + fitMaxX + 1) / 2
    const centerY = (fitMinY + fitMaxY + 1) / 2
    setScale(newScale)
    setOffset({
      x: W / 2 - centerX * newScale,
      y: H / 2 - centerY * newScale
    })
  }, [chunks, canvasSize])

  // Auto-fit when chunks load or canvas resizes
  useEffect(() => { fitView() }, [fitView])

  // Safety net: re-fit after a frame when canvas container appears
  useEffect(() => {
    if (!bounds || !hasCanvas) return
    const id = requestAnimationFrame(() => fitView())
    return () => cancelAnimationFrame(id)
  }, [bounds, hasCanvas, fitView])

  // ─── Canvas resize observer ───
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setCanvasSize({ width: Math.floor(width), height: Math.floor(height) })
        }
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [hasCanvas])

  // ─── Map tile loading (lazy, on-demand) ───
  const MAX_TILE_CACHE = 512
  const loadMapTile = useCallback((tileX: number, tileY: number) => {
    const key = `${tileX}_${tileY}`
    if (key in tileCacheRef.current) return
    // Evict oldest entries when cache exceeds limit
    const keys = Object.keys(tileCacheRef.current)
    if (keys.length >= MAX_TILE_CACHE) {
      const toRemove = keys.slice(0, keys.length - MAX_TILE_CACHE + 64)
      for (const k of toRemove) delete tileCacheRef.current[k]
    }
    tileCacheRef.current[key] = null // mark as loading
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      tileCacheRef.current[key] = img
      tileLoadCountRef.current++
      // Trigger a redraw when tile loads
      if (drawRequestRef.current === 0) {
        drawRequestRef.current = requestAnimationFrame(() => { drawRequestRef.current = 0 })
      }
    }
    img.onerror = () => { /* tile missing, keep null */ }
    img.src = `${MAP_TILES_CDN}/map_${tileX}_${tileY}.png`
  }, [])

  // ─── B42 DZI tile loading ───
  const dziCacheRef = useRef<Record<string, HTMLImageElement | null>>({})
  const loadDziTile = useCallback((level: number, col: number, row: number) => {
    const key = `dzi_${level}_${col}_${row}`
    if (key in dziCacheRef.current) return
    const keys = Object.keys(dziCacheRef.current)
    if (keys.length >= MAX_TILE_CACHE) {
      const toRemove = keys.slice(0, keys.length - MAX_TILE_CACHE + 64)
      for (const k of toRemove) delete dziCacheRef.current[k]
    }
    dziCacheRef.current[key] = null
    const img = new window.Image()
    img.onload = () => {
      dziCacheRef.current[key] = img
      if (drawRequestRef.current === 0) {
        drawRequestRef.current = requestAnimationFrame(() => { drawRequestRef.current = 0 })
      }
    }
    img.onerror = () => { /* tile missing */ }
    img.src = `${B42_DZI_CDN}/layer0_files/${level}/${col}_${row}.webp`
  }, [])

  // ─── Canvas draw (extracted to callable function for rAF use) ───
  const drawCanvasRef = useRef<() => void>(() => {})
  
  useEffect(() => {
    drawCanvasRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return
      
      canvas.width = canvasSize.width
      canvas.height = canvasSize.height
      
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      
      const W = canvasSize.width
      const H = canvasSize.height
      
      // Read theme colors from CSS custom properties
      const style = getComputedStyle(canvas)
      const cssVar = (name: string) => style.getPropertyValue(name).trim()
      const bgVar = cssVar('--background')
      const primaryVar = cssVar('--primary') || '217 91% 60%'
      const destructiveVar = cssVar('--destructive') || '0 70% 50%'
      const mutedFgVar = cssVar('--muted-foreground') || '215 14% 55%'
      const foregroundVar = cssVar('--foreground') || '210 11% 90%'
      const warningVar = cssVar('--warning') || '28 80% 55%'
      const hsl = (v: string, a: number) => `hsl(${v} / ${a})`

      const canvasBg = bgVar ? `hsl(${bgVar})` : hsl('228 30% 7%', 1)
      
      // Dark background
      ctx.fillStyle = canvasBg
      ctx.fillRect(0, 0, W, H)
      
      if (!bounds || chunks.length === 0) return
      
      // Visible world bounds (with 1-chunk margin)
      const visMinX = Math.floor(-offset.x / scale) - 1
      const visMaxX = Math.ceil((W - offset.x) / scale) + 1
      const visMinY = Math.floor(-offset.y / scale) - 1
      const visMaxY = Math.ceil((H - offset.y) / scale) + 1
      
      // ── Map tiles ──
      if (showMap) {
        ctx.save()
        ctx.globalAlpha = 0.6
        
        if (isB42Save) {
          // ── B42 DZI tiles from b42map.com ──
          // Choose DZI level: want ~1 DZI pixel ≈ 1 screen pixel
          // 1 B41-equiv chunk on screen = `scale` px; 1 B41-equiv chunk = B42_CHUNK_TO_DZI_PX full DZI px
          // At level L, levelScale = 2^(maxLevel-L), so 1 DZI pixel at level L = levelScale full-res px
          // Ideal: levelScale = B42_CHUNK_TO_DZI_PX / scale
          const idealLevel = B42_DZI_MAX_LEVEL - Math.log2(B42_CHUNK_TO_DZI_PX / Math.max(scale, 0.01))
          const level = Math.max(0, Math.min(B42_DZI_MAX_LEVEL, Math.round(idealLevel)))
          const levelScale = Math.pow(2, B42_DZI_MAX_LEVEL - level)
          
          const levelW = Math.ceil(B42_DZI_FULL_W / levelScale)
          const levelH = Math.ceil(B42_DZI_FULL_H / levelScale)
          const numCols = Math.ceil(levelW / B42_DZI_TILE_PX)
          const numRows = Math.ceil(levelH / B42_DZI_TILE_PX)
          
          // Convert visible chunk bounds → DZI pixel bounds at this level
          const pixMinX = visMinX * B42_CHUNK_TO_DZI_PX / levelScale
          const pixMinY = visMinY * B42_CHUNK_TO_DZI_PX / levelScale
          const pixMaxX = visMaxX * B42_CHUNK_TO_DZI_PX / levelScale
          const pixMaxY = visMaxY * B42_CHUNK_TO_DZI_PX / levelScale
          
          const colMin = Math.max(0, Math.floor(pixMinX / B42_DZI_TILE_PX))
          const colMax = Math.min(numCols - 1, Math.floor(pixMaxX / B42_DZI_TILE_PX))
          const rowMin = Math.max(0, Math.floor(pixMinY / B42_DZI_TILE_PX))
          const rowMax = Math.min(numRows - 1, Math.floor(pixMaxY / B42_DZI_TILE_PX))
          
          // Chunks covered by one DZI pixel at this level
          const chunkPerDziPx = levelScale / B42_CHUNK_TO_DZI_PX
          
          for (let row = rowMin; row <= rowMax; row++) {
            for (let col = colMin; col <= colMax; col++) {
              loadDziTile(level, col, row)
              const img = dziCacheRef.current[`dzi_${level}_${col}_${row}`]
              if (img) {
                // This DZI tile starts at chunk coordinate:
                const tileChunkX = col * B42_DZI_TILE_PX * chunkPerDziPx
                const tileChunkY = row * B42_DZI_TILE_PX * chunkPerDziPx
                // Actual tile pixel dimensions (last tile in row/col may be smaller)
                const actualTileW = Math.min(B42_DZI_TILE_PX, levelW - col * B42_DZI_TILE_PX)
                const actualTileH = Math.min(B42_DZI_TILE_PX, levelH - row * B42_DZI_TILE_PX)
                const chunkW = actualTileW * chunkPerDziPx
                const chunkH = actualTileH * chunkPerDziPx
                
                const sx = tileChunkX * scale + offset.x
                const sy = tileChunkY * scale + offset.y
                const sw = chunkW * scale
                const sh = chunkH * scale
                ctx.drawImage(img, sx, sy, sw, sh)
              }
            }
          }
        } else {
          // ── B41 grabofus tiles ──
          const minTX = Math.floor(visMinX / MAP_TILE_SIZE)
          const maxTX = Math.floor(visMaxX / MAP_TILE_SIZE)
          const minTY = Math.floor(visMinY / MAP_TILE_SIZE)
          const maxTY = Math.floor(visMaxY / MAP_TILE_SIZE)
          
          for (let ty = minTY; ty <= maxTY; ty++) {
            for (let tx = minTX; tx <= maxTX; tx++) {
              loadMapTile(tx, ty)
              const img = tileCacheRef.current[`${tx}_${ty}`]
              if (img) {
                const sx = tx * MAP_TILE_SIZE * scale + offset.x
                const sy = ty * MAP_TILE_SIZE * scale + offset.y
                const sw = MAP_TILE_SIZE * scale
                ctx.drawImage(img, sx, sy, sw, sw)
              }
            }
          }
        }
        
        ctx.restore()
      }
      
      // ── Tile grid lines (every 100 chunks — B41 tile boundaries) ──
      if (showMap && !isB42Save && scale > 1) {
        const tileGridMinX = Math.floor(visMinX / MAP_TILE_SIZE) * MAP_TILE_SIZE
        const tileGridMaxX = Math.ceil(visMaxX / MAP_TILE_SIZE) * MAP_TILE_SIZE
        const tileGridMinY = Math.floor(visMinY / MAP_TILE_SIZE) * MAP_TILE_SIZE
        const tileGridMaxY = Math.ceil(visMaxY / MAP_TILE_SIZE) * MAP_TILE_SIZE
        
        ctx.strokeStyle = hsl(primaryVar, 0.25)
        ctx.lineWidth = 1
        for (let x = tileGridMinX; x <= tileGridMaxX; x += MAP_TILE_SIZE) {
          const sx = Math.floor(x * scale + offset.x) + 0.5
          if (sx >= 0 && sx <= W) {
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke()
          }
        }
        for (let y = tileGridMinY; y <= tileGridMaxY; y += MAP_TILE_SIZE) {
          const sy = Math.floor(y * scale + offset.y) + 0.5
          if (sy >= 0 && sy <= H) {
            ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke()
          }
        }
      }
      
      // ── City / landmark markers ──
      // Always shown — helps users orient themselves regardless of tile background
      {
        const markerSize = Math.max(6, Math.min(14, scale * 3))
        const fontSize = Math.max(9, Math.min(13, scale * 2.5))
        ctx.font = `bold ${fontSize}px sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        
        for (const lm of PZ_LANDMARKS) {
          const sx = lm.x * scale + offset.x
          const sy = lm.y * scale + offset.y
          // Skip if off screen
          if (sx < -100 || sx > W + 100 || sy < -50 || sy > H + 50) continue
          
          // Diamond marker
          const half = markerSize / 2
          ctx.fillStyle = hsl(primaryVar, 0.85)
          ctx.beginPath()
          ctx.moveTo(sx, sy - half)
          ctx.lineTo(sx + half, sy)
          ctx.lineTo(sx, sy + half)
          ctx.lineTo(sx - half, sy)
          ctx.closePath()
          ctx.fill()
          
          // White border
          ctx.strokeStyle = hsl(foregroundVar, 0.7)
          ctx.lineWidth = 1
          ctx.stroke()
          
          // Label with shadow
          const labelX = sx + half + 4
          ctx.fillStyle = hsl(bgVar || '0 0% 0%', 0.6)
          ctx.fillText(lm.name, labelX + 1, sy + 1)
          ctx.fillStyle = hsl(foregroundVar, 0.95)
          ctx.fillText(lm.name, labelX, sy)
        }
      }
      
      // ── Grid lines (only when zoomed in enough) ──
      if (scale > 4) {
        ctx.strokeStyle = hsl(foregroundVar, 0.06)
        ctx.lineWidth = 1
        
        const gridMinX = Math.max(bounds.minX, visMinX)
        const gridMaxX = Math.min(bounds.maxX + 1, visMaxX)
        const gridMinY = Math.max(bounds.minY, visMinY)
        const gridMaxY = Math.min(bounds.maxY + 1, visMaxY)
        
        for (let x = gridMinX; x <= gridMaxX; x++) {
          const sx = Math.floor(x * scale + offset.x) + 0.5
          if (sx >= 0 && sx <= W) {
            ctx.beginPath()
            ctx.moveTo(sx, 0)
            ctx.lineTo(sx, H)
            ctx.stroke()
          }
        }
        for (let y = gridMinY; y <= gridMaxY; y++) {
          const sy = Math.floor(y * scale + offset.y) + 0.5
          if (sy >= 0 && sy <= H) {
            ctx.beginPath()
            ctx.moveTo(0, sy)
            ctx.lineTo(W, sy)
            ctx.stroke()
          }
        }
      }
      
      // ── Draw chunks ──
      // Translucent fill so the map underneath remains visible
      for (const chunk of chunks) {
        if (chunk.x + 1 < visMinX || chunk.x > visMaxX || chunk.y + 1 < visMinY || chunk.y > visMaxY) continue
        
        const sx = chunk.x * scale + offset.x
        const sy = chunk.y * scale + offset.y
        const key = `${chunk.x}_${chunk.y}`
        const isSelected = selectedChunks.has(key)
        const sz = Math.max(scale, 1) // never go below 1px
        
        if (isSelected) {
          ctx.fillStyle = hsl(destructiveVar, 0.5)
        } else {
          const ratio = Math.min(chunk.size / 50000, 1)
          const r = Math.floor(240 + (1 - ratio) * 15)
          const g = Math.floor(130 + (1 - ratio) * 70)
          const b = Math.floor(15 + (1 - ratio) * 15)
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`
        }
        
        if (scale > 4) {
          const gap = Math.max(0.5, scale * 0.06)
          ctx.fillRect(sx + gap, sy + gap, scale - gap * 2, scale - gap * 2)
          // Thin border for definition against the map
          if (isSelected) {
            ctx.strokeStyle = hsl(destructiveVar, 0.8)
          } else {
            ctx.strokeStyle = `rgba(${Math.floor(240 + (1 - Math.min(chunk.size / 50000, 1)) * 15)}, ${Math.floor(130 + (1 - Math.min(chunk.size / 50000, 1)) * 70)}, 20, 0.6)`
          }
          ctx.lineWidth = 1
          ctx.strokeRect(sx + gap, sy + gap, scale - gap * 2, scale - gap * 2)
        } else {
          ctx.fillRect(sx, sy, sz, sz)
        }
      }
      
      // ── Chunk region outline (boundary of the data area) ──
      if (bounds) {
        const bx = bounds.minX * scale + offset.x
        const by = bounds.minY * scale + offset.y
        const bw = (bounds.maxX - bounds.minX + 1) * scale
        const bh = (bounds.maxY - bounds.minY + 1) * scale
        ctx.strokeStyle = hsl(warningVar, 0.5)
        ctx.lineWidth = 1.5
        ctx.setLineDash([6, 4])
        ctx.strokeRect(bx, by, bw, bh)
        ctx.setLineDash([])
      }
      
      // ── Coordinate labels (when zoomed in) ──
      if (scale > 18) {
        const fontSize = Math.min(10, scale * 0.5)
        ctx.font = `${fontSize}px monospace`
        ctx.fillStyle = hsl(mutedFgVar, 0.6)
        
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        for (let x = Math.max(bounds.minX, visMinX); x <= Math.min(bounds.maxX, visMaxX); x++) {
          const sx = (x + 0.5) * scale + offset.x
          if (sx >= 0 && sx <= W) {
            const tickY = bounds.minY * scale + offset.y - 3
            if (tickY > -20 && tickY < H) ctx.fillText(x.toString(), sx, tickY)
          }
        }
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        for (let y = Math.max(bounds.minY, visMinY); y <= Math.min(bounds.maxY, visMaxY); y++) {
          const sy = (y + 0.5) * scale + offset.y
          if (sy >= 0 && sy <= H) {
            const tickX = bounds.minX * scale + offset.x - 4
            if (tickX > -60 && tickX < W) ctx.fillText(y.toString(), tickX, sy)
          }
        }
      }
      
      // ── Selection rectangle ──
      if (selectionStart && selectionEnd) {
        const wsx = Math.min(selectionStart.x, selectionEnd.x)
        const wsy = Math.min(selectionStart.y, selectionEnd.y)
        const wex = Math.max(selectionStart.x, selectionEnd.x)
        const wey = Math.max(selectionStart.y, selectionEnd.y)
        
        const s1x = selectionStart.x * scale + offset.x
        const s1y = selectionStart.y * scale + offset.y
        const s2x = selectionEnd.x * scale + offset.x
        const s2y = selectionEnd.y * scale + offset.y
        
        const rx = Math.min(s1x, s2x)
        const ry = Math.min(s1y, s2y)
        const rw = Math.abs(s2x - s1x)
        const rh = Math.abs(s2y - s1y)
        
        ctx.fillStyle = hsl(primaryVar, 0.15)
        ctx.fillRect(rx, ry, rw, rh)
        ctx.strokeStyle = hsl(primaryVar, 1)
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.setLineDash([])
        
        // Selection preview: count chunks in selection region
        let selCount = 0
        for (const c of chunks) {
          if (c.x + 1 > wsx && c.x < wex && c.y + 1 > wsy && c.y < wey) selCount++
        }
        
        if (selCount > 0 && rw > 30) {
          const selLabel = `${selCount} chunk${selCount !== 1 ? 's' : ''}`
          ctx.font = '11px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          const mx = rx + rw / 2
          const lm = ctx.measureText(selLabel)
          ctx.fillStyle = hsl(primaryVar, 0.9)
          const pw = lm.width + 10
          ctx.fillRect(mx - pw / 2, ry - 18, pw, 16)
          ctx.fillStyle = hsl(foregroundVar, 1)
          ctx.fillText(selLabel, mx, ry - 4)
        }
      }
      
      // ── Hover highlight ──
      const hover = hoverWorldRef.current
      if (hover) {
        const hx = Math.floor(hover.x)
        const hy = Math.floor(hover.y)
        const shx = hx * scale + offset.x
        const shy = hy * scale + offset.y
        
        ctx.strokeStyle = hsl(foregroundVar, 0.5)
        ctx.lineWidth = 1.5
        ctx.strokeRect(shx, shy, scale, scale)
      }
      
      // ── HUD: coordinates + zoom ──
      ctx.font = '11px monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      
      if (hover) {
        const hx = Math.floor(hover.x)
        const hy = Math.floor(hover.y)
        const hkey = `${hx}_${hy}`
        const hoverChunk = chunkMap[hkey]
        const hoverSel = selectedChunks.has(hkey)
        
        const cellX = Math.floor(hx / 30)
        const cellY = Math.floor(hy / 30)
        let label = `Chunk ${hx}, ${hy}  |  Cell ${cellX}, ${cellY}`
        if (hoverChunk) {
          label += ` | ${formatSize(hoverChunk.size)}${hoverSel ? ' | SELECTED' : ''}`
        }
        
        const metrics = ctx.measureText(label)
        ctx.fillStyle = hsl(bgVar || '0 0% 0%', 0.85)
        ctx.fillRect(6, H - 22, metrics.width + 12, 18)
        ctx.fillStyle = hsl(foregroundVar, 0.85)
        ctx.fillText(label, 12, H - 8)
      }
      
      ctx.textAlign = 'right'
      const zLabel = `${scale.toFixed(1)} px/chunk`
      const zm = ctx.measureText(zLabel)
      ctx.fillStyle = hsl(bgVar || '0 0% 0%', 0.7)
      ctx.fillRect(W - zm.width - 16, H - 22, zm.width + 12, 18)
      ctx.fillStyle = hsl(mutedFgVar, 0.7)
      ctx.fillText(zLabel, W - 10, H - 8)
      
      // ── Top-left bounds info ──
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      const cellMinX = Math.floor(bounds.minX / 30)
      const cellMinY = Math.floor(bounds.minY / 30)
      const cellMaxX = Math.floor(bounds.maxX / 30)
      const cellMaxY = Math.floor(bounds.maxY / 30)
      const boundsLabel = `Chunks ${bounds.minX}–${bounds.maxX}, ${bounds.minY}–${bounds.maxY}  (${chunks.length})  |  Cells ${cellMinX}–${cellMaxX}, ${cellMinY}–${cellMaxY}`
      const bm = ctx.measureText(boundsLabel)
      ctx.fillStyle = hsl(bgVar || '0 0% 0%', 0.7)
      ctx.fillRect(6, 6, bm.width + 12, 18)
      ctx.fillStyle = hsl(mutedFgVar, 0.7)
      ctx.fillText(boundsLabel, 12, 9)
      
      // Map overlay version indicator
      if (showMap) {
        const mapLabel = isB42Save ? 'Map: B42 (b42map.com)' : 'Map: B41'
        const mm = ctx.measureText(mapLabel)
        ctx.fillStyle = hsl(bgVar || '0 0% 0%', 0.7)
        ctx.fillRect(6, 26, mm.width + 12, 18)
        ctx.fillStyle = hsl(mutedFgVar, 0.7)
        ctx.fillText(mapLabel, 12, 29)
      }
    }
    
    // Initial draw
    drawCanvasRef.current()
  }, [chunks, chunkMap, bounds, scale, offset, selectedChunks, selectionStart, selectionEnd, canvasSize, showMap, loadMapTile, loadDziTile, isB42Save])

  // Schedule a canvas redraw via requestAnimationFrame (used by mouse handlers)
  const scheduleDraw = useCallback(() => {
    if (drawRequestRef.current) return
    drawRequestRef.current = requestAnimationFrame(() => {
      drawRequestRef.current = 0
      drawCanvasRef.current()
    })
  }, [])
  
  // Cleanup rAF on unmount
  useEffect(() => {
    return () => { if (drawRequestRef.current) cancelAnimationFrame(drawRequestRef.current) }
  }, [])

  // Prevent page scroll when wheeling over the canvas (React onWheel is passive)
  useEffect(() => {
    if (!hasCanvas) return
    const container = containerRef.current
    if (!container) return
    const preventScroll = (e: WheelEvent) => { e.preventDefault() }
    container.addEventListener('wheel', preventScroll, { passive: false })
    return () => container.removeEventListener('wheel', preventScroll)
  }, [hasCanvas])

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (deleteDialogOpen) return
      if (!selectedSave) return
      
      switch (e.key) {
        case 'Escape':
          setSelectionStart(null)
          setSelectionEnd(null)
          setSelectedChunks(new Set())
          break
        case 'Delete':
          if (selectedChunks.size > 0) setDeleteDialogOpen(true)
          break
        case '1':
          setTool('select')
          break
        case '2':
          setTool('pan')
          break
      }
    }
    
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedChunks.size, deleteDialogOpen, selectedSave])

  // ─── Mouse handlers ───
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const pos = getCanvasMousePos(e)
    
    if (tool === 'pan' || e.button === 1 || e.button === 2) {
      isPanningRef.current = true
      panStartRef.current = { x: pos.x, y: pos.y, ox: offset.x, oy: offset.y }
    } else if (tool === 'select' && e.button === 0) {
      const world = screenToWorld(pos.x, pos.y)
      setSelectionStart(world)
      setSelectionEnd(world)
    }
  }, [tool, offset, getCanvasMousePos, screenToWorld])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasMousePos(e)
    const world = screenToWorld(pos.x, pos.y)
    hoverWorldRef.current = world
    
    if (isPanningRef.current) {
      const dx = pos.x - panStartRef.current.x
      const dy = pos.y - panStartRef.current.y
      setOffset({ x: panStartRef.current.ox + dx, y: panStartRef.current.oy + dy })
    } else if (selectionStart) {
      setSelectionEnd(world)
    } else {
      // Only hover changed — redraw via rAF without re-rendering
      scheduleDraw()
    }
  }, [selectionStart, getCanvasMousePos, screenToWorld, scheduleDraw])

  // Commit a selection (shared by mouseUp and mouseLeave)
  const commitSelection = useCallback((shiftKey: boolean) => {
    if (!selectionStart || !selectionEnd) return
    
    const sx = Math.min(selectionStart.x, selectionEnd.x)
    const sy = Math.min(selectionStart.y, selectionEnd.y)
    const ex = Math.max(selectionStart.x, selectionEnd.x)
    const ey = Math.max(selectionStart.y, selectionEnd.y)
    
    // If selection area is very small (click), toggle the single chunk under cursor
    const isClick = Math.abs(ex - sx) < 0.5 && Math.abs(ey - sy) < 0.5
    
    setSelectedChunks(prev => {
      const newSelected = new Set(prev)
      
      if (isClick) {
        const cx = Math.floor((sx + ex) / 2)
        const cy = Math.floor((sy + ey) / 2)
        const key = `${cx}_${cy}`
        if (chunkMap[key]) {
          if (shiftKey || prev.has(key)) {
            newSelected.delete(key)
          } else {
            newSelected.add(key)
          }
        }
      } else {
        for (const chunk of chunks) {
          if (chunk.x + 1 > sx && chunk.x < ex && chunk.y + 1 > sy && chunk.y < ey) {
            const key = `${chunk.x}_${chunk.y}`
            if (shiftKey) {
              newSelected.delete(key)
            } else {
              newSelected.add(key)
            }
          }
        }
      }
      
      return newSelected
    })
    
    setSelectionStart(null)
    setSelectionEnd(null)
  }, [selectionStart, selectionEnd, chunks, chunkMap])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      return
    }
    
    commitSelection(e.shiftKey)
  }, [commitSelection])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const pos = getCanvasMousePos(e)
    const factor = e.deltaY > 0 ? 0.88 : 1.14
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor))
    
    // Zoom centered on mouse position
    const worldX = (pos.x - offset.x) / scale
    const worldY = (pos.y - offset.y) / scale
    setScale(newScale)
    setOffset({
      x: pos.x - worldX * newScale,
      y: pos.y - worldY * newScale
    })
  }, [scale, offset, getCanvasMousePos])

  const handleMouseLeave = useCallback(() => {
    hoverWorldRef.current = null
    if (isPanningRef.current) {
      isPanningRef.current = false
    }
    // Commit selection if one was in progress (don't lose the work)
    if (selectionStart && selectionEnd) {
      commitSelection(false)
    }
    scheduleDraw()
  }, [selectionStart, selectionEnd, commitSelection, scheduleDraw])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  // ─── Delete handlers ───
  const handleDelete = async () => {
    if (selectedChunks.size === 0) return
    
    setDeleting(true)
    try {
      const chunksToDelete = chunks
        .filter(c => selectedChunks.has(`${c.x}_${c.y}`))
        .map(c => ({ file: c.file, x: c.x, y: c.y, source: c.source }))
      
      const result = await chunksApi.deleteChunks(selectedSave, chunksToDelete, createBackup, customPath || undefined)
      
      toast({
        title: 'Chunks Deleted',
        description: `Deleted ${result.deleted ?? 0} chunks${createBackup ? ' (backup created)' : ''}`,    
      })
      
      setDeleteDialogOpen(false)
      setSelectedChunks(new Set())
      await loadChunks()
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete chunks',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  const selectAll = () => setSelectedChunks(new Set(chunks.map(c => `${c.x}_${c.y}`)))
  const clearSelection = () => setSelectedChunks(new Set())
  const invertSelection = () => {
    const all = new Set(chunks.map(c => `${c.x}_${c.y}`))
    const inverted = new Set<string>()
    for (const key of all) {
      if (!selectedChunks.has(key)) inverted.add(key)
    }
    setSelectedChunks(inverted)
  }

  return (
    <TooltipProvider>
      <div className="space-y-5 page-transition">
        {/* Header + compact warning */}
        <div className="space-y-3">
          <PageHeader
            title="Chunk Cleaner"
            description="Reset damaged or over-looted map areas so the world can regenerate cleanly"
            icon={<Map className="w-5 h-5" />}
          />
          <p className="flex items-center gap-2 text-xs text-warning/90">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Deleting chunks resets those areas — constructions, loot, and zombies will be lost. Stop the server first and keep backups enabled.
          </p>

          {/* Limit Warning */}
          {limitReached && (
            <div className="flex items-center gap-2.5 rounded-md border border-warning/25 bg-warning/8 px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 text-warning" />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-warning">Chunk limit reached</span> — Only {chunks.length.toLocaleString()} chunks shown. Use region delete for larger areas.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Left Panel - Controls */}
          <div className="space-y-3 order-2 lg:order-1">
            {/* Save Selection */}
            <Card>
              <CardHeader className="px-4 py-3 pb-0">
                <CardTitle className="text-xs font-medium flex items-center gap-2 text-muted-foreground">
                  <Save className="w-3.5 h-3.5" />
                  Save
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-2 space-y-2.5">
                <Select value={selectedSave} onValueChange={setSelectedSave}>
                  <SelectTrigger disabled={loadingSaves} className="h-9">
                    <SelectValue placeholder={loadingSaves ? 'Loading saves...' : 'Choose a save...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {saves.map(save => (
                      <SelectItem key={save.name} value={save.name}>
                        <div className="flex items-center justify-between w-full">
                          <span>{save.name}</span>
                          <Badge variant="secondary" className="ml-2 text-xs">
                            {save.sizeFormatted}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full h-8 text-xs"
                  onClick={() => fetchSaves()}
                  disabled={loadingSaves}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingSaves ? 'animate-spin' : ''}`} />
                  {loadingSaves ? 'Refreshing...' : 'Refresh'}
                </Button>
                
                {/* Custom path — collapsible */}
                <Collapsible open={showCustomPath} onOpenChange={setShowCustomPath}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-1.5 w-full text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors pt-1">
                      <FolderOpen className="w-3 h-3" />
                      <span>{showCustomPath ? 'Hide' : 'Custom path...'}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pt-2">
                    <div className="flex gap-1.5">
                      <Input
                        value={customPathInput}
                        onChange={(e) => setCustomPathInput(e.target.value)}
                        placeholder="e.g. /home/user/Zomboid"
                        className="text-xs h-7"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customPathInput.trim()) {
                            void applyCustomPath()
                          }
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 shrink-0 text-xs"
                        onClick={() => void applyCustomPath()}
                        disabled={!customPathInput.trim() || loadingSaves}
                      >
                        Load
                      </Button>
                    </div>
                    {customPath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full h-6 text-[10px] text-muted-foreground"
                        onClick={() => void resetToDefaultPath()}
                        disabled={loadingSaves}
                      >
                        Reset to default path
                      </Button>
                    )}
                    <div className="rounded border border-border/40 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground break-all">
                      {activePathLabel}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            {/* Stats — inline when available */}
            {stats && (
              <Card>
                <CardContent className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Database className="w-3 h-3" /> Size
                    </span>
                    <span className="text-xs font-medium">{stats.totalSizeFormatted}</span>
                  </div>
                  {Object.entries(stats.folders || {}).map(([folder, info]) => (
                    <div key={folder} className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{folder}</span>
                      <span>{info.fileCount} ({info.sizeFormatted})</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Tools */}
            <Card>
              <CardContent className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'select' ? 'default' : 'outline'}
                        size="icon"
                        onClick={() => setTool('select')}
                        aria-label="Select tool"
                      >
                        <Square className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Select Tool (1)</TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={tool === 'pan' ? 'default' : 'outline'}
                        size="icon"
                        onClick={() => setTool('pan')}
                        aria-label="Pan tool"
                      >
                        <Move className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Pan Tool (2) — also right-click drag</TooltipContent>
                  </Tooltip>
                  
                  <Separator orientation="vertical" className="h-6 mx-0.5" />
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Zoom in"
                        onClick={() => {
                          const newScale = Math.min(MAX_SCALE, scale * 1.3)
                          const cx = canvasSize.width / 2
                          const cy = canvasSize.height / 2
                          const wx = (cx - offset.x) / scale
                          const wy = (cy - offset.y) / scale
                          setScale(newScale)
                          setOffset({ x: cx - wx * newScale, y: cy - wy * newScale })
                        }}
                      >
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zoom In</TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Zoom out"
                        onClick={() => {
                          const newScale = Math.max(MIN_SCALE, scale * 0.7)
                          const cx = canvasSize.width / 2
                          const cy = canvasSize.height / 2
                          const wx = (cx - offset.x) / scale
                          const wy = (cy - offset.y) / scale
                          setScale(newScale)
                          setOffset({ x: cx - wx * newScale, y: cy - wy * newScale })
                        }}
                      >
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zoom Out</TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" onClick={fitView} aria-label="Fit all chunks">
                        <Maximize className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Fit All Chunks</TooltipContent>
                  </Tooltip>
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {showMap ? <Image className="w-3.5 h-3.5" /> : <ImageOff className="w-3.5 h-3.5" />}
                    Map
                  </Label>
                  <Switch checked={showMap} onCheckedChange={setShowMap} />
                </div>
                
                <Separator />
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">Selection</Label>
                    <span className="text-[10px] font-medium tabular-nums text-foreground/80">
                      {selectedChunks.size > 0 ? `${selectedChunks.size} • ${formatSize(selectedSize)}` : '0'}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={selectAll} disabled={chunks.length === 0}>
                      All
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={clearSelection} disabled={selectedChunks.size === 0}>
                      Clear
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={invertSelection} disabled={chunks.length === 0}>
                      Invert
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Delete Button */}
            {selectedChunks.size > 0 && (
              <Button 
                variant="destructive" 
                className="w-full h-9 text-sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete {selectedChunks.size} Chunk{selectedChunks.size === 1 ? '' : 's'}
              </Button>
            )}
          </div>

          {/* Canvas — primary workspace */}
          <div className="order-1 lg:order-2">
            <Card className="flex flex-col h-[55vh] min-h-[320px] sm:h-[65vh] lg:h-[72vh]">
              <CardContent className="flex-1 p-2 min-h-0">
                {!selectedSave ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center max-w-xs">
                      <FileBox className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="font-medium text-foreground text-sm">Select a save</p>
                      <p className="text-xs mt-1.5 opacity-70">
                        {hasSaves ? 'Choose a save from the panel to review chunk data.' : 'No saves found — set a custom data path.'}
                      </p>
                    </div>
                  </div>
                ) : loading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <RefreshCw className="w-6 h-6 mx-auto animate-spin" />
                      <p className="mt-2 text-xs">Loading chunks...</p>
                    </div>
                  </div>
                ) : chunks.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center max-w-xs">
                      <Map className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="font-medium text-foreground text-sm">No chunks found</p>
                      <p className="text-xs mt-1.5 opacity-70">Map folder may be empty or the path needs adjusting.</p>
                    </div>
                  </div>
                ) : (
                  <div ref={containerRef} className="h-full w-full overflow-hidden">
                    {canvasSize.width > 0 && (
                      <canvas
                        ref={canvasRef}
                        width={canvasSize.width}
                        height={canvasSize.height}
                        style={{
                          width: canvasSize.width,
                          height: canvasSize.height,
                          borderRadius: '0.375rem',
                          border: '1px solid hsl(var(--border))',
                          cursor: tool === 'pan' ? 'grab' : 'crosshair'
                        }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
                        onWheel={handleWheel}
                        onContextMenu={handleContextMenu}
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Help — collapsible */}
        <Collapsible open={showHelp} onOpenChange={setShowHelp}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors w-full">
              <Info className="w-3.5 h-3.5" />
              <span>{showHelp ? 'Hide help' : 'Show help'}</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1.5">
              <p><strong className="text-foreground/80">Select chunks</strong> — Click or drag to select. Hold Shift to deselect.</p>
              <p><strong className="text-foreground/80">Navigate</strong> — Scroll to zoom, right-click to pan. Press 1/2 to switch tools.</p>
              <p><strong className="text-foreground/80">Delete</strong> — Rebuilds those areas on next visit. Press Delete or use the button.</p>
              <p><strong className="text-foreground/80">Shortcuts</strong> — Esc clears selection. Backup stays enabled by default.</p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Delete {selectedChunks.size} selected chunks?
              </DialogTitle>
              <DialogDescription>
                This permanently removes {selectedChunks.size} chunk files ({formatSize(selectedSize)}). When players revisit those areas, the game rebuilds them and removes any player-built structures or stored items there.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div>
                  <Label>Create safety backup</Label>
                  <p className="text-xs text-muted-foreground">
                    Save a copy of the selected chunks before deleting them.
                  </p>
                </div>
                <Switch
                  checked={createBackup}
                  onCheckedChange={setCreateBackup}
                />
              </div>
              
              {!createBackup && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/8 p-3 text-sm">
                  <p className="font-medium text-destructive">No backup will be created</p>
                  <p className="text-muted-foreground">You will not be able to recover these chunks after deletion.</p>
                </div>
              )}
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Deleting chunks...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete selected chunks
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
