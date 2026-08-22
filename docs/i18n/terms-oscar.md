# i18n terms — Oscar

Non-obvious French term choices for the server-configuration cluster
(Mods.tsx, ServerConfig.tsx, Servers.tsx, Templates.tsx). Reconciled by god
against terms-<other translators>.md at the end.

## Reused from the existing glossary (do not re-derive)
- "template" → **modèle** (confirmed via `shell.json` nav item "Modèles" and
  `roles.json` "modèles de configuration" — do not use "gabarit" or "patron").
- "Save" (verb, button) → **Enregistrer** (per `players.json` saveButton).
- "current config" → **configuration actuelle**.
- Destructive confirm phrasing "This can't be undone." → **Cette action est
  irréversible.** (matches the tone of existing destructive-confirm strings).

## Servers.tsx
- "server instance" / "managed server" → **serveur** (no separate word for
  "instance" — French UI text just says "serveur", matches shell.json nav
  "Serveurs").
- "Start"/"Stop"/"Restart" (server lifecycle verbs) → **Démarrer** /
  **Arrêter** / **Redémarrer** (confirmed from dashboard.json — do not
  invent "Lancer" or "Stopper").
- "RCON host/port/password" → kept RCON untranslated (it's a PZ/Steam
  protocol acronym operators already know); "host" → **hôte**, standard.
- "SteamCMD", "Docker", "branch" (Steam beta channel) → SteamCMD and Docker
  stay as product names; "branch" → **branche**.
- "install path" / "data path" → **chemin d'installation** / **chemin des
  données** (Chemin is the established word for "Path" across the app).
- Distinctness check: ran an automated pass diffing which English source
  strings collapse to the same French value across servers.json. Every
  collision traced back to the *same* English source string reused in two
  legitimate places (e.g. "Cancel" used in 5 dialogs, "RCON Port" used in
  both the tandem-conflict label and the edit dialog) -- none were two
  *different* English concepts flattened into one French phrase, which is
  the failure mode Angela flagged. Recommend the other translators run the
  same kind of check on their namespaces before final reconciliation.
- Scope note: server status labels ("Host", "Process", "RCON",
  "Not configured", "Authentication failed", "Unavailable") are literal
  strings *constructed in Servers.tsx* and passed as props into
  `<ServerStatusBadge>` (client/src/components/ServerStatusBadge.tsx, not
  mine). Translated them since I own the call site; did not touch the
  component itself.

## ServerConfig.tsx
(Converted by a forked sub-agent under my direction, reviewed and verified
by me before commit: independent key-parity check, i18n-check.mjs run,
both gates re-run clean, `t`-shadowing fix spot-checked, French read as
prose. Term choices below as reported by the fork.)
- Reused rather than invented: "template" → **modèle** (servers.json/
  roles.json); "Backup" → **Sauvegarde**, "Restore" → **Restaurer**,
  "Refresh" → **Actualiser** (settings.json); "Reset" → **Réinitialiser**
  (dashboard.json/login.json).
- "discard" (changes, distinct from Cancel) → **ignorer** — no prior
  precedent existed anywhere in the glossary for this concept; chose it
  specifically to avoid colliding with "Annuler" (Cancel), already
  established elsewhere and meaning something different (closing a dialog
  vs. throwing away edits).
- Lowercase command-style micro-buttons ("save", "discard", "expand all",
  "refresh"/"load") are a deliberate terse-console register in the English
  source on this page — kept that register in French ("enregistrer",
  "ignorer", "tout développer", "actualiser"/"charger") rather than
  capitalizing to normal French UI case, to preserve the visual/tonal
  distinction from the page's other, normally-cased buttons.
- Mod-settings "modified count" badge → **"{{count}} modif."**, not
  "{{count}} mod." — this whole tab already says "mod" to mean "game
  modification" constantly; an abbreviated "mod." for "modifié" would read
  as a mod-count to a French speaker. "modif." is unambiguous.
- Two *distinct* toggle-label registers, kept deliberately separate rather
  than collapsed to one key: **ACTIVÉ/DÉSACTIVÉ** (all-caps, matches PZ's
  own in-game convention) for the mod-settings sandbox switches, vs.
  sentence-case **Activé/Désactivé** for the plain INI/Sandbox setting-row
  toggles — the two appear in visually distinct contexts and use PZ's own
  in-game casing convention only where the option is itself a PZ/mod
  sandbox value.
- SCOPE BOUNDARY (important, affects how "done" this page really is): the
  hundreds of individual INI/Sandbox *setting names and descriptions*
  (`setting.label`/`setting.description` in `IniSettingRow`/
  `SandboxSettingRow`) are sourced from `client/src/lib/serverConfigSchema.ts`
  (`INI_SCHEMA`/`SANDBOX_SCHEMA`), NOT from ServerConfig.tsx itself. That
  file is out of my exclusive-ownership scope and was not touched. Result:
  all page chrome (tabs, dialogs, toasts, search/filter, backups,
  templates, mod-settings furniture, row furniture) is bilingual, but the
  actual PZ setting names/descriptions throughout the INI and Sandbox tabs
  stay English-only. This is a separate, materially larger task
  (internationalizing the schema file that defines every PZ setting) —
  needs a deliberate decision on ownership, same shape as the
  components/templates/*.tsx gap but bigger.
- Two real bugs found and fixed (not translation issues — code bugs the
  translation pass surfaced): (1) a `.map((t) => (...))` inside the tab
  strip's `TabsList` render used `t` as its lambda parameter, silently
  shadowing the `useTranslation` `t` for every `t(...)` call inside that
  JSX block — renamed to `tabDef`. Same latent-shadow pattern fixed in
  `handleDeleteTemplate`'s `.filter(t => ...)`, renamed to `tpl`. (2) None
  found beyond that on this page — no comment/code mismatch like the
  Mods.tsx:911 one.
- i18n-check.mjs flagged 2 remaining "duplicate" French pairs after fixing
  2 real ones (see verification note above): an aria-label paired with its
  own button's visible tooltip, deliberately worded identically so a
  screen-reader user and a sighted user get the same message (e.g.
  "Télécharger la sauvegarde des points de spawn" for both
  `downloadSpawnPointsAria` and `downloadSpawnPointsTooltip`) — checked
  against the English source, which is itself duplicated the same way by
  design. Not a bug.

## Templates.tsx
- Page title "Simulation Templates" → **Modèles de simulation**.
- Scope note: TemplateCard, TemplatePreviewDialog, CreateTemplateDialog,
  ImportTemplateDialog, TemplateApplyPanel, TemplateDiffList
  (client/src/components/templates/*.tsx) are NOT page files and are out of
  my exclusive-ownership scope per the task brief. They hold their own
  hardcoded English strings (dialog titles, form labels, diff view). The
  Templates page itself is now fully bilingual, but a French operator will
  still see English inside those dialogs. Flagged to god — not fixed here,
  scope was explicit.
