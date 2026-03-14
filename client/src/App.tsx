import { Routes, Route } from 'react-router-dom'
import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import type { Socket } from 'socket.io-client'
import Layout from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import {
  FeatureErrorBoundary,
} from './components/FeatureErrorBoundary'
import { Toaster } from './components/ui/toaster'
import { SocketContext, ConnectionStatus, ConnectionStatusContext } from './contexts/SocketContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TooltipProvider } from './components/ui/tooltip'
import { useToast } from './components/ui/use-toast'
import { PageSkeleton } from './components/PageSkeleton'
import { ScrollToTop } from './components/ScrollToTop'
import { Shield } from 'lucide-react'
import { isDemoMode } from './lib/demo'
import DemoMenuPreview from './pages/DemoMenuPreview'

const AUTH_LOADING_MESSAGES = [
  'Verifying credentials and restoring your post.',
  'Syncing the control room with the active panel state.',
  'Waking the admin systems and checking live channels.',
]

// Lazy load larger pages for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Players = lazy(() => import('./pages/Players'))
const Console = lazy(() => import('./pages/Console'))
const Scheduler = lazy(() => import('./pages/Scheduler'))
const Mods = lazy(() => import('./pages/Mods'))
const ChunkCleaner = lazy(() => import('./pages/ChunkCleaner'))
const Discord = lazy(() => import('./pages/Discord'))
const Settings = lazy(() => import('./pages/Settings'))
const ServerSetup = lazy(() => import('./pages/ServerSetup'))
const Servers = lazy(() => import('./pages/Servers'))
const ServerConfig = lazy(() => import('./pages/ServerConfig'))
const Debug = lazy(() => import('./pages/Debug'))
const ServerFinder = lazy(() => import('./pages/ServerFinder'))
const Events = lazy(() => import('./pages/Events'))
const Chat = lazy(() => import('./pages/Chat'))
const Backups = lazy(() => import('./pages/Backups'))
const Login = lazy(() => import('./pages/Login'))
const Setup = lazy(() => import('./pages/Setup'))

// Loading fallback — shows a skeleton layout instead of a plain spinner
function PageLoader() {
  return <PageSkeleton variant="default" />
}

function AuthScreenLoader() {
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % AUTH_LOADING_MESSAGES.length)
    }, 2200)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(circle at 82% -10%, hsl(var(--primary) / 0.2), transparent 36%), radial-gradient(circle at 14% 108%, hsl(var(--destructive) / 0.16), transparent 42%), linear-gradient(180deg, hsl(var(--background)), hsl(var(--background)))',
        }}
      />
      <div aria-hidden="true" className="control-room-sweep absolute inset-0 opacity-60" />
      <div className="relative w-full max-w-sm rounded-2xl border border-border/60 bg-card/78 px-6 py-8 text-center shadow-[0_24px_80px_-40px_hsl(var(--foreground)/0.45)] backdrop-blur-sm">
        <div className="mx-auto mb-3 inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-primary/90">
          Secure Handshake
        </div>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/12 bg-primary/8 text-primary shadow-[0_0_30px_hsl(var(--primary)/0.12)]">
          <Shield className="h-6 w-6" />
        </div>
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary/35 border-t-primary" />
        <p className="text-sm font-medium text-foreground">Checking access</p>
        <p key={messageIndex} className="mt-1 text-sm text-muted-foreground fade-in">{AUTH_LOADING_MESSAGES[messageIndex]}</p>
      </div>
    </div>
  )
}

