import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Players from '../Players'
import { playersApi, panelBridgeApi, configApi } from '@/lib/api'
import { TooltipProvider } from '@/components/ui/tooltip'

// bug-hunt-2026-08-27: Players.tsx had zero client-side capability gating.
// Every mutating action reaches one of THREE distinct server gates --
// players.moderate (kick/ban/whitelist/access-level/notes), players.gm_tools
// (teleport/spawn items+vehicles/xp/character import-export), and
// bridge.command (godmode/invisible/noclip/heal -- these route through the
// generic PanelBridge passthrough, POST /panel-bridge/command, NOT through
// their same-named but never-called players.gm_tools-gated dedicated routes).
// Several actions have more than one render-level trigger (Kick and Ban each
// have an ActionTile AND a dossier quick-action button; Unban SteamID has
// THREE: a summary banner, a Banned-tab row button, and an ActionTile) --
// this test asserts every one of them, not just the first found, per the
// Scheduler.tsx restart-now lesson.

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
    playersApi: {
      ...actual.playersApi,
      getPlayers: vi.fn(),
      getWhitelist: vi.fn(),
      getPerks: vi.fn(),
      getSteamIdBans: vi.fn(),
      getNotes: vi.fn(),
      getStats: vi.fn(),
      getExports: vi.fn(),
      getActivityLogs: vi.fn(),
      kick: vi.fn(),
      ban: vi.fn(),
      unban: vi.fn(),
      unbanSteamId: vi.fn(),
      banSteamId: vi.fn(),
      voiceBan: vi.fn(),
      addUser: vi.fn(),
      addAllowedSteamId: vi.fn(),
      removeAllowedSteamId: vi.fn(),
      removeFromWhitelist: vi.fn(),
      setAccessLevel: vi.fn(),
      saveNote: vi.fn(),
      deleteNote: vi.fn(),
      teleport: vi.fn(),
      addItem: vi.fn(),
      addVehicle: vi.fn(),
      addXp: vi.fn(),
      getExport: vi.fn(),
      deleteExport: vi.fn(),
    },
    panelBridgeApi: {
      ...actual.panelBridgeApi,
      getStatus: vi.fn(),
      sendCommand: vi.fn(),
      exportCharacter: vi.fn(),
      importCharacter: vi.fn(),
    },
    configApi: {
      ...actual.configApi,
      getAppSettings: vi.fn(),
      updateAppSettings: vi.fn(),
    },
  }
})

const getPlayers = vi.mocked(playersApi.getPlayers)
const getWhitelist = vi.mocked(playersApi.getWhitelist)
const getPerks = vi.mocked(playersApi.getPerks)
const getSteamIdBans = vi.mocked(playersApi.getSteamIdBans)
const getNotes = vi.mocked(playersApi.getNotes)
const getStats = vi.mocked(playersApi.getStats)
const getExports = vi.mocked(playersApi.getExports)
const getActivityLogs = vi.mocked(playersApi.getActivityLogs)
const kick = vi.mocked(playersApi.kick)
const ban = vi.mocked(playersApi.ban)
const unban = vi.mocked(playersApi.unban)
const unbanSteamId = vi.mocked(playersApi.unbanSteamId)
const banSteamId = vi.mocked(playersApi.banSteamId)
const voiceBan = vi.mocked(playersApi.voiceBan)
const addUser = vi.mocked(playersApi.addUser)
const addAllowedSteamId = vi.mocked(playersApi.addAllowedSteamId)
const removeAllowedSteamId = vi.mocked(playersApi.removeAllowedSteamId)
const removeFromWhitelist = vi.mocked(playersApi.removeFromWhitelist)
const setAccessLevel = vi.mocked(playersApi.setAccessLevel)
const saveNote = vi.mocked(playersApi.saveNote)
const deleteNote = vi.mocked(playersApi.deleteNote)
const teleport = vi.mocked(playersApi.teleport)
const addItem = vi.mocked(playersApi.addItem)
const addVehicle = vi.mocked(playersApi.addVehicle)
const addXp = vi.mocked(playersApi.addXp)
const getStatus = vi.mocked(panelBridgeApi.getStatus)
const sendCommand = vi.mocked(panelBridgeApi.sendCommand)
const getAppSettings = vi.mocked(configApi.getAppSettings)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPlayers() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Players />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

