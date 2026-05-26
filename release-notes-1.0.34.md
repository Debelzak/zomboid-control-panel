# v1.0.34

### Changed
- Restart broadcasts are now impossible to miss: per-minute warnings, then a 30s / 10s / 5-4-3-2-1 / "RESTARTING NOW" final stretch, sent via both PZ's RCON `servermsg` and (when the PanelBridge mod is connected) the in-game **server alert** chat. Plain ASCII text and the `[SERVER]` prefix make the messages render verbatim in chat on both B41 and B42. Applies to mod-update auto-restarts, scheduled cron restarts, and manual "Restart with warning" actions.
