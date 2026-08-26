import { describe, expect, it, vi } from 'vitest'
import { resolveClientProvider, waitForServerState } from '../serverStatus'

describe('resolveClientProvider', () => {
  it('returns null for no server', () => {
    expect(resolveClientProvider(null)).toBeNull()
    expect(resolveClientProvider(undefined)).toBeNull()
  })

  it('maps isRemote to remote-sftp regardless of any docker fields', () => {
    expect(resolveClientProvider({ isRemote: true })).toBe('remote-sftp')
    expect(resolveClientProvider({ isRemote: true, dockerContainerName: 'pz' })).toBe('remote-sftp')
  })

  // GH#114: isRemote === false does NOT mean "the local process scan can see
  // this server" -- a docker-managed server's process runs in a different
  // container. dockerContainerName must be checked before defaulting to
  // native, or a Docker provider gets misread as a locally-scannable one.
  it('maps a dockerContainerName mapping to docker-local, not native', () => {
    expect(resolveClientProvider({ isRemote: false, dockerContainerName: 'pz-server' })).toBe(
      'docker-local',
    )
  })

  it('defaults to native only when neither isRemote nor dockerContainerName is set', () => {
    expect(resolveClientProvider({ isRemote: false })).toBe('native')
    expect(resolveClientProvider({})).toBe('native')
  })
})

describe('waitForServerState', () => {
  it('waits until the requested server state is observed', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce({ servers: [{ id: 7, running: true, pid: '123' }] })
      .mockResolvedValueOnce({ servers: [{ id: 7, running: false, pid: null }] })
    const observed: boolean[] = []

    await expect(waitForServerState(fetchStatus, 7, false, status => observed.push(status.running), { pollMs: 0 }))
      .resolves.toBe(true)

    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(observed).toEqual([true, false])
  })

  it('times out when the server never reaches the requested state', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ servers: [{ id: 7, running: true, pid: '123' }] })

    await expect(waitForServerState(fetchStatus, 7, false, undefined, { timeoutMs: 0, pollMs: 0 }))
      .resolves.toBe(false)
    expect(fetchStatus).toHaveBeenCalledOnce()
  })
})
