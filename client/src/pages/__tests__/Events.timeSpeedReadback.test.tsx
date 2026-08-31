import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { vi } from 'vitest'
import Events from '../Events'
import { playersApi, panelBridgeApi } from '@/lib/api'

// 2026-08-30, panelbridge-audit-2026-08-30: third instance of the same
// defect class found tonight (vehicleSetSiren, then Jim's visual-controls
// precondition check, now this) -- a control that displays a number it
// never fetched is asserting something it does not know. The time-speed
// slider was local useState(1), never reassigned by any poll, so it could
// show a stale multiplier after a change made via RCON, another admin, or a
// restart. Fixed by reading the multiplier PanelBridge.lua's getGameTime
// now reports (the same zombie.GameTime singleton/field RCON's setTimeSpeed
// command writes, confirmed via the real jar -- not a decorative read-back).

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    playersApi: { ...actual.playersApi, getPlayers: vi.fn() },
    panelBridgeApi: {
      ...actual.panelBridgeApi,
      getStatus: vi.fn(),
      getClimateFloats: vi.fn(),
      getGameTime: vi.fn(),
      getUtilitiesStatus: vi.fn(),
      sendCommand: vi.fn(),
    },
  }
})

const getPlayers = vi.mocked(playersApi.getPlayers)
const getStatus = vi.mocked(panelBridgeApi.getStatus)
const getClimateFloats = vi.mocked(panelBridgeApi.getClimateFloats)
const getGameTime = vi.mocked(panelBridgeApi.getGameTime)
const getUtilitiesStatus = vi.mocked(panelBridgeApi.getUtilitiesStatus)

function renderEvents() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ConfirmProvider>
          <Events />
        </ConfirmProvider>
      </TooltipProvider>
    </MemoryRouter>,
  )
}

async function openTimeSpeedSection() {
  const nav = await screen.findByText('Time speed')
  fireEvent.click(nav)
}

beforeEach(() => {
  getPlayers.mockReset().mockResolvedValue({ players: [] } as never)
  getStatus.mockReset().mockResolvedValue({ modConnected: true } as never)
  getClimateFloats.mockReset().mockResolvedValue({ success: false } as never)
  getUtilitiesStatus.mockReset().mockResolvedValue({ success: false } as never)
})

describe('Events -- time speed slider reflects the server\'s real multiplier instead of a stale local guess', () => {
  it('shows the polled multiplier, not the useState(1) default, once the bridge reports one', async () => {
    getGameTime.mockResolvedValue({
      success: true,
      data: { hour: 12, day: 5, month: 3, multiplier: 10 },
    } as never)

    renderEvents()
    await openTimeSpeedSection()

    await waitFor(() => expect(screen.getByText('10x')).toBeTruthy())
  })

  it('does not clobber an in-progress drag with a poll tick', async () => {
    getGameTime.mockResolvedValue({
      success: true,
      data: { hour: 12, day: 5, month: 3, multiplier: 10 },
    } as never)

    renderEvents()
    await openTimeSpeedSection()
    await waitFor(() => expect(screen.getByText('10x')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '24×' }))
    expect(screen.getByText('24x')).toBeTruthy()
  })

  // 2026-08-31 impeccable pass: "apply speed" was the only one of three
  // structurally identical "apply this card's pending changes to the live
  // game" buttons on the Events page styled variant="outline" -- Climate
  // Trim's "Apply All Climate" and Visual's "Apply All Visual" both use the
  // plain default (solid primary) variant, with no reason for the
  // difference found in the surrounding code or comments.
  it('styles "apply speed" the same as the page\'s other Apply-All buttons, not outline', async () => {
    getGameTime.mockResolvedValue({
      success: true,
      data: { hour: 12, day: 5, month: 3, multiplier: 1 },
    } as never)

    renderEvents()
    await openTimeSpeedSection()

    const applySpeed = await screen.findByRole('button', { name: /apply speed/i })
    expect(applySpeed).not.toHaveAttribute('data-variant', 'outline')
  })
})
