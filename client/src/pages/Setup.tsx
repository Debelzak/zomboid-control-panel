import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { AuthScreenLayout } from '../components/AuthScreenLayout'
import { Eye, EyeOff, Loader2, CheckCircle, ArrowRight, Server, ShieldCheck, RadioTower } from 'lucide-react'

export default function Setup() {
  const { setup } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const errorId = error ? 'setup-error' : undefined
  const usernameHintId = 'setup-username-hint'
  const passwordHintId = 'setup-password-hint'
  const confirmHintId = 'setup-confirm-hint'

  const passwordsMatch = password === confirmPassword
  const passwordLongEnough = password.length >= 6
  const usernameValid = /^[a-zA-Z0-9_-]{3,32}$/.test(username)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!usernameValid) {
      setError('Username must be 3-32 characters (letters, numbers, _ or -)')
      return
    }
    if (!passwordLongEnough) {
      setError('Password must be at least 6 characters')
      return
    }
    if (!passwordsMatch) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await setup(username, password, rememberMe)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthScreenLayout
      badge="Initial Provisioning"
      title="Zomboid Control Panel"
      description="Create the first admin account for this panel, then continue to the rest of setup."
      cardTitle="Create Admin Account"
      cardDescription="This account unlocks the control panel and signs you in right away."
      footer="Store this password safely. Anyone with it can manage this panel on this machine."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            id="setup-error"
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
            placeholder="admin"
            autoComplete="username"
            autoFocus
            maxLength={32}
            disabled={loading}
            aria-describedby={[usernameHintId, errorId].filter(Boolean).join(' ')}
            aria-invalid={Boolean(error && !usernameValid)}
            required
          />
          <p id={usernameHintId} className="text-xs leading-5 text-muted-foreground">
            Use 3-32 characters: letters, numbers, underscores, or hyphens.
          </p>
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
              autoComplete="new-password"
              disabled={loading}
              aria-describedby={[passwordHintId, errorId].filter(Boolean).join(' ')}
              aria-invalid={Boolean(error && !passwordLongEnough)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div id={passwordHintId} className="flex items-center gap-1.5 text-xs leading-5">
            {passwordLongEnough ? (
              <CheckCircle className="w-3.5 h-3.5 text-primary" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
            )}
            <span className={passwordLongEnough ? 'text-primary' : 'text-muted-foreground'}>
              Use at least 6 characters.
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            disabled={loading}
            aria-describedby={[confirmHintId, errorId].filter(Boolean).join(' ')}
            aria-invalid={Boolean(confirmPassword && !passwordsMatch)}
            required
          />
          {confirmPassword && (
            <div id={confirmHintId} className="flex items-center gap-1.5 text-xs leading-5">
              {passwordsMatch ? (
                <CheckCircle className="w-3.5 h-3.5 text-primary" />
              ) : (
                <div className="h-3.5 w-3.5 rounded-full border border-destructive" />
              )}
              <span className={passwordsMatch ? 'text-primary' : 'text-destructive'}>
                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
              </span>
            </div>
          )}
          {!confirmPassword && (
            <p id={confirmHintId} className="text-xs leading-5 text-muted-foreground">
              Type the same password again to confirm it.
            </p>
          )}
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

        <Button
          type="submit"
          className="w-full onboarding-cta"
          disabled={loading || !usernameValid || !passwordLongEnough || !passwordsMatch}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating admin account...
            </>
          ) : (
            'Create admin account'
          )}
        </Button>

        <div className="mission-brief rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ArrowRight className="h-4 w-4 text-primary" />
            What happens next
          </div>
          <div className="mission-step-grid mt-3 space-y-3">
            <div className="mission-step-card flex gap-3 rounded-lg border border-border/50 bg-background/35 px-3 py-3">
              <div className="mission-step-icon mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Bring one server into the panel</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Add an existing install or run the guided server setup to create a fresh one.
                </p>
              </div>
            </div>

            <div className="mission-step-card flex gap-3 rounded-lg border border-border/50 bg-background/35 px-3 py-3">
              <div className="mission-step-icon mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Confirm RCON and server paths</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  The panel becomes useful once it can reach the server, authenticate, and save the right paths.
                </p>
              </div>
            </div>

            <div className="mission-step-card flex gap-3 rounded-lg border border-border/50 bg-background/35 px-3 py-3">
              <div className="mission-step-icon mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <RadioTower className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Check the dashboard for live status</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  After setup, use the dashboard to verify server state, players, backups, and quick admin actions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </form>
    </AuthScreenLayout>
  )
}
