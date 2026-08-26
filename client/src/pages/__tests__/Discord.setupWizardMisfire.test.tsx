import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmProvider } from '@/contexts/ConfirmContext'
import Discord from '../Discord'
import { discordApi } from '@/lib/api'

// bug-hunt-2026-08-26: loadData() ran four independent fetches in parallel,
// each with its own silent-fallback .catch(). Three of the four (status,
// webhook events, permissions) discarded their failure with zero visible
// feedback; only the config fetch showed an inline error -- and even that
// one had a further problem: showSetupWizard = !isConfigured && !running
// derived isConfigured from `config`, which stays null on a failed read.
// A FULLY CONFIGURED, currently-STOPPED bot (a normal, common state -- no
// second failure required) hitting a transient config-fetch hiccup on page
// load would see isConfigured=false and running=false (honestly, since the
// bot really is stopped) and the FIRST-TIME SETUP WIZARD would render
// instead of the management dashboard. This file pins that specific
// misfire and its inverse (a genuinely unconfigured bot must still see the
// wizard when nothing failed).

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    discordApi: {
      ...actual.discordApi,
      getStatus: vi.fn(),
      getConfig: vi.fn(),
      getWebhookEvents: vi.fn(),
      getPermissions: vi.fn(),
    },
  }
})

const getStatus = vi.mocked(discordApi.getStatus)
const getConfig = vi.mocked(discordApi.getConfig)
const getWebhookEvents = vi.mocked(discordApi.getWebhookEvents)
const getPermissions = vi.mocked(discordApi.getPermissions)

function renderDiscord() {
  return render(
    <TooltipProvider>
      <ConfirmProvider>
        <Discord />
      </ConfirmProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  getStatus.mockReset()
  getConfig.mockReset()
  getWebhookEvents.mockReset().mockResolvedValue({ events: {} })
  getPermissions.mockReset().mockResolvedValue({ permissions: {} })
})

describe('Discord -- a failed config read must not present the setup wizard', () => {
  it('shows the management dashboard, not the setup wizard, when config fails to load on a stopped-but-configured bot', async () => {
    getConfig.mockRejectedValue(new Error('network error'))
    getStatus.mockResolvedValue({ running: false, configured: true })

    renderDiscord()

    expect(await screen.findByText('Discord Bot')).toBeInTheDocument()
    expect(screen.queryByText('Discord Bot Setup')).not.toBeInTheDocument()
  })

  it('still shows the setup wizard for a genuinely unconfigured bot when nothing failed to load', async () => {
    getConfig.mockResolvedValue(null)
    getStatus.mockResolvedValue({ running: false, configured: false })

    renderDiscord()

    expect(await screen.findByText('Discord Bot Setup')).toBeInTheDocument()
    expect(screen.queryByText('Discord Bot', { selector: 'h1' })).not.toBeInTheDocument()
  })
})
