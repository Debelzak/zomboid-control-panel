import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import noRawErrorMessage from '../eslint-rules/no-raw-error-message.js'
import noDuplicateInterfaceName from '../eslint-rules/no-duplicate-interface-name.js'
import noDeadDisabledTitle from '../eslint-rules/no-dead-disabled-title.js'

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      local: {
        rules: {
          'no-raw-error-message': noRawErrorMessage,
          'no-duplicate-interface-name': noDuplicateInterfaceName,
          'no-dead-disabled-title': noDeadDisabledTitle,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-case-declarations': 'off',
      'no-extra-boolean-cast': 'off',
      'no-useless-escape': 'off',

      // 2026-08-26 errorMessage.ts coverage audit's structural half: forbids
      // a NEW `x instanceof Error ? x.message : fallback` toast/error-state
      // site anywhere. See eslint-rules/no-raw-error-message.js for what it
      // does and does not catch, and errorMessage.ts's own comment above
      // rawErrorMessageIntentional() for the (rare) escape hatch.
      'local/no-raw-error-message': 'error',

      // 2026-08-27 api.ts type-architecture survey: api.ts had `BackupFile`
      // declared twice for two genuinely different real shapes (config-file
      // backups vs full server backups), and tsc's declaration merging
      // silently unioned them into a type requiring fields neither producer
      // returns. See eslint-rules/no-duplicate-interface-name.js.
      'local/no-duplicate-interface-name': 'error',

      // 2026-08-27 disabled-reason sweep (Dashboard/Players/Events): a
      // `title` on an element that can be `disabled` is invisible while
      // disabled (Chromium shows no native tooltip there, confirmed
      // empirically) -- see eslint-rules/no-dead-disabled-title.js. `warn`,
      // not `error`: the tree had dozens of hits the night this landed,
      // split across a confirmed-defect shape and an ambiguous shape the
      // rule honestly can't resolve without a human reading the copy. An
      // `error` here would force either fixing all of them immediately or
      // maintaining a per-file exemption list -- the exact grandfather-list
      // liability already removed elsewhere in this file tonight.
      'local/no-dead-disabled-title': 'warn',
    },
  },
  {
    // Known debt at 2026-08-26, listed explicitly so the count can only go
    // DOWN: every file with at least one existing raw-error-message toast/
    // error-state site as of this rule landing, downgraded to a warning here
    // so the client gate (`npm run lint`, 0 ERRORS) stays green at HEAD
    // without silencing the rule everywhere. As a file's sites get converted
    // to getUserErrorMessage(), remove it from this list in the SAME commit
    // -- if a site is ever missed, removing the file immediately turns it
    // back into a hard error instead of silently staying clean. Do not add a
    // file here that wasn't already in this list when the rule landed; a
    // new file starts under the 'error' severity above like everything else.
    files: [
      'src/App.tsx',
      'src/pages/ChunkCleaner.tsx',
      'src/pages/Dashboard.tsx',
      'src/pages/Players.tsx',
      'src/pages/ServerSetup.tsx',
      'src/pages/WorldMap.tsx',
      'src/components/DiscoverySetup.tsx',
      'src/components/FolderBrowser.tsx',
      'src/components/mods/ConflictsPanel.tsx',
    ],
    rules: {
      'local/no-raw-error-message': 'warn',
    },
  },
)
