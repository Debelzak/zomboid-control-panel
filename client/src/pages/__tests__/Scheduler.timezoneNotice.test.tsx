import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Scheduler from '../Scheduler'
import { schedulerApi, serverApi, serversApi } from '@/lib/api'
import { TooltipProvider } from '@/components/ui/tooltip'

// Linux bug hunt (2026-08-29, hunt-wave5, suspect 1 -- timezone): every
// cron.schedule() call in scheduler.js interprets its expression in the
// PANEL PROCESS's own resolved timezone (confirmed empirically: TZ=UTC vs
// TZ=America/New_York produce genuinely different fire times for the same
// expression) -- not the browser's timezone, not anything the operator
// configures. Neither the Dockerfile nor docker-compose.yml sets TZ, so a
// containerized install silently defaults to UTC. The Scheduler UI's
// "Hour (0-23)" field previously gave zero indication of any of this.
// scheduler.js's getStatus() now reports the real, currently-effective
// timezone; this proves the create/edit-task dialog actually surfaces it.

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'someone', role: 'technician', capabilities: [] },
    authEnabled: true,
    isAuthenticated: true,
    isLoading: false,
    needsSetup: false,
    logout: vi.fn(),
    getToken: () => 'fake-token',
    can: () => true,
  }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    schedulerApi: {
      ...actual.schedulerApi,
      getTasks: vi.fn(),
      getCronPresets: vi.fn(),
      getStatus: vi.fn(),
      getHistory: vi.fn(),
    },
    serversApi: { ...actual.serversApi, getAll: vi.fn() },
    serverApi: { ...actual.serverApi, getStatus: vi.fn() },
  }
})

const getTasks = vi.mocked(schedulerApi.getTasks)
const getCronPresets = vi.mocked(schedulerApi.getCronPresets)
const getStatus = vi.mocked(schedulerApi.getStatus)
const getHistory = vi.mocked(schedulerApi.getHistory)
const serversGetAll = vi.mocked(serversApi.getAll)
const serverGetStatus = vi.mocked(serverApi.getStatus)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderScheduler() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Scheduler />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

async function baseMocks() {
  getTasks.mockResolvedValue({ tasks: [] })
  getCronPresets.mockResolvedValue({ presets: [] })
  getHistory.mockResolvedValue({ history: [] })
  serversGetAll.mockResolvedValue({ servers: [] })
  serverGetStatus.mockResolvedValue({ running: false } as Awaited<ReturnType<typeof serverApi.getStatus>>)
}

describe('Scheduler.tsx: the create/edit-task dialog discloses which timezone schedules actually run in', () => {
  it('shows the real, currently-effective server timezone from getStatus(), not the browser timezone', async () => {
    await baseMocks()
    getStatus.mockResolvedValue({
      activeTasks: 0,
      autoRestartEnabled: false,
      modUpdateRestartPending: false,
      timezone: 'America/New_York',
    })

    renderScheduler()

    fireEvent.click(await screen.findByRole('button', { name: 'New Task' }))

    expect(await screen.findByText(/America\/New_York/)).toBeInTheDocument()
  })

  it('shows nothing extra (no crash, no blank/undefined text) when getStatus() has not resolved a timezone', async () => {
    await baseMocks()
    getStatus.mockResolvedValue({
      activeTasks: 0,
      autoRestartEnabled: false,
      modUpdateRestartPending: false,
    })

    renderScheduler()

    fireEvent.click(await screen.findByRole('button', { name: 'New Task' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })
})
