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
