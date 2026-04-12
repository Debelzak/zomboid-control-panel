import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No servers found" description="Add a server to get started." />)
    expect(screen.getByText('No servers found')).toBeInTheDocument()
    expect(screen.getByText('Add a server to get started.')).toBeInTheDocument()
  })

  it('renders eyebrow text for the given type', () => {
    render(<EmptyState type="noPlayers" title="Ghost town" />)
    expect(screen.getByText('No Players Online')).toBeInTheDocument()
  })

  it('renders action button when provided', () => {
    const onClick = () => {}
    render(
      <EmptyState
        title="Nothing here"
        action={{ label: 'Add Server', onClick }}
      />
    )
    expect(screen.getByRole('button', { name: 'Add Server' })).toBeInTheDocument()
  })

  it('does not render action button when omitted', () => {
    render(<EmptyState title="Nothing here" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders compact variant with smaller padding', () => {
    const { container } = render(<EmptyState title="Compact" compact />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('py-8')
  })

  it('has an accessible live region', () => {
    const { container } = render(<EmptyState title="Test" />)
    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion).toBeInTheDocument()
  })
})
