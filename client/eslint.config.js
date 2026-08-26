import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import noRawErrorMessage from '../eslint-rules/no-raw-error-message.js'

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
      local: { rules: { 'no-raw-error-message': noRawErrorMessage } },
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
      'src/pages/Login.tsx',
      'src/pages/Players.tsx',
      'src/pages/ServerSetup.tsx',
      'src/pages/WorldMap.tsx',
      'src/components/DiscoverySetup.tsx',
      'src/components/FolderBrowser.tsx',
      'src/components/WorkshopCollectionPanel.tsx',
      'src/components/mods/ConflictsPanel.tsx',
      'src/components/templates/CreateTemplateDialog.tsx',
      'src/components/templates/TemplatePreviewDialog.tsx',
    ],
    rules: {
      'local/no-raw-error-message': 'warn',
    },
  },
)
