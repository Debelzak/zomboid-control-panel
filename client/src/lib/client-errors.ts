export function reportClientError(message: string, error?: unknown) {
  if (import.meta.env.DEV) {
    console.error(message, error)
  }
}

export function reportClientWarning(message: string, details?: unknown) {
  if (import.meta.env.DEV) {
    console.warn(message, details)
  }
}