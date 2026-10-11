// ESLint flat configuration (ESLint 9+ / 10).
// Formatting concerns (indent, quotes, semicolons) are owned by Prettier
// (see .prettierrc). ESLint here is focused on correctness: undefined vars,
// unused vars, unreachable code, and accidental globals.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**", ".env", "*.log"],
  },
  js.configs.recommended,
  {
    // This config file itself runs under Node/CommonJS.
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    // vitest.config.js uses ESM syntax. The package is CommonJS ("type" is
    // absent), but this file is loaded by Vite's config loader, so ESLint must
    // be told to parse it as a module.
    files: ["vitest.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // Node backend
    files: ["src/**/*.js", "scripts/**/*.js", "tests/**/*.js", "server.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "no-implicit-coercion": "error",
    },
  },
  {
    // Vite test runner exposes globals like describe/it/expect when configured.
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
