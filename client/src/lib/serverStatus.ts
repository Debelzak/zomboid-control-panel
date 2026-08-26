export type ServerProvider = 'native' | 'docker-local' | 'remote-sftp'

/**
 * Mirrors server/utils/serverStatusModel.js's resolveProvider so client code
 * can tell -- even before a composed-status fetch has resolved -- whether a
 * local process scan (status.running) is actually a trustworthy signal for
 * this server. `isRemote` alone isn't enough: it's false for BOTH native
 * and docker-managed servers, and only a native server runs as a process
 * this host's own scan can ever see. A docker-managed server's process runs
 * in a *different* container, so isRemote === false does not mean "the
 * scan can see it" -- treating it as if it did is exactly how GH#114
 * happened (a Docker container correctly shown running by the Docker panel
 * still read "down" on the same page, because the badge trusted the scan
 * for every non-remote server).
 */
export function resolveClientProvider(
  server: { isRemote?: boolean; dockerContainerName?: string | null } | null | undefined,
): ServerProvider | null {
  if (!server) return null
  if (server.isRemote) return 'remote-sftp'
  if (server.dockerContainerName) return 'docker-local'
  return 'native'
}

export interface ServerStatusEntry {
  id: string | number
  running: boolean
  pid: string | null
}

export interface ServerStatusResponse {
  servers: ServerStatusEntry[]
}

export async function waitForServerState(
  fetchStatus: () => Promise<ServerStatusResponse>,
  serverId: string | number,
  expectedRunning: boolean,
  onStatus?: (status: ServerStatusEntry) => void,
  { timeoutMs = 30000, pollMs = 1000 }: { timeoutMs?: number; pollMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      const data = await fetchStatus()
      const serverStatus = data.servers?.find((entry) => String(entry.id) === String(serverId))
      if (serverStatus) {
        onStatus?.(serverStatus)
        if (serverStatus.running === expectedRunning) return true
      }
    } catch {
      // A short process transition can briefly interrupt the status endpoint.
    }

    if (Date.now() >= deadline) return false
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
  }
}
