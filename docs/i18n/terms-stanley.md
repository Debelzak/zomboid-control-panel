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

## Scheduler.tsx (namespace: `scheduler`)

Per the brief, this is the page where time/interval/recurrence phrasing goes wrong
easiest — I read every countdown/frequency string out loud before committing.

- Countdown buttons ("Restart in 15m/10m/5m/1m") → **"Redémarrer dans 15 min"** etc.,
  using "min" rather than a bare "m" — French doesn't abbreviate minutes to a bare "m"
  the way English UI shorthand does; "15m" would misread as meters/months to a French
  reader in a way "15m" doesn't in English UI shorthand.
- Two toast strings interpolate a live minute count that can legitimately be 1
  ("Server will restart in {{minutes}} minutes", "Restart in {{count}} minute(s)?") —
  added explicit `_one`/`_other` plural forms to both languages so a 1-minute restart
  doesn't read as the grammatically broken "redémarrera dans 1 minutes". The English
  source didn't bother pluralizing these (always says "minutes" even for 1), but French
  can't get away with that, so I fixed it in both rather than carrying the English
  looseness into French.
- "Weekday" (cron-help column header) and "Day of the week" (simple-builder form label)
  both translate to **"Jour de la semaine"** — this is the same underlying concept at two
  levels of terseness in the English source too (a compact table header vs. a full form
  label), not two different concepts colliding on one phrase, so I did not force them
  apart.
- The four Quick Broadcast messages (maintenance start/end, save warning, welcome) are
  real chat text sent to players, so I translated the actual message content, not just
  the button labels. Kept "MODE MAINTENANCE" and the "Merci de..." opening consistent
  with the *separate* maintenance-broadcast preset Angela already translated in
  console.json, since it's the same in-game announcement concept appearing in two
  different quick-broadcast UIs — even though this page's English source wording differs
  slightly from console.json's ("Please save and disconnect" vs "Please disconnect"), I
  aligned the French phrasing/tone rather than letting two independently-invented French
  versions of "server entering maintenance" exist side by side.
- Did NOT translate the message text embedded inside two `commonCommands` dropdown
  *values* (`servermsg Server maintenance in progress`, `bridge:sendToServerChat
  {"message":"Scheduled broadcast"}`). Only the dropdown option's visible label is
  translated. These embedded strings are default/example RCON command bodies the
  operator is expected to inspect and edit in the Command field before saving — unlike
  Chat.tsx's quick-broadcast presets (finished, ready-to-send text) these are starting
  templates for a technical command string, so changing them per-locale would be editing
  code-adjacent content rather than UI copy, and risks a French operator not recognizing
  the underlying `servermsg`/`bridge:` syntax if the embedded example text moved.

## Discord.tsx (namespace: `discord`)

- Found and reused an existing exact-match glossary pair from settings.json before
  writing anything new: en "Discord bot" / "Bot token, channels, event notifications,
  and the chat bridge." → fr "Bot Discord" / "Jeton du bot, canaux, notifications
  d'événements et pont de chat." This fixed several terms at once: **jeton** for
  "token" (not "token" left untranslated, and not "clé"), **canal/canaux** for
  "channel(s)" (not "salon", even though Discord's own French client uses "salon" —
  this app's existing glossary already committed to "canal" in Chat.tsx and
  settings.json, and in-app consistency wins over matching a third-party product's
  wording), and **pont de chat** for the Discord↔game "chat bridge" feature name.
  Also reused debug.json's "Check the bot token and intents in Discord settings." →
  "Vérifiez le jeton du bot et les intents dans les paramètres Discord." to confirm
  **intents stays untranslated** — it's the literal technical term shown on Discord's
  own Developer Portal, no established French equivalent, and translating it would
  send an operator looking for a UI element by the wrong name.
- "Slash commands" → **commandes slash** (no existing precedent in this app; chose the
  term Discord's own French client uses, since operators will see it there too).
  "Moderator" tier → **Modérateur**, reusing the exact word already used in the
  existing glossary. "Guild (Server) ID" → **ID du serveur (Guild)**, keeping the
  parenthetical "Guild" in English since that is literally the field name in the
  Discord Developer Portal an operator has to find — dropping it risks someone not
  recognizing which portal field to copy from.
- One flagged uncertainty for Angela/god to sanity-check: instructions that tell the
  operator to right-click *inside the actual Discord client* (e.g. "Copy Server ID",
  "Copy Channel ID", "Copy Role ID") were translated to match this app's own
  canal/serveur/rôle vocabulary rather than guaranteed-current Discord French client
  menu wording, since I don't have live access to verify Discord's actual current
  French UI strings. If Discord's live menu differs, these instructional lines
  specifically (not the rest of the page) may need a follow-up tweak from whoever can
  check the real client.
- Notification event templates (`events.*.defaultTemplate`, e.g. "🟢 **Server is
  online**") are the actual default message bodies posted to the operator's Discord
  channel, so — consistent with the Chat.tsx and Scheduler.tsx precedent for
  operator-facing default content — I translated them, not just their labels. For
  "{player} died at {location}" I used **"a péri à {location}"** instead of
  "est mort/morte à" specifically to sidestep needing to guess the player's grammatical
  gender in an automated bot message: the passé composé of "périr" with avoir doesn't
  agree with the subject, so it's correct regardless of who died. All `{variable}`
  placeholders (`{player}`, `{location}`, `{x}`, `{y}`, `{z}`, `{pvp}`, `{minutes}`)
  were left untouched since the server backend substitutes them literally by name.
