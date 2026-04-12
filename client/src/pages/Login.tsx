import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { AuthScreenLayout } from '../components/AuthScreenLayout'
import { Eye, EyeOff, Loader2, ArrowLeft, KeyRound } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const errorId = error ? 'login-error' : undefined

  // Reset password state
  const [resetMode, setResetMode] = useState(false)
  const [resetAvailable, setResetAvailable] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup the auto-switch timer on unmount
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // Check if a reset token file exists on the server
    fetch('/api/auth/reset-status', { signal: controller.signal })
      .then(r => r.json())
      .then(data => setResetAvailable(data.resetAvailable))
      .catch(() => setResetAvailable(false))
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
      if (!res.ok) {
        throw new Error(data.error || 'Reset failed')
      }
      setResetSuccess(data.message)
      setResetToken('')
      setNewPassword('')
      setConfirmPassword('')
      setResetAvailable(false)
      // Switch back to login after 3 seconds
      const timer = setTimeout(() => {
        setResetMode(false)
        setResetSuccess('')
      }, 3000)
      // Store timer so useEffect cleanup can clear it
      resetTimerRef.current = timer
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  if (resetMode) {
    return (
      <AuthScreenLayout
        badge="Account Recovery"
        title="Zomboid Control Panel"
        description="Reset your admin password using the token from data/reset-token.txt on the server."
        cardTitle="Reset Password"
        cardDescription="Enter the token from the reset file and choose a new password."
        footer="Create data/reset-token.txt with any 8+ character token, then enter it here."
      >
        <form onSubmit={handleReset} className="space-y-4">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          {resetSuccess && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-success/25 bg-success/8 px-3 py-2.5 text-sm text-success"
            >
              {resetSuccess}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="resetToken">Reset Token</Label>
            <Input
              id="resetToken"
              type="text"
              value={resetToken}
              onChange={(e) => setResetToken(e.target.value)}
              placeholder="Paste token from data/reset-token.txt"
              autoFocus
              disabled={loading}
              required
              minLength={8}
              maxLength={512}
              aria-describedby="resetToken-hint"
            />
            <p id="resetToken-hint" className="text-xs text-muted-foreground">Must be at least 8 characters</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="pr-10"
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

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              disabled={loading}
              required
              minLength={6}
              maxLength={128}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Resetting...
              </>
            ) : (
              'Reset Password'
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => { setResetMode(false); setError(''); setResetSuccess(''); }}
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Sign In
          </Button>
        </form>
      </AuthScreenLayout>
    )
  }

  return (
    <AuthScreenLayout
      badge="Secure Access"
      title="Zomboid Control Panel"
      description="Sign in with your panel admin account to manage this server."
      cardTitle="Sign In"
      cardDescription="Use the username and password for this control panel."
      footer="Your sign-in is checked against the panel service running on this machine."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            id="login-error"
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. admin"
            autoComplete="username"
            autoFocus
            maxLength={32}
            disabled={loading}
            aria-describedby={errorId}
            aria-invalid={error ? true : undefined}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pr-10"
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

        <div className="flex items-center space-x-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5">
          <Checkbox
            id="rememberMe"
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(checked === true)}
          />
          <Label htmlFor="rememberMe" className="cursor-pointer text-sm font-normal text-foreground/90">
            Keep me signed in on this browser
          </Label>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
                    Signing you in...
            </>
          ) : (
                  'Sign in'
          )}
        </Button>

        {resetAvailable && (
          <button
            type="button"
            onClick={() => { setResetMode(true); setError(''); }}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Forgot password? Reset via token file
          </button>
        )}
      </form>
    </AuthScreenLayout>
  )
}
