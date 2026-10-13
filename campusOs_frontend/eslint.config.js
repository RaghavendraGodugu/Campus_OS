import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Rules-of-Hooks is an error, not a warning.
 *
 * A hook called conditionally or out of order does not merely lint badly — it
 * produces stale closures and torn state, and it does so under exactly the
 * conditions that are hardest to reproduce: a role change, a slow refetch, a
 * remount mid-interaction.
 */
export default [
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // A console.log in a browser bundle is data left where anyone can read
      // it. warn and error remain: those are the two a human chose to keep.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  // Test and script files run under Node, not in a browser.
  {
    files: ["src/test/**/*.{js,jsx}", "scripts/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
];
