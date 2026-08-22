import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BridgeStatusBadge } from '../BridgeStatusBadge'

describe('BridgeStatusBadge', () => {
  it('reports connected when the bridge is connected', () => {
    render(<BridgeStatusBadge connected running />)
    expect(screen.getByText('Bridge connected')).toBeInTheDocument()
  })

  it('does not claim connected just because the server is running', () => {
    render(<BridgeStatusBadge connected={false} running />)
    expect(screen.getByText('Bridge waiting')).toBeInTheDocument()
    expect(screen.queryByText('Bridge connected')).not.toBeInTheDocument()
  })

  it('reports offline when neither connected nor running', () => {
    render(<BridgeStatusBadge connected={false} running={false} />)
    expect(screen.getByText('Bridge offline')).toBeInTheDocument()
  })

  it('loading overrides a stale connected flag rather than asserting it', () => {
    render(<BridgeStatusBadge connected loading />)
    expect(screen.getByText('Checking…')).toBeInTheDocument()
    expect(screen.queryByText('Bridge connected')).not.toBeInTheDocument()
  })

  it('surfaces the bridge path in the tooltip so operators can verify it', () => {
    render(<BridgeStatusBadge connected bridgePath="/opt/pz/mods/bridge" />)
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('/opt/pz/mods/bridge'))
  })

  it('surfaces the offline hint pointing at Settings when disconnected', () => {
    render(<BridgeStatusBadge connected={false} running={false} />)
    expect(screen.getByRole('status')).toHaveAttribute(
      'title',
      expect.stringContaining('Settings')
    )
  })

  it('prefers an explicit summary over the generic hint', () => {
    render(<BridgeStatusBadge connected={false} running={false} summary="Custom detail from server" />)
    const el = screen.getByRole('status')
    expect(el.getAttribute('title')).toContain('Custom detail from server')
    expect(el.getAttribute('title')).not.toContain('Settings → Bridge')
  })
})
