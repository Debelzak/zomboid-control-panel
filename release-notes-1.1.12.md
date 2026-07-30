## v1.1.12

### Fixed
- "Remove from server" (`POST /mods/batch-remove`) could report success and ignore-list a mod while silently leaving it active in `Mods=`/`WorkshopItems=`. Ignore-list writes are now gated on the INI edit actually running, and `delete-disk-mod` got the same fix.
