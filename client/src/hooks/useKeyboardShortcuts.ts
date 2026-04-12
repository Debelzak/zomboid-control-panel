import { useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export interface ShortcutDef {
  key: string
  label: string
  path?: string
  action?: () => void
  group: string
}

const NAV_SHORTCUTS: ShortcutDef[] = [
  { key: '1', label: 'Dashboard', path: '/', group: 'Navigation' },
  { key: '2', label: 'Console', path: '/console', group: 'Navigation' },
  { key: '3', label: 'Players', path: '/players', group: 'Navigation' },
  { key: '4', label: 'Chat', path: '/chat', group: 'Navigation' },
  { key: '5', label: 'Events', path: '/events', group: 'Navigation' },
  { key: '6', label: 'Mods', path: '/mods', group: 'Navigation' },
  { key: '7', label: 'Backups', path: '/backups', group: 'Navigation' },
  { key: '8', label: 'Server Config', path: '/server-config', group: 'Navigation' },
  { key: '9', label: 'Settings', path: '/settings', group: 'Navigation' },
]

const PAGE_SHORTCUTS: ShortcutDef[] = [
  { key: 'Ctrl+S', label: 'Save', group: 'Page Actions' },
  { key: 'Ctrl+K', label: 'Focus search', group: 'Page Actions' },
  { key: 'R', label: 'Refresh (Dashboard)', group: 'Page Actions' },
  { key: '`', label: 'Switch console tab', group: 'Page Actions' },
  { key: 'A', label: 'Toggle auto-scroll (Console)', group: 'Page Actions' },
]

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)

  const allShortcuts: ShortcutDef[] = [
    ...NAV_SHORTCUTS,
    ...PAGE_SHORTCUTS,
    { key: '?', label: 'Show keyboard shortcuts', action: () => setHelpOpen(true), group: 'General' },
  ]

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept when typing in inputs
    if (isInputFocused()) return
    // Don't intercept modified keys (except Shift for ?)
    if (e.ctrlKey || e.altKey || e.metaKey) return

    const key = e.key

    if (key === '?') {
      e.preventDefault()
      setHelpOpen(prev => !prev)
      return
    }

    if (key === 'Escape') {
      setHelpOpen(false)
      return
    }

    const shortcut = NAV_SHORTCUTS.find(s => s.key === key)
    if (shortcut?.path) {
      e.preventDefault()
      navigate(shortcut.path)
    }
  }, [navigate])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { helpOpen, setHelpOpen, shortcuts: allShortcuts }
}

/**
 * Register a page-specific keyboard shortcut. Active only while the component is mounted.
 * For Ctrl/Cmd shortcuts, set ctrl: true — these work even when an input is focused.
 * For unmodified keys, they are ignored when an input is focused.
 */
export function usePageShortcut(
  key: string,
  handler: () => void,
  options: { ctrl?: boolean } = {}
) {
  const stableHandler = useCallback(handler, [handler])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const wantsCtrl = options.ctrl ?? false
      const hasCtrl = e.ctrlKey || e.metaKey

      if (wantsCtrl && !hasCtrl) return
      if (!wantsCtrl && hasCtrl) return
      if (!wantsCtrl && isInputFocused()) return
      if (e.altKey) return
      if (e.key.toLowerCase() !== key.toLowerCase()) return

      e.preventDefault()
      stableHandler()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, stableHandler, options.ctrl])
}