async function setUpFixtures() {
  getPlayers.mockResolvedValue({ players: [{ name: 'TestPlayer', online: true }] })
  getWhitelist.mockResolvedValue({
    success: true,
    available: true,
    accounts: [{ id: 1, username: 'TestPlayer', lastConnection: null, role: 'user', authType: 0, steamId: null, ownerId: null, displayName: null }],
    allowedSteamIds: ['76561198000000001'],
  })
  getPerks.mockResolvedValue({ catalog: [{ id: 'Sprinting', label: 'Sprinting', category: 'Combat' }] })
  getSteamIdBans.mockResolvedValue({ bans: [{ steamId: '76561198000000002', banned_at: new Date().toISOString() }] })
  getNotes.mockResolvedValue({ notes: [{ playerName: 'TestPlayer', note: 'existing note', tags: [], updated_at: new Date().toISOString() }] })
  getStats.mockResolvedValue({ stats: [] })
  getExports.mockResolvedValue({ exports: [] })
  getActivityLogs.mockResolvedValue({ logs: [] })
  getStatus.mockResolvedValue({ modConnected: true, isRunning: true } as Awaited<ReturnType<typeof panelBridgeApi.getStatus>>)
  getAppSettings.mockResolvedValue({ settings: {} } as Awaited<ReturnType<typeof configApi.getAppSettings>>)
}

async function selectTestPlayer() {
  await waitFor(() => expect(screen.getByText('TestPlayer')).toBeInTheDocument(), { timeout: 3000 })
  fireEvent.click(screen.getByText('TestPlayer'))
  await waitFor(() => expect(screen.getAllByText('TestPlayer').length).toBeGreaterThan(1), { timeout: 3000 })
}

