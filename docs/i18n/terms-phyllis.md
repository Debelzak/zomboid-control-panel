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
