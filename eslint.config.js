import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "client/**",
      "dist/**",
      "build/**",
      "release/**",
      "coverage/**",
      "pz-mod/**",
      "*.cjs",
    ],
  },
  {
    files: ["server/**/*.js", "*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        // Injected by esbuild at build time; guarded with typeof at runtime.
        PANEL_VERSION: "readonly",
        PANEL_BRIDGE_LUA_B64: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,

      // Control chars in regexes are deliberate input sanitization (RCON args,
      // player names, PanelBridge payloads).
      "no-control-regex": "off",

      "no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Triaged 2026-08-04: the one real race (server wipe guard) is fixed.
      // The rest are per-request/per-socket objects and function-local
      // variables, which this rule reports as false positives. Kept visible
      // as warnings so new occurrences still surface for review.
      "require-atomic-updates": "warn",

      // Escaping `-` and `[` inside character classes is deliberate defensive
      // style here; rewriting 20 working regexes would risk real bugs.
      "no-useless-escape": "warn",

      "no-empty": ["warn", { allowEmptyCatch: false }],
      "no-fallthrough": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-unsafe-optional-chaining": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      "no-unmodified-loop-condition": "error",
      "require-await": "warn",
    },
  },
  {
    // Test doubles must match the awaited interface they stand in for, so an
    // async stub with no await inside is correct here.
    files: ["server/tests/**/*.js"],
    rules: {
      "require-await": "off",
    },
  },
];
