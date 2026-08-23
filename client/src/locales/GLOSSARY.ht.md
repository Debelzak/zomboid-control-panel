# Haitian Creole (ht) translation glossary

This is a brand-new locale being written by three agents at once (bucket 1: conflictsPanel,
dashboardPerformanceCharts, discord, discoverySetup, itemPicker, login, modRow, scheduler,
serverSetup, serverStatusBadge, settings, setup, spawnBrowser, templateApplyPanel, templateCard,
templateCreateDialog, templateDiffList, workshopCollectionPanel — the other two buckets split the
remaining 43 namespaces). This file exists so all three settle on the same words before any of them
starts translating. **Use these renderings.**

None of us is a native Kreyòl speaker, and the operator knows that going in. This glossary is a
best-effort, consistent starting point for a native-speaker review pass — not a claim of fluency.
Where a term below is a guess rather than an established word, it says so.

## Orthography

Use standard Haitian Creole orthography (IPN — Enstitisyon Pedagojik Nasyonal spelling, the one
taught in Haitian schools and used by Haitian government documents), not French-influenced spelling:

- `k` not `c`/`qu`, `w` not `oi`, no `x`, no silent letters.
- Nasal vowels written `an`, `en`, `on` (not `an`/`in`/`on` with a French nasal mark).
- `è` and `ò` are real, distinct letters (`sèvè`, `mòd`) — do not drop the grave accent, the same
  way `Región` in Spanish is not optional.
- Apostrophes mark real elisions only (`m'ap`, `pa gen anyen pou'w fè`) — do not add one just
  because a word "looks like" it needs one.

## Do not translate

Product and protocol names stay as they are:

`Project Zomboid`, `SteamCMD`, `Steam`, `Workshop`, `Workshop ID`, `Docker`, `RCON`, `OIDC`,
`PanelBridge`, `Discord`, `SFTP`, `Lua`, `INI`, `UID`, `GID`, `URL`, `API`, `mod`, `chunk`, `sandbox`,
`token` (the technical login token — see below for the recovery-code sense, which *is* translated).

`mod` and `chunk` stay in English deliberately, same reasoning as the other locales: these are what
Kreyòl-speaking Project Zomboid players already call them, not concepts with a natural local word.

Also never translated: file paths, folder names, environment variable names, error codes (`EACCES`),
command names, cron expressions, and anything inside `{{double braces}}`.

## Core vocabulary

