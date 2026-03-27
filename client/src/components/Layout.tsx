import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState, useContext } from 'react'
import { 
  LayoutDashboard, 
  Users, 
  Terminal, 
  Clock, 
  Package, 
  Settings,
  Server,
  Download,
  Bug,
  Map,
  MessageSquare,
  Layers,
  ChevronDown,
  FileCog,
  Menu,
  X,
  Search,
  Zap,
  MessagesSquare,
  Archive,
  AlertCircle,
  RefreshCw,
  LogOut,
  Github
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConnectionStatus } from './ConnectionStatus'
import { serversApi, ServerInstance, updateApi, UpdateStatus } from '@/lib/api'
import { SocketContext } from '@/contexts/SocketContext'

import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"

// Standalone top-level nav item (not collapsible)
const dashboardItem = { to: '/', icon: LayoutDashboard, label: 'Dashboard' }

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  requiresLocal?: boolean
}

interface NavSection {
  id: string
  label: string
  icon: typeof LayoutDashboard
  color: string
  items: NavItem[]
}

// Navigation sections with collapsible groups
const navSections: NavSection[] = [
  {
    id: 'active',
    label: 'Live',
    icon: Terminal,
    color: 'emerald',
    items: [
      { to: '/console', icon: Terminal, label: 'Server Console' },
      { to: '/players', icon: Users, label: 'Online Players' },
      { to: '/chat', icon: MessagesSquare, label: 'In-Game Chat' },
    ]
  },
  {
    id: 'world',
    label: 'World',
    icon: Zap,
    color: 'amber',
    items: [
      { to: '/events', icon: Zap, label: 'Events & Weather' },
      { to: '/world-map', icon: Map, label: 'World Map' },
    ]
  },
  {
    id: 'config',
    label: 'Config',
    icon: FileCog,
    color: 'blue',
    items: [
      { to: '/server-config', icon: FileCog, label: 'Server Configuration', requiresLocal: true },
      { to: '/mods', icon: Package, label: 'Mod Manager', requiresLocal: true },
    ]
  },
  {
    id: 'maintenance',
    label: 'Maintain',
    icon: Clock,
    color: 'purple',
    items: [
      { to: '/scheduler', icon: Clock, label: 'Scheduled Tasks' },
      { to: '/backups', icon: Archive, label: 'World Backups', requiresLocal: true },
      { to: '/chunks', icon: Map, label: 'Map Cleanup', requiresLocal: true },
    ]
  },
  {
    id: 'servers',
    label: 'Servers',
    icon: Server,
    color: 'cyan',
    items: [
      { to: '/servers', icon: Layers, label: 'My Servers' },
      { to: '/server-setup', icon: Download, label: 'Steam Installer' },
      { to: '/server-finder', icon: Search, label: 'Browse Public' },
    ]
  },
  {
    id: 'system',
    label: 'Settings & Tools',
    icon: Settings,
    color: 'slate',
    items: [
      { to: '/discord', icon: MessageSquare, label: 'Discord' },
      { to: '/settings', icon: Settings, label: 'Panel Settings' },
      { to: '/debug', icon: Bug, label: 'Debug Logs' },
    ]
  },
]

