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
