import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { AuthScreenLayout } from '../components/AuthScreenLayout'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const errorId = error ? 'login-error' : undefined

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
      </form>
    </AuthScreenLayout>
  )
}
