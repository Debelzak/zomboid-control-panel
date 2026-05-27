const DEMO_FLAGS = new Set(['1', 'true', 'yes', 'on'])

export function isDemoMode(): boolean {
  const value = (import.meta.env.VITE_DEMO_MODE || '').toString().trim().toLowerCase()
  return DEMO_FLAGS.has(value)
}

let demoFetchInstalled = false

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function normalizeApiPath(input: RequestInfo | URL): string {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
    ? input.toString()
    : input.url

  try {
    const parsed = new URL(rawUrl, window.location.origin)
    return parsed.pathname
  } catch {
    return rawUrl
  }
}

function demoServer() {
  return {
    id: 'demo-server',
    name: 'Demo Server',
    serverName: 'DoomerZDemo',
    installPath: '/opt/pz',
    zomboidDataPath: '/home/pz/Zomboid',
    serverConfigPath: '/home/pz/Zomboid/Server',
    rconHost: '127.0.0.1',
    rconPort: 27015,
    rconPassword: '',
    serverPort: 16261,
    minMemory: 2048,
    maxMemory: 4096,
    useNoSteam: false,
    useDebug: false,
    isRemote: false,
    isActive: true,
    createdAt: new Date().toISOString(),
  }
}

function demoIniSettings(): Record<string, string> {
  return {
    PublicName: 'Demo Server',
    PublicDescription: 'GitHub Pages demo mode (no backend connection)',
    MaxPlayers: '16',
    PauseEmpty: 'true',
    Open: 'true',
    PVP: 'false',
    RCONPort: '27015',
    RCONPassword: 'demo-password',
    Mods: 'DemoMod1;DemoMod2',
    WorkshopItems: '1234567890;0987654321',
    LuaChecksum: 'false',
  }
}

export function installDemoFetchShim(): void {
  if (!isDemoMode() || demoFetchInstalled) return

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = normalizeApiPath(input)
    if (!path.startsWith('/api/')) {
      return originalFetch(input, init)
    }

    const method = (init?.method || 'GET').toUpperCase()

    if (path === '/api/auth/status') {
      return jsonResponse({ needsSetup: false, authEnabled: false })
    }
    if (path === '/api/health') {
      return jsonResponse({ version: `${(typeof __PANEL_VERSION__ !== 'undefined' ? __PANEL_VERSION__ : '0.0.0')}-demo` })
    }
    if (path === '/api/panel-info') {
      return jsonResponse({ localIp: '127.0.0.1', port: 3001, url: 'http://demo.local:3001' })
    }
    if (path === '/api/servers') {
      return jsonResponse({ servers: [demoServer()] })
    }
    if (path === '/api/servers/active') {
      return jsonResponse({ server: demoServer() })
    }
    if (path.startsWith('/api/servers/') && path.endsWith('/activate') && method === 'POST') {
      return jsonResponse({ success: true, message: 'Demo mode: active server updated locally only.', server: demoServer() })
    }
    if (path === '/api/server/update/status') {
      return jsonResponse({
        updateAvailable: {
          updateAvailable: false,
          currentVersion: '0.6.0-demo',
        },
      })
    }
    if (path === '/api/server/update-check/status') {
      return jsonResponse({
        updateAvailable: {
          updateAvailable: false,
          installed: { buildId: '21143703', branch: 'unstable', lastUpdated: new Date().toISOString() },
          latest: { buildId: '21143703', branch: 'unstable', timeUpdated: null, description: null },
          lastCheck: new Date().toISOString(),
        },
        gameVersion: '42.15.2',
        lastCheck: new Date().toISOString(),
        intervalMinutes: 30,
        isChecking: false,
      })
    }

    if (path === '/api/server-files/paths') {
      return jsonResponse({
        configPath: '/home/pz/Zomboid/Server',
        serverName: 'DoomerZDemo',
        files: {
          ini: '/home/pz/Zomboid/Server/DoomerZDemo.ini',
          sandbox: '/home/pz/Zomboid/Server/DoomerZDemo_SandboxVars.lua',
          spawnpoints: '/home/pz/Zomboid/Server/spawnpoints.lua',
          spawnregions: '/home/pz/Zomboid/Server/spawnregions.lua',
        },
        exists: {
          ini: true,
          sandbox: true,
          spawnpoints: true,
          spawnregions: true,
        },
      })
    }
    if (path === '/api/server-files/ini') {
      return jsonResponse({ settings: demoIniSettings(), path: '/home/pz/Zomboid/Server/DoomerZDemo.ini' })
    }
    if (path === '/api/server-files/sandbox') {
      return jsonResponse({
        sandbox: {
          ZombieLore: { Speed: 2, Strength: 2 },
          World: { WaterShut: 2, ElecShut: 2 },
          StartYear: 1,
          StartMonth: 7,
          StartDay: 9,
        },
        path: '/home/pz/Zomboid/Server/DoomerZDemo_SandboxVars.lua',
      })
    }
    if (path === '/api/server-files/spawnpoints') {
      return jsonResponse({
        spawnpoints: {
          unemployed: [{ worldX: 40, worldY: 22, posX: 130, posY: 100, posZ: 0 }],
          fireofficer: [{ worldX: 40, worldY: 23, posX: 140, posY: 180, posZ: 0 }],
        },
        path: '/home/pz/Zomboid/Server/spawnpoints.lua',
      })
    }
    if (path === '/api/server-files/spawnregions') {
      return jsonResponse({
        spawnregions: [
          { name: 'Muldraugh, KY', file: 'media/maps/Muldraugh, KY/spawnpoints.lua' },
          { name: 'West Point, KY', file: 'media/maps/West Point, KY/spawnpoints.lua' },
        ],
        path: '/home/pz/Zomboid/Server/spawnregions.lua',
      })
    }
    if (path.startsWith('/api/server-files/raw/')) {
      const type = path.split('/').pop() || 'ini'
      return jsonResponse({
        content: `-- Demo mode raw file for ${type}\n-- No backend is connected on GitHub Pages.\n`,
        path: `/home/pz/Zomboid/Server/${type}.demo`,
        filename: `${type}.demo`,
      })
    }
    if (path === '/api/server-files/backups') {
      return jsonResponse({ backups: [], path: '/home/pz/Zomboid/Server/backups' })
    }
    if (path === '/api/server-files/templates') {
      return jsonResponse({ templates: [] })
    }

    if (method !== 'GET') {
      return jsonResponse({ success: true, message: 'Demo mode: action acknowledged (no backend connected).' })
    }

    return jsonResponse({ success: true, demo: true })
  }

  demoFetchInstalled = true
}
