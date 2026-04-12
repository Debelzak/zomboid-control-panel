import { describe, it, expect } from 'vitest'
import { getUserErrorMessage } from '../errorMessage'

class MockApiError extends Error {
  status?: number
  code?: string
  isRetryable = false
  isTimeout = false
  isNetworkError = false

  constructor(message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

describe('getUserErrorMessage', () => {
  it('returns the error message for a standard Error', () => {
    expect(getUserErrorMessage(new Error('Connection lost'), 'fallback')).toBe('Connection lost')
  })

  it('returns fallback for empty error message', () => {
    expect(getUserErrorMessage(new Error(''), 'Something went wrong')).toBe('Something went wrong')
  })

  it('returns fallback for "unknown error" message (case-insensitive)', () => {
    expect(getUserErrorMessage(new Error('Unknown Error'), 'fallback')).toBe('fallback')
  })

  it('returns fallback for non-error objects without message', () => {
    expect(getUserErrorMessage(42, 'fallback')).toBe('fallback')
    expect(getUserErrorMessage(null, 'fallback')).toBe('fallback')
    expect(getUserErrorMessage(undefined, 'fallback')).toBe('fallback')
  })

  it('extracts message from plain objects with message property', () => {
    expect(getUserErrorMessage({ message: 'server down' }, 'fallback')).toBe('server down')
  })

  it('returns fallback for plain objects with empty message', () => {
    expect(getUserErrorMessage({ message: '' }, 'fallback')).toBe('fallback')
  })
})
