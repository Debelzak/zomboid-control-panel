import { useState, useEffect, useCallback, useRef } from 'react'
import { 
  MessagesSquare,
  Send,
  Users,
  Megaphone,
  Loader2,
  RefreshCw,
  Shield,
  MessageSquare,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/components/ui/use-toast'
import { panelBridgeApi, playersApi } from '@/lib/api'
import { useSocket } from '@/contexts/SocketContext'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import { reportClientError } from '@/lib/client-errors'

interface ChatMessage {
  id: string
  type: string
  author?: string
  message: string
  timestamp: Date
}

interface Player {
  name: string
  online: boolean
}

export default function Chat() {
  const [message, setMessage] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  
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

  useEffect(() => {
    fetchPlayers()
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchPlayers()
    }, 15000)
    return () => clearInterval(interval)
  }, [fetchPlayers])

  // Listen for chat messages from the server log tailer
  useEffect(() => {
    if (socket) {
      const handleSocketMessage = (data: { id?: string; type?: string; author?: string; message?: string; timestamp?: string }) => {
        const msg = data.message
        if (!msg) return
        setChatHistory(prev => {
             const recent = prev.slice(-5);
             const isDuplicate = recent.some(m => 
                 m.message === msg && 
                 m.author === data.author &&
                 Math.abs(m.timestamp.getTime() - new Date(data.timestamp || Date.now()).getTime()) < 2000
             );
             if (isDuplicate) return prev;

             const newMessage: ChatMessage = {
                id: data.id || Date.now().toString(),
                type: data.type || 'general',
                author: data.author,
                message: msg,
                timestamp: new Date(data.timestamp || Date.now())
             };

             return [...prev, newMessage].slice(-200);
        });
      }

      socket.on('chat:message', handleSocketMessage)
      return () => { socket.off('chat:message', handleSocketMessage) }
    }
  }, [socket])

  const sendMessage = async () => {
    if (!message.trim() || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      // Uses RCON servermsg as primary (handled by backend)
      const result = await panelBridgeApi.sendToServerChat(message, false)

      if (result?.success) {
        setChatHistory(prev => [...prev, {
          id: Date.now().toString(),
          type: 'server',
          author: 'Server',
          message: message,
          timestamp: new Date()
        }].slice(-200))
        setMessage('')
        toast({
          title: 'Broadcast Sent',
          description: 'Message delivered to all connected players.',
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

  const getMessageStyle = (type: string) => {
    if (type === 'server') return 'ml-4 rounded-xl border px-3 py-3 border-warning/20 bg-warning/10'
    if (type === 'admin') return 'ml-4 rounded-xl border px-3 py-3 border-destructive/20 bg-destructive/10'
    return 'ml-4 rounded-xl border px-3 py-3 border-border/60 bg-muted/30'
  }

  const getMessageMeta = (msg: ChatMessage) => {
    if (msg.type === 'server') return { icon: <Megaphone className="w-3 h-3 text-warning" />, label: msg.author || 'Server', labelClass: 'text-warning' }
    if (msg.type === 'admin') return { icon: <Shield className="w-3 h-3 text-destructive" />, label: msg.author || 'Admin', labelClass: 'text-destructive' }
    return { icon: <MessageSquare className="w-3 h-3 text-primary" />, label: msg.author || 'Player', labelClass: 'text-primary' }
  }

  return (
    <div className="space-y-6 page-transition">
      <PageHeader
        title="In-Game Chat"
        description="Broadcast messages to all connected players and see their chat in real time."
        icon={<MessagesSquare className="w-5 h-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={fetchPlayers} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat Window */}
        <div className="lg:col-span-2">
          <Card className="h-[24rem] min-h-[300px] sm:h-[30rem] lg:h-[36rem] flex flex-col">
            <CardHeader className="pb-3 border-b shrink-0">
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="w-4 h-4 text-primary" />
                Server Chat
              </CardTitle>
              <CardDescription>Live chat feed from the server. Your broadcasts appear to all players in-game.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0 min-h-0">
              {/* Messages Area */}
              <ScrollArea className="flex-1 px-4" role="log" aria-live="polite" aria-label="Chat messages">
                <div className="py-4 space-y-3">
                  {chatHistory.length === 0 ? (
                    <EmptyState type="noMessages" title="No chat messages yet" description="Player messages and your broadcasts will appear here in real time." compact />
                  ) : (
                    chatHistory.map((msg) => {
                      const meta = getMessageMeta(msg)
                      return (
                        <div key={msg.id} className={getMessageStyle(msg.type)}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              {meta.icon}
                              <span className={cn('text-xs font-medium', meta.labelClass)}>
                                {meta.label}
                              </span>
                            </div>
                            <time dateTime={msg.timestamp.toISOString()} className="text-xs text-muted-foreground">
                              {msg.timestamp.toLocaleTimeString()}
                            </time>
                          </div>
                          <p className="text-sm [overflow-wrap:anywhere]">{msg.message}</p>
                        </div>
                      )
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              <div className="p-4 border-t bg-muted/30">
                <div className="flex gap-2">
                  <Input
                    placeholder="Broadcast a message to all players... (Enter to send)"
                    aria-label="Broadcast message"
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
                    className="h-11 min-w-20 sm:min-w-28 gap-2"
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
              <CardTitle className="flex items-center gap-2">
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

          {/* Quick Messages */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
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
