# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-07-28

### Added

- **Dependency-aware load order auto-sort**: the Load Order tab can now propose an order that places every mod declaring `require=` in its `mod.info` after the mods it depends on. Mods without a declared dependency keep their existing position, so the arrangement you built by hand is preserved rather than replaced by an alphabetical list.
- **Reviewable sort proposal**: auto-sort never writes on its own. It presents the mods that would move with their before and after positions, and the order is only staged when you apply it and saved when you confirm with Save Order.
- **Sort diagnostics**: circular `require=` chains are reported by name and keep their current order instead of being reordered arbitrarily, and requirements that point at mods which are not enabled are counted and surfaced rather than silently discarded.

### Changed

- **Focused move reporting**: the proposal lists only the mods whose position genuinely had to change, instead of every mod whose index shifted because an entry above it moved.

## [1.1.0] - 2026-07-28

### Added

- **Collection-first Steam Workshop management**: the Collection tab now identifies whether each item is tracked, in the Steam collection, and configured on the active server. Add collection items directly to the server, or remove server mods individually or in bulk after changing the Steam collection.
- **Complete server-enable action**: adding a mod from Collection updates `WorkshopItems=`, discovers and writes its internal mod ID to `Mods=`, includes map folders when available, and begins tracking the mod for update checks.
- **Safer collection synchronization**: optional collection-only mods are now a first-class neutral state instead of a false mismatch. Sync adds tracked mods that are missing from Steam without silently deleting optional collection items.
- **Operational dashboard signals**: added host disk headroom, next scheduled maintenance action, and current console error count to the dashboard.
- **Clearer collection actions**: bulk actions are disabled when they cannot apply to the current selection, and every mod row states whether it is on the server.

### Fixed

- **Mod removal semantics**: Collection-tab untracking no longer creates an ignore rule or changes Steam membership. Server removal consistently removes the mod from the server INI and tracking state, then mirrors to Steam only when collection auto-sync is enabled.
- **Workshop title resolution**: tracked and deactivated mods now resolve their real Steam titles automatically when local workshop files are unavailable; generic `Workshop Mod <id>` labels are repaired and persisted without manual intervention.
- **Steam collection rate limiting**: collection mutations use a dedicated limiter so normal collection management no longer collides with sensitive-operation limits.
- **Collection title accuracy**: placeholder tracked names no longer block Steam title lookups in the collection view.
- **Mod configuration reliability**: server mod removal handles Workshop IDs, internal mod IDs, and map-folder cleanup together; collection-driven server actions follow the same safe path.
- **Settings reliability**: browser-extension downloads are packaged in Docker images and clipboard copy falls back for browsers running on non-HTTPS local panel URLs.
- **Dashboard polish**: telemetry rows retain fixed geometry, the removed trace mode no longer leaves stale controls, and duplicated oversized error verdicts were replaced by a compact errors work item.

### Changed

- **Steam collection workflow**: the Collection tab is now the practical place to reconcile Steam membership with server configuration. With auto-sync enabled, removing a mod from the server also removes it from Steam; with auto-sync disabled, Steam membership stays unchanged and the UI says so.
- **Advanced mod actions**: `Remove from server INI` and `Remove from server` now have distinct names, shared destructive iconography, and hover explanations that make their tracking behavior explicit.

## [1.0.77] - 2026-07-22

### Added

- **SteamCMD discovery**: the server update dialog now detects and saves an installed SteamCMD path automatically, including the `/home/steam/steamcmd` location used by the all-in-one Docker image.
- **Branch details**: the server update dialog now explains the selected Steam channel and displays its Steam build number and last-updated time when available.

## [1.0.76] - 2026-07-22

### Fixed

- **All-in-one Docker update controller**: update and rollback Compose commands now load the deployment `.env` file, preserving required CORS and controller-token settings when the panel container is recreated.

## [1.0.75] - 2026-07-22

### Added

- **All-in-one Docker updater**: an opt-in, token-protected controller can download a tagged GitHub release, rebuild the all-in-one image, recreate the panel container, verify its health, and roll back the source and image if the rollout fails.
- **Docker update workflow**: Settings now offers an explicit Docker update confirmation that saves and stops Project Zomboid through RCON before recreating the container.
- **Host-independent bootstrap**: the all-in-one setup script runs Docker Compose inside the updater image, so Unraid hosts do not need a local Docker Compose installation.

## [1.0.72] - 2026-07-22

### Fixed

