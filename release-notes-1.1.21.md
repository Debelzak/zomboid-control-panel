## v1.1.21

### Fixed

- **Remote server status**: hosted servers are recognized as online from a live RCON connection or a fresh PanelBridge heartbeat, instead of a local-process check that only works for servers on the same machine as the panel.
- **SFTP PanelBridge command delivery**: commands upload before remote reads and wait up to 60 seconds for a response. This supports VPS SFTP connections with higher round-trip latency.

---

### Downloads

- **ZomboidControlPanel-windows.zip**: Windows full package, extract and run `Start.bat`.
- **ZomboidControlPanel-linux.tar.gz**: Linux full package, extract and run `./start.sh`.
- **checksums.txt**: SHA256 verification hashes.