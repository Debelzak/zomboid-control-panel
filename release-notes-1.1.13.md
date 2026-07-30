## v1.1.13

### Fixed
- `PanelBridge.lua` (bumped to 1.7.13 — folds in this fix plus the fork's own 1.7.11/1.7.12 work that landed in parallel): `vehicles:get(i)` was called with no safety check, unlike the `.size` lookup right above it. On this game version that call threw "Object tried to call nil in pcall" for every vehicle, every ~5s tick — flooding the server console and leaving the World Map's vehicle layer permanently stuck at "0 loaded". Now guarded the same way `.size` already was (and the same guard was applied to a third call site with the identical issue).
