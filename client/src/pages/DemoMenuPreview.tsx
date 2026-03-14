import {
  Archive,
  Bug,
  Clock,
  Download,
  FileCog,
  Layers,
  LayoutDashboard,
  Map,
  MessageSquare,
  MessagesSquare,
  Package,
  Search,
  Server,
  Settings,
  Terminal,
  Users,
  Zap,
} from 'lucide-react'
import type { ComponentType } from 'react'

type DemoItem = {
  label: string
  icon: ComponentType<{ className?: string }>
}

type DemoSection = {
  title: string
  items: DemoItem[]
}

const sections: DemoSection[] = [
  {
    title: 'Live',
    items: [
      { label: 'Server Console', icon: Terminal },
      { label: 'Online Players', icon: Users },
      { label: 'In-Game Chat', icon: MessagesSquare },
    ],
  },
  {
    title: 'World',
    items: [{ label: 'Events & Weather', icon: Zap }],
  },
  {
    title: 'Config',
    items: [
      { label: 'INI Settings', icon: FileCog },
      { label: 'Workshop Mods', icon: Package },
    ],
  },
  {
    title: 'Maintain',
    items: [
      { label: 'Scheduled Tasks', icon: Clock },
      { label: 'World Backups', icon: Archive },
      { label: 'Map Cleanup', icon: Map },
    ],
  },
  {
    title: 'Servers',
    items: [
      { label: 'My Servers', icon: Layers },
      { label: 'Steam Installer', icon: Download },
      { label: 'Browse Public', icon: Search },
    ],
  },
  {
    title: 'Settings & Tools',
    items: [
      { label: 'Discord', icon: MessageSquare },
      { label: 'Panel Settings', icon: Settings },
      { label: 'Debug Logs', icon: Bug },
    ],
  },
]

export default function DemoMenuPreview() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(circle at 16% -14%, hsl(var(--primary) / 0.16), transparent 34%), radial-gradient(circle at 88% 106%, hsl(var(--destructive) / 0.14), transparent 40%)',
        }}
      />
      <div className="relative flex min-h-screen w-full">
        <aside className="w-[300px] border-r border-border/70 bg-card/70 p-4 backdrop-blur-sm">
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Demo Mode</p>
            <p className="mt-1 text-xs text-muted-foreground">Navigation preview only. Live controls are disabled.</p>
          </div>

          <button
            disabled
            className="mb-3 flex w-full cursor-not-allowed items-center gap-2 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-sm font-semibold text-foreground/80 opacity-90"
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </button>

          <div className="space-y-3">
            {sections.map((section) => (
              <div key={section.title} className="rounded-md border border-border/70 bg-background/50 p-2">
                <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {section.title}
                </p>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      disabled
                      className="flex w-full cursor-not-allowed items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm text-foreground/72 opacity-90"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 p-6 md:p-10">
          <div className="mx-auto max-w-5xl rounded-2xl border border-border/70 bg-card/60 p-6 shadow-[0_24px_70px_-40px_hsl(var(--foreground)/0.5)] backdrop-blur-sm md:p-10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/90">Project Zomboid Control Panel</p>
                <h1 className="mt-2 text-2xl font-semibold leading-tight text-foreground md:text-3xl">Interactive demo disabled</h1>
              </div>
              <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/25 px-3 py-1 text-xs font-medium text-muted-foreground">
                Static preview
              </span>
            </div>

            <p className="mt-4 max-w-3xl text-sm text-muted-foreground md:text-base">
              This public page intentionally shows only the navigation shell and visual style. Server actions,
              writes, authentication, Discord integration, and cleanup tools are disabled in this build.
            </p>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/70 bg-background/55 p-4">
                <p className="text-sm font-semibold text-foreground">Included in demo</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>Menu layout and section structure</li>
                  <li>Panel visual theme and typography</li>
                  <li>Desktop and mobile shell responsiveness</li>
                </ul>
              </div>
              <div className="rounded-lg border border-border/70 bg-background/55 p-4">
                <p className="text-sm font-semibold text-foreground">Not included</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>Backend API connections</li>
                  <li>Socket streams and server status</li>
                  <li>All command, deploy, and editing actions</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
              <Server className="h-4 w-4" />
              Demo safety lock enabled
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
