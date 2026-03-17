const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettier = require('eslint-config-prettier');

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  crypto: 'readonly',
  Blob: 'readonly',
  IntersectionObserver: 'readonly',
  Chart: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
  require: 'readonly',
  exports: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const unusedVarsWarn = ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }];

const allowEmptyCatchWarn = ['warn', { allowEmptyCatch: true }];

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'supabase/.temp/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      'no-unused-vars': unusedVarsWarn,
      'no-empty': allowEmptyCatchWarn,
    },
  },
  {
    files: [
      'eslint.config.js',
      'tailwind.config.js',
      'postcss.config.js',
      '**/*.cjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': unusedVarsWarn,
      'no-empty': allowEmptyCatchWarn,
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': unusedVarsWarn,
      'no-empty': allowEmptyCatchWarn,
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: browserGlobals,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVarsWarn,
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': allowEmptyCatchWarn,
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        global: 'readonly',
        process: 'readonly',
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': unusedVarsWarn,
      'no-undef': 'error',
    },
  },
  {
    files: ['app.js'],
    rules: {
      'no-undef': 'off',
      'no-irregular-whitespace': 'warn',
      'no-prototype-builtins': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  prettier,
];