| English | ht | Note |
| --- | --- | --- |
| server | sèvè | |
| the panel | panèl la | this application, as distinct from the game server |
| dashboard | tablo | short for "tablo bòd" — avoid the longer form, it reads like a car dashboard |
| player | jwè | |
| save (verb, "save changes") | sove | the everyday Kreyòl verb for saving a document/file, distinct from *sovgad* below |
| save / savegame (noun, the world's save data) | sovgad | |
| backup (noun, a copy of a save) | kopi sovgad | "backup copy" — kept two words on purpose so it never collides with plain *sovgad* |
| restore (verb) | retabli | |
| world | mond | |
| world map | kat mond lan | |
| region | rejyon | |
| template | modèl | |
| scheduled task | tach pwograme | |
| schedule (noun) | orè | |
| console | konsòl | |
| log | jounal | |
| diagnostics | dyagnostik | |
| settings | paramèt | |
| conflict | konfli | |
| dependency | depandans | |
| folder | dosye | |
| path | chemen | |
| wipe (destructive) | efase nèt | "erase completely" — never *reyinisyalize* (reset), see Style rules |
| vehicle | machin | |
| spawn (verb, materialize an item/vehicle/entity in-world) | fè parèt | "make appear" — descriptive, no established single-word Kreyòl gaming term found |
| scan (verb, query the live server via PanelBridge) | eskane | |
| catalog | katalòg | |
| Safehouse (Project Zomboid mechanic) | kay sekirize | **uncertain** — descriptive translation ("secured house"), not a known established Kreyòl gaming term. Flagged for native-speaker review; if a real Kreyòl PZ community term exists, it should replace this. |

## Access control

| English | ht | Note |
| --- | --- | --- |
| user | itilizatè | |
| role | wòl | |
| permission | otorizasyon | **judgment call**, not the only defensible choice — *pèmisyon* is also heard in casual Kreyòl. Picked *otorizasyon* because it is the term used in Haitian official/legal Kreyòl and reads as less of a raw English borrowing. Whoever reviews this should feel free to override, but every namespace must agree. |
| capability | kapasite | one tickable row in the rights matrix |
| administrator | administratè | |
| moderator | moderatè | |
| technician | teknisyen | |
| sign in | konekte | |
| sign out | dekonekte | |
| password | modpas | |
| session | sesyon | |
| single sign-on | koneksyon inik | "unique/single connection" — SSO has no established Kreyòl abbreviation, spelled out every time |
| recovery token | jeton rekiperasyon | |
| recovery code | kòd rekiperasyon | the *code*, distinct from the *token* above — the panel's login flow uses both words for two different things and the translation must keep them apart |
| account | kont | |

## Actions

| English | ht | Note |
| --- | --- | --- |
| start (a server/service) | demare | |
| stop | sispann | |
| restart | redemare | |
| install | enstale | |
| update (verb) | mete ajou | |
| update (noun) | mizajou | |
| verify | verifye | |
| enable / disable | aktive / dezaktive | |
| kick (a player) | mete deyò | "put out" — no established single-word Kreyòl gaming term found; flagged as a judgment call |
| ban / unban | bani / retire baniman | |
| whitelist | lis blan | |
| delete | efase | |
| apply | aplike | |
| retry | eseye ankò | |
| reset (password) | reyinisyalize | technical "re-initialize" register, deliberately distinct from *efase nèt* (wipe) — resetting a password is not destructive to data, wiping a server is |

## Status words

| English | ht |
| --- | --- |
| succeeded / completed | fini |
| failed | echwe |
| error | erè |
| warning | avètisman |
| running | ap fonksyone |
| stopped | sispann |
| unavailable | pa disponib |
| not configured | poko konfigire |
| unknown | enkoni |

## Style rules

- **Address the reader as `ou`.** Haitian Creole does not have a French *tu/vous* or Spanish
  *tú/usted* distinction — `ou` is the only second-person singular pronoun, for every register. There
  is no formality choice to make here the way there was for German/Spanish/French; use `ou`
  everywhere, including instructions and button labels. Plural "you" (addressing all panel accounts
  at once, rare in this UI) is `nou`.
- **Register is controlled by vocabulary, not pronoun.** Where a sentence *could* lean on a heavily
  French-derived word or a plainer everyday Kreyòl one, prefer the plain one — this is a tool an
  admin runs for their own game server, not enterprise software. `sove` over a more formal
  alternative for "save," `demare`/`sispann` over stiffer options for "start"/"stop."
- **Keep destructive wording destructive.** A wipe/delete confirmation that reads mild in Kreyòl
  when it was alarming in English is a bug, the same lesson the French locale already learned the
  hard way once (see `GLOSSARY.es.md`). `efase nèt` for "wipe," never a softer verb.
- **Straight ASCII quotes inside a JSON string value are a parse error, not a style choice.** If Kreyòl
  prose needs a quotation mark inside a string, use `\"` (escaped) or curly quotes (`" "`), never an
  unescaped straight `"`. `JSON.parse` every file before calling it done.

## Placeholders and tags are structural, not text

Every `{{name}}`-style interpolation placeholder must appear in the Kreyòl string, spelled
byte-for-byte identically to the English source. Every `<tag>...</tag>` or self-closing `<1/>` must
also survive. The parity test checks both, per key, in both directions. Word order around a
placeholder or tag should change to fit natural Kreyòl phrasing — that is the point of translating —
but the token itself never does. Example: English `Deleted {{name}}` could become
`{{name}} efase` (placeholder moved to the front, which reads more naturally in Kreyòl) — never
`Item efase` (placeholder dropped) or `{{Name}} efase` (placeholder respelled).

## Discord and PanelBridge

| English | ht | Note |
| --- | --- | --- |
| Bot (the Discord bot) | bot | stays as-is |
| Guild (Server) ID | ID Sèvè (Guild) | keep the Guild parenthetical, Discord's own Developer Portal term |
| Intents / Privileged Gateway Intents | Intents / Privileged Gateway Intents | leave in English — literal Discord Developer Portal checkbox names |
| bridge (generic, lowercase) | pon | but **PanelBridge** the product name stays literal |
| GM | GM | do not expand |
| Overseer / Observer | Overseer / Observer | Project Zomboid access-level names — left untranslated, unlike the Spanish locale's choice, because no Kreyòl PZ community precedent was found for these; flagged for review |

Left untranslated as game-literal tokens, same reasoning as the other locales: Project Zomboid's chat
scopes (General, Say, Local, Shout, Q shouts), the `[ADMIN]` / `[SAY]` / `[FACTION]` / `[SAFEHOUSE]`
chat tags, `SERVER.INI` and `SANDBOX` section labels.

## If you need a term that is not here

Add it to this file in the same commit as the strings that use it, so the next agent to hit the same
word finds it already settled instead of inventing a second answer.
