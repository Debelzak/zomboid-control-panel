import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react'
import { Terminal as TerminalIcon, Send, Trash2, WifiOff, Loader2, Megaphone, FileText, RefreshCw, Pause, Play, Filter, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { rconApi, configApi, serverApi } from '@/lib/api'
import { useSocket } from '@/contexts/SocketContext'
import { EmptyState } from '@/components/EmptyState'
import { StatusIndicator } from '@/components/StatusIndicator'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { usePageShortcut } from '@/hooks/useKeyboardShortcuts'

interface CommandEntry {
  id: number
  command: string
  response: string
  success: number
  executed_at: string
}

interface RconResponse {
  command: string
  response: string
  success: boolean
  timestamp: string
}

// Parse PZ server log line into structured parts
interface ParsedLogLine {
  type: 'LOG' | 'WARN' | 'ERROR' | 'DEBUG' | 'INFO' | 'UNKNOWN'
  category: string
  message: string
  raw: string
}

function parseLogLine(line: string): ParsedLogLine {
  // PZ log format: "TYPE : Category    f:XXXXX, t:XXXXX, st:XXXXX> Source > Message"
  // or just plain text
  
  const trimmed = line.trim()
  if (!trimmed) {
    return { type: 'UNKNOWN', category: '', message: '', raw: line }
  }
  
  // Match: LOG/WARN/ERROR : Category  f:xxx...> Message
  const match = trimmed.match(/^(LOG|WARN|ERROR|DEBUG|INFO)\s*:\s*(\w+).*?>\s*(.+)$/i)
  if (match) {
    let type = match[1].toUpperCase() as ParsedLogLine['type']
    const message = match[3]
    // Promote LOG → ERROR when the message body is a Java exception or stack trace.
    // PZ logs every exception as `LOG : General ... > java.lang.NullPointerException ...`
    // which makes them invisible against routine LOG spam.
    if (type === 'LOG' && /^(java\.|kotlin\.|zombie\.|com\.|org\.|at\s+\S+\.|Exception in thread|Caused by:|\S+(Exception|Error)(:|\s|$))/i.test(message)) {
      type = 'ERROR'
    }
    return {
      type,
      category: match[2],
      message,
      raw: line
    }
  }
  
  // Check for simple prefixes
  if (trimmed.startsWith('ERROR')) {
    return { type: 'ERROR', category: '', message: trimmed.replace(/^ERROR\s*:?\s*/i, ''), raw: line }
  }
  if (trimmed.startsWith('WARN')) {
    return { type: 'WARN', category: '', message: trimmed.replace(/^WARN\s*:?\s*/i, ''), raw: line }
  }
  if (trimmed.startsWith('LOG')) {
    return { type: 'LOG', category: '', message: trimmed.replace(/^LOG\s*:?\s*/i, ''), raw: line }
  }
  // Bare Java stack-trace continuation lines ("\tat zombie.network...", "Caused by: ...")
  if (/^(\s*at\s+\S+|Caused by:|\.{3}\s+\d+ more|Exception in thread)/.test(trimmed)) {
    return { type: 'ERROR', category: '', message: trimmed, raw: line }
  }
  
  return { type: 'UNKNOWN', category: '', message: trimmed, raw: line }
}

// Log line type → text color
const typeColors: Record<string, string> = {
  'ERROR': 'text-destructive',
  'WARN': 'text-warning',
  'LOG': 'text-foreground/90',
  'DEBUG': 'text-muted-foreground',
  'INFO': 'text-primary',
  'UNKNOWN': 'text-muted-foreground'
}

// Log line type → badge color
const typeBadgeColors: Record<string, string> = {
  'ERROR': 'border border-destructive/25 bg-destructive/10 text-destructive',
  'WARN': 'border border-warning/25 bg-warning/10 text-warning',
  'LOG': 'border border-border/60 bg-muted/40 text-foreground/90',
  'DEBUG': 'border border-border/50 bg-muted/25 text-muted-foreground',
  'INFO': 'border border-primary/20 bg-primary/10 text-primary',
  'UNKNOWN': 'border border-border/50 bg-muted/25 text-muted-foreground'
}

// Channel tag prefixes for server broadcasts. "all" = no prefix.
// All options become `servermsg` since RCON cannot route to real chat channels.
const chatChannels = [
  { value: 'all',       label: 'All players',     description: 'No tag — plain broadcast' },
  { value: 'admin',     label: '[ADMIN] tag',      description: 'Marks the message as admin' },
  { value: 'say',       label: '[SAY] tag',        description: 'Cosmetic local-chat label' },
  { value: 'faction',   label: '[FACTION] tag',    description: 'Cosmetic faction label' },
  { value: 'safehouse', label: '[SAFEHOUSE] tag',  description: 'Cosmetic safehouse label' },
]

// Memoized log line to avoid re-rendering unchanged lines
const ServerLogLine = memo(function ServerLogLine({ line }: { line: string }) {
  const parsed = parseLogLine(line)
  if (!parsed.message && !parsed.raw.trim()) return null

  return (
    <div
      className={cn(
        'border-l px-2 py-0.5 leading-tight',
        parsed.type === 'ERROR'
          ? 'border-destructive/40 bg-destructive/8'
          : parsed.type === 'WARN'
            ? 'border-warning/40 bg-warning/8'
            : parsed.type === 'INFO'
              ? 'border-primary/20 bg-primary/5'
              : 'border-transparent'
      )}
    >
      <div className="flex items-baseline gap-1.5">
        {parsed.type !== 'UNKNOWN' && (
          <span className={`px-1 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${typeBadgeColors[parsed.type]}`}>
            {parsed.type}
          </span>
        )}
        {parsed.category && (
          <span className="shrink-0 text-muted-foreground/70 text-[11px]">[{parsed.category}]</span>
        )}
        <span className={`${typeColors[parsed.type]} break-words min-w-0`}>
          {parsed.message || parsed.raw}
        </span>
      </div>
    </div>
  )
})

const quickCommands = [
  { label: 'Players', command: 'players' },
  { label: 'Save', command: 'save' },
  { label: 'Show Options', command: 'showoptions' },
  { label: 'Check Mods', command: 'checkModsNeedUpdate' },
  { label: 'Help', command: 'help' },
  { label: 'Server Info', command: 'serverinfo' },
  { label: 'Get Memory', command: 'getmemory' },
]

// Quick broadcast message templates
const quickBroadcasts = [
  { label: 'Restart 15min', message: 'SERVER RESTART in 15 minutes - Please find a safe location!' },
  { label: 'Restart 5min', message: 'SERVER RESTART in 5 minutes - Save your progress!' },
  { label: 'Restart 1min', message: 'SERVER RESTART in 1 minute - Disconnecting soon!' },
  { label: 'Maintenance', message: 'Server entering MAINTENANCE MODE - Please disconnect' },
  { label: 'Back Online', message: 'Server maintenance complete - Welcome back!' },
  { label: 'Save Warning', message: 'Server is saving - Brief lag expected' },
]

export default function Console() {
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<CommandEntry[]>([])
  const [liveLog, setLiveLog] = useState<RconResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [commandHistoryIndex, setCommandHistoryIndex] = useState(-1)
  const [commandCache, setCommandCache] = useState<string[]>([])
  const [rconConnected, setRconConnected] = useState<boolean | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('all')
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [showBroadcast, setShowBroadcast] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [commandDraft, setCommandDraft] = useState('') // saves in-progress text while browsing history
  const liveLogIdRef = useRef(0) // monotonic counter for stable liveLog keys
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const socket = useSocket()
  
  // Server Console Log state
  const [serverLogLines, setServerLogLines] = useState<string[]>([])
  const [_serverLogSize, setServerLogSize] = useState(0)
  const [serverLogPath, setServerLogPath] = useState('')
  const [serverLogExists, setServerLogExists] = useState(false)
  const [serverLogLoading, setServerLogLoading] = useState(false)
  const [serverLogError, setServerLogError] = useState<string | null>(null)
  const serverLogErrorCountRef = useRef(0)
  const [serverLogAutoScroll, setServerLogAutoScroll] = useState(true)
  const [serverLogPaused, setServerLogPaused] = useState(false)
  const [serverLogFiltered, setServerLogFiltered] = useState(true) // Filter out noise by default
  const [consoleTab, setConsoleTab] = useState('server-log')

  // Console keyboard shortcuts
  usePageShortcut('a', () => setServerLogAutoScroll(prev => !prev))
  usePageShortcut('`', () => setConsoleTab(prev => prev === 'server-log' ? 'rcon' : 'server-log'))
  const serverLogRef = useRef<HTMLDivElement>(null)
  const serverLogIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const serverLogSizeRef = useRef(0) // Track size without recreating interval

  // Patterns to filter out (uninteresting/repetitive messages) - memoized to prevent recreation
  const noisePatterns = useMemo(() => [
    /moveZombie: There are no zombies/i,
    /ItemPickInfo -> cannot get ID for container/i,
    /IsoThumpable not found on square/i,
    /SpriteConfig\.initObjectInfo.*Invalid SpriteConfig/i,
    /MOWoodenWalFrame\.lua: replacing isoObject/i,
    /OreVein\{startPoint/i,
    /SkeletonBone not resolved for bone/i,
    /action was null, object: null/i,
    /Could not find item type for/i,
    /Canceled loading wrong transition/i,
  ], [])

  // Get filtered lines - memoized to prevent recalculation on every render
  const filteredLogLines = useMemo(() => {
    if (!serverLogFiltered) return serverLogLines
    return serverLogLines.filter(line => !noisePatterns.some(pattern => pattern.test(line)))
  }, [serverLogLines, serverLogFiltered, noisePatterns])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await rconApi.getHistory(50)
      setHistory(data.history || [])
      setCommandCache(data.history?.map((h: CommandEntry) => h.command).reverse() || [])
    } catch {
      toast({
        title: 'History Unavailable',
        description: 'Recent RCON command history could not be loaded.',
        variant: 'destructive',
      })
    }
  }, [toast])

  const testRconConnection = useCallback(async () => {
    setTestingConnection(true)
    try {
      const result = await configApi.testRcon()
      setRconConnected(result.success && result.connected)
    } catch {
      setRconConnected(false)
    } finally {
      setTestingConnection(false)
    }
  }, [])

  // Server Console Log functions
  const fetchServerLog = useCallback(async (initial = false) => {
    if (serverLogPausedRef.current && !initial) return
    
    try {
      if (initial) {
        setServerLogLoading(true)
        setServerLogError(null)
        serverLogErrorCountRef.current = 0
        const data = await serverApi.getConsoleLog(1000)
        setServerLogLines(data.lines || [])
        setServerLogSize(data.size || 0)
        serverLogSizeRef.current = data.size || 0
        setServerLogPath(data.path || '')
        setServerLogExists(data.exists || false)
      } else {
        // Stream new content - use ref to avoid stale closure
        const data = await serverApi.streamConsoleLog(serverLogSizeRef.current)
        if (data.newLines && data.newLines.length > 0) {
          setServerLogLines(prev => [...prev, ...data.newLines].slice(-500))
        }
        if (data.rotated) {
          // File was rotated, replace all content
          setServerLogLines(data.newLines || [])
        }
        setServerLogSize(data.currentSize || serverLogSizeRef.current)
        serverLogSizeRef.current = data.currentSize || serverLogSizeRef.current
        // Clear error state on any successful poll
        if (serverLogErrorCountRef.current > 0) {
          serverLogErrorCountRef.current = 0
          setServerLogError(null)
        }
      }
    } catch {
      serverLogErrorCountRef.current += 1
      if (serverLogErrorCountRef.current >= 3) {
        setServerLogError('Log stream unavailable — server may be offline')
      }
    } finally {
      setServerLogLoading(false)
    }
  }, []) // No deps - uses refs for mutable state

  const clearServerLog = async () => {
    try {
      await serverApi.clearConsoleLog()
      setServerLogLines([])
      setServerLogSize(0)
      toast({
        title: 'Log Cleared',
        description: 'Server console log has been cleared',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to clear server log',
        variant: 'destructive',
      })
    }
  }

  // Ref to track paused state for interval callback (avoids stale closure)
  const serverLogPausedRef = useRef(serverLogPaused)
  useEffect(() => {
    serverLogPausedRef.current = serverLogPaused
  }, [serverLogPaused])

  // Start/stop server log polling
  useEffect(() => {
    // Initial fetch
    fetchServerLog(true)
    
    // Poll every 2 seconds for new log content
    serverLogIntervalRef.current = setInterval(() => {
      if (!serverLogPausedRef.current && document.visibilityState !== 'hidden') {
        fetchServerLog(false)
      }
    }, 2000)
    
    return () => {
      if (serverLogIntervalRef.current) {
        clearInterval(serverLogIntervalRef.current)
      }
    }
  }, [fetchServerLog])

  // Auto-scroll server log
  useEffect(() => {
    if (serverLogAutoScroll && serverLogRef.current) {
      const el = serverLogRef.current
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    }
  }, [serverLogLines, serverLogAutoScroll])

  useEffect(() => {
    fetchHistory()
    testRconConnection()
    // Auto-focus input on mount
    inputRef.current?.focus()
  }, [fetchHistory, testRconConnection])

  useEffect(() => {
    if (socket) {
      const handleRconResponse = (data: RconResponse) => {
        const entry = { ...data, _id: ++liveLogIdRef.current } as RconResponse & { _id: number }
        setLiveLog(prev => [...prev, entry].slice(-100))
        // If we get a response, RCON is connected
        setRconConnected(true)
      }

      socket.on('rcon:response', handleRconResponse)

      return () => {
        socket.off('rcon:response', handleRconResponse)
      }
    }
  }, [socket])

  useEffect(() => {
    // Auto-scroll to bottom
    if (scrollRef.current) {
      const el = scrollRef.current
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    }
  }, [liveLog])

  const executeCommand = async () => {
    if (!command.trim()) return

    setLoading(true)
    try {
      const result = await rconApi.execute(command)
      
      // Update connection status based on result
      if (result.error?.includes('Server is not running') || result.error?.includes('ECONNREFUSED')) {
        setRconConnected(false)
      } else if (result.success) {
        setRconConnected(true)
      }
      
      // Add to live log only when socket updates are unavailable to avoid duplicates.
      if (!socket?.connected) {
        setLiveLog(prev => [...prev, {
          command,
          response: result.response || result.error || 'No response',
          success: result.success,
          timestamp: new Date().toISOString(),
          _id: ++liveLogIdRef.current,
        } as RconResponse & { _id: number }].slice(-100))
      }

      // Add to command cache (limit to 100 entries)
      setCommandCache(prev => [...prev.slice(-99), command])
      setCommandHistoryIndex(-1)
      setCommand('')
      
      // Re-focus input after command execution
      inputRef.current?.focus()
      
      fetchHistory()
    } catch (error) {
      setRconConnected(false)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Command failed',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (commandCache.length > 0) {
        // Stash the user's in-progress text the first time they leave the live input.
        if (commandHistoryIndex === -1) setCommandDraft(command)
        const newIndex = commandHistoryIndex < commandCache.length - 1
          ? commandHistoryIndex + 1
          : commandHistoryIndex
        setCommandHistoryIndex(newIndex)
        setCommand(commandCache[commandCache.length - 1 - newIndex] || '')
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (commandHistoryIndex > 0) {
        const newIndex = commandHistoryIndex - 1
        setCommandHistoryIndex(newIndex)
        setCommand(commandCache[commandCache.length - 1 - newIndex] || '')
      } else if (commandHistoryIndex === 0) {
        // Restore the draft they had typed before browsing history.
        setCommandHistoryIndex(-1)
        setCommand(commandDraft)
        setCommandDraft('')
      }
    }
  }

  const clearLog = () => {
    setLiveLog([])
  }



  const sendAnnouncement = async () => {
    if (!announcement.trim()) return

    setSendingAnnouncement(true)
    try {
      const cleaned = announcement.replace(/"/g, '\\"')
      const cmd = selectedChannel === 'all'
        ? `servermsg "${cleaned}"`
        : `servermsg "[${selectedChannel.toUpperCase()}] ${cleaned}"`
      const result = await rconApi.execute(cmd)

      setLiveLog(prev => [...prev, {
        command: cmd,
        response: result.response || result.error || 'Broadcast sent',
        success: result.success,
        timestamp: new Date().toISOString(),
        _id: ++liveLogIdRef.current,
      } as RconResponse & { _id: number }].slice(-100))

      if (result.success) {
        toast({
          title: 'Broadcast Sent',
          description: selectedChannel === 'all'
            ? 'Your message was broadcast to all players'
            : `Sent with the [${selectedChannel.toUpperCase()}] tag`,
          variant: 'success' as const,
        })
        setAnnouncement('')
        setRconConnected(true)
      } else {
        throw new Error(result.error || 'Failed to send broadcast')
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send broadcast',
        variant: 'destructive',
      })
    } finally {
      setSendingAnnouncement(false)
    }
  }



  return (
    <div className="space-y-6 page-transition">
      <PageHeader
        title="Console"
        description="Server log output and RCON commands"
        tone="ops"
        icon={<TerminalIcon className="w-5 h-5" />}
      />
      <Tabs value={consoleTab} onValueChange={setConsoleTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="server-log" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Server Console
          </TabsTrigger>
          <TabsTrigger value="rcon" className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4" />
            RCON Console
          </TabsTrigger>
        </TabsList>

        {/* Server Console Log Tab */}
        <TabsContent value="server-log" className="space-y-0">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
            <p className="text-xs text-muted-foreground font-mono truncate">
              {serverLogPath ? serverLogPath : 'Loading...'}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {serverLogLoading && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setServerLogPaused(!serverLogPaused)}
                aria-label={serverLogPaused ? 'Resume auto-update' : 'Pause auto-update'}
              >
                {serverLogPaused ? (
                  <Play className="w-4 h-4" />
                ) : (
                  <Pause className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setServerLogFiltered(!serverLogFiltered)}
                aria-label={serverLogFiltered ? 'Show all messages (including noise)' : 'Filter out repetitive messages'}
                className={serverLogFiltered ? 'text-primary' : ''}
              >
                <Filter className="w-4 h-4 mr-1" />
                <span className="text-xs">{serverLogFiltered ? 'Filtered' : 'All'}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setServerLogAutoScroll(!serverLogAutoScroll)}
                aria-label={serverLogAutoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
                className={serverLogAutoScroll ? 'text-primary' : ''}
              >
                <span className="text-xs">Auto-scroll</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchServerLog(true)}
                aria-label="Refresh log"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="destructive" size="sm" onClick={clearServerLog}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear the log display (does not delete the server log file)</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Error banner when log polling fails repeatedly */}
          {serverLogError && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="flex-1">{serverLogError}</span>
              <Button variant="ghost" size="sm" className="h-9 px-3 text-xs" onClick={() => fetchServerLog(true)}>
                Retry
              </Button>
            </div>
          )}

          {/* Terminal pane */}
          {!serverLogExists ? (
            <div className="flex h-[calc(100vh-340px)] min-h-[300px] items-center justify-center rounded-lg border border-border/50 bg-muted/20 p-4">
              <EmptyState type="serverOffline" title="Server console log not found" description="Make sure the server is running" compact />
            </div>
          ) : (
            <div
              ref={serverLogRef}
              role="log"
              aria-live="polite"
              aria-label="Server console output"
              className="h-[calc(100vh-340px)] min-h-[300px] overflow-auto rounded-lg border border-border/30 bg-black/40 p-3 font-mono text-xs terminal-output"
            >
              {filteredLogLines.length === 0 ? (
                <div className="p-2 text-muted-foreground">
                  {serverLogFiltered && serverLogLines.length > 0 ? (
                    <span>
                      All {serverLogLines.length} lines were hidden by the filter.{' '}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-primary"
                        onClick={() => setServerLogFiltered(false)}
                      >
                        Show all messages
                      </button>
                    </span>
                  ) : (
                    'Console log is empty.'
                  )}
                </div>
              ) : (
                filteredLogLines.map((line, index) => (
                  <ServerLogLine key={index} line={line} />
                ))
              )}
            </div>
          )}
          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>
              {serverLogFiltered 
                ? `${filteredLogLines.length} lines shown (${serverLogLines.length - filteredLogLines.length} filtered)` 
                : `${serverLogLines.length} lines loaded`}
            </span>
            <span>{serverLogPaused ? 'Live updates paused' : 'Updates every 2 seconds'}</span>
          </div>
        </TabsContent>

        {/* RCON Console Tab */}
        <TabsContent value="rcon" className="space-y-4">
          <div className="flex items-center justify-end gap-2">
            {testingConnection ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Checking connection...</span>
              </div>
            ) : rconConnected === null ? (
              <StatusIndicator state="unknown" label="RCON status unknown" />
            ) : rconConnected ? (
              <StatusIndicator state="online" label="RCON connected" />
            ) : (
              <StatusIndicator state="offline" label="RCON disconnected" />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={testRconConnection}
              disabled={testingConnection}
            >
              Check again
            </Button>
          </div>

          {/* RCON Disconnected Warning */}
          {rconConnected === false && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/8 p-4">
              <WifiOff className="w-5 h-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">RCON Not Connected</p>
                <p className="text-sm text-muted-foreground">
                  Start the server, then confirm the RCON host, port, and password in Panel Settings.
                </p>
              </div>
            </div>
          )}

          {/* Console Output (primary surface) */}
          <div>
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <TerminalIcon className="w-4 h-4" />
                Console Output
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={clearLog} disabled={liveLog.length === 0}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear the visible output (does not delete history)</TooltipContent>
              </Tooltip>
            </div>
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-label="RCON command output"
              className="h-[18rem] min-h-[220px] sm:h-[22rem] lg:h-[26rem] overflow-auto rounded-lg border border-border/30 bg-black/40 p-3 terminal-output"
            >
              {liveLog.length === 0 ? (
                <EmptyState compact type="noMessages" title="No commands yet" description="Run an RCON command to see the response here." />
              ) : (
                liveLog.map((entry, idx) => (
                  <div key={(entry as RconResponse & { _id?: number })._id ?? `${entry.timestamp}-${idx}`} className="mb-3 font-mono text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-primary">{'>'}</span>
                      <span className="text-foreground/90">{entry.command}</span>
                      <span className="text-muted-foreground text-xs ml-auto">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className={cn('ml-4 text-xs', entry.success ? 'text-foreground/85' : 'text-destructive')}>
                      {entry.response.split('\n').map((line, i) => (
                        <div key={`line-${i}`}>{line || '\u00A0'}</div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Quick Commands (close to the input where they'll be used) */}
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              <span className="text-xs text-muted-foreground font-medium mr-1">Quick:</span>
              {quickCommands.map((qc) => (
                <Button
                  key={qc.command}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setCommand(qc.command)
                    inputRef.current?.focus()
                  }}
                  disabled={rconConnected === false}
                >
                  {qc.label}
                </Button>
              ))}
            </div>

            {/* Command Input */}
            <div className="flex gap-2 mt-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" aria-hidden="true">{'>'}</span>
                <Input
                  ref={inputRef}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type an RCON command..."
                  className="pl-8 font-mono"
                  disabled={loading}
                  maxLength={2000}
                  aria-label="RCON command input"
                />
              </div>
              <Button
                onClick={executeCommand}
                disabled={loading || !command.trim()}
                aria-label="Execute command"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Press Enter to run. Use ↑ and ↓ to reuse earlier commands.
            </p>
          </div>

          {/* Broadcast (collapsible) */}
          <div className="rounded-lg border border-border/40">
            <button
              type="button"
              onClick={() => setShowBroadcast(v => !v)}
              aria-expanded={showBroadcast}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 rounded-lg transition-colors"
            >
              <span className="flex items-center gap-2">
                <Megaphone className="w-4 h-4" />
                Broadcast Message
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  Send a message to everyone online
                </span>
              </span>
              <ChevronDown className={cn('w-4 h-4 transition-transform', showBroadcast && 'rotate-180')} />
            </button>
            {showBroadcast && (
              <div className="border-t border-border/40 p-4 space-y-3">
                {/* Quick templates */}
                <div className="flex flex-wrap gap-1.5">
                  {quickBroadcasts.map((qb) => (
                    <Button
                      key={qb.label}
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setAnnouncement(qb.message)}
                      disabled={rconConnected === false}
                    >
                      {qb.label}
                    </Button>
                  ))}
                </div>

                {/* Channel tag selector */}
                <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start">
                  <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                    <SelectTrigger aria-label="Channel tag">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {chatChannels.map((channel) => (
                        <SelectItem key={channel.value} value={channel.value}>
                          <div className="flex flex-col">
                            <span>{channel.label}</span>
                            <span className="text-xs text-muted-foreground">{channel.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    value={announcement}
                    onChange={(e) => setAnnouncement(e.target.value)}
                    placeholder={selectedChannel === 'all'
                      ? 'Write the message players should see…'
                      : `Tagged [${selectedChannel.toUpperCase()}] — write the message…`}
                    aria-label="Broadcast message"
                    className="min-h-[80px]"
                    maxLength={500}
                    disabled={sendingAnnouncement || rconConnected === false}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Sends via <code className="text-foreground/80">servermsg</code>. Tags are cosmetic — RCON cannot route to real chat channels.
                  </p>
                  <Button
                    onClick={sendAnnouncement}
                    disabled={sendingAnnouncement || !announcement.trim() || rconConnected === false}
                  >
                    {sendingAnnouncement ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Command History (collapsible) */}
          <div className="rounded-lg border border-border/40">
            <button
              type="button"
              onClick={() => setShowHistory(v => !v)}
              aria-expanded={showHistory}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 rounded-lg transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Command History
                {history.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal ml-1">
                    {history.length} entr{history.length === 1 ? 'y' : 'ies'}
                  </span>
                )}
              </span>
              <ChevronDown className={cn('w-4 h-4 transition-transform', showHistory && 'rotate-180')} />
            </button>
            {showHistory && (
              <div className="border-t border-border/40 p-3 space-y-2">
                <div className="relative">
                  <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search command history..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                    aria-label="Search command history"
                  />
                </div>
                <ScrollArea className="h-[16rem] min-h-[200px] sm:h-[20rem] rounded-lg border border-border/30 bg-black/40">
                  {history.length === 0 ? (
                    <EmptyState compact type="noData" title="No command history" description="Commands you run will be logged here." />
                  ) : (
                    <div className="space-y-1 p-2">
                      {history
                        .filter(entry =>
                          !historySearch ||
                          entry.command.toLowerCase().includes(historySearch.toLowerCase()) ||
                          entry.response?.toLowerCase().includes(historySearch.toLowerCase())
                        )
                        .map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className="w-full text-left p-2.5 rounded-md hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => {
                            setCommand(entry.command)
                            inputRef.current?.focus()
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <code className="text-sm font-mono text-primary truncate">{entry.command}</code>
                            <span className="text-xs text-muted-foreground">
                              {new Date(entry.executed_at).toLocaleString()}
                            </span>
                          </div>
                          {entry.response && (
                            <p className={cn('mt-1 truncate text-xs font-mono', entry.success ? 'text-muted-foreground' : 'text-destructive')}>
                              {entry.response}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
