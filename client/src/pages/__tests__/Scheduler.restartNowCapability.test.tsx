import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Scheduler from '../Scheduler'
import { schedulerApi, serverApi, serversApi } from '@/lib/api'
import { TooltipProvider } from '@/components/ui/tooltip'

// bug-hunt-2026-08-27: POST /scheduler/restart-now is gated by automation.manage
// alone at the router level, but the route itself additionally requires
// server.control (server/routes/scheduler.js, b2fc76c) -- it performs the
// identical immediate restart POST /server/restart does. Before this fix,
// Scheduler.tsx had zero client-side awareness of that: every button that
// reaches restartNow was disabled only on `loading`/`!serverRunning`, so an
// operator holding automation.manage but not server.control saw a fully
// enabled "Restart Now" button that the server would refuse. This page has
// SIX separate render sites that call schedulerApi.restartNow (three quick
// buttons, a 1-minute confirm dialog, a short-countdown confirm dialog, and
// the custom-time direct button) -- Templates.tsx's own canManage fix found
// a second, easy-to-miss entry point the same way, so this test asserts
// every one of them, not just the first one found.

let mockCan = (_capability: string) => true

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'someone', role: 'technician', capabilities: [] },
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
    schedulerApi: {
      ...actual.schedulerApi,
      getTasks: vi.fn(),
      getCronPresets: vi.fn(),
      getStatus: vi.fn(),
      getHistory: vi.fn(),
      restartNow: vi.fn(),
    },
    serversApi: { ...actual.serversApi, getAll: vi.fn() },
    serverApi: { ...actual.serverApi, getStatus: vi.fn() },
  }
})

const getTasks = vi.mocked(schedulerApi.getTasks)
const getCronPresets = vi.mocked(schedulerApi.getCronPresets)
const getStatus = vi.mocked(schedulerApi.getStatus)
const getHistory = vi.mocked(schedulerApi.getHistory)
const restartNow = vi.mocked(schedulerApi.restartNow)
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

async function setUpRunningServer() {
  getTasks.mockResolvedValue({ tasks: [] })
  getCronPresets.mockResolvedValue({ presets: [] })
  getStatus.mockResolvedValue({ activeTasks: 0, autoRestartEnabled: false, modUpdateRestartPending: false })
  getHistory.mockResolvedValue({ history: [] })
  serversGetAll.mockResolvedValue({ servers: [] })
  serverGetStatus.mockResolvedValue({ running: true } as Awaited<ReturnType<typeof serverApi.getStatus>>)
}

describe('Scheduler.tsx: Restart Now buttons gate on server.control, not just page access', () => {
  it('disables every restart-now entry point, and a click on any of them never calls the API, when the role lacks server.control', async () => {
    mockCan = (capability) => capability !== 'server.control'
    await setUpRunningServer()

    renderScheduler()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart in 15m' })).toBeInTheDocument())

    const buttonNames = ['Restart in 15m', 'Restart in 10m', 'Restart in 5m', 'Restart in 1m', 'Restart Now']
    const buttons = buttonNames.map((name) => screen.getByRole('button', { name }))
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }

    for (const button of buttons) {
      fireEvent.click(button)
    }

    expect(restartNow).not.toHaveBeenCalled()
  })

  it('enables every restart-now entry point when the role holds server.control', async () => {
    mockCan = () => true
    await setUpRunningServer()

    renderScheduler()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart in 15m' })).toBeInTheDocument())

    const buttonNames = ['Restart in 15m', 'Restart in 10m', 'Restart in 5m', 'Restart in 1m', 'Restart Now']
    for (const name of buttonNames) {
      expect(screen.getByRole('button', { name })).not.toBeDisabled()
    }
  })
})
