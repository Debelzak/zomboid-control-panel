const DEMO_FLAGS = new Set(['1', 'true', 'yes', 'on'])

export function isDemoMode(): boolean {
  const value = (import.meta.env.VITE_DEMO_MODE || '').toString().trim().toLowerCase()
  return DEMO_FLAGS.has(value)
}
