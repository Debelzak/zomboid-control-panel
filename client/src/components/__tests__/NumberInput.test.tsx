import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NumberInput } from '../NumberInput'

// GH silent-default sweep (conv-install-idiot-proofing-2026-08, god's follow-up
// to f1ce821): every plain numeric <Input> in the client used to run
// `onChange={(e) => setX(parseInt(e.target.value) || DEFAULT)}` -- clearing
// the field snapped it back to DEFAULT under the operator's own cursor
// instead of staying empty. This is the shared component that now backs
// every one of those 13 sites (ServerSetup.tsx x4, Servers.tsx x7,
// Players.tsx x1, Scheduler.tsx x1) -- Settings.tsx:4673 is a separate card,
// not covered here. These tests exercise the component directly rather than
// each page, since the fix lives in exactly one place now.

// A real call site is a controlled component: the parent's own state updates
// from onChange and flows back down as the `value` prop on the next render.
// This harness reproduces that loop instead of asserting against a frozen
// `value` prop, the same way the pages that use NumberInput actually behave.
function ControlledHarness({
  initial,
  onChange,
  clamp,
}: {
  initial: number
  onChange?: (value: number) => void
  clamp?: (value: number) => number
}) {
  const [value, setValue] = useState(initial)
  return (
    <NumberInput
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      clamp={clamp}
    />
  )
}

describe('NumberInput', () => {
  it('reproduces the fix: clearing the field leaves it empty instead of snapping to the old value', () => {
    render(<ControlledHarness initial={27015} />)
    const input = screen.getByDisplayValue('27015')

    fireEvent.change(input, { target: { value: '' } })

    // The old bug: parseInt('') || 27015 -> the box would show "27015" again,
    // as if the operator's keystroke never happened.
    expect(screen.queryByDisplayValue('27015')).not.toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('calls onChange with NaN when the field is cleared, so the caller\'s own submit-time validation refuses it', () => {
    const onChange = vi.fn()
    render(<ControlledHarness initial={27015} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('27015'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(NaN)
  })

  it('shows exactly what is typed mid-edit, not a coerced value', () => {
    render(<ControlledHarness initial={16261} />)
    const input = screen.getByDisplayValue('16261')

    fireEvent.change(input, { target: { value: '8' } })
    expect((input as HTMLInputElement).value).toBe('8')

    fireEvent.change(input, { target: { value: '80' } })
    expect((input as HTMLInputElement).value).toBe('80')
  })

  it('propagates a fully-typed valid integer to the caller', () => {
    const onChange = vi.fn()
    render(<ControlledHarness initial={16261} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('16261'), { target: { value: '8080' } })

    expect(onChange).toHaveBeenLastCalledWith(8080)
  })

  it('applies clamp only to a value the operator actually typed, never to the empty/NaN case', () => {
    const onChange = vi.fn()
    render(<ControlledHarness initial={4} onChange={onChange} clamp={(n) => Math.max(1, n)} />)
    const input = screen.getByDisplayValue('4')

    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith(1) // clamp applied to a real typed value

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(NaN) // clamp NOT applied to empty -- would otherwise hide the NaN
  })

  it('re-syncs from an external value change (e.g. RAM auto-detect) when the field is not focused', () => {
    const { rerender } = render(<NumberInput value={4} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()

    rerender(<NumberInput value={8} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('8')).toBeInTheDocument()
  })

  it('does not let an external value change clobber text the operator is mid-typing', () => {
    const { rerender, container } = render(<NumberInput value={4} onChange={vi.fn()} />)
    const input = container.querySelector('input')!

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1' } })
    expect(input.value).toBe('1')

    // Something external changes the committed value while still focused/mid-edit
    // (e.g. a sibling control writing the same state) -- the operator's own
    // half-typed keystroke must not be overwritten out from under them.
    rerender(<NumberInput value={9} onChange={vi.fn()} />)
    expect(input.value).toBe('1')

    fireEvent.blur(input)
  })

  it('renders empty rather than the literal text "NaN" when constructed with a non-finite value', () => {
    const { container } = render(<NumberInput value={NaN} onChange={vi.fn()} />)
    const input = container.querySelector('input')!
    expect(input.value).toBe('')
  })
})
