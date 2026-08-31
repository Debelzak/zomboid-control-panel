import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ServerConfig from '../ServerConfig'
import { serverFilesApi, serversApi, ApiError } from '@/lib/api'

// 2026-08-31 quality-pass finding: server/routes/serverFiles.js's
// getServerConfigPath() throws the SAME SERVER_NOT_CONFIGURED error for a
// genuinely-unconfigured panel AND for an active REMOTE server with no SFTP
// transport configured -- the isRemote branch falls through to the same
// "nothing configured" throw when transport resolution comes back empty,
// instead of the router's own second-stage REMOTE_CONFIG_NOT_CONFIGURED
// gate (which never runs, because the first gate already threw). The wire
// error code alone can't tell the two conditions apart, so the client reads
// the active server independently (serversApi.getResolvedActive(), same
// pattern as Backups.tsx) and overrides the message when it already knows
// better than to trust the server's "no active server" claim -- proven
// wrong by the sidebar showing the very server the page would otherwise
// claim doesn't exist.

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'someone', role: 'admin', capabilities: [] },
    authEnabled: true,
    isAuthenticated: true,
    isLoading: false,
    needsSetup: false,
    logout: vi.fn(),
    getToken: () => 'fake-token',
    can: () => true,
  }),
}))

const getPaths = vi.spyOn(serverFilesApi, 'getPaths')
const getResolvedActive = vi.spyOn(serversApi, 'getResolvedActive')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderServerConfig() {
  return render(
    <MemoryRouter>
      <ServerConfig />
    </MemoryRouter>,
  )
}

describe('ServerConfig.tsx: active-server-is-remote load-error messaging', () => {
  it('shows the remote-config copy and the real server name instead of "No active server configured" / "No server selected"', async () => {
    getResolvedActive.mockResolvedValue({
      server: { id: 1, name: 'Tour Remote Server', serverName: 'servertest', isRemote: true } as never,
    })
    getPaths.mockRejectedValue(
      new ApiError('No active server configured', { status: 404, code: 'SERVER_NOT_CONFIGURED' }),
    )

    renderServerConfig()

    expect(await screen.findByText(/This server is remote\. Add its SFTP details/)).toBeInTheDocument()
    expect(screen.queryByText('No active server configured')).not.toBeInTheDocument()
    expect(screen.queryByText('No server selected')).not.toBeInTheDocument()
    expect(screen.getByText('Tour Remote Server')).toBeInTheDocument()
    // Retry can't turn a remote server into a local one or add SFTP
    // details on its own, so it should not be offered for this condition.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('still shows the generic load-error copy with a Retry button for a real, non-remote failure', async () => {
    getResolvedActive.mockResolvedValue({
      server: { id: 2, name: 'Ashenwood', serverName: 'Ashenwood', isRemote: false } as never,
    })
    getPaths.mockRejectedValue(new ApiError('boom', { status: 500 }))

    renderServerConfig()

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText(/This server is remote\. Add its SFTP details/)).not.toBeInTheDocument()
  })

  it('leaves the page exactly as before when there is genuinely no active server at all', async () => {
    getResolvedActive.mockResolvedValue({ server: null })
    getPaths.mockRejectedValue(
      new ApiError('No active server configured', { status: 404, code: 'SERVER_NOT_CONFIGURED' }),
    )

    renderServerConfig()

    expect(await screen.findByText('No active server configured')).toBeInTheDocument()
    expect(screen.getByText('No server selected')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