- **Configurable Steam Workshop update frequency**: the Mod Update Settings interval now accepts whole-minute values from 1 to 120 and applies a saved change immediately, without restarting the panel.
- **One-minute polling regression**: Settings stored values in minutes but startup treated them as milliseconds and clamped them to one minute. Existing millisecond values are migrated safely, and invalid values are rejected.
- **Mod-check timer edge cases**: rescheduling clears stale delayed startup checks without interrupting a pending player-aware restart; unexpected scheduled-check failures are caught and logged.

## [1.0.70] - 2026-07-17

### Added

- **Sandbox diagnostics + auto-repair**: detects a corrupted `SandboxVars.lua` (mismatched braces) and surfaces it as a critical Debug finding, with a one-click automated repair action (backs up the original file first, refuses to write unless the repair is verified syntactically balanced).

### Fixed

- **SandboxVars.lua values containing commas inside quotes could get corrupted when edited through the Sandbox editor**: settings like `WorldItemRemovalList` and `LootItemRemovalList` were truncated at the first comma inside the quotes, corrupting the file and preventing the dedicated server from booting. Quoted string values are now treated as atomic when parsing/writing.

## [1.0.68] - 2026-07-16

### Fixed

- **PanelBridge mod (v1.7.4): server freeze on Restore/Shut Off Utilities**: restoring or shutting off power/water scanned tens of thousands of grid squares synchronously on the game tick, freezing the whole server for every player. The scan now runs as a background job chunked across ticks when triggered from the panel.
- **PanelBridge mod (v1.7.4): character import drained real skill points**: restoring a saved character's perk levels called the skill-point-consuming `LevelPerk` variant, silently spending the live player's own unspent skill points on every restore. Now uses the no-cost restore path.

## [1.0.65] - 2026-07-13

### Fixed

- **Discord bot crash on newer Node versions (full fix)**: the earlier fix only covered slash-command registration. The Discord client's internal REST — used for login, notifications, the "Send Test Message" button, chat relay, and command replies — still crashed on Node 22+/24+ with the `Symbol(sensitiveHeaders)` header error. All Discord API traffic now goes through the safe request path.

### Security

- **Discord mention injection**: player-controlled text (in-game chat relay and player join/leave/death notifications) could ping Discord roles or users via raw mention syntax like `<@&roleId>`. The bot now blocks all outbound mentions, so relayed chat and notifications can no longer ping anyone.

### Changed

- Replaced the deprecated Discord `ephemeral` reply option with the current `MessageFlags.Ephemeral` form.
- Added a request timeout to the Discord token test so a stalled Discord API can no longer hang the check.

## [1.0.64] - 2026-07-07

### Fixed

- **World map and chunk cleaner tile loading**: fixed the Project Zomboid map tile breakage after the B42 CDN migration from b42map.com to map.projectzomboid.com. The panel now proxies tiles through the backend and resolves the current B42 map directory dynamically from upstream metadata, so newer map builds continue to work without manual updates.
- **Discord bot startup crash**: fixed a compatibility issue with newer Node/undici versions that caused the Discord bot to crash during REST requests. Discord API calls now use a safe request path that avoids the header constructor failure.
- **Server names with spaces**: server creation and validation now accept names containing spaces while still rejecting unsafe path characters.

### Changed

- **Release pipeline**: removed the hard dependency on the old garage deployment share so packaging and release steps no longer block on that dead target.

## [1.0.27] - 2026-05-13

### Fixed

- **Mod update restart loop for mods removed from INI**: if a previously subscribed mod was deleted from `WorkshopItems=` but still had a newer version on Steam, the panel kept flagging it as "Update available" and queued a `Restart Pending` cycle that could never resolve (a restart can't apply a mod the server isn't subscribed to). `modChecker.checkForUpdates()` now filters out updates for any workshop ID not present in the active server's INI before they reach the auto-restart pipeline.
- **"Flags out of sync" false positive from phantom updates**: `getStatus().updatesAvailable` was counted directly from the Workshop ACF without consulting the server INI, so even after the filter above the UI still showed `1 mod update reported by Steam — flags out of sync` and prompted a re-check. The status count is now filtered against `WorkshopItems=` as well.
- **Cancelling a pending mod-update restart silently disabled future auto-restarts for those mods**: `cancelPendingRestart()` left the `processedUpdates` dedup map populated, so the next poll cycle treated the same Steam timestamps as "already processed" and skipped them indefinitely. The map is now cleared on cancel, re-arming detection on the next check.

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