function AppContent() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    reconnecting: false,
    reconnectAttempt: 0,
    error: null,
  })
  const { toast } = useToast()
  const { isAuthenticated, isLoading, needsSetup, authEnabled, getToken } = useAuth()

  const handleReconnectSuccess = useCallback(() => {
    toast({
      title: 'Reconnected',
      description: 'Connection to server restored',
      variant: 'success' as const,
    })
  }, [toast])

  useEffect(() => {
    // Don't connect socket until auth is resolved
    if (isLoading) return
    // If auth is enabled and user is not authenticated, don't connect
    if (authEnabled && !isAuthenticated && !needsSetup) return

    let cancelled = false
    let createdSocket: Socket | null = null

    const setupSocket = async () => {
      const { io } = await import('socket.io-client')
      if (cancelled) return

      const newSocket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        autoConnect: false,
      })
      createdSocket = newSocket

      const applySocketAuth = () => {
        const token = getToken()
        newSocket.auth = token ? { token } : {}
      }

      applySocketAuth()
      newSocket.connect()

      // Connection established
      newSocket.on('connect', () => {
        setConnectionStatus(prev => {
          // Show toast only on reconnect, not initial connect
          if (prev.reconnecting || prev.reconnectAttempt > 0) {
            handleReconnectSuccess()
          }
          return {
            connected: true,
            reconnecting: false,
            reconnectAttempt: 0,
            error: null,
          }
        })
        // Subscribe to updates
        newSocket.emit('subscribe:status')
        newSocket.emit('subscribe:players')
        newSocket.emit('subscribe:logs')
      })

      // Connection lost
      newSocket.on('disconnect', (reason) => {
        setConnectionStatus(prev => ({
          ...prev,
          connected: false,
          error: reason === 'io server disconnect' ? 'Server closed connection' : null,
        }))
      })

      // Connection error with detailed logging (from Socket.IO best practices)
      newSocket.on('connect_error', (err) => {
        if (newSocket.active) {
          // Temporary failure, socket will automatically reconnect
          setConnectionStatus(prev => ({
            ...prev,
            connected: false,
            reconnecting: true,
            error: err.message,
          }))
        } else {
          // Connection denied by server - needs manual reconnect
          setConnectionStatus({
            connected: false,
            reconnecting: false,
            reconnectAttempt: 0,
            error: err.message,
          })
        }
      })

      // Reconnection events
      newSocket.io.on('reconnect_attempt', (attempt) => {
        applySocketAuth()
        setConnectionStatus(prev => ({
          ...prev,
          reconnecting: true,
          reconnectAttempt: attempt,
        }))
      })

      newSocket.io.on('reconnect_failed', () => {
        setConnectionStatus({
          connected: false,
          reconnecting: false,
          reconnectAttempt: 0,
          error: 'Failed to reconnect after multiple attempts',
        })
        toast({
          title: 'Connection Lost',
          description: 'Unable to reconnect to server. Please refresh the page.',
          variant: 'destructive',
        })
      })

      setSocket(newSocket)
    }

    void setupSocket()

    return () => {
      cancelled = true
      createdSocket?.close()
    }
  }, [toast, handleReconnectSuccess, isLoading, isAuthenticated, authEnabled, needsSetup, getToken])

  // Auth gate — show loading, setup, or login screens before main app
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (needsSetup) {
    return (
      <Suspense fallback={<AuthScreenLoader />}>
        <>
          <Setup />
          <Toaster />
        </>
      </Suspense>
    )
  }

  if (authEnabled && !isAuthenticated) {
    return (
      <Suspense fallback={<AuthScreenLoader />}>
        <>
          <Login />
          <Toaster />
        </>
      </Suspense>
    )
  }

  return (
    <ConnectionStatusContext.Provider value={connectionStatus}>
      <SocketContext.Provider value={socket}>
        <Layout>
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<FeatureErrorBoundary featureName="Dashboard"><Dashboard /></FeatureErrorBoundary>} />
              <Route path="/players" element={<FeatureErrorBoundary featureName="Player Management"><Players /></FeatureErrorBoundary>} />
              <Route path="/console" element={<FeatureErrorBoundary featureName="Console"><Console /></FeatureErrorBoundary>} />
              <Route path="/scheduler" element={<FeatureErrorBoundary featureName="Scheduler"><Scheduler /></FeatureErrorBoundary>} />
              <Route path="/mods" element={<FeatureErrorBoundary featureName="Mod Manager"><Mods /></FeatureErrorBoundary>} />
              <Route path="/chunks" element={<FeatureErrorBoundary featureName="Chunk Cleaner"><ChunkCleaner /></FeatureErrorBoundary>} />
              <Route path="/discord" element={<FeatureErrorBoundary featureName="Discord Integration"><Discord /></FeatureErrorBoundary>} />
              <Route path="/settings" element={<FeatureErrorBoundary featureName="Settings"><Settings /></FeatureErrorBoundary>} />
              <Route path="/server-setup" element={<FeatureErrorBoundary featureName="Server Setup"><ServerSetup /></FeatureErrorBoundary>} />
              <Route path="/servers" element={<FeatureErrorBoundary featureName="Server Manager"><Servers /></FeatureErrorBoundary>} />
              <Route path="/server-config" element={<FeatureErrorBoundary featureName="Server Configuration"><ServerConfig /></FeatureErrorBoundary>} />
              <Route path="/server-finder" element={<FeatureErrorBoundary featureName="Server Finder"><ServerFinder /></FeatureErrorBoundary>} />
              <Route path="/debug" element={<FeatureErrorBoundary featureName="Debug"><Debug /></FeatureErrorBoundary>} />
              <Route path="/events" element={<FeatureErrorBoundary featureName="Events & Weather"><Events /></FeatureErrorBoundary>} />
              <Route path="/chat" element={<FeatureErrorBoundary featureName="In-Game Chat"><Chat /></FeatureErrorBoundary>} />
              <Route path="/backups" element={<FeatureErrorBoundary featureName="Backups"><Backups /></FeatureErrorBoundary>} />
            </Routes>
          </Suspense>
        </Layout>
        <Toaster />
      </SocketContext.Provider>
    </ConnectionStatusContext.Provider>
  )
}

function App() {
  if (isDemoMode()) {
    return (
      <ErrorBoundary>
        <ThemeProvider>
          <TooltipProvider>
            <DemoMenuPreview />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
