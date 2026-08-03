## v1.1.23

### Fixed

- **Linux release artifacts**: GitHub Actions can build the standalone Linux binary and archive again. The release bundler now excludes SSH2's optional native accelerators, which have a built-in JavaScript fallback.

---

### Downloads

- **ZomboidControlPanel-windows.zip**: Windows full package, extract and run `Start.bat`.
- **ZomboidControlPanel-linux.tar.gz**: Linux full package, extract and run `./start.sh`.
- **checksums.txt**: SHA256 verification hashes.