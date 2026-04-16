# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] - 2026-04-16

### Fixed
- **RCON detection with WinGSM and other wrappers**: the panel failed to detect servers launched through WinGSM because the wrapper's process arguments did not match the old strict regex. `isWindowsDedicatedServerCommandLine` now recognizes WinGSM-wrapped launches, native `ProjectZomboid64.exe` with `-server`/`-servername`, and generic Zomboid command lines.
- **RCON startup port-probe fallback**: when Windows process detection returns a false negative (permissions, wrappers, unusual launchers), the panel now probes the RCON port directly at startup and connects immediately if it is listening, instead of waiting up to 60s for the auto-reconnect loop.
- **Stale RCON credentials after editing active server**: previously, editing the active server's RCON host/port/password kept the running RconService using cached credentials until the panel was restarted. Editing the active server now reloads and reconnects RCON and refreshes ServerManager paths when relevant fields change.
- **Force stop failed on wrapped servers**: the Windows force-kill path used a hardcoded PowerShell pipeline that only matched the raw `zombie.network.gameserver` Java class. WinGSM-wrapped or native-launcher processes were not stopped. Force stop now scans processes via WMI, matches them with the shared wrapper-aware logic, and falls back to generic kill only if detection fails.
- **Log download 401 errors**: "Download combined.log" and "Download error.log" in `/debug` used plain `<a href>` links that skipped the JWT bearer header. Replaced with authenticated `Blob` downloads.

### Added
- **Support Bundle ZIP**: new "Download Support Bundle (.zip)" button on `/debug` aggregates panel logs (`combined.log`, `error.log`), Zomboid install logs (`connection_log`, `workshop_log`, `content_log`, etc.), server runtime logs (`server-console.txt`, chat/debug logs), and any matching crash dumps (`hs_err_pid*`) into a single zip stream for bug reports.

### Changed
- **Safer Windows force stop**: `-server` / `startserver` in a command line alone no longer counts as a PZ server match. The native launcher or an explicit Zomboid path is now required, so unrelated Java processes on the same machine (for example a Minecraft server started with `java -server`) can never be falsely identified or killed by the panel.

## [1.0.1] - 2025-04-12

### Added
- **World Map — Vehicle overlay**: see every vehicle on the map, color-coded by fuel level. Right-click for quick actions (repair, fill fuel, charge battery, remove).
- **World Map — Safehouse overlay**: safehouses rendered as isometric diamonds with owner labels. Active safehouses glow brighter when a player is connected.
- **World Map — Toggle buttons**: Car and Home icons in the toolbar to show/hide vehicles and safehouses independently.
- **Chunk Cleaner — Vehicle overlay**: vehicles shown as colored dots on the chunk map with fuel-level coloring.
- **Chunk Cleaner — Safehouse overlay**: safehouses shown as dashed-border rectangles with owner labels.
- **Chunk Cleaner — Vehicle removal on delete**: checkbox in the delete dialog to remove vehicles in the selected area before chunk deletion, preventing orphaned entries in vehicles.db.
- **Chunk Cleaner — Safehouse warning**: delete dialog warns when safehouses overlap the selected chunks, listing affected owners.
- **PanelBridge `removeVehicle` handler**: permanently remove a single vehicle by ID.
- **PanelBridge `removeVehiclesInArea` handler**: remove all vehicles within a coordinate bounding box.

### Fixed
- "Ekron" label on both World Map and Chunk Cleaner corrected to "Fallas Lake".
- Vehicle overlay coordinate validation in Lua now checks `nil` instead of `== 0` (0,0 is a valid PZ coordinate).
- Safehouse label deduplication — owner name no longer shown twice when it matches the safehouse title.
- Stale overlay data cleared when switching saves in Chunk Cleaner.
- Delete dialog "Remove vehicles" checkbox resets on each open (no stale state from cancelled dialogs).

### Changed
- Vehicle fuel-level colors pre-resolved to canvas color refs instead of calling `getComputedStyle()` per frame per vehicle.
- Safehouse owner list in delete dialog truncated to 5 entries with "+N more" overflow.

## [1.0.0] - 2025-04-10

### Added
- Full-featured web admin panel for Project Zomboid dedicated servers.
- Dashboard with real-time server status, player list, and quick actions.
- Interactive World Map with DZI tile rendering, player position tracking, airdrops, and landmark labels.
- RCON console with command history and autocomplete.
- Player management: kick, ban, teleport, heal, godmode, inventory, character export/import.
- Weather and climate control via PanelBridge (storms, temperature, fog, wind, snow).
- Mod tracker with Steam Workshop update detection.
- Scheduler for automated tasks (restarts, backups, messages) via cron.
- Backup and restore with zip archives.
- Chunk Cleaner for resetting map areas with visual chunk selection.
- Server config INI editor with validation.
- Multi-server support with server finder auto-detection.
- Discord bot integration for server status and player notifications.
- PanelBridge Lua mod for advanced in-game operations (B41 + B42 compatible).
- JWT authentication with rate limiting and CORS configuration.
- Standalone Windows .exe and Linux binary builds via pkg.
- Docker support with docker-compose.
- 6 color themes (Dark, Midnight, Crimson, Forest, Hacker, Vapor).
- Responsive design with mobile support.

[1.0.6]: https://github.com/fpsacha/zomboid-control-panel/compare/v1.0.1...v1.0.6
[1.0.1]: https://github.com/fpsacha/zomboid-control-panel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/fpsacha/zomboid-control-panel/releases/tag/v1.0.0
