# Zomboid Control Panel

[![CI](https://github.com/fpsacha/zomboid-control-panel/actions/workflows/release-artifacts.yml/badge.svg)](https://github.com/fpsacha/zomboid-control-panel/actions/workflows/release-artifacts.yml)
[![Latest Release](https://img.shields.io/github/v/release/fpsacha/zomboid-control-panel)](https://github.com/fpsacha/zomboid-control-panel/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Web-based admin panel for **Project Zomboid dedicated servers** on **Windows** and **Linux**.

One interface. Everything needed to run your server without jumping between five different tools.

**[Try the live demo →](https://fpsacha.github.io/zomboid-control-panel/)**

> Real UI, real routes, GitHub Pages. Navigation and all pages work. Server actions are intentionally offline — no RCON, no live backend, no writes.

---

## Why

No existing PZ server tool covered the full workflow. Most handled one or two parts. I needed one place for server control, reliable mod update tracking, an in-game bridge, backup management, Discord integration, chunk cleanup, and multi-server support.

So I built the whole thing. [Background story →](https://www.youtube.com/watch?v=P2k0VFX1FUw)

---

<p align="center">
   <img src="Screenshots/screenshot-dashboard.png" width="49%" alt="Dashboard" />
   <img src="Screenshots/screenshot-players.png" width="49%" alt="Players" />
</p>
<p align="center">
   <img src="Screenshots/screenshot-events.png" width="49%" alt="Events &amp; Weather" />
   <img src="Screenshots/screenshot-serverconfig.png" width="49%" alt="Server Config" />
</p>

---

## Features

- **Server control** — Start, stop, restart, force-stop, save world. Live status and uptime.
- **Multi-server** — Manage multiple PZ server instances from one panel. Add existing servers, install new ones via SteamCMD, or connect to remote servers.
- **Player management** — Online players, activity history, notes and tags. Kick, ban, unban, access levels.
- **PanelBridge extras** — Teleport, heal, god mode, invisibility, character export/import (skills, perks, recipes, inventory).
- **World & events** — Weather triggers, climate control, game time, sound events, zombie management. Chat and admin messaging.
- **World map** — Live player positions on Knox County map with right-click actions.
- **Server config editor** — Full INI editor with structured and raw views, sandbox variables, spawn points, spawn regions, and mod settings — all searchable and editable in-browser.
- **Live mod settings** — Browse and edit every sandbox option from your mods and vanilla, grouped by mod, searchable, with instant apply. No config files, no restart.
- **Mod tracking** — Workshop mod update detection with configurable polling. Sync from server config with automatic filtering of non-mod Workshop items (collections, screenshots).
- **Scheduling** — Recurring tasks: restarts, saves, broadcasts. Countdown warnings before restarts.
- **Maintenance** — World backups/restores, chunk cleanup with visual map selector, full RCON console.
- **Integrations** — Discord bot with slash commands and two-way chat relay. PanelBridge Lua mod for in-game commands RCON can't reach.
- **Themes** — Survival (gritty) and Control Room (clean) dark themes.

---

## Quick Start

**Requires:** Windows 10/11 or Linux (Ubuntu 20.04+, Debian, etc.) and a Project Zomboid server with RCON enabled.

### Windows
1. Download `ZomboidControlPanel-windows.zip` from [Releases](https://github.com/fpsacha/zomboid-control-panel/releases/latest).
2. Extract anywhere — keep the folder structure intact.
3. Run `Start.bat`.
4. Open `http://localhost:3001`, complete setup, configure RCON in Settings.

### Linux
1. Download `ZomboidControlPanel-linux.tar.gz` from [Releases](https://github.com/fpsacha/zomboid-control-panel/releases/latest).
2. Extract and run:
   ```bash
   tar xzf ZomboidControlPanel-linux.tar.gz
   ./start.sh
   ```
   Execute permissions are preserved in the archive — no `chmod` needed.
3. Open `http://localhost:3001`.

> On Linux, UI folder browsing requires `zenity` (GNOME) or `kdialog` (KDE). Paths can always be typed manually.

### Docker
```bash
docker build -t zomboid-panel .
docker run -d -p 3001:3001 -v panel-data:/app/data zomboid-panel
```

For remote/VPS access, pass `CORS_ORIGINS` to allow your IP:
```bash
docker run -d -p 3001:3001 -e CORS_ORIGINS=http://YOUR-VPS-IP:3001 -v panel-data:/app/data zomboid-panel
```

### Remote Access (VPS)

Accessing the panel from another machine? Allow your IP before first launch:

```bash
echo 'CORS_ORIGINS=http://YOUR-VPS-IP:3001' > .env
./start.sh
```

Replace `YOUR-VPS-IP` with the server's public IP. After login, go to **Settings → CORS / Remote Access** to save it permanently — the `.env` line is only needed for initial access.

---

## Setup

### First Run

1. Open the panel and complete setup/login.
2. In **Settings**, configure:
   - Server install path
   - Zomboid data/config path (`Zomboid/Server`)
   - RCON host, port (default: `27015`), and password
3. Save and test the connection.

### RCON

In your server `.ini` (under `Zomboid/Server`):

```ini
RCONPassword=your_password
RCONPort=27015
```

Restart the PZ server after saving.

### PanelBridge (Optional, Recommended)

PanelBridge is a Lua server mod that opens up commands RCON can't reach: character data, detailed weather control, extended world actions. Most of the interesting stuff is behind it.

1. Copy `pz-mod/PanelBridge` to your server mods directory.
2. Add to server INI:
   ```ini
   DoLuaChecksum=false
   ```
3. Restart the PZ server.
4. Set the bridge path in panel Settings.

---

## Security

- JWT authentication on all API routes (except health check and map tiles).
- Rate limiting at multiple tiers: general API, destructive operations, RCON, login.
- RCON command parameter sanitization to prevent injection.
- INI value sanitization to prevent config injection.
- Error messages sanitized before returning to clients.
- CORS configurable for LAN and VPS deployments.
- Password reset via secure token file or CLI flag.

For VPS deployments, use a reverse proxy with HTTPS and configure explicit CORS origins. See Settings → Remote Access after first login.

---

## Troubleshooting

**RCON not connecting**
- Confirm the PZ server is running and RCON is enabled in the INI.
- Check firewall rules for the RCON port.
- Re-test from panel Settings after every change.

**PanelBridge commands failing**
- Confirm `DoLuaChecksum=false` and that the server has been restarted.
- Verify the bridge file path in Settings.
- Check the Debug page and server logs for mod errors.

**Server start/stop failing**
- Verify the path points to the correct startup script (`StartServer64.bat` on Windows, `start-server.sh` on Linux).
- Look for stale server processes.

**Mod updates not detected**
- Confirm Workshop IDs are tracked in the Mods page.
- Check the mod checker interval in Settings.

---

## Development

### Dev Mode
```bash
npm run install:all
npm run dev
```
Frontend at `http://localhost:5173`, backend at `http://localhost:3001`.

### Build
```bash
node build.js --windows    # Windows exe only
node build.js --linux      # Linux binary only
node build.js --all        # Both platforms + checksums + manifest
npm test                   # Run tests
```

### Release Pipeline (PowerShell)
```powershell
.\release.ps1 -Version "0.6.2"
.\release.ps1 -Version "0.6.2" -DryRun       # Preview without changes
.\release.ps1 -Version "0.6.2" -SkipDeploy   # Skip live server deploy
```

### Project Structure
```
├── client/               # React + TypeScript frontend
├── server/               # Express backend (routes, services, database)
│   └── tests/            # Vitest tests
├── pz-mod/PanelBridge/   # Lua bridge mod
├── data/                 # LowDB runtime data (never commit db.json)
├── logs/                 # Runtime logs
├── build.js              # Build pipeline
├── Dockerfile
└── release.ps1           # Release automation
```

<details>
<summary>Release package contents</summary>

Each [release](https://github.com/fpsacha/zomboid-control-panel/releases/latest) ships two complete packages (binary + web UI + launch scripts + PanelBridge mod):

| File | Platform | How to run |
|------|----------|------------|
| `ZomboidControlPanel-windows.zip` | Windows | Extract → run `Start.bat` |
| `ZomboidControlPanel-linux.tar.gz` | Linux | Extract → run `./start.sh` |
| `checksums.txt` | Both | SHA256 integrity hashes |
| `release-manifest.json` | Both | Build metadata |

Verify integrity:
```bash
# Linux/macOS
sha256sum -c checksums.txt

# Windows (PowerShell)
Get-FileHash .\ZomboidControlPanel-windows.zip -Algorithm SHA256
```

</details>

---

## License

MIT
