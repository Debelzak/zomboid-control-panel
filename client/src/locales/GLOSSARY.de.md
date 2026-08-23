# German (de) translation glossary

The one place German vocabulary and register are decided. Read it before writing a
string. Unlike the Spanish and Chinese glossaries, THIS FILE HAS ONE WRITER (god) --
five agents are translating in parallel and five editors of one file collide. Message
god a term you have decided; it lands here and gets broadcast. A term that crosses namespaces crossing them inconsistently is the one
defect the parity test cannot catch — every key present, every string wrong in a
different way.

German is not Spanish and it is not Chinese. Three things below have no analogue in
either: closed compounds, capitalised nouns, and case-and-gender agreement around
placeholders. The last of those is the trap; it has its own section at the bottom.

## Do not translate

Product and engine tokens, left exactly as they appear in English:

- Project Zomboid, SteamCMD, Steam Workshop, Steam, RCON, PanelBridge, OIDC, Docker
- **mod** (die Mod, plural die Mods), **chunk** (der Chunk), **sandbox** (die Sandbox),
  **token** (das Token), **Backup** (das Backup, die Backups), **Dashboard**,
  **Server**, **Whitelist**, **Single Sign-on**
- INI keys and any value the game itself writes to disk; the SERVER.INI and SANDBOX
  section labels
- Project Zomboid's chat scopes (General, Say, Local, Shout, Q shouts) and the
  [ADMIN] / [SAY] / [FACTION] / [SAFEHOUSE] chat tags
- *iso* in "iso regions" — the engine's own Iso* prefix
- GM, Admin — never expanded
- Intents / Privileged Gateway Intents — literal Discord Developer Portal checkbox names

Prefer **Backup** to *Sicherung* and **Dashboard** to *Übersicht* deliberately: both
are universal in German ops vocabulary and both are shorter, which matters (see the
length rule).

## Core vocabulary

| English | de | Note |
| --- | --- | --- |
| server | der Server | |
| the panel | das Panel | this application, as distinct from the game server |
| dashboard | das Dashboard | |
| player | der Spieler | generic; **no** Gendersternchen or :Innen forms — they break around placeholders and are not house style |
| save / savegame | der Spielstand | |
| world | die Welt | |
| world map | die Weltkarte | |
| region | die Region | |
| backup | das Backup | |
| template | die Vorlage | |
| scheduled task | geplante Aufgabe | |
| console | die Konsole | |
| log | das Protokoll | |
| diagnostics | die Diagnose | one check is *eine Prüfung* |
| settings | die Einstellungen | always plural |
| conflict | der Konflikt | |
| dependency | die Abhängigkeit | |
| folder | der Ordner | |
| path | der Pfad | |
| file | die Datei | |

## Access control

| English | de | Note |
| --- | --- | --- |
| user | der Benutzer | **not** *Nutzer* — pick one, this is it |
| role | die Rolle | |
| permission | die Berechtigung | |
| capability | das Recht | one tickable row in the rights matrix (die Rechtematrix) |
| administrator | Administrator | |
| moderator | Moderator | |
| technician | Techniker | |
| sign in / sign out | anmelden / abmelden | |
| password | das Passwort | |
| session | die Sitzung | |
| Overseer / Observer | Aufseher / Beobachter | Project Zomboid access levels |

## Actions — always the infinitive on a button

| English | de |
| --- | --- |
| start / stop | starten / stoppen |
| restart | neu starten (verb) · der Neustart (noun) |
| install | installieren |
| update | aktualisieren |
| verify | überprüfen |
| enable / disable | aktivieren / deaktivieren |
| kick | kicken |
| ban / unban | bannen / entbannen |
| wipe | unwiderruflich löschen — destructive, **never** *zurücksetzen* |
| delete | löschen |
| save (verb) | speichern |
| apply | anwenden |
| retry | erneut versuchen |
| cancel / close | abbrechen / schließen |

## Status words

| English | de |
| --- | --- |
| succeeded / completed | abgeschlossen |
| failed | fehlgeschlagen |
| error | Fehler |
| warning | Warnung |
| running | läuft |
| stopped | gestoppt |
| pending | ausstehend |
| unavailable | nicht verfügbar |
| not configured | nicht konfiguriert |
| unknown | unbekannt |

## Project Zomboid entities

| English | de | Note |
| --- | --- | --- |
| safehouse | das Safehouse (pl. die Safehouses) | **stays literal** — see the ruling below |
| faction | die Fraktion | |
| territory | das Gebiet | |
| claim (a safehouse) | beanspruchen | |
| respawn | der Respawn · respawnen | |

**Why safehouse stays English when fr, es and zh-CN all translated it.** Three reasons,
and the third is the decisive one:

1. German gaming idiom absorbs English feature names where French and Spanish resist
   them. The precedent from the other three locales does not transfer.
2. Length. *Safehouse* is nine characters; the honest German is fifteen, in table
   headers, chips and operation labels.
3. **The honest German reads as a description, not a feature name.** An attributive
   adjective stays lowercase, so it is *das sichere Haus* — "the safe house" — not
   *das Sichere Haus*. Sitting in an operations list next to *Fraktion*, a
   description-shaped label stops naming the claimable thing the operator manages.

