# Zomboid Control Panel

[![Latest Release](https://img.shields.io/github/v/release/fpsacha/zomboid-control-panel)](https://github.com/fpsacha/zomboid-control-panel/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Web-based admin panel for **Project Zomboid dedicated servers**. Runs on Windows, Linux, Docker, or a VPS.

One place to manage your server instead of juggling five different tools.

**[Live demo →](https://fpsacha.github.io/zomboid-control-panel/)**

No existing PZ server tool covered the full workflow. Most handled one or two parts. I needed one place for everything — server control, mod tracking, an in-game bridge, backups, Discord, chunk cleanup, multi-server. So I built the whole thing. [Background story →](https://www.youtube.com/watch?v=P2k0VFX1FUw)

![Dashboard](Screenshots/screenshot-dashboard.png)

---

## What It Does

- **Server control** — Start, stop, restart, save. Live status and uptime tracking.
- **Players** — Online list, activity history, kick/ban/unban, access levels, notes and tags.
- **Console** — Live server log viewer and RCON terminal with command history.
- **Mod manager** — Track Workshop mods, detect updates, sync from server config, conflict detection.
- **Events & weather** — Rain, storms, blizzards, climate control, time control, sound triggers, zombie management.
- **World map** — Live player positions on Knox County with right-click actions.
- **Server config** — Full INI editor with structured and raw views. Sandbox variables, spawn points, mod settings — all searchable and editable in-browser.
- **Scheduling** — Recurring restarts, saves, broadcasts with countdown warnings.
- **Backups** — Create, restore, and manage world backups.
- **Chunk cleaner** — Visual map selector for cleaning unused chunks.
- **Multi-server** — Manage multiple PZ servers from one panel.
- **Discord bot** — Slash commands and two-way chat relay.
- **PanelBridge** — Lua mod for in-game actions RCON can't reach: teleport, heal, god mode, character export/import, inventory management.
- **Auto-update** — Checks for new panel releases, downloads and applies them.

<p align="center">
   <img src="Screenshots/screenshot-events.png" width="49%" alt="Events &amp; Weather" />
   <img src="Screenshots/screenshot-mods.png" width="49%" alt="Mod Manager" />
</p>
<p align="center">
   <img src="Screenshots/screenshot-console.png" width="49%" alt="Console" />
   <img src="Screenshots/screenshot-players.png" width="49%" alt="Players" />
</p>

---

## Quick Start

Download from [Releases](https://github.com/fpsacha/zomboid-control-panel/releases/latest). No dependencies required — the binary is self-contained.

### Windows
1. Extract `ZomboidControlPanel-windows.zip`
2. Run `Start.bat`
3. Open `http://localhost:3001`

### Linux
```bash
tar xzf ZomboidControlPanel-linux.tar.gz
./start.sh
```
Works on Ubuntu 20.04+, Debian 10+, CentOS Stream 8+, Rocky 8+, or anything with glibc 2.28+.

### Docker
```bash
docker compose up -d
```

### VPS / Remote Access

If accessing from another machine, allow your IP before first launch:

```bash
CORS_ORIGINS=http://YOUR-IP:3001 ./start.sh
```

After login, save it permanently in **Settings → Remote Access**. Use a reverse proxy (nginx/Caddy) with HTTPS for production.

---

## Setup

1. Open the panel and create your admin account.
2. In **Settings**, set your server install path and Zomboid data path.
3. Configure RCON (host, port `27015`, password from your server `.ini`).
4. Optionally install PanelBridge for advanced features (teleport, weather, character management).

### PanelBridge (Optional)

PanelBridge is a Lua mod that enables everything RCON can't do. The panel installs it automatically — just set `DoLuaChecksum=false` in your server INI, restart the PZ server, and enable it in Settings.

---

## Security

- JWT authentication on all API routes.
- Rate limiting on login, RCON, and destructive operations.
- RCON parameter sanitization to prevent command injection.
- CORS configurable per deployment (LAN auto-allows private IPs, VPS requires explicit origins).
- Password reset via secure token file or CLI flag.

---

## Development

```bash
npm run install:all
npm run dev
```
Frontend at `http://localhost:5173`, backend at `http://localhost:3001`.

```bash
node build.js --all        # Build Windows + Linux binaries
npm test                   # Run tests
```

---

## License

MIT
