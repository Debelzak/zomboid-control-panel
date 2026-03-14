# Zomboid Control Panel

Web-based admin panel for **Project Zomboid dedicated servers** on **Windows** and **Linux/Ubuntu**.

Use one interface to manage server state, players, mods, backups, config files, diagnostics, and optional advanced in-game actions through PanelBridge.

![Zomboid Control Panel Dashboard](Screenshots/Main_Dashboard.png)

## Live Demo

- Dashboard (default): https://fpsacha.github.io/zomboid-control-panel/
- Direct Server Config page: https://fpsacha.github.io/zomboid-control-panel/#/server-config

The demo runs the real frontend shell and real routes on GitHub Pages.

- Navigation and page browsing are enabled.
- Server actions are intentionally offline in demo mode.
- No live backend, no RCON, and no real server writes happen in the demo.

## What You Can Do

### Server Control
- Start, stop, restart, force-stop, and save world.
- Monitor live server status and uptime.
- Check for updates and run update flows.
- Manage multiple server profiles and switch active server.

### Players and Admin Actions
- View online players and player activity history.
- Kick, ban, unban, and manage access levels.
- Use advanced actions through PanelBridge (teleport, heal, god mode, invisibility).
- Export and import character data (skills, perks, recipes, inventory metadata).

### World and Events
- Trigger events and weather actions.
- Control climate settings and game time.
- Use chat/admin messaging tools where supported.

### Mods, Scheduling, and Maintenance
- Track Workshop mods and detect updates.
- Schedule recurring tasks.
- Run backups and restores.
- Use chunk cleanup workflows for map maintenance.

### Security and Reliability
- First-run setup with login.
- JWT auth with refresh token support.
- Input/path safety and route throttling.
- Better session and error handling across UI and backend.

### Integrations
- RCON command console.
- Discord bot configuration and management.
- PanelBridge Lua mod for advanced in-game commands.

## Quick Start

### Option 1: Standalone Build (recommended)

#### Windows
1. Run `ZomboidControlPanel.exe` (or `Start.bat`).
2. Complete setup/login.
3. Configure server paths and RCON in Settings.
4. Start managing your server.

#### Linux/Ubuntu
1. Download the `ZomboidControlPanel` binary.
2. Make it executable and run:
   ```bash
   chmod +x ZomboidControlPanel
   ./ZomboidControlPanel
   ```
3. Open `http://localhost:3001`.
4. Complete setup/login and configure paths + RCON.

> On Linux, optional folder browsing in the UI requires `zenity` (GNOME) or `kdialog` (KDE). You can always type paths manually.

### Option 2: Development Mode
1. Install Node.js 18+.
2. Install dependencies and run:
   ```bash
   npm run install:all
   npm run dev
   ```
3. Open `http://localhost:5173`.

### Option 3: Docker
```bash
docker build -t zomboid-panel .
docker run -d -p 3001:3001 -v panel-data:/app/data zomboid-panel
```

Then open `http://localhost:3001`.

## Requirements

### Runtime
- Windows 10/11 or Linux (Ubuntu 20.04+, Debian, and similar)
- Project Zomboid dedicated server
- RCON enabled in server config

### Development
- Node.js 18+
- npm

## First-Time Setup Checklist

1. Open the panel and complete setup/login.
2. In **Settings**, set:
   - Server install path
   - Zomboid data/config path
   - RCON host, port, and password
3. Save settings and test connection.
4. Optional: install PanelBridge for advanced actions.

## RCON Setup

In your server `.ini` (usually under `Zomboid/Server`):

```ini
RCONPassword=your_password
RCONPort=27015
```

Restart the server after saving.

## PanelBridge Setup (Optional, Recommended)

PanelBridge enables advanced actions that base RCON does not support.

### Common Uses
- Advanced player controls
- Character export/import
- Rich weather/climate commands
- Extended world and diagnostics actions

### Install Steps
1. Copy `pz-mod/PanelBridge` into your server mods directory.
2. Disable Lua checksum in server INI:
   ```ini
   DoLuaChecksum=false
   ```
3. Restart the PZ server.
4. Configure bridge path/settings in the panel.

## Launchers

| File | Platform | Purpose |
|------|----------|---------|
| `ZomboidControlPanel.exe` | Windows | Standalone app (no Node runtime required) |
| `ZomboidControlPanel` | Linux | Standalone app (no Node runtime required) |
| `Start.bat` | Windows | Startup helper (included in full release package) |
| `start.sh` | Linux | Startup helper (included in full release package) |

## Configuration and Environment

Most settings are managed in the UI and stored in `data/db.json`.

Optional environment variables:

| Key | Purpose |
|-----|---------|
| `PORT` | Panel backend port (default: 3001) |
| `RCON_PORT` | PZ RCON port |
| `RCON_PASSWORD` | RCON password |
| `PZ_SERVER_PATH` | PZ server install path |
| `PZ_SAVE_PATH` | Zomboid data/saves path |
| `PZ_SERVER_BAT` | Custom startup script name |
| `MOD_CHECK_INTERVAL` | Mod checker interval |

## Build, Test, and Release

- Build Windows executable: `node build.js`
- Build Linux binary: `node build.js --linux`
- Run tests: `npm test`
- Full release pipeline:
  - `./release.ps1 -Version "0.5.2"`

## Project Structure

```text
├── client/               # React + TypeScript frontend
├── server/               # Express backend (routes/services/database)
│   └── tests/            # Vitest tests
├── pz-mod/PanelBridge/   # Lua bridge mod
├── data/                 # LowDB runtime data
├── logs/                 # Runtime logs
├── build.js              # Build pipeline (client/server/exe)
├── Dockerfile            # Docker support
├── deploy*.ps1           # Deploy scripts
└── release.ps1           # Release automation
```

## Troubleshooting

### RCON not connecting
1. Confirm PZ server is running.
2. Verify `RCONPassword` and `RCONPort` in server INI.
3. Confirm firewall rules allow the RCON port.
4. Retest from panel Settings.

### PanelBridge commands failing
1. Confirm `DoLuaChecksum=false`.
2. Verify bridge path in panel Settings.
3. Restart panel and server, then check Debug/log pages.

### Server start/stop failing
1. Verify server path points to startup scripts (`StartServer64.bat` on Windows or `start-server.sh` on Linux).
2. Check for stale server processes.
3. Run panel with elevated permissions if needed.

### Mod updates not detected
1. Verify Workshop IDs.
2. Confirm tracked mod list is populated.
3. Check mod checker interval settings.

## License

MIT License.