Consistent with the [SAFEHOUSE] chat tag, which this glossary already leaves literal:
the word is on screen untranslated either way, and splitting one concept across two
words inside the same product is worse than a loanword.

Compounds hyphenate, because they mix an English token: *Safehouse-Besitzer*,
*Safehouse-Verwaltung*, *Safehouse-Mitglied*.

## Terms coined during the German pass

Decided from real strings as the buckets landed. Same rule as everything else here:
if you are about to coin one of these differently, do not.

| English | de | Note |
| --- | --- | --- |
| spawn point / spawn region | der Spawnpunkt / die Spawnregion | closed compound; *Spawn* is an adopted loanword |
| tile | die Kachel | world-map tile |
| disk | der Datenträger | *von Datenträger löschen* — chosen for consistency across debug, errors and mods |
| Mod Checker | der Mod-Checker | the feature's German name; **never** *Mod-Prüfung* |
| item (a JSON array entry) | das Element | |
| itemType (the Project Zomboid item id) | itemType | a payload field name — stays literal |
| capability label | see below | |

**Capability labels are substituted into error sentences.** `roles.json`'s
`capabilities.<key>.label` entries are not only matrix row headings: the server throws
ROLE_LOCKOUT_LAST_MANAGER and ROLE_SELF_CAPABILITY_LOSS_CONFIRM with
`{ action: "roles.manage" }`, and the client resolves that key through the same
catalogue (see the comment at `server/services/permissions.js:568` and
`CAPABILITY_KEY_PARAM_NAMES` in `errorMessage.ts`). So every capability label must read
correctly **standalone, after a colon**, in a sentence it never sees:

```
Nach dieser Änderung hätte niemand mehr die Berechtigung: {{action}}
```

That is why the German for those two errors uses a colon construction rather than
*niemand könnte mehr {{action}}* — the placeholder carries a label, not an infinitive.

## Style rules

1. **Register: du, lowercase.** This panel is run by game-server operators, and the
   floor already ruled the informal form for Spanish. Same call here. Never *Sie*,
   never a mix. Carve-out: a pure statement of state has no addressee and stays
   impersonal — *Server läuft*, *Keine Backups vorhanden* — do not contort those into
   second person.
2. **Buttons and menu items take the infinitive**, not the imperative: *Speichern*,
   *Löschen*, *Neu starten*. Never *Speichere*.
3. **Every noun is capitalised.** This is the single most common defect in machine-
   assisted German and it is invisible to every test here. Re-read your own output for
   it before committing — including nouns inside a sentence and nouns formed from
   verbs (*das Löschen*, *beim Starten*).
4. **Compounds are written closed**, not spaced and not hyphenated: *Serverkonfiguration*,
   *Startparameter*, *Weltkarte*, *Rechtematrix*. Hyphenate only where a compound
   contains an English token or an abbreviation: *Mod-Ordner*, *Backup-Datei*,
   *RCON-Passwort*, *Steam-Workshop-Sammlung*.
5. **Length is a real constraint.** German runs roughly 30% longer than English. On
   buttons, badges, table headers, tabs and chips, choose the shortest correct word
   even where a richer one exists — the layout was built around English string widths
   and nothing on this floor renders your text before it ships.
6. **ß, German orthography** (not Swiss ss): *schließen*, *Größe*, *gelöscht*, but
   *muss*, *dass* — ss after a short vowel.
7. **Quotation marks in prose are „…“**. Straight quotes are fine inside code, paths
   and INI values.
8. Do not translate a string that is literally an INI key or a value the game writes
   to disk. Translate our explanation of what that setting does. Judge it per string
   and report anything genuinely ambiguous rather than guessing silently.

## The trap specific to German: case and gender around placeholders

English carries no agreement at all. German carries three genders and four cases, and
a placeholder that substitutes a **noun** makes every article and adjective around it
unresolvable. This is worse than the Spanish version of the same problem, because
German inflects the article as well as the ending.

```
WRONG   Der {{item}} wurde gelöscht.        <- wrong the moment {{item}} is feminine or neuter
WRONG   Möchtest du den {{item}} löschen?   <- and now the case is wrong too
RIGHT   Gelöscht: {{item}}
RIGHT   {{item}} wurde gelöscht.            <- participle after werden never inflects
RIGHT   Löschen: {{item}}?
```

The rule: **rewrite so that nothing agrees with the substituted word.** Do not guess a
gender. A colon construction, a leading participle, or putting the placeholder first
all work, and none of them commit to a gender the server never sends.

Two consequences worth stating separately:

- **_one and _other must genuinely differ.** German inflects plurals. In zh-CN both
  variants carry the same text because Chinese does not; carrying that habit into
  German would be wrong in every plural in the file.
- **A placeholder standing in for a word rather than a value is not a translation
  problem.** If a string cannot be made agreement-safe without changing what it says,
  report it. That is a server-side variant — two sentences — not something to solve in
  the locale file.

## Discord and PanelBridge

| English | de | Note |
| --- | --- | --- |
| Bot (the Discord bot) | der Bot | |
| Guild (Server) ID | Guild-ID (Server) | keep the Guild wording — Discord's own Developer Portal term |
| bridge (generic, lowercase) | die Brücke | **PanelBridge** the product name stays literal |
| channel | der Kanal | |
| webhook | der Webhook | |
