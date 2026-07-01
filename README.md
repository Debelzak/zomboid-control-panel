<div align="center">

# 🧟 Zomboid Control Panel

### The complete admin cockpit for Project Zomboid dedicated servers

[![Latest Release](https://img.shields.io/github/v/release/fpsacha/zomboid-control-panel?style=for-the-badge&logo=github&color=8a9a5b)](https://github.com/fpsacha/zomboid-control-panel/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/fpsacha/zomboid-control-panel/total?style=for-the-badge&logo=github&color=8a9a5b)](https://github.com/fpsacha/zomboid-control-panel/releases)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/jHsWJDNmSg)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](LICENSE)

**Server control · RCON · live world map · mods · scheduler · backups · Discord bot · Lua bridge**
One dark-mode control room instead of five different tools.

[**🚀 Download**](https://github.com/fpsacha/zomboid-control-panel/releases/latest) ·
[**👁️ Live demo**](https://fpsacha.github.io/zomboid-control-panel/) ·
[**💬 Discord**](https://discord.gg/jHsWJDNmSg) ·
[**📖 Setup**](#quick-start)

</div>

<br />

![Dashboard](Screenshots/screenshot-dashboard-v2.png)

> **At a glance** — server status, RCON & PanelBridge connection state, live player activity, host telemetry, backup readiness, and quick actions. One screen covers 80% of routine admin work.

## ✨ Feature tour

<table>
<tr>
<td width="50%" valign="top">

### 🌧️ Events & Weather
Force-trigger blizzards, tropical storms, or rain at any intensity. Fine-grained climate sliders for fog, wind, temperature, clouds, humidity. Spawn helicopter events or lightning strikes on demand. The closest thing to PZ admin god-mode.

<img src="Screenshots/screenshot-events-v2.png" alt="Events & Weather" />

</td>
<td width="50%" valign="top">

### 🗺️ Live World Map
Real-time player positions on Knox County. Multi-floor support, layer toggles, zoom & pan. Right-click any player for instant teleport, heal, kick, or message — straight from the map.

<img src="Screenshots/screenshot-worldmap-v2.png" alt="World Map" />

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 👥 Player Management
Roster with online / offline / banned tabs. Per-player dossier with moderation, spawn loadout, powers (heal, teleport, god mode), notes & history. Voice ban, SteamID ban, manual targeting.

<img src="Screenshots/screenshot-players-v2.png" alt="Players" />

</td>
<td width="50%" valign="top">

### 🧩 Mod Manager
Tracks every Workshop mod on your server. Detects updates via the Steam API and surfaces pending changes. Pull mod list straight from your server config — no manual entry.

<img src="Screenshots/screenshot-mods-v2.png" alt="Mod Manager" />

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ⚠️ Mod Conflict Detection
Scans your mod list for known incompatibilities, missing dependencies, and load-order issues. Severity-tinted findings so you see real problems before you boot the server.

<img src="Screenshots/screenshot-mods-conflicts.png" alt="Mod Conflicts" />

</td>
<td width="50%" valign="top">

### ⚙️ Server Configuration
Full in-browser INI editor for sandbox options, spawn regions, mod settings, and server flags. Searchable, structured view + raw view for power users. No more notepad-and-restart.

<img src="Screenshots/screenshot-config-v2.png" alt="Server Configuration" />

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🆕 Server Setup Wizard
Spin up a fresh PZ server in minutes. SteamCMD install, port config, RCON setup, admin account — all stepped through with sensible defaults.

<img src="Screenshots/screenshot-server-setup.png" alt="Server Setup" />

</td>
<td width="50%" valign="top">

### 🤖 Discord Bot Setup
Guided wizard for creating the Discord app, getting tokens, configuring intents and inviting the bot. Slash commands + two-way chat relay + event notifications ship turnkey.

<img src="Screenshots/screenshot-discord-setup.png" alt="Discord Setup" />

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 📊 Performance Telemetry
Host RAM and CPU graphs, PZ process memory, player count history. Time-range selectable, exportable. Catch slow leaks and load spikes before players notice.

<img src="Screenshots/screenshot-debug-performance.png" alt="Performance" />

</td>
<td width="50%" valign="top">

### 🐛 Crash Logs & Diagnostics
Java crash dumps, error logs, support bundles. One-click `.zip` export for when you need to share state with someone smarter than you. Health, environment, and activity tabs included.

<img src="Screenshots/screenshot-debug-crashes.png" alt="Crash Logs" />

</td>
</tr>
</table>

---

## Contents

- [What It Does](#what-it-does)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Setup](#setup)
- [PanelBridge](#panelbridge-optional)
- [Remote Access](#remote-access)
- [Security](#security)
- [Development](#development)
- [Community](#community)

---

## What It Does

### Operate
- **Server control** — Start, stop, restart, save. Live status and uptime.
- **Console** — Live log viewer and RCON terminal with command history.
- **Scheduling** — Recurring restarts, saves, broadcasts with countdown warnings.
- **Backups** — Create, restore, and manage world backups.

### Observe
- **Players** — Online list, activity history, kick/ban/unban, access levels, notes and tags.
- **World map** — Live player positions on Knox County with right-click actions.
- **Mod manager** — Track Workshop mods, detect updates, sync from server config, conflict detection.
- **Server config** — Full INI editor with structured and raw views. Sandbox, spawn points, mod settings — searchable and editable in-browser.

### Extend
- **Events & weather** — Rain, storms, blizzards, climate control, time control, sound triggers, zombie management.
- **PanelBridge** — Server-side Lua mod for actions RCON can't reach: teleport, heal, god mode, character export/import, inventory.
- **Discord bot** — Slash commands and two-way chat relay.
- **Multi-server** — Manage multiple PZ servers from one panel.
- **Chunk cleaner** — Visual map selector for cleaning unused chunks.
- **Auto-update** — Checks for new releases, downloads and applies them.

---

## Requirements

- **Project Zomboid dedicated server** — Build 41 or Build 42. Tested through B42.18.
- **RCON enabled** in your server `.ini` (`RCONPort=27015` and `RCONPassword=...`).
- **Network access** between the panel and the PZ server (same machine, same LAN, or reachable IP).
- For PanelBridge features: `DoLuaChecksum=false` in the server `.ini`.

The packaged binary includes its own runtime — no Node.js, Python, or Java install needed on the panel host.

---

## Quick Start

Download from [Releases](https://github.com/fpsacha/zomboid-control-panel/releases/latest). Self-contained binary — no dependencies.

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

The image runs **the panel only** — Project Zomboid itself still has to run somewhere (on the host, in another container, or on a separate machine). The panel reaches it via RCON and via shared filesystem (for PanelBridge).

Pull the prebuilt image:
```bash
mkdir -p ~/zomboid-panel && cd ~/zomboid-panel
curl -O https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/.env.example
mv .env.example .env
docker compose up -d
```
Then open `http://localhost:3001`.

Before bringing it up for real, edit [`docker-compose.yml`](docker-compose.yml) and uncomment the volume mounts that point at your PZ install and `~/Zomboid` folder — the file has two annotated topology examples (PZ on the host vs. PZ on a remote machine). All env vars are documented in [`.env.example`](.env.example).

Prebuilt images are published to GHCR: `ghcr.io/fpsacha/zomboid-panel:latest` and `:vX.Y.Z`. Prefer to build from source? Comment out `image:` in the compose file and uncomment the `build:` block.

---

## Installation

Want the easiest path? Choose one option below.

### Option A: Windows (fastest)
1. Download `ZomboidControlPanel-windows.zip` from [latest release](https://github.com/fpsacha/zomboid-control-panel/releases/latest).
2. Right-click the zip and extract it.
3. Open the extracted folder and run `Start.bat`.
4. Open `http://localhost:3001` in your browser.

### Option B: Linux server (Ubuntu/Debian/Rocky)
1. Download `ZomboidControlPanel-linux.tar.gz` from [latest release](https://github.com/fpsacha/zomboid-control-panel/releases/latest).
2. Extract and start:

```bash
tar xzf ZomboidControlPanel-linux.tar.gz
cd ZomboidControlPanel-linux* 2>/dev/null || true
chmod +x ZomboidControlPanel start.sh
./start.sh
```

3. Open `http://YOUR-SERVER-IP:3001`.

### Option C: Docker (best for VPS)
1. Create a folder and fetch compose + env template:

```bash
mkdir -p ~/zomboid-panel && cd ~/zomboid-panel
curl -O https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/.env.example
cp .env.example .env
```

2. Edit `.env` and `docker-compose.yml` for your paths.
3. Start:

```bash
docker compose up -d
```

4. Open `http://YOUR-SERVER-IP:3001`.

### Option D: macOS (source run)
There is no packaged macOS binary yet. Use Node.js runtime:

```bash
git clone https://github.com/fpsacha/zomboid-control-panel.git
cd zomboid-control-panel
npm run install:all
npm run dev
```

Then open `http://localhost:5173` (frontend dev) and `http://localhost:3001` (API).

### First-time setup (all platforms)
1. Create your admin account in the web UI.
2. Open **Settings** and configure:
	- Project Zomboid install path
	- Zomboid data folder path
	- RCON host/port/password
3. Save, then test server status and RCON from the dashboard.

### Optional but recommended: PanelBridge
For advanced features (teleport, heal, map-driven actions, weather control), copy:

`pz-mod/PanelBridge/media/lua/server/PanelBridge.lua`

to your PZ server install folder:

`Install/media/lua/server/PanelBridge.lua`

Then set `DoLuaChecksum=false` in your server INI and restart the PZ server.

---

## Setup

1. Open the panel and create your admin account.
2. In **Settings**, set your server install path and Zomboid data path.
3. Configure RCON (host, port `27015`, password from your server `.ini`).
4. Optionally install PanelBridge for advanced features.

### PanelBridge (Optional)

PanelBridge is a server-side Lua drop-in that enables features RCON can't reach — teleport, heal, weather control, character export/import, inventory editing, sound triggers.

There is no client-side component. Players don't install anything. The panel copies `PanelBridge.lua` into your server's `Install/media/lua/server/` folder, then you set `DoLuaChecksum=false` in the server INI, restart the PZ server, and enable it in **Settings → PanelBridge**.

---

## Remote Access

If you're running the panel on the same machine as your browser, skip this section.

To access the panel from another machine, allow the origin before first launch:

```bash
CORS_ORIGINS=http://YOUR-IP:3001 ./start.sh
```

After login, save it permanently in **Settings → Remote Access** so the env var isn't required next time.

For VPS or public-internet deployment, put the panel behind a reverse proxy (nginx or Caddy) with HTTPS, and set `HTTPS=true` so the panel emits HSTS headers. Don't expose port 3001 directly to the internet.

---

## Security

- JWT authentication on all API routes.
- Rate limiting on login, RCON, and destructive operations.
- RCON parameter sanitization to prevent command injection.
- CORS configurable per deployment (LAN auto-allows private IPs, VPS requires explicit origins).
- Password reset via secure token file or `--reset-password` CLI flag.

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

## Community

- **Discord** — [discord.gg/jHsWJDNmSg](https://discord.gg/jHsWJDNmSg) for questions, support, and feature ideas.
- **Issues** — [Report bugs or request features](https://github.com/fpsacha/zomboid-control-panel/issues) on GitHub.
- **Changelog** — See the [latest release notes](https://github.com/fpsacha/zomboid-control-panel/releases/latest) for what's new.

---

## License

MIT
