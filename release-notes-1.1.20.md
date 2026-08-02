## v1.1.20

### Added

- **Remote PanelBridge via SFTP**: connect to a VPS with SFTP credentials and its absolute `Lua/panelbridge/<server>` folder. The panel syncs only the small Bridge status, queue state, result, and command files through a local cache. Test the connection before starting it, see round-trip latency, and choose a 2-10 second sync interval.
- **Remote mapped-drive support**: a configured read/write path, including an SFTP-mounted drive such as RaiDrive, can now be used by PanelBridge for remote servers.
- **Force Stop**: a confirmation-gated Dashboard control can stop the managed PZ server without RCON, while protecting against ambiguous multi-server process detection.
- **Paste Steam cookies from Collection**: paste a Steam `Cookie:` header or copied cURL request directly from the Workshop Collection panel.
- **Electricity and water controls** on the Events page.

### Changed

- PZ JVM heap allocation is displayed as normal allocation rather than a host-RAM incident. Real host memory pressure is still alerted.
- Scheduled restarts remain pinned to their original server even if the active selection changes.

### Fixed

- Sandbox and utility changes now persist to `SandboxVars.lua` and survive a restart.
- Backup restores cannot run while the server is active.
- Legacy mod-update restart settings are normalized, and unknown player count holds a restart rather than restarting blindly.
- Workshop collection sync reports Steam-rejected item titles.

---

### Downloads

- **ZomboidControlPanel-windows.zip**: Windows full package, extract and run `Start.bat`.
- **ZomboidControlPanel-linux.tar.gz**: Linux full package, extract and run `./start.sh`.
- **checksums.txt**: SHA256 verification hashes.