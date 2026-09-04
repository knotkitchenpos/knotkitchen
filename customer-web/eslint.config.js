import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    // Built output is not source. The Android wrapper ships a copy of the
    // compiled bundle, and linting minified code produced hundreds of
    // meaningless violations (208 "rules-of-hooks" alone) that buried the
    // real ones in the app's own code.
    ignores: [
      'dist',
      'build',
      'android/**',
      'ios/**',
      '**/assets/public/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',

      // This codebase does not use PropTypes anywhere, so the rule reported a
      // violation for essentially every prop on every component -- 618 of the
      // 741 problems in pos-frontend. That volume is what made the real
      // findings invisible, which is the only reason it is off.
      'react/prop-types': 'off',

      'no-unused-vars': [
        'error',
        {
          // `import React` is unnecessary under the automatic JSX runtime this
          // config already enables, but it is harmless and present in ~60
          // files. Flagging it says nothing about correctness.
          varsIgnorePattern: '^React$',
          // `catch (e) {}` where the error is deliberately swallowed.
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
        },
      ],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
]
