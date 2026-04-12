# Copilot Instructions — Zomboid Control Panel

## Scope

- Treat `Dev1/` as the only editable source tree.
- Do not edit `GitHub/`, `Dev1/release/`, `ServerB42Files/`, `Server_Config_Data/`, or `SteamCMD/` directly.
- Treat `data/db.json` as runtime state and never overwrite it during deploy or release work.

## Deploy Script

- Deploy script path: `D:\Zomboid_dev_panel\Dev1\deploy.ps1`
- Run it from `Dev1/` with: `./deploy.ps1`
- Script source folder: `D:\Zomboid_dev_panel\Dev1\release`
- Script destination: `\\garage\PZ\Admin_panel`
- Current exclusion: `data/db.json`
- Use this script to redeploy the packaged admin panel after rebuilding `release/`.
- Do not hand-copy files to the live admin panel path when `deploy.ps1` is the correct deployment path.

## Redeploy Everything

When the user asks to `redeploy everything`, treat that as a full ship-and-verify workflow, not just a copy or GitHub upload.

### Required steps

1. Rebuild the Windows executable from `Dev1/`.
2. Stop any stale local panel process before launch, then start the freshly built executable.
3. Verify the running app visually in the VS Code integrated browser.
4. Rebuild the Linux binary and its launcher/package pieces so the Linux release is usable.
5. Repackage the release artifacts so both Windows and Linux deliverables are runnable.
6. Redeploy the live admin panel package with `D:\Zomboid_dev_panel\Dev1\deploy.ps1`.
7. Redeploy `PanelBridge.lua` to the live server path when the shipped system depends on it.
8. Update the GitHub release assets and metadata when publishing or refreshing a release.
9. Re-run demo deployment when frontend changes are part of the redeploy.
10. Report what was rebuilt, deployed, and visually verified.

## Versioned Release Requests

If the user mentions a new version during redeploy or release work:

1. Update version references consistently across release outputs and metadata.
2. Update the README for the new version and shipped feature changes.
3. Keep GitHub release title, notes, and asset names aligned with the requested version.

## Release Notes Expectations

- Refresh the GitHub release body when rebuilt assets or shipped features changed.
- Prefer concise release notes that mention the user-visible feature work, the rebuilt assets, and any redeploy/demo refresh that was performed.

## Verification Preference

- Prefer the VS Code integrated browser for post-build verification when the user asks for redeploy or launch validation.