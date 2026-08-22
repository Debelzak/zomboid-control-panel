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