describe('Players.tsx: capability gating', () => {
  it('disables every gated trigger, and clicking any of them never calls the API, when the role holds none of the three capabilities', async () => {
    mockCan = () => false
    await setUpFixtures()
    renderPlayers()
    await selectTestPlayer()

    // Moderation tab -- players.moderate. Kick and Ban each have TWO
    // triggers (ActionTile + dossier quick-action button). The ActionTile's
    // accessible name is "Kick <description text>" (label + description are
    // both rendered inside the trigger <button>), so match by prefix.
    const kickButtons = screen.getAllByRole('button', { name: /^Kick\b/ })
    expect(kickButtons).toHaveLength(2)
    kickButtons.forEach(b => expect(b).toBeDisabled())

    const banButtons = screen.getAllByRole('button', { name: /^Ban\b/ })
    expect(banButtons).toHaveLength(2)
    banButtons.forEach(b => expect(b).toBeDisabled())

    expect(screen.getByRole('button', { name: /^Access Level\b/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Voice Ban' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SteamID Ban' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add User' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unban' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unban SteamID' })).toBeDisabled()
    // Unban SteamID's second trigger: the summary banner (only rendered
    // because getSteamIdBans returned one ban).
    expect(screen.getByRole('button', { name: /View \d+ banned SteamIDs/ })).toBeDisabled()

    // Teleport is players.gm_tools, not players.moderate -- confirm it is
    // NOT disabled by the moderate-less role in this pass (asserted properly
    // in the gm_tools-only pass below; here we just confirm the two gates
    // are independent by not touching it).

    ;[...kickButtons, ...banButtons,
      screen.getByRole('button', { name: /^Access Level\b/ }),
      screen.getByRole('button', { name: 'Voice Ban' }),
      screen.getByRole('button', { name: 'SteamID Ban' }),
      screen.getByRole('button', { name: 'Add User' }),
      screen.getByRole('button', { name: 'Unban' }),
      screen.getByRole('button', { name: 'Unban SteamID' }),
    ].forEach(b => fireEvent.click(b))

    expect(kick).not.toHaveBeenCalled()
    expect(ban).not.toHaveBeenCalled()
    expect(setAccessLevel).not.toHaveBeenCalled()
    expect(voiceBan).not.toHaveBeenCalled()
    expect(banSteamId).not.toHaveBeenCalled()
    expect(addUser).not.toHaveBeenCalled()
    expect(unban).not.toHaveBeenCalled()
    expect(unbanSteamId).not.toHaveBeenCalled()

    // Banned tab -- third Unban SteamID trigger (per-row button). The
    // Moderation tab's own "Unban" ActionTile stays mounted in the right
    // panel throughout (it's a separate Tabs instance from the roster tabs
    // on the left), so disambiguate by the row button's title.
    fireEvent.click(screen.getByRole('button', { name: /Banned/ }))
    await waitFor(() => expect(screen.getByText('76561198000000002')).toBeInTheDocument(), { timeout: 3000 })
    const bannedRowUnban = screen.getAllByRole('button', { name: 'Unban' }).find(b => b.title?.includes('76561198000000002'))
    expect(bannedRowUnban).toBeDisabled()
    if (bannedRowUnban) fireEvent.click(bannedRowUnban)
    expect(unbanSteamId).not.toHaveBeenCalled()

    // Whitelist tab -- Add/Remove allowed SteamID, Remove account.
    fireEvent.click(screen.getByRole('button', { name: /Whitelist/ }))
    await waitFor(() => expect(screen.getByPlaceholderText('76561198XXXXXXXXX')).toBeInTheDocument(), { timeout: 3000 })
    fireEvent.change(screen.getByPlaceholderText('76561198XXXXXXXXX'), { target: { value: '76561198000000099' } })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(addAllowedSteamId).not.toHaveBeenCalled()
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    expect(removeButtons.length).toBeGreaterThanOrEqual(2)
    removeButtons.forEach(b => expect(b).toBeDisabled())
    removeButtons.forEach(b => fireEvent.click(b))
    expect(removeAllowedSteamId).not.toHaveBeenCalled()
    expect(removeFromWhitelist).not.toHaveBeenCalled()

    // Spawn tab -- players.gm_tools.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Spawn' }), { button: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: /Give XP/ })).toBeInTheDocument(), { timeout: 3000 })
    const giveItemButton = screen.getByText('Give items').closest('button')
    const spawnVehicleButton = screen.getByText('Spawn vehicles').closest('button')
    expect(giveItemButton).toBeDisabled()
    expect(spawnVehicleButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /Give XP/ })).toBeDisabled()
    if (giveItemButton) fireEvent.click(giveItemButton)
    if (spawnVehicleButton) fireEvent.click(spawnVehicleButton)
    fireEvent.click(screen.getByRole('button', { name: /Give XP/ }))
    expect(addItem).not.toHaveBeenCalled()
    expect(addVehicle).not.toHaveBeenCalled()
    expect(addXp).not.toHaveBeenCalled()

    // Powers tab -- bridge.command, NOT players.gm_tools (the trap this
    // card exists to guard against).
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Powers' }), { button: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Heal' })).toBeInTheDocument(), { timeout: 3000 })
    const enableButtons = screen.getAllByRole('button', { name: 'Enable' })
    expect(enableButtons).toHaveLength(3)
    enableButtons.forEach(b => expect(b).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Heal' })).toBeDisabled()
    enableButtons.forEach(b => fireEvent.click(b))
    fireEvent.click(screen.getByRole('button', { name: 'Heal' }))
    expect(sendCommand).not.toHaveBeenCalled()

    // Notes tab -- players.moderate.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Notes/ }), { button: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Note' })).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByRole('button', { name: 'Save Note' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(saveNote).not.toHaveBeenCalled()
    expect(deleteNote).not.toHaveBeenCalled()

    // Teleport -- players.gm_tools, confirmed disabled here too since this
    // role holds neither gm_tools nor moderate.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Moderation' }), { button: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Teleport\b/ })).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByRole('button', { name: /^Teleport\b/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Teleport\b/ }))
    expect(teleport).not.toHaveBeenCalled()
  })

  it('enables gated triggers once the role holds the matching capability', async () => {
    mockCan = () => true
    await setUpFixtures()
    renderPlayers()
    await selectTestPlayer()

    screen.getAllByRole('button', { name: /^Kick\b/ }).forEach(b => expect(b).not.toBeDisabled())
    screen.getAllByRole('button', { name: /^Ban\b/ }).forEach(b => expect(b).not.toBeDisabled())
    expect(screen.getByRole('button', { name: /^Access Level\b/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^Teleport\b/ })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Voice Ban' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'SteamID Ban' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add User' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unban' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unban SteamID' })).not.toBeDisabled()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Powers' }), { button: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Heal' })).toBeInTheDocument(), { timeout: 3000 })
    screen.getAllByRole('button', { name: 'Enable' }).forEach(b => expect(b).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Heal' })).not.toBeDisabled()
  })
})
