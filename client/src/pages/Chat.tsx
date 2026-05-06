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
  Pencil,
  Plus,
  Trash2,
  Check,
  X,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { panelBridgeApi, playersApi, configApi } from '@/lib/api'
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
}

type ChatChannel = 'server' | 'admin' | 'general'

const DEFAULT_PRESETS = [
  'Server will restart in 5 minutes!',
  'Welcome to the server!',
  'Please read the rules at /rules',
  'Server maintenance starting soon',
  'Have fun and stay safe!',
]

export default function Chat() {
  const [message, setMessage] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [channel, setChannel] = useState<ChatChannel>('server')
  const [presets, setPresets] = useState<string[]>(DEFAULT_PRESETS)
  const [presetsEditing, setPresetsEditing] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [newPresetDraft, setNewPresetDraft] = useState('')

  const chatEndRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const stickToBottomRef = useRef(true)
  const sendingRef = useRef(false)
  const { toast } = useToast()
  const socket = useSocket()

  // Track whether the user is parked at (or near) the bottom of the
  // scroll viewport. We only auto-scroll on new messages when they are,
  // so reading older history isn't yanked back by every incoming line.
  const handleScroll = useCallback(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
    stickToBottomRef.current = distance < 80
  }, [])

  useEffect(() => {
    // ScrollArea (Radix) renders a viewport div with [data-radix-scroll-area-viewport].
    const root = chatEndRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement | null
    scrollViewportRef.current = root
    if (!root) return
    root.addEventListener('scroll', handleScroll, { passive: true })
    return () => root.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
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
             // Coalesce optimistic broadcasts with their echoed log line.
             // The log tailer's timestamp can lag by several seconds when the
             // PZ log is buffered, so match on (author, message) within the
             // last 30s rather than a tight 2s window.
             const incomingTs = new Date(data.timestamp || Date.now()).getTime();
             const recent = prev.slice(-10);
             const isDuplicate = recent.some(m =>
                 m.message === msg &&
                 m.author === data.author &&
                 Math.abs(m.timestamp.getTime() - incomingTs) < 30000
             );
             if (isDuplicate) return prev;

             const newMessage: ChatMessage = {
                id: data.id || `${incomingTs}-${Math.random().toString(36).slice(2, 8)}`,
                type: data.type || 'general',
                author: data.author,
                message: msg,
                timestamp: new Date(incomingTs)
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
      // Dispatch on the selected channel:
      //   server  → yellow broadcast banner (RCON servermsg)
      //   admin   → red admin-only chat (visible only to admins in-game)
      //   general → posts as a custom author into the public chat stream
      let result: { success?: boolean; error?: string } | undefined
      let localType: ChatMessage['type'] = 'server'
      let localAuthor = 'Server'
      if (channel === 'admin') {
        result = await panelBridgeApi.sendToAdminChat(message)
        localType = 'admin'
        localAuthor = 'Admin'
      } else if (channel === 'general') {
        result = await panelBridgeApi.sendToGeneralChat(message, 'Admin')
        localType = 'general'
        localAuthor = 'Admin'
      } else {
        result = await panelBridgeApi.sendToServerChat(message, false)
      }

      if (result?.success) {
        const sentAt = new Date()
        setChatHistory(prev => [...prev, {
          id: `local-${sentAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
          type: localType,
          author: localAuthor,
          message: message,
          timestamp: sentAt
        }].slice(-200))
        // Sending always pins the user back to the bottom — they just
        // posted, so they want to see the result.
        stickToBottomRef.current = true
        setMessage('')
        toast({
          title:
            channel === 'admin' ? 'Admin Message Sent'
            : channel === 'general' ? 'Posted to Chat'
            : 'Broadcast Sent',
          description:
            channel === 'admin' ? 'Visible only to admins in-game.'
            : channel === 'general' ? 'Posted into the public chat stream.'
            : 'Message delivered to all connected players.',
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

  // Load saved chat presets from app settings; fall back to defaults.
  useEffect(() => {
    let cancelled = false
    configApi.getAppSettings()
      .then((settings: any) => {
        if (cancelled) return
        const saved = settings?.chatPresets
        if (Array.isArray(saved) && saved.every((p: unknown) => typeof p === 'string')) {
          setPresets(saved.length > 0 ? saved : DEFAULT_PRESETS)
        }
      })
      .catch(() => { /* fall back to defaults silently */ })
    return () => { cancelled = true }
  }, [])

  const persistPresets = useCallback(async (next: string[]) => {
    setPresets(next)
    try {
      await configApi.updateAppSettings({ chatPresets: next })
    } catch (error) {
      reportClientError('Failed to save chat presets.', error)
      toast({
        title: 'Could not save presets',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [toast])

  const handleAddPreset = useCallback(() => {
    const trimmed = newPresetDraft.trim()
    if (!trimmed) return
    if (trimmed.length > 500) return
    persistPresets([...presets, trimmed])
    setNewPresetDraft('')
  }, [newPresetDraft, persistPresets, presets])

  const handleSaveEdit = useCallback(() => {
    if (editingIdx === null) return
    const trimmed = editingDraft.trim()
    if (!trimmed) return
    const next = presets.slice()
    next[editingIdx] = trimmed.slice(0, 500)
    persistPresets(next)
    setEditingIdx(null)
    setEditingDraft('')
  }, [editingDraft, editingIdx, persistPresets, presets])

  const handleDeletePreset = useCallback((idx: number) => {
    const next = presets.filter((_, i) => i !== idx)
    persistPresets(next)
    if (editingIdx === idx) {
      setEditingIdx(null)
      setEditingDraft('')
    }
  }, [editingIdx, persistPresets, presets])

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
          <Card className="h-[calc(100vh-260px)] min-h-[420px] flex flex-col">
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
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select value={channel} onValueChange={(v) => setChannel(v as ChatChannel)} disabled={sending}>
                    <SelectTrigger className="h-11 sm:w-44" aria-label="Chat channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="server">
                        <span className="flex items-center gap-2">
                          <Megaphone className="w-3.5 h-3.5 text-warning" />
                          Server broadcast
                        </span>
                      </SelectItem>
                      <SelectItem value="admin">
                        <span className="flex items-center gap-2">
                          <Shield className="w-3.5 h-3.5 text-destructive" />
                          Admin chat
                        </span>
                      </SelectItem>
                      <SelectItem value="general">
                        <span className="flex items-center gap-2">
                          <MessageSquare className="w-3.5 h-3.5 text-primary" />
                          General chat
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    ref={messageInputRef}
                    placeholder={
                      channel === 'admin'
                        ? 'Message visible only to admins in-game... (Enter to send)'
                        : channel === 'general'
                          ? 'Post as Admin into the public chat... (Enter to send)'
                          : 'Broadcast a message to all players... (Enter to send)'
                    }
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
                    className="h-11 min-w-20 sm:min-w-28 gap-2"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send
                  </Button>
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {channel === 'admin'
                      ? 'Admin chat — only players with admin access see this.'
                      : players.length === 0
                        ? 'No players online — messages will only appear in the server log.'
                        : `Broadcasting to ${players.length} ${players.length === 1 ? 'player' : 'players'}.`}
                  </span>
                  <span className={cn('tabular-nums', message.length > 450 ? 'text-warning' : '')}>
                    {message.length}/500
                  </span>
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
              <CardDescription>{players.length === 1 ? '1 player' : `${players.length} players`}</CardDescription>
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
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-warning" />
                Quick Messages
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setPresetsEditing((v) => !v)
                  setEditingIdx(null)
                  setEditingDraft('')
                  setNewPresetDraft('')
                }}
                aria-label={presetsEditing ? 'Done editing presets' : 'Edit presets'}
              >
                {presetsEditing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                <span className="ml-1">{presetsEditing ? 'Done' : 'Edit'}</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {presets.length === 0 && !presetsEditing && (
                <p className="text-xs text-muted-foreground">No quick messages yet — click Edit to add some.</p>
              )}
              {presets.map((quickMsg, idx) => {
                const isEditing = presetsEditing && editingIdx === idx
                if (isEditing) {
                  return (
                    <div key={`edit-${idx}`} className="flex items-center gap-1">
                      <Input
                        value={editingDraft}
                        onChange={(e) => setEditingDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                          if (e.key === 'Escape') { setEditingIdx(null); setEditingDraft('') }
                        }}
                        maxLength={500}
                        autoFocus
                        className="h-9 flex-1 text-sm"
                      />
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleSaveEdit} aria-label="Save">
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setEditingIdx(null); setEditingDraft('') }} aria-label="Cancel">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )
                }
                return (
                  <div key={`preset-${idx}`} className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 flex-1 justify-start whitespace-normal px-3 py-2 text-left"
                      onClick={() => {
                        if (presetsEditing) {
                          setEditingIdx(idx)
                          setEditingDraft(quickMsg)
                        } else {
                          setMessage(quickMsg)
                          messageInputRef.current?.focus()
                        }
                      }}
                    >
                      {quickMsg}
                    </Button>
                    {presetsEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        onClick={() => handleDeletePreset(idx)}
                        aria-label={`Delete preset ${idx + 1}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                )
              })}
              {presetsEditing && (
                <div className="flex items-center gap-1 pt-2 border-t border-border/40">
                  <Input
                    placeholder="Add a new quick message..."
                    value={newPresetDraft}
                    onChange={(e) => setNewPresetDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleAddPreset() }
                    }}
                    maxLength={500}
                    className="h-9 flex-1 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={handleAddPreset}
                    disabled={!newPresetDraft.trim()}
                    aria-label="Add preset"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
