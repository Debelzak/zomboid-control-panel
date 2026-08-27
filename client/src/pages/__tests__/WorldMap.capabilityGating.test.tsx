import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SocketContext } from '@/contexts/SocketContext'
import WorldMap from '../WorldMap'
import { panelBridgeApi, serversApi, updateApi, mapApi, type ServerInstance } from '@/lib/api'

// 2026-08-27 bug-hunt: Jim's c3083d5 added setGodMode/setInvisible/setNoclip/
// healPlayer to panelBridge.js's BRIDGE_ACTION_CAPABILITY, so those four now
// require bridge.command AND players.gm_tools server-side -- an hour after
// this file's own capability trace (2c6180a-era comment above canRunBridgeCommand)
// established bridge.command ALONE as the correct gate for every passthrough
// action on this page. WorldMap only reaches two of those four (healPlayer,
// setGodMode -- setInvisible/setNoclip live on Players.tsx), across three
// call sites (dossier Heal/God buttons, context-menu Heal item). Gating them
// on bridge.command alone now OVER-offers: a role holding bridge.command but
// not players.gm_tools sees them enabled and gets a 403 on click.
// This asserts BOTH directions, which is the point of the fix: heal/godmode
// must be unreachable without gm_tools, while every OTHER bridge.command-only
// action on the page (proven here via the empty-space context menu's "Custom
// drop…" item) must stay reachable -- over-gating the rest to require
// gm_tools too would hide working controls for zero reason, the exact
// failure this whole sweep exists to avoid.

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
    serversApi: { ...actual.serversApi, getResolvedActive: vi.fn() },
    updateApi: { ...actual.updateApi, getStatus: vi.fn() },
    mapApi: { ...actual.mapApi, resolve: vi.fn(), vehicles: vi.fn() },
    panelBridgeApi: {
      ...actual.panelBridgeApi,
      getServerInfo: vi.fn(),
      getStatus: vi.fn(),
      sendCommand: vi.fn(),
    },
  }
})

const getResolvedActive = vi.mocked(serversApi.getResolvedActive)
const getUpdateStatus = vi.mocked(updateApi.getStatus)
const mapResolve = vi.mocked(mapApi.resolve)
const mapVehicles = vi.mocked(mapApi.vehicles)
const getServerInfo = vi.mocked(panelBridgeApi.getServerInfo)
const getBridgeStatus = vi.mocked(panelBridgeApi.getStatus)
const sendCommand = vi.mocked(panelBridgeApi.sendCommand)

const testServer: ServerInstance = {
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

// jsdom has no ResizeObserver, and WorldMap's canvas-sizing effect needs a
// real non-zero contentRect -- unlike a no-op stub, panToPlayer() (the
// roster-click handler that opens the dossier panel) bails out early when
// canvasSize.width is still 0, so a no-op stub would leave the dossier
// panel unreachable in this test.
class StubResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe() {
    this.cb(
      [{ contentRect: { width: 800, height: 600 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWorldMap() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SocketContext.Provider value={null}>
          <WorldMap />
        </SocketContext.Provider>
      </TooltipProvider>
    </MemoryRouter>,
  )
}

async function setUp(players: Array<{ name: string; x: number; y: number }>) {
  vi.stubGlobal('ResizeObserver', StubResizeObserver)
  // jsdom has no matchMedia -- WorldMap's reduced-motion effect calls it
  // unconditionally on mount.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  getResolvedActive.mockResolvedValue({ server: testServer })
  getUpdateStatus.mockResolvedValue({} as Awaited<ReturnType<typeof updateApi.getStatus>>)
  mapResolve.mockResolvedValue({
    root: '/tiles',
    b42Dir: 'b42',
    b41Path: '/tiles/b41',
    tileSize: 1024,
    width: 1157312,
    height: 509520,
    maxLevel: 21,
    renderedMaxLevel: 10,
  })
  mapVehicles.mockResolvedValue({ vehicles: [] })
  getServerInfo.mockResolvedValue({ success: true, data: { players } } as Awaited<ReturnType<typeof panelBridgeApi.getServerInfo>>)
  getBridgeStatus.mockResolvedValue({ modConnected: true, modStatus: { version: '1.7.40' } } as Awaited<ReturnType<typeof panelBridgeApi.getStatus>>)
  sendCommand.mockResolvedValue({ success: true, data: {} } as Awaited<ReturnType<typeof panelBridgeApi.sendCommand>>)
}

describe('WorldMap.tsx: healPlayer/setGodMode require bridge.command AND players.gm_tools (Jim c3083d5), not bridge.command alone', () => {
  it('disables the dossier Heal and God buttons, and clicking them never calls the API, when the role holds bridge.command but not players.gm_tools', async () => {
    mockCan = (capability) => capability !== 'players.gm_tools'
    await setUp([{ name: 'Kate', x: 10000, y: 10000 }])

    renderWorldMap()

    const rosterButton = await screen.findByRole('button', { name: /pan to kate/i })
    fireEvent.click(rosterButton)

    const healButton = await screen.findByRole('button', { name: 'Heal' })
    const godButton = screen.getByRole('button', { name: 'God' })
    expect(healButton).toBeDisabled()
    expect(godButton).toBeDisabled()

    fireEvent.click(healButton)
    fireEvent.click(godButton)

    await waitFor(() => {
      expect(sendCommand).not.toHaveBeenCalledWith('healPlayer', expect.anything())
      expect(sendCommand).not.toHaveBeenCalledWith('setGodMode', expect.anything())
    })
  })

  it('leaves an unrelated bridge.command-only action (Custom drop… on the empty-space menu) reachable under the same role -- proves this is not an over-gate', async () => {
    mockCan = (capability) => capability !== 'players.gm_tools'
    await setUp([])

    renderWorldMap()

    // Wait for the bridge to report connected before opening the menu --
    // Custom Drop is also gated on !bridgeConnected, and it starts false.
    await waitFor(() => expect(getBridgeStatus).toHaveBeenCalled())

    const canvas = await screen.findByRole('img', { name: /world map/i })
    fireEvent.contextMenu(canvas, { clientX: 10, clientY: 10 })

    const customDrop = await screen.findByRole('menuitem', { name: /custom drop/i })
    expect(customDrop).not.toBeDisabled()
  })

  it('enables the dossier Heal and God buttons, and Heal actually calls healPlayer, when the role holds both bridge.command and players.gm_tools', async () => {
    mockCan = () => true
    await setUp([{ name: 'Kate', x: 10000, y: 10000 }])

    renderWorldMap()

    const rosterButton = await screen.findByRole('button', { name: /pan to kate/i })
    fireEvent.click(rosterButton)

    const healButton = await screen.findByRole('button', { name: 'Heal' })
    const godButton = screen.getByRole('button', { name: 'God' })
    expect(healButton).not.toBeDisabled()
    expect(godButton).not.toBeDisabled()

    fireEvent.click(healButton)

    await waitFor(() => expect(sendCommand).toHaveBeenCalledWith('healPlayer', { username: 'Kate' }))
  })
})
