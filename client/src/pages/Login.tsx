import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { Eye, EyeOff, Loader2, ArrowLeft, KeyRound } from 'lucide-react'

type PanelStatus = 'checking' | 'online' | 'unreachable'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now.toTimeString().slice(0, 8)
}

function usePanelHealth() {
  const [status, setStatus] = useState<PanelStatus>('checking')
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const poll = async () => {
      try {
        const r = await fetch('/api/health', { signal: controller.signal })
        if (!r.ok) throw new Error('http')
        const data = await r.json()
        if (cancelled) return
        setStatus('online')
        if (typeof data?.version === 'string') setVersion(data.version)
      } catch {
        if (!cancelled) setStatus('unreachable')
      }
    }
    poll()
    const id = window.setInterval(poll, 15000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(id)
    }
  }, [])
  return { status, version }
}

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const errorId = error ? 'login-error' : undefined

  const [resetMode, setResetMode] = useState(false)
  const [resetAvailable, setResetAvailable] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [localResetSupported, setLocalResetSupported] = useState(false)
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false)
  const [checkingResetStatus, setCheckingResetStatus] = useState(false)
  const [creatingLocalReset, setCreatingLocalReset] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clock = useClock()
  const { status, version } = usePanelHealth()

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const fetchResetStatus = async (signal?: AbortSignal) => {
    const response = await fetch('/api/auth/reset-status', signal ? { signal } : undefined)
    const data = await response.json()
    const available = data.resetAvailable === true
    const localSupported = data.localResetSupported === true
    setResetAvailable(available)
    setLocalResetSupported(localSupported)
    return { available, localSupported }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchResetStatus(controller.signal)
      .catch(() => {
        setResetAvailable(false)
        setLocalResetSupported(false)
      })
    return () => controller.abort()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password, rememberMe)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResetSuccess('')
    if (!resetToken || resetToken.trim().length < 8) {
      setError('Reset token must be at least 8 characters')
      return
    }
    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reset failed')
      setResetSuccess(data.message)
      setResetToken('')
      setNewPassword('')
      setConfirmPassword('')
      setShowRecoveryHelp(false)
      setResetAvailable(false)
      const timer = setTimeout(() => {
        setResetMode(false)
        setResetSuccess('')
      }, 3000)
      resetTimerRef.current = timer
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  const handleLostPassword = () => {
    setError('')
    setResetSuccess('')
    if (resetAvailable) {
      setShowRecoveryHelp(false)
      setResetMode(true)
      return
    }
    if (localResetSupported) {
      void handleCreateLocalReset()
      return
    }
    setShowRecoveryHelp(current => !current)
  }

  const handleRecoveryCheck = async () => {
    setError('')
    setCheckingResetStatus(true)
    try {
      const { available } = await fetchResetStatus()

      if (available) {
        setShowRecoveryHelp(false)
        setResetMode(true)
        return
      }

      setError('No recovery token found yet. Create data/reset-token.txt on the panel host, then try again.')
    } catch {
      setError('Could not check recovery status. Try again in a moment.')
    } finally {
      setCheckingResetStatus(false)
    }
  }

  const handleCreateLocalReset = async () => {
    setError('')
    setResetSuccess('')
    setCreatingLocalReset(true)
    try {
      const res = await fetch('/api/auth/reset-token/local', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create a recovery token')

      setResetAvailable(true)
      setLocalResetSupported(true)
      setResetToken(typeof data.token === 'string' ? data.token : '')
      setShowRecoveryHelp(false)
      setResetSuccess(typeof data.message === 'string' ? data.message : 'Recovery token created on this server.')
      setResetMode(true)
    } catch (err) {
      setShowRecoveryHelp(true)
      setError(err instanceof Error ? err.message : 'Could not create a recovery token')
    } finally {
      setCreatingLocalReset(false)
    }
  }

  const statusMap: Record<PanelStatus, { label: string; tone: string; dot: string }> = {
    checking: { label: 'Linking', tone: 'text-muted-foreground/70', dot: 'bg-muted-foreground/60 animate-pulse' },
    online: { label: 'Online', tone: 'text-emerald-500/80', dot: 'bg-emerald-400 shadow-[0_0_8px_hsl(var(--primary)/0.55)]' },
    unreachable: { label: 'Lost', tone: 'text-destructive/90', dot: 'bg-destructive animate-pulse shadow-[0_0_8px_hsl(var(--destructive)/0.6)]' },
  }
  const s = statusMap[status]

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <a
        href="#login-form"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm"
      >
        Skip to form
      </a>

      {/* Atmospheric backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 50% 25%, hsl(var(--primary) / 0.10), transparent 55%), radial-gradient(circle at 88% 105%, hsl(var(--warning) / 0.08), transparent 45%), radial-gradient(circle at 8% 110%, hsl(var(--destructive) / 0.07), transparent 45%), linear-gradient(180deg, hsl(var(--background)), hsl(var(--background)))',
        }}
      />
      <div aria-hidden="true" className="control-room-sweep absolute inset-0 opacity-35" />
      {/* Scanlines */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-[0.10] mix-blend-overlay [background-image:repeating-linear-gradient(0deg,hsl(var(--foreground)/0.55)_0px,hsl(var(--foreground)/0.55)_1px,transparent_1px,transparent_3px)]"
      />
      {/* Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 220px 40px hsl(var(--background))' }}
      />

      {/* Top status bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground/70">
        <span>Project Zomboid // Control Panel</span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-warning/80 animate-pulse shadow-[0_0_8px_hsl(var(--warning)/0.7)]" />
          <span className="text-warning/85">Access Required</span>
        </span>
      </div>

      {/* Bottom status bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground/60">
        <span>{clock} UTC</span>
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          <span className={s.tone}>Service · {s.label}</span>
        </span>
        <span>{version ? `BUILD ${version}` : 'BUILD ----'}</span>
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-[440px] flex-col items-stretch justify-center px-5 py-16">
        {/* Hero */}
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark />
          <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground/70">
            access.terminal
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold uppercase tracking-[0.08em] text-foreground sm:text-[1.65rem]">
            {resetMode ? 'Recover Access' : 'Sign In'}
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {resetMode
              ? 'Paste the token from data/reset-token.txt on the panel host to set a new admin password.'
              : 'Authenticate with your admin account to take the console.'}
          </p>
        </div>

        {/* Bracketed panel */}
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute -left-2 -top-2 h-5 w-5 border-l-2 border-t-2 border-primary/45" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-2 -top-2 h-5 w-5 border-r-2 border-t-2 border-primary/45" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -left-2 h-5 w-5 border-b-2 border-l-2 border-primary/45" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 -right-2 h-5 w-5 border-b-2 border-r-2 border-primary/45" />

          <div className="relative overflow-hidden rounded-md border border-border/60 bg-card/80 backdrop-blur-sm shadow-[0_30px_80px_-50px_hsl(var(--foreground)/0.6)]">
            {/* Hairline accent */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,hsl(var(--primary)/0.55)_20%,hsl(var(--warning)/0.7)_50%,hsl(var(--primary)/0.55)_80%,transparent_100%)]"
            />

            {/* Header strip */}
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="text-primary/80">{resetMode ? 'reset.token' : 'auth.handshake'}</span>
              <span>secure channel</span>
            </div>

            <div className="px-5 py-5">
              {resetMode ? (
                <form id="login-form" onSubmit={handleReset} className="space-y-4">
                  {error && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      className="rounded-sm border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
                    >
                      {error}
                    </div>
                  )}
                  {resetSuccess && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-sm border border-success/30 bg-success/8 px-3 py-2 text-sm text-success"
                    >
                      {resetSuccess}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="resetToken" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <span className="text-primary/70">›</span> Reset Token
                    </Label>
                    <Input
                      id="resetToken"
                      type="text"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="paste token…"
                      autoFocus
                      disabled={loading}
                      required
                      minLength={8}
                      maxLength={512}
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground/80">Minimum 8 characters · sourced from data/reset-token.txt</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="newPassword" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <span className="text-primary/70">›</span> New Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="newPassword"
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="min. 6 characters"
                        className="pr-10 text-sm"
                        disabled={loading}
                        required
                        minLength={6}
                        maxLength={128}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground cursor-pointer select-none rounded-sm focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <span className="text-primary/70">›</span> Confirm
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="re-enter password"
                      disabled={loading}
                      required
                      minLength={6}
                      maxLength={128}
                      className="text-sm"
                    />
                  </div>

                  <Button type="submit" className="w-full tracking-[0.08em] uppercase" disabled={loading}>
                    {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Resetting…</>) : 'Reset Password'}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-xs tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground"
                    onClick={() => { setResetMode(false); setError(''); setResetSuccess('') }}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Back to Sign In
                  </Button>
                </form>
              ) : (
                <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div
                      id="login-error"
                      role="alert"
                      aria-live="assertive"
                      className="rounded-sm border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive"
                    >
                      {error}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <span className="text-primary/70">›</span> Username
                    </Label>
                    <Input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin"
                      autoComplete="username"
                      autoFocus
                      maxLength={32}
                      disabled={loading}
                      aria-describedby={errorId}
                      aria-invalid={error ? true : undefined}
                      required
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <span className="text-primary/70">›</span> Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="pr-10 text-sm"
                        disabled={loading}
                        aria-describedby={errorId}
                        aria-invalid={error ? true : undefined}
                        required
                        maxLength={128}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground cursor-pointer select-none rounded-sm focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-0.5">
                    <Checkbox
                      id="rememberMe"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                    />
                    <Label htmlFor="rememberMe" className="cursor-pointer text-xs font-normal text-muted-foreground">
                      Keep me signed in on this browser
                    </Label>
                  </div>

                  <Button type="submit" className="w-full tracking-[0.08em] uppercase" disabled={loading}>
                    {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Signing In…</>) : 'Sign In'}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full gap-1.5 tracking-[0.08em] uppercase text-muted-foreground hover:text-foreground"
                    onClick={handleLostPassword}
                    disabled={loading || checkingResetStatus || creatingLocalReset}
                  >
                    {creatingLocalReset ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    {creatingLocalReset
                      ? 'Preparing Recovery…'
                      : resetAvailable
                        ? 'Lost Password? Recover Access'
                        : localResetSupported
                          ? 'Lost Password? Reset On This Server'
                          : 'Lost Password?'}
                  </Button>

                  {showRecoveryHelp && !resetAvailable && (
                    <div className="rounded-sm border border-border/60 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      <p className="font-medium uppercase tracking-[0.08em] text-foreground/90">Recover Access</p>
                      {localResetSupported ? (
                        <>
                          <p className="mt-2 leading-5">
                            You opened the panel locally on the server, so the panel can create the recovery token for you automatically.
                          </p>
                          <p className="mt-2 leading-5">
                            If that local recovery step fails, you can still use <span className="font-mono text-foreground/85">--reset-password</span> from the server terminal.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="mt-2 leading-5">
                            If you still have access to the panel host, you can reset the admin password without knowing the old one.
                          </p>
                          <ol className="mt-2 list-decimal space-y-1.5 pl-4 leading-5">
                            <li>Create <span className="font-mono text-foreground/85">data/reset-token.txt</span> on the panel host with any token that is at least 8 characters long.</li>
                            <li>Click the button below to check for that token.</li>
                            <li>When the token is found, this screen will switch to the password reset form automatically.</li>
                          </ol>
                          <p className="mt-2 leading-5">
                            Alternative: start the panel with <span className="font-mono text-foreground/85">--reset-password</span> from the server terminal.
                          </p>
                        </>
                      )}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        {localResetSupported ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="sm:flex-1"
                            onClick={() => void handleCreateLocalReset()}
                            disabled={creatingLocalReset || checkingResetStatus || loading}
                          >
                            {creatingLocalReset ? (<><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>) : 'Create Recovery Token On This Server'}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            className="sm:flex-1"
                            onClick={handleRecoveryCheck}
                            disabled={checkingResetStatus || loading}
                          >
                            {checkingResetStatus ? (<><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>) : 'Check for Recovery Token'}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          className="sm:flex-1"
                          onClick={() => { setShowRecoveryHelp(false); setError('') }}
                          disabled={creatingLocalReset || checkingResetStatus || loading}
                        >
                          Hide Help
                        </Button>
                      </div>
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function BrandMark() {
  return (
    <div aria-hidden="true" className="relative inline-flex h-[72px] w-[72px] items-center justify-center">
      <svg
        viewBox="0 0 72 72"
        className="absolute inset-0 h-full w-full text-primary/85"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      >
        <path d="M2 2 L2 16 M2 2 L16 2" />
        <path d="M70 2 L70 16 M70 2 L56 2" />
        <path d="M2 70 L2 56 M2 70 L16 70" />
        <path d="M70 70 L70 56 M70 70 L56 70" />
      </svg>
      <div className="flex h-[54px] w-[54px] items-center justify-center rounded-sm border border-primary/45 bg-primary/12 font-display text-lg font-bold uppercase tracking-[0.08em] text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18),inset_0_-12px_24px_-12px_hsl(var(--warning)/0.18)]">
        ZCP
      </div>
    </div>
  )
}