const sectionToneStyles = {
  emerald: {
    triggerActive: 'bg-success/12 border-success/35',
    iconActive: 'border-success/45 bg-success/14 text-success',
    iconIdle: 'text-foreground/86 group-hover:text-success',
    labelActive: 'text-success',
    childActive: 'border-success/45 bg-success/10',
    childDot: 'bg-success',
    childBorder: 'border-success/35',
  },
  amber: {
    triggerActive: 'bg-warning/12 border-warning/35',
    iconActive: 'border-warning/45 bg-warning/14 text-warning',
    iconIdle: 'text-foreground/86 group-hover:text-warning',
    labelActive: 'text-warning',
    childActive: 'border-warning/45 bg-warning/10',
    childDot: 'bg-warning',
    childBorder: 'border-warning/35',
  },
  blue: {
    triggerActive: 'bg-info/12 border-info/35',
    iconActive: 'border-info/45 bg-info/14 text-info',
    iconIdle: 'text-foreground/86 group-hover:text-info',
    labelActive: 'text-info',
    childActive: 'border-info/45 bg-info/10',
    childDot: 'bg-info',
    childBorder: 'border-info/35',
  },
  purple: {
    triggerActive: 'bg-accent/30 border-accent/50',
    iconActive: 'border-accent/60 bg-accent/35 text-accent-foreground',
    iconIdle: 'text-foreground/86 group-hover:text-accent-foreground',
    labelActive: 'text-accent-foreground',
    childActive: 'border-accent/60 bg-accent/25',
    childDot: 'bg-accent-foreground',
    childBorder: 'border-accent/50',
  },
  cyan: {
    triggerActive: 'bg-primary/14 border-primary/35',
    iconActive: 'border-primary/45 bg-primary/16 text-primary',
    iconIdle: 'text-foreground/86 group-hover:text-primary',
    labelActive: 'text-primary',
    childActive: 'border-primary/45 bg-primary/10',
    childDot: 'bg-primary',
    childBorder: 'border-primary/35',
  },
  slate: {
    triggerActive: 'bg-muted/45 border-border/70',
    iconActive: 'border-border/80 bg-muted text-foreground',
    iconIdle: 'text-foreground/86 group-hover:text-foreground',
    labelActive: 'text-foreground',
    childActive: 'border-border/80 bg-muted/60',
    childDot: 'bg-muted-foreground',
    childBorder: 'border-border/70',
  },
} as const

// Auth footer — shows logged-in user and logout button
function AuthFooter() {
  const { user, authEnabled, logout } = useAuth()
  
  if (!authEnabled || !user) return null
  
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 truncate font-medium" title={user.username}>
        {user.username}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={logout}
        className="h-9 px-2 text-xs"
        title="Sign out"
      >
        <LogOut className="w-3 h-3" />
        <span>Sign out</span>
      </Button>
    </div>
  )
}

function PanelBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
      <img
        src={`${import.meta.env.BASE_URL}spiffo.png`}
        alt="Spiffo"
        className={cn(
          compact ? "h-10 w-8" : "h-12 w-10",
          "object-contain drop-shadow-sm saturate-90"
        )}
      />
      <div className="min-w-0">
        <h1
          className={cn(
            "shell-brand-title truncate uppercase",
            compact ? "text-sm tracking-[0.12em]" : "text-base tracking-[0.14em]"
          )}
        >
          Project Zomboid
        </h1>
        <p
          className={cn(
            "shell-brand-subtitle truncate text-muted-foreground",
            compact ? "text-xs leading-tight" : "text-xs"
          )}
        >
          // Control Panel
        </p>
      </div>
    </div>
  )
}

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [activeServer, setActiveServer] = useState<ServerInstance | null>(null)
  const [servers, setServers] = useState<ServerInstance[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['active', 'world']))
  const [updateInfo, setUpdateInfo] = useState<UpdateStatus | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(() => sessionStorage.getItem('updateBannerDismissed') === 'true')
  const [playerCount, setPlayerCount] = useState<number>(0)
  const [panelVersion, setPanelVersion] = useState('')
  const socket = useContext(SocketContext)
  const { toast } = useToast()

  // Fetch panel version
  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then(r => r.json())
      .then(d => { if (!cancelled && d.version) setPanelVersion(d.version) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Listen for player updates globally
  useEffect(() => {
    if (!socket) return

    const handlePlayersUpdate = (players: unknown) => {
      setPlayerCount(Array.isArray(players) ? players.length : 0)
    }

    socket.on('players:update', handlePlayersUpdate)
    return () => {
      socket.off('players:update', handlePlayersUpdate)
    }
  }, [socket])
  const navigate = useNavigate()
  const location = useLocation()
  const playerCountLabel = playerCount > 99 ? '99+' : String(playerCount)

  // Toggle section open/closed
  const toggleSection = (sectionId: string) => {
    setOpenSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId)
      } else {
        newSet.add(sectionId)
      }
      return newSet
    })
  }

  // Auto-open section containing current route
  useEffect(() => {
    const currentPath = location.pathname
    for (const section of navSections) {
      if (section.items.some(item => item.to === currentPath)) {
        setOpenSections(prev => new Set([...prev, section.id]))
        break
      }
    }
  }, [location.pathname])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Close mobile menu with Escape for keyboard users
  useEffect(() => {
    if (!mobileMenuOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileMenuOpen])

  // Prevent background scroll while mobile menu is open
  useEffect(() => {
    const { body } = document
    const previousOverflow = body.style.overflow
    if (mobileMenuOpen) {
      body.style.overflow = 'hidden'
    }

    return () => {
      body.style.overflow = previousOverflow
    }
  }, [mobileMenuOpen])

  // Fetch servers and active server
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await serversApi.getAll()
        setServers(data.servers || [])
        const active = data.servers?.find((s: ServerInstance) => s.isActive) || null
        setActiveServer(active)
      } catch {
        toast({
          title: 'Server list unavailable',
          description: 'The panel could not load server profiles.',
          variant: 'destructive',
        })
      }
    }
    fetchServers()
  }, [toast])

  // Listen for server changes
  useEffect(() => {
    if (!socket) return
    
    const handleActiveServerChanged = async () => {
      try {
        const data = await serversApi.getAll()
        setServers(data.servers || [])
        const active = data.servers?.find((s: ServerInstance) => s.isActive) || null
        setActiveServer(active)
      } catch {
        toast({
          title: 'Server refresh failed',
          description: 'The active server list could not be refreshed.',
          variant: 'destructive',
        })
      }
    }
    
    socket.on('activeServerChanged', handleActiveServerChanged)
    return () => {
      socket.off('activeServerChanged', handleActiveServerChanged)
    }
  }, [socket, toast])

  // Listen for update notifications
  useEffect(() => {
    if (!socket) return
    
    const handleUpdateAvailable = (data: UpdateStatus) => {
      setUpdateInfo(data)
      setUpdateDismissed(false) // Show banner again when new update detected
      sessionStorage.removeItem('updateBannerDismissed')
    }
    
    const handleUpdateCheck = (data: UpdateStatus) => {
      if (data.updateAvailable) {
        setUpdateInfo(data)
      } else {
        setUpdateInfo(null)
      }
    }
    
    socket.on('server:updateAvailable', handleUpdateAvailable)
    socket.on('server:updateCheck', handleUpdateCheck)
    
    // Check for updates on mount
    updateApi.getStatus().then(status => {
      if (status.updateAvailable?.updateAvailable) {
        setUpdateInfo(status.updateAvailable)
      }
    }).catch(() => {})
    
    return () => {
      socket.off('server:updateAvailable', handleUpdateAvailable)
      socket.off('server:updateCheck', handleUpdateCheck)
    }
  }, [socket])

  const handleSwitchServer = async (server: ServerInstance) => {
    if (server.isActive) return
    try {
      await serversApi.activate(server.id)
      // Socket event will refresh the list
    } catch {
      toast({
        title: 'Switch failed',
        description: `Could not make ${server.name} the active server.`,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:hidden">
        <div className="flex items-center justify-between p-3">
          <PanelBrand compact />
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="h-11 w-11 rounded-lg border border-transparent hover:border-border/70 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - Desktop always visible, Mobile as slide-out */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-card transform transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none lg:relative lg:w-64",
        "lg:translate-x-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        "pt-16 lg:pt-0" // Add padding for mobile header
      )}>
        {/* Project Zomboid Banner with Spiffo */}
        <div className={cn(
          "relative overflow-hidden sidebar-header",
          "bg-gradient-to-b from-amber-950/28 via-stone-950/94 to-card border-b border-amber-900/24"
        )}>
          <div className="relative p-4">
            <PanelBrand />
          </div>
        </div>

        {/* Active Server Selector */}
        {servers.length > 0 && (
          <div className="px-4 py-3 border-b">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="group h-auto min-h-[3.25rem] w-full items-start justify-between rounded-xl border-border/60 bg-muted/20 px-4 py-3 text-left hover:border-primary/25 hover:bg-accent/35 sm:h-auto"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase leading-none tracking-[0.18em] text-muted-foreground">Active Server</p>
                    <p className="mt-1 truncate text-sm font-semibold leading-5 group-hover:text-primary">
                      {activeServer?.name || 'No server selected'}
                    </p>
                  </div>
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 group-hover:text-primary" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60 glass border-border/50">
                {servers.map(server => (
                  <DropdownMenuItem
                    key={server.id}
                    onClick={() => handleSwitchServer(server)}
                    className={cn(
                      "py-2.5 px-3 cursor-pointer transition-colors",
                      server.isActive && 'bg-primary/10'
                    )}
                  >
                    <div className="flex items-center gap-3 w-full">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        server.isActive ? "bg-primary/18" : "bg-muted/70"
                      )}>
                        <Server className={cn("w-4 h-4", server.isActive && "text-primary")} />
                      </div>
                      <span className="truncate flex-1 font-medium">{server.name}</span>
                      {server.isActive && (
                        <Badge variant="secondary" className="px-2 py-0.5 text-xs uppercase tracking-wide">
                          Active
                        </Badge>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/servers')} className="py-2.5 px-3">
                  <Layers className="w-4 h-4 mr-2" />
                  Manage Servers
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto nav-scroll">
          <div className="space-y-1">
            {/* Dashboard - standalone item */}
            <NavLink
              to={dashboardItem.to}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'nav-item flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1',
                  isActive
                    ? 'nav-item-active bg-primary/10 text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                  )}
                  <span className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
                    isActive ? "bg-primary/15" : "bg-muted/50 group-hover:bg-muted"
                  )}>
                    <dashboardItem.icon className={cn("w-[18px] h-[18px]", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  </span>
                  <span>{dashboardItem.label}</span>
                </>
              )}
            </NavLink>

            {/* Section divider */}
            <Separator className="my-3" />

            {/* Collapsible sections */}
            {navSections.map((section) => {
              const isOpen = openSections.has(section.id)
              const hasActiveChild = section.items.some(item => location.pathname === item.to)
              const tone = sectionToneStyles[section.color as keyof typeof sectionToneStyles] || sectionToneStyles.slate

              return (
                <Collapsible
                  key={section.id}
                  open={isOpen}
                  onOpenChange={() => toggleSection(section.id)}
                >
                  <CollapsibleTrigger className={cn(
                    "flex min-h-11 items-center justify-between w-full px-3 py-2.5 rounded-lg border border-transparent transition-[background-color,border-color,color] duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1",
                    isOpen ? "mb-0.5" : "",
                    hasActiveChild && !isOpen ? tone.triggerActive : "hover:bg-accent/25"
                  )}>
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        "flex items-center justify-center w-6 h-6 rounded-md transition-colors",
                        isOpen || hasActiveChild
                          ? tone.iconActive
                          : "bg-transparent group-hover:bg-accent/20",
                        !(isOpen || hasActiveChild) && tone.iconIdle
                      )}>
                        <section.icon className={cn(
                          "w-3.5 h-3.5 transition-colors",
                          isOpen || hasActiveChild ? "text-current" : "text-current"
                        )} />
                      </span>
                      <span className={cn(
                        "text-[0.78rem] leading-none font-medium uppercase tracking-[0.1em] transition-colors",
                        isOpen || hasActiveChild ? tone.labelActive : "text-foreground/60 group-hover:text-foreground/80"
                      )}>
                        {section.label}
                      </span>
                      {hasActiveChild && !isOpen && (
                        <span className={cn("h-1.5 w-1.5 rounded-full", tone.childDot)} />
                      )}
                    </div>
                    <ChevronDown className={cn(
                      "w-3.5 h-3.5 text-foreground/78 group-hover:text-foreground transition-transform duration-200",
                      isOpen ? "" : "-rotate-90"
                    )} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="nav-section-content overflow-hidden">
                    <div className={cn(
                      "ml-[18px] pl-3 space-y-0.5 py-0.5",
                      "border-l-[2px] transition-colors",
                      hasActiveChild ? tone.childBorder : "border-border/40"
                    )}>
                      {section.items.map((item) => {
                        const isDisabledByRemote = !!item.requiresLocal && activeServer?.isRemote
                        
                        if (isDisabledByRemote) {
                          return (
                            <div
                              key={item.to}
                              className="nav-item relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm opacity-50"
                              title="Not available for remote (RCON-only) servers"
                              aria-disabled="true"
                            >
                              <item.icon className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                              <span className="truncate text-muted-foreground/70 line-through decoration-muted-foreground/30">{item.label}</span>
                              <Badge variant="outline" className="ml-auto px-1.5 py-0 text-xs uppercase tracking-wide">
                                Local
                              </Badge>
                            </div>
                          )
                        }
                        
                        return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setMobileMenuOpen(false)}
                          className={({ isActive }) =>
                            cn(
                              'nav-item flex min-h-10 items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1',
                              isActive
                                ? cn('nav-item-active text-foreground font-medium', tone.childActive)
                                : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon className={cn(
                                "w-4 h-4 transition-colors duration-200 shrink-0",
                                isActive ? tone.labelActive : "text-muted-foreground/70 group-hover:text-foreground"
                              )} />
                              <span className="truncate">{item.label}</span>
                              {item.to === '/players' && playerCount > 0 && (
                                <Badge
                                  variant={isActive ? 'secondary' : 'success'}
                                  className="ml-auto min-w-[26px] justify-center px-1.5 py-0.5 text-xs leading-none"
                                >
                                  {playerCountLabel}
                                </Badge>
                              )}
                            </>
                          )}
                        </NavLink>
                        )
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t space-y-4">
          <ConnectionStatus showLabel className="justify-center" />
          <AuthFooter />
          <div className="text-center">
            <p className="shell-brand-subtitle text-xs text-muted-foreground">
              // Zomboid Control Panel
            </p>
            <p className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              {panelVersion && <span>v{panelVersion}</span>}
              <a
                href="https://github.com/fpsacha/zomboid-control-panel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                aria-label="GitHub repository"
              >
                <Github className="w-3.5 h-3.5" />
              </a>
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pt-16 lg:pt-0">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          {/* Server Update Banner */}
          {updateInfo && updateInfo.updateAvailable && !updateDismissed && (
            <Alert className="mb-4 border-warning/40 bg-warning/10">
              <AlertCircle className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning">Server Update Available</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0 text-muted-foreground break-words">
                  A new version is available for the <strong>{updateInfo.installed.branch}</strong> branch. 
                  Build {updateInfo.installed.buildId} → {updateInfo.latest.buildId}
                  {updateInfo.latest.description && ` (${updateInfo.latest.description})`}
                </span>
                <div className="flex flex-col gap-2 sm:ml-4 sm:flex-row sm:items-center">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setUpdateDismissed(true)
                      sessionStorage.setItem('updateBannerDismissed', 'true')
                    }}
                  >
                    Dismiss
                  </Button>
                  <Button 
                    size="sm"
                    variant="warning"
                    className="w-full sm:w-auto"
                    onClick={() => navigate('/servers')}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Update Server
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {children}
        </div>
      </main>
    </div>
  )
}
