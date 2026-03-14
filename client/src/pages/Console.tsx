import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react'
import { Terminal as TerminalIcon, Send, Trash2, WifiOff, Loader2, Megaphone, MessageCircle, FileText, RefreshCw, Pause, Play, Filter } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { rconApi, configApi, serverApi } from '@/lib/api'
import { useSocket } from '@/contexts/SocketContext'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { StatusIndicator } from '@/components/StatusIndicator'
import { cn } from '@/lib/utils'

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
    return {
      type: match[1].toUpperCase() as ParsedLogLine['type'],
      category: match[2],
      message: match[3],
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

// Chat channels available in PZ
const chatChannels = [
  { value: 'say', label: 'Local (Say)', description: 'Nearby players only' },
  { value: 'all', label: 'General', description: 'All players' },
  { value: 'admin', label: 'Admin', description: 'Admin chat' },
  { value: 'faction', label: 'Faction', description: 'Faction members' },
  { value: 'safehouse', label: 'Safehouse', description: 'Safehouse members' },
]

// Memoized log line to avoid re-rendering unchanged lines
const ServerLogLine = memo(function ServerLogLine({ line }: { line: string }) {
  const parsed = parseLogLine(line)
  if (!parsed.message && !parsed.raw.trim()) return null

  return (
    <div
      className={cn(
        'mb-1 rounded-md border-l px-2 py-1.5',
        parsed.type === 'ERROR'
          ? 'border-destructive/30 bg-destructive/10'
          : parsed.type === 'WARN'
            ? 'border-warning/30 bg-warning/10'
            : parsed.type === 'INFO'
              ? 'border-primary/18 bg-primary/10'
              : 'border-border/35 bg-transparent'
      )}
    >
      <div className="flex items-start gap-2">
        {parsed.type !== 'UNKNOWN' && (
          <span className={`px-1.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide shrink-0 ${typeBadgeColors[parsed.type]}`}>
            {parsed.type}
          </span>
        )}
        {parsed.category && (
          <span className="shrink-0 text-muted-foreground">[{parsed.category}]</span>
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
  const [channelMessage, setChannelMessage] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('say')
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false)
  const [sendingChannelMessage, setSendingChannelMessage] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const socket = useSocket()
  
  // Server Console Log state
  const [serverLogLines, setServerLogLines] = useState<string[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_serverLogSize, setServerLogSize] = useState(0)
  const [serverLogPath, setServerLogPath] = useState('')
  const [serverLogExists, setServerLogExists] = useState(false)
  const [serverLogLoading, setServerLogLoading] = useState(false)
  const [serverLogError, setServerLogError] = useState<string | null>(null)
  const serverLogErrorCountRef = useRef(0)
  const [serverLogAutoScroll, setServerLogAutoScroll] = useState(true)
  const [serverLogPaused, setServerLogPaused] = useState(false)
  const [serverLogFiltered, setServerLogFiltered] = useState(true) // Filter out noise by default
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
        title: 'History unavailable',
        description: 'Recent RCON command history could not be loaded.',
        variant: 'destructive',
      })
    }
  }, [])

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
      if (!serverLogPausedRef.current) {
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
        setLiveLog(prev => [...prev, data].slice(-100))
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
          timestamp: new Date().toISOString()
        }].slice(-100))
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
        setCommandHistoryIndex(-1)
        setCommand('')
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
      const result = await rconApi.execute(`servermsg "${announcement.replace(/"/g, '\\"')}"`)
      
      setLiveLog(prev => [...prev, {
        command: `servermsg "${announcement}"`,
        response: result.response || result.error || 'Announcement sent',
        success: result.success,
        timestamp: new Date().toISOString()
      }].slice(-100))
      
      if (result.success) {
        toast({
          title: 'Announcement Sent',
          description: 'Your message was broadcast to all players',
          variant: 'success' as const,
        })
        setAnnouncement('')
        setRconConnected(true)
      } else {
        throw new Error(result.error || 'Failed to send announcement')
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send announcement',
        variant: 'destructive',
      })
    } finally {
      setSendingAnnouncement(false)
    }
  }

  const sendChannelMessage = async () => {
    if (!channelMessage.trim()) return
    
    setSendingChannelMessage(true)
    try {
      // Use the appropriate command based on channel
      // PZ uses: additem/say commands or direct chat commands
      const chatCommand = selectedChannel === 'all' 
        ? `servermsg "${channelMessage.replace(/"/g, '\\"')}"` 
        : `servermsg "[${selectedChannel.toUpperCase()}] ${channelMessage.replace(/"/g, '\\"')}"`
      
      const result = await rconApi.execute(chatCommand)
      
      setLiveLog(prev => [...prev, {
        command: chatCommand,
        response: result.response || result.error || 'Message sent',
        success: result.success,
        timestamp: new Date().toISOString()
      }].slice(-100))
      
      if (result.success) {
        toast({
          title: 'Message Sent',
          description: `Message sent to ${chatChannels.find(c => c.value === selectedChannel)?.label || selectedChannel}`,
          variant: 'success' as const,
        })
        setChannelMessage('')
        setRconConnected(true)
      } else {
        throw new Error(result.error || 'Failed to send message')
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send message',
        variant: 'destructive',
      })
    } finally {
      setSendingChannelMessage(false)
    }
  }



  return (
    <div className="space-y-4 sm:space-y-6 page-transition">
      <PageHeader
        title="Console"
        description="Server console output and RCON commands"
        icon={<TerminalIcon className="w-5 h-5 text-primary" />}
      />

      <Tabs defaultValue="server-log" className="w-full">
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
                title={serverLogPaused ? 'Resume auto-update' : 'Pause auto-update'}
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
                title={serverLogFiltered ? 'Show all messages (including noise)' : 'Filter out repetitive messages'}
                className={serverLogFiltered ? 'text-primary' : ''}
              >
                <Filter className="w-4 h-4 mr-1" />
                <span className="text-xs">{serverLogFiltered ? 'Filtered' : 'All'}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setServerLogAutoScroll(!serverLogAutoScroll)}
                title={serverLogAutoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
                className={serverLogAutoScroll ? 'text-primary' : ''}
              >
                <span className="text-xs">Auto-scroll</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchServerLog(true)}
                title="Refresh log"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={clearServerLog}>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>

          {/* Error banner when log polling fails repeatedly */}
          {serverLogError && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="flex-1">{serverLogError}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => fetchServerLog(true)}>
                Retry
              </Button>
            </div>
          )}

          {/* Terminal pane */}
          {!serverLogExists ? (
            <div className="flex h-[55vh] min-h-[300px] items-center justify-center rounded-lg border border-border/50 bg-muted/20 p-4">
              <EmptyState type="serverOffline" title="Server console log not found" description="Make sure the server is running" compact />
            </div>
          ) : (
            <div
              ref={serverLogRef}
              className="h-[55vh] min-h-[300px] overflow-auto rounded-lg border border-border/30 bg-black/40 p-3 font-mono text-xs terminal-output"
            >
              {filteredLogLines.length === 0 ? (
                <p className="text-muted-foreground p-2">{serverLogFiltered && serverLogLines.length > 0 ? 'All messages filtered out. Try disabling the filter.' : 'Console log is empty.'}</p>
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

      {/* Quick Commands */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">Quick:</span>
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
          >
            {qc.label}
          </Button>
        ))}
      </div>

      {/* Messaging Section */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Server Announcement */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="w-5 h-5" />
              Server Announcement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send one message to everyone currently online.
            </p>
            
            {/* Quick Broadcast Templates */}
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
            
            <Textarea
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="Write the announcement players should see..."
              className="min-h-[80px]"
              maxLength={500}
              disabled={sendingAnnouncement || rconConnected === false}
            />
            <Button 
              onClick={sendAnnouncement} 
              disabled={sendingAnnouncement || !announcement.trim() || rconConnected === false}
              className="w-full"
            >
              {sendingAnnouncement ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Megaphone className="w-4 h-4 mr-2" />
              )}
              Send Announcement
            </Button>
          </CardContent>
        </Card>

        {/* Channel Message */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="w-5 h-5" />
              Channel Message
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send one message to a specific chat channel through RCON.
            </p>
            <Select value={selectedChannel} onValueChange={setSelectedChannel}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a channel" />
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
            <Input
              value={channelMessage}
              onChange={(e) => setChannelMessage(e.target.value)}
              placeholder="Write the message for this channel..."
              disabled={sendingChannelMessage || rconConnected === false}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && sendChannelMessage()}
            />
            <Button 
              onClick={sendChannelMessage} 
              disabled={sendingChannelMessage || !channelMessage.trim() || rconConnected === false}
              className="w-full"
            >
              {sendingChannelMessage ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send to {chatChannels.find(c => c.value === selectedChannel)?.label || 'Channel'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Console */}
      <div>
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <TerminalIcon className="w-4 h-4" />
            Console Output
          </div>
          <Button variant="ghost" size="sm" onClick={clearLog}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
        <div 
          ref={scrollRef}
          className="h-[35vh] min-h-[200px] sm:h-[40vh] overflow-auto rounded-lg border border-border/30 bg-black/40 p-3 terminal-output"
        >
          {liveLog.length === 0 ? (
            <p className="text-muted-foreground font-mono text-xs">No commands yet. Run an RCON command to see the response here.</p>
          ) : (
            liveLog.map((entry) => (
              <div key={`${entry.timestamp}-${entry.command}`} className="mb-3 font-mono text-sm">
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

          {/* Quick Commands */}
          <div className="flex flex-wrap gap-2 mt-4">
             {['players', 'save', 'quit', 'broadcast', 'chopper', 'gunfire'].map(cmd => (
               <Button
                 key={cmd}
                 variant="outline"
                 size="sm"
                 className="h-7 text-xs font-mono"
                 onClick={() => {
                    const newCommand = cmd === 'broadcast' ? 'servermsg "Message"' : cmd
                    setCommand(newCommand)
                    inputRef.current?.focus()
                    // If broadcast, select the message part for easy editing
                    if (cmd === 'broadcast') {
                      setTimeout(() => inputRef.current?.setSelectionRange(11, 18), 10)
                    }
                 }}
               >
                 {cmd}
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
            Press Enter to run the command. Use ↑ and ↓ to reuse earlier commands.
          </p>
      </div>

      {/* Command History */}
      <div>
        <div className="flex items-center justify-between pb-2">
          <span className="text-sm font-medium text-foreground">Command History</span>
          <div className="relative w-full sm:w-48">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search command history..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                aria-label="Search command history"
              />
            </div>
          </div>
          <ScrollArea className="h-[35vh] min-h-[200px] rounded-lg border border-border/30 bg-black/40">
            {history.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 font-mono text-xs">No command history yet.</p>
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
