import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import Console from '../Console'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { serverApi, serversApi, rconApi, type ServerInstance } from '@/lib/api'
import enConsole from '../../locales/en/console.json'

// conv-hunt-pages-2 lens 3/4: the Server Log panel's "clear" button calls
// POST /server/console-log/clear, which server/routes/server.js answers with
// fs.writeFileSync(consoleLogPath, "") -- a real, irreversible truncation of
// the PZ server's own server-console.txt on disk. Two problems, one root
// cause (this control was built as if it were as harmless as its sibling,
// the RCON output panel's "clear", which really is just client-side
// setLiveLog([]) and correctly says so):
//   1. No confirmation of any kind before an irreversible file truncation --
//      every comparable destructive action elsewhere in pages/** (Backups
//      delete, Scheduler delete, Users delete, Discord wipe, RolesPermissions
//      delete role) gates on an AlertDialog, a Dialog, or useConfirm().
//   2. Its own tooltip actively claims the opposite of what it does:
//      "Clear the log display (does not delete the server log file)" --
//      copy is a claim, and this one is false.

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    serverApi: {
      ...actual.serverApi,
      getConsoleLog: vi.fn(),
      streamConsoleLog: vi.fn(),
      clearConsoleLog: vi.fn(),
    },
    serversApi: { ...actual.serversApi, getAll: vi.fn() },
    rconApi: { ...actual.rconApi, getHistory: vi.fn() },
  }
})

const getConsoleLog = vi.mocked(serverApi.getConsoleLog)
const clearConsoleLog = vi.mocked(serverApi.clearConsoleLog)
const getAllServers = vi.mocked(serversApi.getAll)
const getHistory = vi.mocked(rconApi.getHistory)

const activeServer: ServerInstance = {
  id: 1,
  name: 'Ashenwood',
  serverName: 'Ashenwood',
  installPath: 'C:/servers/ashenwood',
  zomboidDataPath: null,
  serverConfigPath: null,
  rconHost: '',
  rconPort: 0,
  rconPassword: '',
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

beforeEach(() => {
  getAllServers.mockReset().mockResolvedValue({ servers: [activeServer] })
  getConsoleLog.mockReset().mockResolvedValue({ lines: ['boot ok'], size: 42, path: 'C:/servers/ashenwood/server-console.txt', exists: true })
  clearConsoleLog.mockReset().mockResolvedValue({ success: true })
  getHistory.mockReset().mockResolvedValue({ history: [] })
})

describe('Console -- server log clear button', () => {
  it('does not truncate the real log file until the operator confirms', async () => {
    render(
      <TooltipProvider>
        <ConfirmProvider>
          <Console />
        </ConfirmProvider>
      </TooltipProvider>,
    )

    const clearButton = await screen.findByRole('button', { name: /clear/i })
    fireEvent.click(clearButton)

    // The assertion that fails against unfixed code: today onClick calls
    // clearServerLog directly, so the real API is hit on the very first
    // click with no dialog in between.
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    expect(clearConsoleLog).not.toHaveBeenCalled()
  })

  it('truncates the real log file once the operator confirms', async () => {
    render(
      <TooltipProvider>
        <ConfirmProvider>
          <Console />
        </ConfirmProvider>
      </TooltipProvider>,
    )

    const clearButton = await screen.findByRole('button', { name: /clear/i })
    fireEvent.click(clearButton)

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /erase/i }))

    await waitFor(() => expect(clearConsoleLog).toHaveBeenCalledTimes(1))
  })

  it("the tooltip copy doesn't promise safety the button doesn't deliver", () => {
    // This is the control's own claim to the operator. Assert on the
    // content directly rather than fighting Radix Tooltip's hover-to-mount
    // behavior in jsdom -- the claim lives in the string, not the DOM node.
    expect(enConsole.serverLog.clearTooltip).not.toMatch(/does not delete the server log file/i)
  })
})
