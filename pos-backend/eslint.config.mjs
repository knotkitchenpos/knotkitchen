/**
 * Minimal lint for the backend, aimed at ONE class of fault.
 *
 * There was no config here at all, so `no-undef` never ran, and a refactor that
 * removed a `const a = ...` while two lines below still read `a.city` shipped
 * to production and 500'd the CSD store list. `node --check` cannot catch that
 * -- it is valid syntax, and the ReferenceError only happens when the function
 * is actually called, which no test did.
 *
 * Deliberately narrow. This is not a style pass and it is not trying to
 * retrofit an opinion onto 600 files: it reports the mistakes that are
 * unambiguously bugs, so the signal stays worth reading.
 */

export default [
  // A bare `ignores` block is a GLOBAL ignore. The same key alongside `files`
  // only excludes paths from that one block, which left the tests being linted.
  { ignores: ["node_modules/**", "tests/**", "migrations/**", "scripts/**"] },
  {
    files: ["**/*.js"],
    // The codebase carries eslint-disable comments from a previous setup whose
    // rules this config does not enable. Reporting all 18 of them as warnings
    // would bury the one line that actually matters, and a gate nobody reads
    // is not a gate.
    linterOptions: { reportUnusedDisableDirectives: false },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        exports: "writable",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        global: "readonly",
        globalThis: "readonly",
      },
    },
    rules: {
      // The one that matters: a name that does not exist at runtime.
      "no-undef": "error",
      // Almost always a half-finished edit.
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-const-assign": "error",
      "no-dupe-args": "error",
      "no-func-assign": "error",
      // Noisy on an existing codebase, and rarely a real fault. Off on purpose
      // rather than by omission.
      "no-unused-vars": "off",
      "no-empty": "off",
    },
  },
];
