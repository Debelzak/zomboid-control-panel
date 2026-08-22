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
