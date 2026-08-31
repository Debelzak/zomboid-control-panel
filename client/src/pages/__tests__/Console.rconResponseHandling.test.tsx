import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SocketContext } from '@/contexts/SocketContext'
import type { Socket } from 'socket.io-client'
import Console from '../Console'
import { rconApi, serversApi, configApi, type ServerInstance } from '@/lib/api'
import enConsole from '../../locales/en/console.json'

// bug-hunt-2026-08-31: two confirmed bugs in the socket-driven half of the
// RCON console, both rooted in treating "a socket message arrived" as proof
// of something it doesn't actually prove.
//
// 1. executeCommand/sendAnnouncement skipped their own local live-log push
//    whenever `socket?.connected` was true, assuming the server's
//    'rcon:response' broadcast would fill the entry in instead. But that
//    broadcast only reaches sockets that joined the "logs" room, which the
//    server gates on the diagnostics.manage capability (server/index.js
//    subscribe:logs handler) -- a completely separate check from transport
//    connectivity. A technician (rcon.execute but not diagnostics.manage)
//    has a connected socket that never joins "logs", so the Console Output
//    panel stayed empty for every command they ran, with zero feedback.
//
// 2. handleRconResponse (the 'rcon:response' socket listener) set
//    rconConnected(true) unconditionally for ANY message in that room,
//    including a failed command's own response (success: false) or someone
//    else's. That could silently overwrite a correctly-computed "offline"
//    banner back to "online" on a message that proves nothing of the kind.

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
    rconApi: {
      ...actual.rconApi,
      execute: vi.fn(),
      getHistory: vi.fn(),
    },
    serversApi: { ...actual.serversApi, getAll: vi.fn() },
    configApi: { ...actual.configApi, testRcon: vi.fn() },
  }
})

const execute = vi.mocked(rconApi.execute)
const getHistory = vi.mocked(rconApi.getHistory)
const getAllServers = vi.mocked(serversApi.getAll)
const testRcon = vi.mocked(configApi.testRcon)

const rconReadyServer: ServerInstance = {
  id: 1,
  name: 'Ashenwood',
  serverName: 'Ashenwood',
  installPath: '',
  zomboidDataPath: null,
  serverConfigPath: null,
  rconHost: '10.0.0.5',
  rconPort: 27015,
  rconPassword: 'hunter2',
  serverPort: 16261,
  minMemory: 2048,
  maxMemory: 4096,
  useNoSteam: false,
  useDebug: false,
  isRemote: false,
  isActive: true,
  startCommand: '',
  adminPassword: '',
  createdAt: '2026-01-01T00:00:00.000Z',
}

// Minimal fake matching only what Console.tsx actually reads/calls off a
// socket -- `connected` (the exact field the old, buggy dedup check read)
// plus on/off/emit for the 'rcon:response' listener effect.
function createFakeSocket(connected: boolean) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const socket = {
    connected,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler)
    }),
    emit: vi.fn(),
  }
  return {
    socket: socket as unknown as Socket,
    trigger: (event: string, data?: unknown) => {
      listeners.get(event)?.forEach((h) => h(data))
    },
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockCan = (_capability: string) => true
})

function renderConsole(socket: Socket | null) {
  return render(
    <SocketContext.Provider value={socket}>
      <TooltipProvider>
        <ConfirmProvider>
          <Console />
        </ConfirmProvider>
      </TooltipProvider>
    </SocketContext.Provider>,
  )
}

async function setUp() {
  getAllServers.mockResolvedValue({ servers: [rconReadyServer] })
  getHistory.mockResolvedValue({ history: [] })
  testRcon.mockResolvedValue({ success: true, connected: true })
}

async function openRconTab() {
  // Radix's TabsTrigger switches on mousedown, not click (see @radix-ui/react-tabs)
  const tabButton = await screen.findByRole('tab', { name: /rcon console/i })
  fireEvent.mouseDown(tabButton, { button: 0 })
}

async function runCommand(command: string) {
  const input = await screen.findByLabelText(/rcon command input/i)
  fireEvent.change(input, { target: { value: command } })
  const runButton = screen.getByRole('button', { name: /execute command/i })
  fireEvent.click(runButton)
}

describe('Console.tsx: live log visibility does not depend on transport connectivity', () => {
  it('still shows an executed command in the Console Output panel for a role without diagnostics.manage, even with a connected socket', async () => {
    // A regression here manifests as findByText never resolving (the log
    // stays empty forever) rather than a clean assertion failure -- fail
    // fast instead of the default 5s x this file's slower setup.
    mockCan = (capability) => capability !== 'diagnostics.manage'
    await setUp()
    execute.mockResolvedValue({ success: true, response: '1 player online' })

    // The socket IS connected -- this is exactly the state that made the old
    // `!socket?.connected` check wrongly skip the local log push, on the
    // (wrong) assumption a server broadcast would arrive instead.
    const { socket } = createFakeSocket(true)

    renderConsole(socket)
    await openRconTab()
    await runCommand('players')

    await waitFor(() => expect(execute).toHaveBeenCalledWith('players'))
    await screen.findByText('players')
    await screen.findByText('1 player online')
    expect(screen.queryByText(enConsole.rcon.noCommandsTitle)).not.toBeInTheDocument()
  }, 10000)
})

describe('Console.tsx: a socket rcon:response only proves the connection is live when it succeeded', () => {
  it('does not flip the offline banner back to online on a failed rcon:response broadcast', async () => {
    await setUp()
    // First, get the banner into a genuine "offline" state via the same
    // disconnect-code path Console.rconDisconnectCode.test.tsx covers.
    execute.mockResolvedValue({
      success: false,
      error: 'Game server is not running.',
      code: 'RCON_EXECUTE_DISCONNECTED',
    })

    const { socket, trigger } = createFakeSocket(true)
    renderConsole(socket)
    await openRconTab()
    await runCommand('players')
    await screen.findByText(enConsole.rcon.offline)

    // Now the room-wide broadcast for that SAME failed command (or someone
    // else's) arrives over the socket -- success: false. This must not
    // resurrect the "online" banner.
    trigger('rcon:response', {
      command: 'players',
      response: 'Game server is not running.',
      success: false,
      timestamp: new Date().toISOString(),
    })

    // Give the (absent) state update a tick to have happened before
    // asserting its absence -- otherwise a false pass could just mean "too
    // early".
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(enConsole.rcon.online)).not.toBeInTheDocument()
    expect(screen.getByText(enConsole.rcon.offline)).toBeInTheDocument()
  })

  it('does flip the offline banner back to online on a successful rcon:response broadcast', async () => {
    await setUp()
    execute.mockResolvedValue({
      success: false,
      error: 'Game server is not running.',
      code: 'RCON_EXECUTE_DISCONNECTED',
    })

    const { socket, trigger } = createFakeSocket(true)
    renderConsole(socket)
    await openRconTab()
    await runCommand('players')
    await screen.findByText(enConsole.rcon.offline)

    trigger('rcon:response', {
      command: 'players',
      response: '1 player online',
      success: true,
      timestamp: new Date().toISOString(),
    })

    await screen.findByText(enConsole.rcon.online)
  })
})
