import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Search, RefreshCw, Loader2, X, ChevronDown, AlertCircle, SearchX,
  Sword, Crosshair, UtensilsCrossed, Heart, Shirt, HardHat, Wrench,
  Layers, Cog, Cpu, BookOpen, Package, Sprout, Home, Bomb, Trash2,
  Gamepad2, HelpCircle, LayoutGrid
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { panelBridgeApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

export interface CatalogItem {
  id: string
  name: string
  category: string
  weight: number
}

interface ItemPickerProps {
  value: string
  onChange: (itemId: string) => void
  disabled?: boolean
  placeholder?: string
}

// PZ categories that are vehicles — filter out of item picker
const VEHICLE_CATEGORIES = new Set(['Vehicle'])

// Consolidate PZ's 270+ display categories into ~15 usable groups
// Uses prefix matching — order matters (first match wins)
const CATEGORY_RULES: Array<{ match: (c: string) => boolean; group: string }> = [
  { match: c => c.startsWith('Clothing') || c.startsWith('Accessory') || c.startsWith('Frockin') || c === 'Appearance' || c.startsWith('AppearanceOr') || c === 'MaleBody', group: 'Clothing' },
  { match: c => c.startsWith('Weapon') || c.startsWith('Firearm') || c.includes('Weapon') || c.startsWith('BrokenWeapon') || c.startsWith('JunkWeapon'), group: 'Weapons' },
  { match: c => c.startsWith('Food') || c.startsWith('Beverage') || c.startsWith('Cooking') || c === 'Smoking', group: 'Food & Drink' },
  { match: c => c.startsWith('Ammo'), group: 'Ammo' },
  { match: c => c.startsWith('Literature') || c.startsWith('SkillBook') || c === 'Cartography', group: 'Books & Maps' },
  { match: c => c.startsWith('Container'), group: 'Containers' },
  { match: c => c.startsWith('ProtectiveGear'), group: 'Protective Gear' },
  { match: c => c.startsWith('Material'), group: 'Materials' },
  { match: c => c.startsWith('Tool'), group: 'Tools' },
  { match: c => c.startsWith('Electronics') || c === 'Communications' || c === 'Devices' || c === 'LightSource' || c === 'Security' || c === 'FireSource', group: 'Electronics' },
  { match: c => c.startsWith('FirstAid') || c.startsWith('Bandage') || c === 'Wound', group: 'Medical' },
  { match: c => c.startsWith('Gardening') || c === 'Farming' || c.startsWith('Animal') || c === 'Fishing' || c.startsWith('FishingOr') || c === 'Trapping' || c === 'Camping', group: 'Farming & Outdoors' },
  { match: c => c === 'Mechanics' || c.startsWith('VehicleMaintenance') || c === 'Tuning' || c === 'Paint', group: 'Vehicle Parts' },
  { match: c => c.startsWith('Furniture') || c.startsWith('Household') || c.startsWith('Memento') || c === 'Hidden', group: 'Household' },
  { match: c => c === 'Junk' || c.startsWith('JunkOr'), group: 'Junk' },
  { match: c => c.startsWith('Explosive'), group: 'Explosives' },
  { match: c => c === 'Sports' || c.startsWith('SportsOr') || c === 'Instrument' || c.startsWith('InstrumentOr') || c === 'Entertainment' || c === 'KeyRing', group: 'Misc' },
]

function getItemGroup(rawCategory: string): string {
  if (!rawCategory) return 'Other'
  for (const rule of CATEGORY_RULES) {
    if (rule.match(rawCategory)) return rule.group
  }
  return 'Other'
}

// Icon + display order for each group
const GROUP_META: Record<string, { order: number; icon: typeof Sword }> = {
  'Weapons':            { order: 0,  icon: Sword },
  'Ammo':               { order: 1,  icon: Crosshair },
  'Food & Drink':       { order: 2,  icon: UtensilsCrossed },
  'Medical':            { order: 3,  icon: Heart },
  'Clothing':           { order: 4,  icon: Shirt },
  'Protective Gear':    { order: 5,  icon: HardHat },
  'Tools':              { order: 6,  icon: Wrench },
  'Materials':          { order: 7,  icon: Layers },
  'Vehicle Parts':      { order: 8,  icon: Cog },
  'Electronics':        { order: 9,  icon: Cpu },
  'Books & Maps':       { order: 10, icon: BookOpen },
  'Containers':         { order: 11, icon: Package },
  'Farming & Outdoors': { order: 12, icon: Sprout },
  'Household':          { order: 13, icon: Home },
  'Explosives':         { order: 14, icon: Bomb },
  'Junk':               { order: 15, icon: Trash2 },
  'Misc':               { order: 16, icon: Gamepad2 },
  'Other':              { order: 99, icon: HelpCircle },
}

const MAX_VISIBLE = 150

export function ItemPicker({ value, onChange, disabled, placeholder = 'Search items...' }: ItemPickerProps) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [initialLoad, setInitialLoad] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [dropUp, setDropUp] = useState(false)
  const { toast } = useToast()

  // Load cached catalog on mount
  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const data = await panelBridgeApi.getCatalogItems()
        if (ctrl.signal.aborted) return
        setItems(data.items || [])
        setScannedAt(data.scannedAt)
      } catch {
        // No catalog yet
      } finally {
        if (!ctrl.signal.aborted) setInitialLoad(false)
      }
    })()
    return () => ctrl.abort()
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => { setHighlightIndex(-1) }, [search, activeCategory])

  useEffect(() => {
    if (!open || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setDropUp(window.innerHeight - rect.bottom < 420)
  }, [open])

  const handleScan = useCallback(async () => {
    if (scanning) return
    setScanning(true)
    setScanError(null)
    try {
      const data = await panelBridgeApi.scanCatalogItems()
      setItems(data.items || [])
      setScannedAt(data.scannedAt)
      toast({ title: 'Item catalog updated', description: `Found ${data.count || 0} items` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scan failed'
      setScanError(msg)
      toast({
        title: 'Item scan failed',
        description: msg.includes('Bridge not running')
          ? 'Server must be online with PanelBridge mod active'
          : msg,
        variant: 'destructive',
      })
    } finally {
      setScanning(false)
    }
  }, [scanning, toast])

  // Filter out vehicles
  const nonVehicleItems = useMemo(
    () => items.filter(item => !VEHICLE_CATEGORIES.has(item.category)),
    [items]
  )

  // Build category sidebar data — consolidate 270+ raw categories into groups
  const categorySummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of nonVehicleItems) {
      const group = getItemGroup(item.category)
      counts.set(group, (counts.get(group) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([group, count]) => {
        const meta = GROUP_META[group] || GROUP_META['Other']
        return {
          raw: group,
          label: group,
          order: meta.order,
          count,
          Icon: meta.icon,
        }
      })
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  }, [nonVehicleItems])

  // Filter by search + category group
  const { visibleItems, totalFiltered, capped } = useMemo(() => {
    const q = search.toLowerCase().trim()
    let filtered = nonVehicleItems

    if (activeCategory) {
      filtered = filtered.filter(item => getItemGroup(item.category) === activeCategory)
    }
    if (q) {
      filtered = filtered.filter(
        item => item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
      )
    }

    const total = filtered.length
    const isCapped = total > MAX_VISIBLE
    const visible = isCapped ? filtered.slice(0, MAX_VISIBLE) : filtered
    visible.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))

    return { visibleItems: visible, totalFiltered: total, capped: isCapped }
  }, [nonVehicleItems, search, activeCategory])

  const selectedItem = useMemo(() => items.find(i => i.id === value), [items, value])

  const handleSelect = (itemId: string) => {
    onChange(itemId)
    setOpen(false)
    setSearch('')
    setActiveCategory(null)
    setHighlightIndex(-1)
  }

  const handleClear = () => {
    onChange('')
    setSearch('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex(prev => Math.min(prev + 1, visibleItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIndex >= 0 && highlightIndex < visibleItems.length) {
          handleSelect(visibleItems[highlightIndex].id)
        } else if (visibleItems.length > 0) {
          handleSelect(visibleItems[0].id)
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setHighlightIndex(-1)
        break
      case 'Home':
        e.preventDefault()
        setHighlightIndex(0)
        break
      case 'End':
        e.preventDefault()
        setHighlightIndex(visibleItems.length - 1)
        break
    }
  }

  // Scroll highlighted into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-item-index="${highlightIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  if (initialLoad) {
    return (
      <div className="flex items-center gap-2 h-11 sm:h-9 rounded-md border border-input bg-background px-3 text-sm">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
        <span className="text-muted-foreground truncate">Loading catalog...</span>
      </div>
    )
  }

  if (nonVehicleItems.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="e.g., Base.Axe"
            disabled={disabled || scanning}
            className="flex-1 min-w-0"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scanning || disabled}
            title="Scan server for items (requires running server with PanelBridge)"
            className="shrink-0"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-1.5 hidden sm:inline">Scan</span>
          </Button>
        </div>
        {scanError ? (
          <p className="text-[11px] text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate">{scanError}</span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {scanning ? 'Scanning server items…' : 'Enter item ID manually, or scan while the server is running'}
          </p>
        )}
      </div>
    )
  }

  const activeCategoryLabel = activeCategory || 'All'
  const ActiveIcon = activeCategory ? (GROUP_META[activeCategory]?.icon || HelpCircle) : LayoutGrid

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <div
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? 'itempicker-listbox' : undefined}
        aria-activedescendant={highlightIndex >= 0 && visibleItems[highlightIndex] ? `itempicker-opt-${highlightIndex}` : undefined}
        aria-label="Select item"
        tabIndex={disabled ? -1 : 0}
        className={cn(
          'flex items-center gap-2 h-11 sm:h-9 rounded-md border border-input bg-background px-3 text-sm cursor-pointer',
          'motion-safe:transition-colors duration-150',
          'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          open && 'border-primary/60 ring-1 ring-primary/20',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
        )}
        onClick={() => !disabled && setOpen(!open)}
      >
        <Package className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
        {selectedItem ? (
          <span className="flex-1 min-w-0 truncate">
            <span className="font-medium">{selectedItem.name || selectedItem.id}</span>
            {selectedItem.weight > 0 && (
              <span className="text-muted-foreground ml-1.5 text-xs">{selectedItem.weight}kg</span>
            )}
          </span>
        ) : value ? (
          <span className="flex-1 min-w-0 truncate text-foreground">{value}</span>
        ) : (
          <span className="flex-1 min-w-0 truncate text-muted-foreground">{placeholder}</span>
        )}
        {value && !disabled && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleClear() }}
            className="-mr-1 flex items-center justify-center w-6 h-6 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0 motion-safe:transition-colors"
            aria-label="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground shrink-0 motion-safe:transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </div>

      {/* Dropdown with category sidebar */}
      {open && (
        <div
          className={cn(
            'absolute z-50 rounded-lg border border-border bg-popover shadow-lg',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.98] motion-safe:duration-150',
            dropUp ? 'bottom-full mb-1 motion-safe:slide-in-from-bottom-1' : 'top-full mt-1 motion-safe:slide-in-from-top-1'
          )}
          style={{ width: 'max(100%, 540px)' }}
        >
          {/* Search bar */}
          <div className="flex items-center gap-2 border-b border-border px-3 h-11">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${nonVehicleItems.length.toLocaleString()} items...`}
              className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Filter items"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={e => { e.stopPropagation(); handleScan() }}
              disabled={scanning}
              className="h-7 w-7 p-0 shrink-0"
              title="Re-scan server items"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {/* Category sidebar + item list */}
          <div className="flex" style={{ maxHeight: '380px' }}>
            {/* Sidebar */}
            <div className="w-[152px] shrink-0 border-r border-border/60 overflow-y-auto overscroll-contain py-1 bg-card/50">
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-2 text-xs',
                  'motion-safe:transition-colors duration-100',
                  !activeCategory
                    ? 'bg-primary/12 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/8 border-l-2 border-transparent'
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 min-w-0 truncate font-medium">All Items</span>
                <span className="text-[10px] tabular-nums opacity-60">{nonVehicleItems.length.toLocaleString()}</span>
              </button>

              <div className="h-px bg-border/40 mx-2.5 my-1" />

              {categorySummary.map(cat => {
                const CatIcon = cat.Icon
                return (
                  <button
                    key={cat.raw}
                    type="button"
                    onClick={() => setActiveCategory(cat.raw)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs',
                      'motion-safe:transition-colors duration-100',
                      activeCategory === cat.raw
                        ? 'bg-primary/12 text-primary border-l-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/8 border-l-2 border-transparent'
                    )}
                  >
                    <CatIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className="flex-1 min-w-0 truncate">{cat.label}</span>
                    <span className="text-[10px] tabular-nums opacity-50">{cat.count.toLocaleString()}</span>
                  </button>
                )
              })}
            </div>

            {/* Items */}
            <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain" role="listbox" id="itempicker-listbox" aria-label="Item list">
              {/* Category header */}
              <div className="sticky top-0 z-10 flex items-center gap-2 px-3 h-8 bg-muted/60 backdrop-blur-sm border-b border-border/30 text-xs text-muted-foreground">
                <ActiveIcon className="w-3 h-3 opacity-60" />
                <span className="font-medium">{activeCategoryLabel}</span>
                <span className="opacity-50">—</span>
                <span className="tabular-nums">{totalFiltered.toLocaleString()} items</span>
              </div>

              {totalFiltered === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <SearchX className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    {search ? <>No items match &ldquo;{search}&rdquo;</> : 'No items in this category'}
                  </p>
                  {search && activeCategory && (
                    <button
                      type="button"
                      onClick={() => setActiveCategory(null)}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      Search all categories
                    </button>
                  )}
                </div>
              ) : (
                <div ref={listRef} className="py-0.5">
                  {visibleItems.map((item, idx) => {
                    const group = getItemGroup(item.category)
                    const ItemGroupIcon = GROUP_META[group]?.icon || HelpCircle
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        id={`itempicker-opt-${idx}`}
                        aria-selected={item.id === value}
                        data-item-index={idx}
                        onClick={() => handleSelect(item.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 h-9 text-sm text-left',
                          'motion-safe:transition-colors duration-75',
                          'hover:bg-accent/10',
                          item.id === value && 'bg-primary/10 text-primary',
                          idx === highlightIndex && 'bg-accent/15 outline-none'
                        )}
                      >
                        {!activeCategory && (
                          <ItemGroupIcon className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate font-medium">{item.name || item.id}</span>
                        {item.weight > 0 && (
                          <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">{item.weight}kg</span>
                        )}
                        <span className="text-[10px] text-muted-foreground/40 shrink-0 max-w-[35%] truncate font-mono">{item.id}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border/40 px-3 h-8 flex items-center justify-between gap-3 text-[11px] text-muted-foreground bg-card/30">
            <span className="shrink-0 tabular-nums">
              {capped
                ? <><span className="text-warning">{MAX_VISIBLE}</span> of {totalFiltered.toLocaleString()} — type to narrow</>
                : `${totalFiltered.toLocaleString()} ${activeCategory ? activeCategoryLabel.toLowerCase() : 'items'}`}
            </span>
            <div className="flex items-center gap-3 text-[10px] opacity-60">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
            {scannedAt && (
              <span className="truncate text-right opacity-50">
                {new Date(scannedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
