import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import Chat from '../Chat'
import { panelBridgeApi, playersApi, configApi } from '@/lib/api'

// bug-hunt-2026-08-27 Tier-3 capability-gating sweep: Chat.tsx had zero
// client-side capability awareness before this change. Two genuinely
// different capabilities gate this one page: sending any chat message
// (server broadcast / admin chat / general chat) requires
// server.world_events (the same capability that gates weather/zombie/
// climate tools -- surprising, but confirmed deliberate, see Chat.tsx's own
// comment); managing the quick-broadcast preset list requires panel.settings
// instead. TECHNICIAN and MODERATOR both hold server.world_events but
// neither holds panel.settings by default, so this is a live stock-role
// gap, not a hypothetical one.
//
// The Enter-key path is the sharpest risk here (Angela's Console.tsx
// finding tonight: a disabled button alone is not a gate if a keypress
// reaches the handler directly) -- sendMessage() is called both by the
// Send button's onClick AND by handleKeyDown's Enter path, and
// handleAddPreset/handleSaveEdit/handleDeletePreset are each reachable by
// both a button click and their own input's Enter-key handler. The real
// guards live inside sendMessage() and persistPresets() themselves, so
// they cover every entry point; this file proves that by firing Enter
// directly, not just clicking the visible button.

// jsdom doesn't implement scrollIntoView -- Chat.tsx calls it on every
// chatHistory update to auto-scroll the message log, which is unrelated to
// capability gating but throws in every test here without a stub. No prior
// test file for this page existed to have already discovered this.
Element.prototype.scrollIntoView = vi.fn()

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
    playersApi: { ...actual.playersApi, getPlayers: vi.fn() },
    configApi: { ...actual.configApi, getAppSettings: vi.fn(), updateAppSettings: vi.fn() },
    panelBridgeApi: {
      ...actual.panelBridgeApi,
      sendToServerChat: vi.fn(),
      sendToAdminChat: vi.fn(),
      sendToGeneralChat: vi.fn(),
    },
  }
})

const getPlayers = vi.mocked(playersApi.getPlayers)
const getAppSettings = vi.mocked(configApi.getAppSettings)
const updateAppSettings = vi.mocked(configApi.updateAppSettings)
const sendToServerChat = vi.mocked(panelBridgeApi.sendToServerChat)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderChat() {
  return render(
    <TooltipProvider>
      <ConfirmProvider>
        <Chat />
      </ConfirmProvider>
    </TooltipProvider>,
  )
}

async function setUp() {
  getPlayers.mockResolvedValue({ players: [] } as Awaited<ReturnType<typeof playersApi.getPlayers>>)
  getAppSettings.mockResolvedValue({ chatPresets: ['Test preset'] } as unknown as Awaited<ReturnType<typeof configApi.getAppSettings>>)
}

describe('Chat.tsx: sending gates on server.world_events', () => {
  it('disables Send and never reaches the API on click or Enter when the role lacks server.world_events', async () => {
    mockCan = (capability) => capability !== 'server.world_events'
    await setUp()

    renderChat()

    const input = await screen.findByRole('textbox', { name: 'Chat message' })
    const sendButton = screen.getByRole('button', { name: 'send' })
    expect(sendButton).toBeDisabled()

    fireEvent.change(input, { target: { value: 'hello players' } })
    fireEvent.click(sendButton)
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(sendToServerChat).not.toHaveBeenCalled()
  })

  it('enables Send and reaches the API when the role holds server.world_events', async () => {
    mockCan = () => true
    await setUp()
    sendToServerChat.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof panelBridgeApi.sendToServerChat>>)

    renderChat()

    const input = await screen.findByRole('textbox', { name: 'Chat message' })
    fireEvent.change(input, { target: { value: 'hello players' } })

    const sendButton = screen.getByRole('button', { name: 'send' })
    expect(sendButton).not.toBeDisabled()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(sendToServerChat).toHaveBeenCalledWith('hello players', false))
  })
})

describe('Chat.tsx: quick-broadcast preset management gates on panel.settings', () => {
  it('disables Add/Save/Delete and never reaches the API, even via Enter, when the role lacks panel.settings', async () => {
    mockCan = (capability) => capability !== 'panel.settings'
    await setUp()

    renderChat()

    await screen.findByText('Test preset')
    fireEvent.click(screen.getByRole('button', { name: 'Edit presets' }))

    const addInput = screen.getByPlaceholderText('add a new quick message…')
    expect(screen.getByLabelText('Add preset')).toBeDisabled()
    fireEvent.change(addInput, { target: { value: 'A new preset' } })
    fireEvent.click(screen.getByLabelText('Add preset'))
    fireEvent.keyDown(addInput, { key: 'Enter' })

    expect(screen.getByLabelText('Delete preset 1')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Delete preset 1'))

    expect(updateAppSettings).not.toHaveBeenCalled()
  })

  it('enables Add/Save/Delete when the role holds panel.settings', async () => {
    mockCan = () => true
    await setUp()
    updateAppSettings.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof configApi.updateAppSettings>>)

    renderChat()

    await screen.findByText('Test preset')
    fireEvent.click(screen.getByRole('button', { name: 'Edit presets' }))

    expect(screen.getByLabelText('Delete preset 1')).not.toBeDisabled()

    // "Add preset" is also legitimately disabled on an empty draft --
    // unrelated to capability -- so only assert its non-disabled state
    // once there is something to add.
    const addInput = screen.getByPlaceholderText('add a new quick message…')
    fireEvent.change(addInput, { target: { value: 'A new preset' } })
    expect(screen.getByLabelText('Add preset')).not.toBeDisabled()
    fireEvent.click(screen.getByLabelText('Add preset'))

    await waitFor(() => expect(updateAppSettings).toHaveBeenCalledWith({ chatPresets: ['Test preset', 'A new preset'] }))
  })
})
