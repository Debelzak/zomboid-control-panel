# Translation term decisions — Phyllis

Pages owned: `Debug.tsx`, `WorldMap.tsx`, `ChunkCleaner.tsx`. Logged here so god can
reconcile against Oscar's and Stanley's term files. I did not create or edit a shared
glossary — this file is mine only.

## Established terms I'm reusing (not deciding, just confirming source)
- "chunk"/"chunks" — left as the English loanword in French, per existing precedent in
  `errors.json` (`SERVER_RUNNING_LEGACY`: "avant de supprimer des chunks") and `roles.json`
  (`chunks de carte`). Never translated to "morceau"/"bloc" etc.
- "safehouse" → "refuge" — per `console.json`'s `broadcast.channels.safehouse.description`
  ("Étiquette cosmétique de refuge").
- "backup" → "sauvegarde" — per Dashboard/Settings/Roles, used consistently everywhere.
- "panel" → "le panneau" — per the five existing uses noted in my task brief.
- "world" (nav/section concept) → "monde" — per `shell.json`'s nav section `world: "Monde"`.

## ChunkCleaner.tsx (namespace `chunkCleaner`)

**"Save" (the save-game/world picker) → "Monde", not "Sauvegarde" — deliberate deviation
from a literal word-for-word translation.** This page has TWO distinct concepts visible on
the same screen: (1) a "Save" dropdown to pick which world/save-game folder to browse, and
(2) a "Create safety backup" toggle in the delete dialog. The established glossary word for
"backup" is "sauvegarde" (confirmed across Dashboard/Settings/Roles). If I also used
"Sauvegarde" for the save-game picker, both concepts would render as the same French word on
one screen — exactly the same-French-word-two-concepts risk called out in my brief (the nav
item collision Angela found). I used "Monde" instead, which is already an established French
term in this app for the world/map concept (`shell.json` nav section "world" → "Monde";
Dashboard's `wipeDialog.targets.world` → "État du monde"). The **English text is unchanged**
("Save", "Loading saves...", "Choose a save...", etc.) — this is a French-only
disambiguation, not a product/copy change.

Everything else in this namespace is a literal, direct translation — including the
canvas-drawn HUD text (chunk/cell coordinate readout, vehicle count badge, selection-size
badge, B41/B42 map version label), which lives in `ctx.fillText()` calls inside a
`useEffect`, not JSX, and is easy to miss during a translation pass if you only grep JSX.

Destructive-action copy (delete confirmation dialog title/description, "No backup will be
created" warning, the server-running override dialog) was translated at least as blunt as
the English source, per the brief — none of it was softened.

## WorldMap.tsx (namespace `worldMap`)

**Reused `players.json`'s exact "cible.acquise" for the dossier panel's "target.acquired"
line, not a fresh translation.** WorldMap has its own player-info side panel styled
identically to (and clearly modeled on) Players.tsx's dossier panel — same "dossier" header
word, same stylized `label.status` mono format. Since it's visibly the same UI concept
reused across two pages, translating "target.acquired" independently risked exactly the
two-translators-two-words problem: I checked Angela's players.json first and matched her
term rather than inventing my own.

**Deliberately left short technical HUD abbreviations untranslated: `x`, `y`, `z`, `zm`,
`hp`, `fuel`, `batt`, `ctrl`.** WorldMap has a tight "tactical control room" aesthetic with
a lot of tiny monospace readouts (a bottom-left coordinate bar, a vehicle-info panel in the
right-click menu, etc.) where these appear as compact 1-4 character labels next to numbers,
not as prose. Two things drove this: (1) space — these widgets are literally built to a
fixed pixel width and French equivalents (e.g. "carburant" for fuel, "batterie" for batt)
would either overflow or need re-abbreviating into something just as opaque; (2) legibility
— these are the same terse gaming-HUD shorthand a French PZ player already reads in English
in dozens of other tools (fuel/hp/batt gauges are near-universal), so leaving them is not a
loss of localization quality the way leaving a real English sentence would be. Every actual
*word* in the same HUD (floor, layers, roster, live/offline, target, vehicle, teleport,
effects, drops, ground) IS translated — only the cryptic 2-3 char codes are not. Logged here
in case a QA pass flags "x"/"y"/"hp" etc. as untranslated — it's a deliberate call, not a
miss.

**City/landmark names (Muldraugh, West Point, Rosewood, etc.) are proper nouns and stay
as-is**, matching the identical decision already made in ChunkCleaner's PZ_LANDMARKS list
(same reasoning: these are real in-game place names, not translatable UI copy).

**Airdrop preset labels/descriptions (Military, Medical, Food, Building, Weapons, Tools)
were moved out of the `AIRDROP_PRESETS` module-level const and into the locale file**,
since the const is defined outside the component and has no access to `t()`. The const now
only carries `id` + the lucide icon; a `presetLabel(id)`/`presetDesc(id)` pair of
`useCallback`s inside the component do the lookup. Mentioning this because it's a slightly
unusual refactor shape and a future translator touching this file should know why the array
looks stripped-down compared to a typical preset list.
