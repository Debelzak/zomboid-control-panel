import { ApiError } from './api'

export function getUserErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const message = error.message?.trim()
    if (message && message.toLowerCase() !== 'unknown error') {
      return message
    }
    return fallback
  }

  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message && message.toLowerCase() !== 'unknown error') {
      return message
    }
    return fallback
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const candidate = (error as { message?: unknown }).message
    if (typeof candidate === 'string' && candidate.trim() && candidate.toLowerCase() !== 'unknown error') {
      return candidate.trim()
    }
  }

  return fallback
}
