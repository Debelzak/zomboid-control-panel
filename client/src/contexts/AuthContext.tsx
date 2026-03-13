import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'

interface User {
  id: string
  username: string
  role: string
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  needsSetup: boolean
  authEnabled: boolean
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  setup: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  logout: () => Promise<void>
  getToken: () => string | null
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'pz_access_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    needsSetup: false,
    authEnabled: true,
  })

  // Get stored token
  const getToken = useCallback((): string | null => {
    return localStorage.getItem(TOKEN_KEY)
  }, [])

  // Check auth status and try auto-login
  const checkAuth = useCallback(async () => {
    try {
      // Step 1: Check if auth is needed
      const statusRes = await fetch('/api/auth/status')
      if (!statusRes.ok) {
        // Server might not have auth routes yet — allow access
        setState(prev => ({ ...prev, isLoading: false, authEnabled: false }))
        return
      }
      const status = await statusRes.json()

      if (status.needsSetup) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          needsSetup: true,
          authEnabled: false,
        }))
        return
      }

      if (!status.authEnabled) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          isAuthenticated: true,
          authEnabled: false,
        }))
        return
      }

      // Step 2: Try existing token
      const token = getToken()
      if (token) {
        const meRes = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (meRes.ok) {
          const data = await meRes.json()
          setState({
            user: data.user,
            isAuthenticated: true,
            isLoading: false,
            needsSetup: false,
            authEnabled: true,
          })
          return
        }
        // Token expired — try refresh
        localStorage.removeItem(TOKEN_KEY)
      }

      // Step 3: Try refresh token (httpOnly cookie sent automatically)
      const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      if (refreshRes.ok) {
        const data = await refreshRes.json()
        localStorage.setItem(TOKEN_KEY, data.accessToken)
        setState({
          user: data.user,
          isAuthenticated: true,
          isLoading: false,
          needsSetup: false,
          authEnabled: true,
        })
        return
      }

      // Not authenticated
      setState(prev => ({
        ...prev,
        isLoading: false,
        isAuthenticated: false,
        authEnabled: true,
      }))
    } catch {
      // Network error — assume no auth needed (server might be starting)
      setState(prev => ({ ...prev, isLoading: false, authEnabled: false }))
    }
  }, [getToken])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const login = useCallback(async (username: string, password: string, rememberMe = true) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Send/receive cookies
      body: JSON.stringify({ username, password, rememberMe }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || "We couldn't sign you in. Check your username and password and try again.")
    }

    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.accessToken)
    setState({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
      needsSetup: false,
      authEnabled: true,
    })
  }, [])

  const setup = useCallback(async (username: string, password: string, rememberMe = true) => {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, rememberMe }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || "We couldn't create the admin account. Try again.")
    }

    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.accessToken)
    setState({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
      needsSetup: false,
      authEnabled: true,
    })
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // Ignore logout errors
    }
    localStorage.removeItem(TOKEN_KEY)
    setState(prev => ({
      ...prev,
      user: null,
      isAuthenticated: false,
    }))
  }, [])

  return (
    <AuthContext.Provider value={useMemo(() => ({ ...state, login, setup, logout, getToken }), [state, login, setup, logout, getToken])}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
