import { useState, useEffect, useCallback, useRef } from 'react'
import { 
  MessagesSquare,
  Send,
  Users,
  Megaphone,
  Loader2,
  RefreshCw,
  Info,
  AlertCircle,
  Shield,
  MessageSquare,
  Bell
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/components/ui/use-toast'
import { panelBridgeApi, playersApi, rconApi } from '@/lib/api'
import { useSocket } from '@/contexts/SocketContext'
import { EmptyState } from '@/components/EmptyState'
import { BridgeStatusBadge } from '@/components/BridgeStatusBadge'
import { cn } from '@/lib/utils'
import { reportClientError } from '@/lib/client-errors'

interface ChatMessage {
  id: string
  type: 'server' | 'admin' | 'general' | 'alert'
  author?: string
  message: string
  timestamp: Date
}

interface Player {
  name: string
  online: boolean
}

type ChatChannel = 'server' | 'admin' | 'general' | 'alert'

const channelTone: Record<ChatChannel, { surface: string; icon: string; label: string }> = {
  server: {
    surface: 'border-border/60 bg-muted/30',
    icon: 'text-primary',
    label: 'text-foreground/90',
  },
  alert: {
    surface: 'border-warning/20 bg-warning/10',
    icon: 'text-warning',
    label: 'text-warning',
  },
  admin: {
    surface: 'border-destructive/20 bg-destructive/10',
    icon: 'text-destructive',
    label: 'text-destructive',
  },
  general: {
    surface: 'border-primary/20 bg-primary/10',
    icon: 'text-primary',
    label: 'text-primary',
  },
}

export default function Chat() {
  const [message, setMessage] = useState('')
  const [channel, setChannel] = useState<ChatChannel>('server')
  const [authorName, setAuthorName] = useState('Server')
  const [players, setPlayers] = useState<Player[]>([])
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [bridgeLoading, setBridgeLoading] = useState(true)
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const { toast } = useToast()
  const socket = useSocket()

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [chatHistory])

  const fetchPlayers = useCallback(async () => {
    try {
      const data = await playersApi.getPlayers()
      if (data.players) {
        setPlayers(data.players)
      }
    } catch (error) {
      reportClientError('Failed to fetch players.', error)
    }
  }, [])

  const checkBridgeStatus = useCallback(async () => {
    try {
      setBridgeLoading(true)
      const status = await panelBridgeApi.getStatus()
      setBridgeConnected(status.modConnected && status.isRunning)
    } catch {
      setBridgeConnected(false)
    } finally {
      setBridgeLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPlayers()
    checkBridgeStatus()
    const interval = setInterval(() => {
      fetchPlayers()
    }, 15000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPlayers]) // checkBridgeStatus only runs once on mount, socket handles updates

  // Listen for bridge status updates via socket
  useEffect(() => {
    if (socket) {
      const handleBridgeStatus = (data: { isRunning?: boolean; modConnected?: boolean }) => {
        setBridgeConnected(prev => {
          const isRunning = data.isRunning ?? prev
          const modConnected = data.modConnected ?? prev
          return Boolean(isRunning && modConnected)
        })
      }

      const handleBridgeModStatus = (data: { alive?: boolean }) => {
        setBridgeConnected(prev => Boolean(prev && data.alive))
      }

      const handleSocketMessage = (data: { id?: string; author?: string; message?: string; timestamp?: string }) => {
        const msg = data.message
        if (!msg) return
        setChatHistory(prev => {
             // Deduplication: Check if we have a message with same content/author in last 2 seconds
             // This prevents echoing our own messages if we optimistically added them
             const recent = prev.slice(-5);
             const isDuplicate = recent.some(m => 
                 m.message === msg && 
                 m.author === data.author &&
                 Math.abs(m.timestamp.getTime() - new Date(data.timestamp || Date.now()).getTime()) < 2000
             );
             if (isDuplicate) return prev;

             const newMessage: ChatMessage = {
                id: data.id || Date.now().toString(),
                type: 'general',
                author: data.author,
                message: msg,
                timestamp: new Date(data.timestamp || Date.now())
             };

             return [...prev, newMessage].slice(-200);
        });
      }

      socket.on('panelBridge:status', handleBridgeStatus)
      socket.on('panelBridge:modStatus', handleBridgeModStatus)
      socket.on('chat:message', handleSocketMessage)

      return () => {
        socket.off('panelBridge:status', handleBridgeStatus)
        socket.off('panelBridge:modStatus', handleBridgeModStatus)
        socket.off('chat:message', handleSocketMessage)
      }
    }
  }, [socket])

  const getChannelLabel = (ch: ChatChannel): string => {
    switch (ch) {
      case 'server': return 'Server Chat'
      case 'admin': return 'Admin Only'
      case 'general': return 'General'
      case 'alert': return 'Alert'
      default: return ch
    }
  }

  const sendMessage = async () => {
    if (!message.trim() || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      let result
      let channelLabel = getChannelLabel(channel)

      if (bridgeConnected) {
        // Use powerful Mod API if available
        switch (channel) {
            case 'server':
            result = await panelBridgeApi.sendToServerChat(message, false)
            break
            case 'alert':
            result = await panelBridgeApi.sendToServerChat(message, true)
            channelLabel = 'Alert'
            break
            case 'admin':
            result = await panelBridgeApi.sendToAdminChat(message)
            break
            case 'general':
            result = await panelBridgeApi.sendToGeneralChat(message, authorName)
            channelLabel = authorName.trim() || 'Server'
            break
        }
      } else {
        // Fallback to RCON
        // RCON works best for 'server' broadcasts.
        // For general/admin, we just use servermsg with prefix
        const safeMessage = message.replace(/"/g, '\\"');
        
        switch (channel) {
            case 'server':
            case 'alert':
                result = await rconApi.execute(`servermsg "${safeMessage}"`)
                break;
            default:
                // Prepend author or context since we can't truly impersonate via RCON easily
                const prefix = channel === 'admin' ? '[Admin]' : `[${authorName}]`;
                result = await rconApi.execute(`servermsg "${prefix} ${safeMessage}"`)
                break;
        }
      }

      if (result?.success) {
        // Add to local chat history (keep last 200 messages)
        // With LogTailer, this might duplicate if we are fast enough, but our dedup logic should handle it
        setChatHistory(prev => [...prev, {
          id: Date.now().toString(),
          type: channel,
          author: channel === 'general' ? authorName : 'Server',
          message: message,
          timestamp: new Date()
        }].slice(-200))
        setMessage('')
        toast({
          title: 'Transmission Sent',
          description: `Routed cleanly to ${channelLabel}`,
          variant: 'success' as const,
        })
      } else {
        throw new Error(result?.error || 'Failed to send message')
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send message',
        variant: 'destructive',
      })
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const getMessageStyle = (type: ChatChannel) => {
    return cn('ml-4 rounded-xl border px-3 py-3', channelTone[type].surface)
  }

  const getMessageIcon = (type: ChatChannel) => {
    switch (type) {
      case 'alert':
        return <Bell className={cn('w-3 h-3', channelTone[type].icon)} />
      case 'admin':
        return <Shield className={cn('w-3 h-3', channelTone[type].icon)} />
      case 'general':
        return <MessageSquare className={cn('w-3 h-3', channelTone[type].icon)} />
      default:
        return <Megaphone className={cn('w-3 h-3', channelTone[type].icon)} />
    }
  }

  return (
    <div className="space-y-6 page-transition">
      <PageHeader
        title="In-Game Chat"
        description="Send server, alert, admin, or custom-name messages through PanelBridge, with RCON fallback for standard broadcasts."
        icon={<MessagesSquare className="w-5 h-5" />}
        actions={
          <div className="flex items-center gap-2">
            <BridgeStatusBadge connected={bridgeConnected} loading={bridgeLoading} />
            <Button variant="outline" size="sm" onClick={() => { fetchPlayers(); checkBridgeStatus() }} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Bridge Warning */}
      {!bridgeConnected && !bridgeLoading && (
        <Card className="border-warning/25 bg-warning/8">
          <CardContent className="flex items-center gap-4 py-4">
            <AlertCircle className="w-5 h-5 text-warning shrink-0" />
            <div>
              <p className="font-medium text-warning">PanelBridge Not Connected</p>
              <p className="text-sm text-muted-foreground">
                Standard broadcasts can still go out through RCON. Reconnect PanelBridge for admin chat, custom author names, and richer routing controls.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat Window */}
        <div className="lg:col-span-2">
          <Card className="h-[50vh] min-h-[300px] sm:h-[500px] md:h-[600px] flex flex-col">
            <CardHeader className="pb-3 border-b shrink-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessagesSquare className="w-4 h-4 text-primary" />
                Server Chat
              </CardTitle>
              <CardDescription>Send a live message to connected players.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0 min-h-0">
              {/* Messages Area */}
              <ScrollArea className="flex-1 px-4" role="log" aria-live="polite" aria-label="Chat messages">
                <div className="py-4 space-y-3">
                  {chatHistory.length === 0 ? (
                    <EmptyState type="noMessages" title="No chat messages yet" description={bridgeConnected ? "Send a message to start the chat log." : "Connect PanelBridge in Settings or send an RCON broadcast below."} compact />
                  ) : (
                    chatHistory.map((msg) => (
                      <div
                        key={msg.id}
                        className={getMessageStyle(msg.type)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {getMessageIcon(msg.type)}
                            <span className={cn('text-xs font-medium', channelTone[msg.type].label)}>
                              {msg.type === 'general' && msg.author ? msg.author : getChannelLabel(msg.type)}
                            </span>
                          </div>
                          <time dateTime={msg.timestamp.toISOString()} className="text-xs text-muted-foreground">
                            {msg.timestamp.toLocaleTimeString()}
                          </time>
                        </div>
                        <p className="text-sm break-words [overflow-wrap:anywhere]">{msg.message}</p>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t bg-muted/30">
                <div className="flex flex-wrap gap-2 mb-3">
                  <Select value={channel} onValueChange={(v) => setChannel(v as ChatChannel)}>
                    <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Chat channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="server">
                        <div className="flex items-center gap-2">
                          <Megaphone className="w-4 h-4" />
                          Server Chat
                        </div>
                      </SelectItem>
                      <SelectItem value="alert">
                        <div className="flex items-center gap-2">
                          <Bell className="w-4 h-4 text-warning" />
                          Alert (high visibility)
                        </div>
                      </SelectItem>
                      <SelectItem value="admin">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-destructive" />
                          Admin Only
                        </div>
                      </SelectItem>
                      <SelectItem value="general">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-primary" />
                          Custom name
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {channel === 'general' && (
                    <Input
                      placeholder="Display name"
                      aria-label="Display name for custom chat messages"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      maxLength={32}
                      className="h-11 w-full sm:w-36"
                    />
                  )}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Write a message... (Enter to send)"
                    aria-label="Chat message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                    maxLength={500}
                    className="h-11 flex-1"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={sending || !message.trim()}
                    className="h-11 min-w-28 gap-2"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Online Players */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="w-4 h-4 text-primary" />
                Online Players
              </CardTitle>
              <CardDescription>{players.length} players</CardDescription>
            </CardHeader>
            <CardContent>
              {players.length === 0 ? (
                <EmptyState type="noPlayers" compact title="No players online" description="No players are online right now." />
              ) : (
                <div className="space-y-2">
                  {players.map((player) => (
                    <div key={player.name} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
                      <span className="text-sm font-medium truncate">{player.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Chat Types Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="w-4 h-4 text-muted-foreground" />
                Chat Types
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div className="flex items-start gap-2">
                <Megaphone className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <div>
                  <strong className="text-foreground">Server Chat:</strong>
                  <span className="text-muted-foreground"> Standard message shown to everyone online.</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Bell className="w-4 h-4 mt-0.5 text-warning shrink-0" />
                <div>
                  <strong className="text-foreground">Alert:</strong>
                  <span className="text-muted-foreground"> Higher-visibility message for everyone online.</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
                <div>
                  <strong className="text-foreground">Admin Only:</strong>
                  <span className="text-muted-foreground"> Visible only to admins in game.</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MessageSquare className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <div>
                  <strong className="text-foreground">Custom Author:</strong>
                  <span className="text-muted-foreground"> Sends a general chat message with the display name you choose.</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Messages */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Megaphone className="w-4 h-4 text-warning" />
                Quick Messages
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                'Server will restart in 5 minutes!',
                'Welcome to the server!',
                'Please read the rules at /rules',
                'Server maintenance starting soon',
                'Have fun and stay safe!'
              ].map((quickMsg) => (
                <Button
                  key={quickMsg}
                  variant="outline"
                  size="sm"
                  className="min-h-11 w-full justify-start whitespace-normal px-3 py-2 text-left"
                  onClick={() => setMessage(quickMsg)}
                >
                  {quickMsg}
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
