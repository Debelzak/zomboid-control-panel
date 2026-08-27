import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { getRequiredCapabilityForCheck } from '../Debug'
import Debug from '../Debug'
import { apiFetch, modsApi } from '@/lib/api'

// bug-hunt-2026-08-26/27: Jim's catalogue (catalogue-debug-tsx-destructive-
// auto-fixes) confirmed all 11 automated diagnostics fixes are already
// gated server-side, across SEVEN distinct capabilities (not one page-level
// concern) -- verified here by reading each route's requirePermission call
// directly: mods.* fixes -> mods.manage (mods.js's router.use), server.process
// -> server.control, rcon.connected -> rcon.execute, db.backup ->
// backups.manage, server.staleLocks -> diagnostics.manage, bridge.configured/
// worldmap.bridge.configured -> bridge.setup, server.sandboxCorrupt ->
// serverfiles.manage. Debug.tsx itself had zero client-side awareness of any
// of them. All 11 fixes share ONE render site and ONE handler
// (handleDiagnosticsFix) -- a native <button>, not a Radix menu item, so the
// Radix disabled-doesn't-gate-onClick trap doesn't apply here, but the
// handler is guarded anyway (defense in depth, same two-layer pattern as
// every other page tonight).

let mockCan = (_capability: string) => true

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'someone', role: 'moderator', capabilities: [] },
    authEnabled: true,
    isAuthenticated: true,
    isLoading: false,
    needsSetup: false,
    logout: vi.fn(),
    getToken: () => 'fake-token',
    can: (capability: string) => mockCan(capability),
  }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    apiFetch: vi.fn(),
    modsApi: { ...actual.modsApi, batchToggleModIds: vi.fn() },
  }
})

const mockedApiFetch = vi.mocked(apiFetch)
const batchToggleModIds = vi.mocked(modsApi.batchToggleModIds)

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

const diagnosticsFixture = {
  timestamp: '2026-08-27T00:00:00.000Z',
  overall: 'fail',
  summary: { ok: 0, warn: 0, fail: 2, info: 0, skip: 0 },
  categories: {
    mods: { label: 'Mods', order: 1 },
    server: { label: 'Server', order: 2 },
  },
  checks: [
    {
      id: 'mods.numericInMods',
      label: 'Numeric mod IDs',
      status: 'fail',
      severity: 'warning',
      message: 'Some mods use numeric-only IDs.',
      category: 'mods',
      meta: { numericInMods: ['12345', '67890'] },
    },
    {
      id: 'server.staleLocks',
      label: 'Stale lock files',
      status: 'fail',
      severity: 'critical',
      message: 'Stale lock files found under the save directory.',
      category: 'server',
    },
  ],
  durationMs: 5,
}

function setUpApiFetch() {
  mockedApiFetch.mockImplementation(async (endpoint: string) => {
    if (endpoint.startsWith('/debug/diagnostics')) return jsonResponse(diagnosticsFixture)
    if (endpoint.startsWith('/debug/clear-stale-locks')) return jsonResponse({ success: true, deleted: 3 })
    // Every other mount-time fetch (system/health/logs/logs-files/crash-logs)
    // -- return a generically-shaped empty success so those unrelated
    // fetchers don't error and spam reportClientError during the test.
    return jsonResponse({})
  })
}

function renderDebug() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ConfirmProvider>
          <Debug />
        </ConfirmProvider>
      </TooltipProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockCan = () => true
})

describe('getRequiredCapabilityForCheck: maps every automated fix to its actual server-verified capability', () => {
  it('maps the four mods.* fixes to mods.manage', () => {
    for (const id of ['mods.numericInMods', 'mods.orphanWorkshop', 'mods.maps', 'mods.duplicates']) {
      expect(getRequiredCapabilityForCheck(id)).toBe('mods.manage')
    }
  })

  it('maps server.process to server.control, rcon.connected to rcon.execute, db.backup to backups.manage', () => {
    expect(getRequiredCapabilityForCheck('server.process')).toBe('server.control')
    expect(getRequiredCapabilityForCheck('rcon.connected')).toBe('rcon.execute')
    expect(getRequiredCapabilityForCheck('db.backup')).toBe('backups.manage')
  })

  it('maps server.staleLocks to diagnostics.manage, bridge fixes to bridge.setup, sandbox repair to serverfiles.manage', () => {
    expect(getRequiredCapabilityForCheck('server.staleLocks')).toBe('diagnostics.manage')
    expect(getRequiredCapabilityForCheck('bridge.configured')).toBe('bridge.setup')
    expect(getRequiredCapabilityForCheck('worldmap.bridge.configured')).toBe('bridge.setup')
    expect(getRequiredCapabilityForCheck('server.sandboxCorrupt')).toBe('serverfiles.manage')
  })

  it('needs no capability for the one automated fix that makes no API call, or for any non-automated/unknown check', () => {
    expect(getRequiredCapabilityForCheck('server.recentCrash')).toBeNull()
    expect(getRequiredCapabilityForCheck('mods.resolved')).toBeNull()
    expect(getRequiredCapabilityForCheck('some.unknown.check.id')).toBeNull()
  })
})

describe('Debug.tsx: automated fixes are gated on their own capability, not one page-level concern', () => {
  it('lacking mods.manage: the numeric-mod-IDs fix is disabled and never calls the API', async () => {
    mockCan = (capability) => capability !== 'mods.manage'
    setUpApiFetch()

    renderDebug()

    const fixButton = await screen.findByRole('button', { name: /numeric/i })
    expect(fixButton).toBeDisabled()

    fireEvent.click(fixButton)
    expect(batchToggleModIds).not.toHaveBeenCalled()
  })

  it('holding mods.manage: the numeric-mod-IDs fix is enabled and actually calls the API', async () => {
    mockCan = () => true
    setUpApiFetch()
    batchToggleModIds.mockResolvedValue({ success: true, changed: 2, totalMods: 10 })

    renderDebug()

    const fixButton = await screen.findByRole('button', { name: /numeric/i })
    expect(fixButton).not.toBeDisabled()

    fireEvent.click(fixButton)
    await waitFor(() => expect(batchToggleModIds).toHaveBeenCalledTimes(1))
  })

  it('lacking diagnostics.manage: the stale-locks fix (which always confirms) is disabled, and clicking it never even opens the confirm dialog', async () => {
    mockCan = (capability) => capability !== 'diagnostics.manage'
    setUpApiFetch()

    renderDebug()

    const fixButton = await screen.findByRole('button', { name: /stale lock/i })
    expect(fixButton).toBeDisabled()

    fireEvent.click(fixButton)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/debug/clear-stale-locks'),
      expect.anything(),
    )
  })

  it('holding diagnostics.manage: the stale-locks fix opens its confirm dialog and actually calls the clear-stale-locks route once confirmed', async () => {
    mockCan = () => true
    setUpApiFetch()

    renderDebug()

    const fixButton = await screen.findByRole('button', { name: /stale lock/i })
    expect(fixButton).not.toBeDisabled()

    fireEvent.click(fixButton)
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /apply/i }))

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith(
        '/debug/clear-stale-locks',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })
})
