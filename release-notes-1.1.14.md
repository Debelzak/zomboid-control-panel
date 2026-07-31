## v1.1.14

### Fixed
- **World Map tiles**: the fallback that switches to a fully-rendered older B42 map build when the newest one isn't rendered upstream yet was deployed live in v1.1.12/v1.1.13 but never actually committed — this release includes it for real. If tiles were still failing to load on 1.1.13, this fixes it.
- Public IP shown on the dashboard now expires its cache after 6 hours instead of indefinitely, so a residential ISP rotating your WAN IP no longer leaves a stale, no-longer-yours address displayed forever.
