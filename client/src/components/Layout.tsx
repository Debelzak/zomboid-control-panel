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
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
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

// Navigation sections with collapsible groups
const navSections = [
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
    ]
  },
  {
    id: 'config',
    label: 'Config',
    icon: FileCog,
    color: 'blue',
    items: [
      { to: '/server-config', icon: FileCog, label: 'INI Settings', requiresLocal: true },
      { to: '/mods', icon: Package, label: 'Workshop Mods', requiresLocal: true },
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
        className="h-7 px-2 text-xs"
        title="Sign out"
      >
        <LogOut className="w-3 h-3" />
        <span>Sign out</span>
      </Button>
    </div>
  )
}

function PanelBrand({ compact = false }: { compact?: boolean }) {
  const { theme } = useTheme()

  return (
    <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
      <img
        src="/spiffo.png"
        alt="Spiffo"
        className={cn(
          compact ? "h-10 w-8" : "h-12 w-10",
          "object-contain drop-shadow-sm",
          theme === 'survival' && "saturate-90"
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
          {theme === 'survival' ? '// Control Panel' : 'Control Panel'}
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
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [playerCount, setPlayerCount] = useState<number>(0)
  const [panelVersion, setPanelVersion] = useState('0.0.0')
  const socket = useContext(SocketContext)

  // Fetch panel version
  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then(r => r.json())
      .then(d => { if (!cancelled && d.version) setPanelVersion(d.version) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Listen for player updates globaly
  useEffect(() => {
    if (!socket) return

    const handlePlayersUpdate = (players: any[]) => {
      setPlayerCount(players.length)
    }

    socket.on('players:update', handlePlayersUpdate)
    return () => {
      socket.off('players:update', handlePlayersUpdate)
    }
  }, [socket])
  const navigate = useNavigate()
  const location = useLocation()
  const { theme } = useTheme()

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

  // Fetch servers and active server
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await serversApi.getAll()
        setServers(data.servers || [])
        const active = data.servers?.find((s: ServerInstance) => s.isActive) || null
        setActiveServer(active)
      } catch (error) {
        console.error('Failed to fetch servers:', error)
      }
    }
    fetchServers()
  }, [])

  // Listen for server changes
  useEffect(() => {
    if (!socket) return
    
    const handleActiveServerChanged = async () => {
      try {
        const data = await serversApi.getAll()
        setServers(data.servers || [])
        const active = data.servers?.find((s: ServerInstance) => s.isActive) || null
        setActiveServer(active)
      } catch (error) {
        console.error('Failed to refresh servers:', error)
      }
    }
    
    socket.on('activeServerChanged', handleActiveServerChanged)
    return () => {
      socket.off('activeServerChanged', handleActiveServerChanged)
    }
  }, [socket])

  // Listen for update notifications
  useEffect(() => {
    if (!socket) return
    
    const handleUpdateAvailable = (data: UpdateStatus) => {
      setUpdateInfo(data)
      setUpdateDismissed(false) // Show banner again when new update detected
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
    } catch (error) {
      console.error('Failed to switch server:', error)
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
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop always visible, Mobile as slide-out */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-card transform transition-transform duration-300 ease-in-out lg:relative lg:w-64",
        "lg:translate-x-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        "pt-16 lg:pt-0" // Add padding for mobile header
      )}>
        {/* Project Zomboid Banner with Spiffo */}
        <div className={cn(
          "relative overflow-hidden sidebar-header",
          theme === 'survival' 
            ? "bg-gradient-to-b from-amber-950/28 via-stone-950/94 to-card border-b border-amber-900/24"
            : "bg-gradient-to-b from-amber-950/22 via-stone-950/94 to-card border-b border-primary/18"
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
                  className="group h-auto w-full items-start justify-between rounded-xl border-border/60 bg-muted/20 px-4 py-3 text-left hover:border-primary/25 hover:bg-accent/35"
                >
                  <div className="min-w-0 truncate">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Active Server</p>
                    <p className="mt-1 truncate text-sm font-semibold group-hover:text-primary">
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
                  'nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative',
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

              return (
                <Collapsible
                  key={section.id}
                  open={isOpen}
                  onOpenChange={() => toggleSection(section.id)}
                >
                  <CollapsibleTrigger className={cn(
                    "flex items-center justify-between w-full px-3 py-2 rounded-lg transition-all duration-200 group",
                    isOpen ? "mb-0.5" : "",
                    hasActiveChild && !isOpen ? "bg-primary/6" : "hover:bg-accent/25"
                  )}>
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        "flex items-center justify-center w-6 h-6 rounded-md transition-colors",
                        isOpen || hasActiveChild
                          ? "border border-primary/15 bg-primary/8 text-primary"
                          : "bg-transparent text-muted-foreground/60 group-hover:bg-accent/20 group-hover:text-muted-foreground"
                      )}>
                        <section.icon className={cn(
                          "w-3.5 h-3.5 transition-colors",
                          isOpen || hasActiveChild ? "text-primary" : "text-muted-foreground/60 group-hover:text-muted-foreground"
                        )} />
                      </span>
                      <span className={cn(
                        "text-xs font-semibold uppercase tracking-widest transition-colors font-display",
                        isOpen || hasActiveChild ? "text-foreground/80" : "text-muted-foreground/60 group-hover:text-muted-foreground"
                      )}>
                        {section.label}
                      </span>
                      {hasActiveChild && !isOpen && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <ChevronDown className={cn(
                      "w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200",
                      isOpen ? "" : "-rotate-90"
                    )} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="nav-section-content overflow-hidden">
                    <div className={cn(
                      "ml-[18px] pl-3 space-y-0.5 py-0.5",
                      "border-l-[2px] transition-colors",
                      hasActiveChild ? "border-primary/30" : "border-border/40"
                    )}>
                      {section.items.map((item) => {
                        const isDisabledByRemote = !!(item as any).requiresLocal && activeServer?.isRemote
                        
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
                              'nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 group relative',
                              isActive
                                ? 'nav-item-active bg-primary/8 text-foreground font-medium'
                                : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon className={cn(
                                "w-4 h-4 transition-all duration-200 shrink-0",
                                isActive ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"
                              )} />
                              <span className="truncate">{item.label}</span>
                              {item.to === '/players' && playerCount > 0 && (
                                <Badge
                                  variant={isActive ? 'secondary' : 'success'}
                                  className="ml-auto min-w-[24px] justify-center px-1.5 py-0.5 text-xs leading-none"
                                >
                                  {playerCount}
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
              {theme === 'survival' ? '// Zomboid Control Panel' : 'Zomboid Control Panel'}
            </p>
            <p className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>v{panelVersion}</span>
              <Badge variant="warning" className="px-2 py-0.5 text-xs uppercase tracking-wide text-warning-foreground shadow-none">
                Beta
              </Badge>
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
                    onClick={() => setUpdateDismissed(true)}
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
