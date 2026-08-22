# i18n term notes — Stanley

Non-obvious French term choices for the pages I own (Events, ServerSetup, Discord,
Scheduler, Backups, ServerFinder, Chat). Logged for god's end-of-night reconciliation
against Angela's and the other translator's choices.

## Chat.tsx (namespace: `chat`)

- "broadcast" (server broadcast to all players) → **diffusion** / **diffuser**, matching
  the existing glossary hit "Diffusion envoyée" already used elsewhere in the app for the
  same RCON servermsg concept. Did not invent "annonce" even though that also reads
  naturally, to stay consistent with the existing string.
- "LIVE" / "OFFLINE" (socket connection status badge) → **EN DIRECT** / **HORS LIGNE**,
  matching the existing "En direct" / "Hors ligne" pattern used for RCON/bridge status
  elsewhere in the app.
- Sender-name fallback labels (`labels.server/admin/player`, shown when a chat line has no
  author) → **Serveur** / **Admin** / **Joueur**. Kept "Admin" untranslated (not
  "Administrateur") since "Admin" already appears as a standalone term throughout the
  existing French locale files (e.g. "Bot Discord" section, admin-chat references).
- Did NOT translate the two literal author strings passed to the backend in
  `sendMessage()` (`'Admin'` passed to `sendToAdminChat`/`sendToGeneralChat` as the
  in-game display name) — those are data sent to the PZ server as the poster's displayed
  name, not panel UI chrome, and changing them would change what name players see
  in-game for admin-posted chat lines.
- Quick-broadcast preset defaults (`presets.default`) are real chat text that gets
  broadcast into the game, so I translated the 5 default quick messages into natural
  French rather than leaving them as English placeholders an operator would have to
  rewrite before their first use.

## ServerFinder.tsx (namespace: `serverFinder`)

- No existing glossary hit for pagination controls (First/Prev/Next/Last, Page X of Y,
  Ascending/Descending). Chose: **Première / Précédent / Suivant / Dernière**, matching
  the existing standalone "Dernière" and "Première connexion" already used elsewhere in
  the app rather than "Premier(e) page" / "Page précédente" (more verbose, no existing
  precedent for the longer form). **Croissant / Décroissant** for sort direction.
- "Ping" (both the sort-column label and the "ping this server" button) is left as
  literal "Ping" in French — it's an accepted, widely used networking term as-is in
  French gaming/tech contexts; no established French equivalent is in common use for a
  server ping button.
- "VAC Secured" → **Sécurisé VAC** (adjective-first per French word order, kept "VAC" as
  the untranslated Valve trademark/acronym).
- "Steam API key missing" appears in three different UI locations (the warning banner
  title, a toast, and an empty-state title) — deliberately reused the *same* French
  string in all three, matching the fact that the English source also reuses the same
  wording. That's correct reuse, not the "two different concepts, one French phrase"
  bug — the underlying English concept genuinely is identical in all three spots.
- "Recharger depuis Steam" (Reload from Steam) vs "Actualiser la liste" (Refresh List) —
  kept these as two distinct French verbs since they're two distinct actions in the UI
  (client-side refresh of the cached list vs. forcing a fresh master-server query),
  matching the English button pair using two different verbs (Refresh vs Reload) for the
  same reason.

## Backups.tsx (namespace: `backups`)

- "Safehouse" → **Refuge**, reusing the exact term already established in the app
  (found "Refuge"/"Refuges" already in the French locale for the chunks/base-management
  page). Did NOT invent "planque" or "abri" even though both are plausible everyday
  French for a survival-game safehouse — Angela's existing glossary already picked
  "Refuge", so I matched it for "Safehouse Snapshot Created".
- "Recovery Point" → **Point de récupération**, reusing the exact phrase already used
  elsewhere in the app for password/account recovery flows ("Création d'un nouveau point
  de récupération."). Same underlying idea (a point you can roll back to), so reused
  rather than inventing "point de restauration" which would read as a second term for
  the same concept.
- "Snapshot" (both the themed "Safehouse Snapshot" and the plain "Server Snapshot"
  dialog) → **Instantané**, the standard French tech term for a snapshot/point-in-time
  capture.
- Kept the "Automatic Snapshots Armed / Stood Down" military-flavor toggle copy as plain
  **Instantanés automatiques activés / désactivés** rather than a literal
  "armé/désarmé" — "armé" reads as alarm/security-system language in French UI
  conventions, not backup-scheduling language, and would confuse rather than convey tone.
- Empty-state copy ("No safety net" / one bad update away from lost progress") is a
  deliberate warning that NOT having a backup is risky — per the brief, backup copy must
  never imply a backup alone means the server is safe/working. Translated to preserve the
  same warning weight: **"Aucun filet de sécurité" / "une mise à jour malheureuse suffit
  pour perdre votre progression."** Did not soften this into reassuring language anywhere
  in the page (e.g. never phrased a successful backup toast as "your server is safe now" —
  "Instantané du refuge créé" only states what happened, the storage action, not a safety
  guarantee).
- "Saves folder" (the PZ save-game directory, distinct from the panel's own backups
  folder) → **dossier de sauvegardes de jeu**, deliberately more specific than the bare
  "dossier de sauvegardes" already used elsewhere in the glossary for the *backups*
  folder — these are two different folders in this app (raw PZ saves vs. zipped panel
  backups) and collapsing them to the same French phrase would be exactly the
  "two different concepts, one phrase" bug the brief warned about.
