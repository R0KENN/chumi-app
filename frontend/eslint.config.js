import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import {
  defineConfig,
  globalIgnores,
} from 'eslint/config';

export default defineConfig([
  globalIgnores([
    'dist/**',
    'node_modules/**',
    '.wrangler/**',
  ]),

  // ── Клиентский React-код ──
  {
    files: [
      'src/**/*.{js,jsx}',
    ],

    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,

      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',

        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    rules: {
      /*
       * Неиспользуемые переменные пока оставляем предупреждениями.
       * Они не должны блокировать сборку существующего проекта.
       */
      'no-unused-vars': [
        'warn',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      /*
       * В проекте есть пустые catch для необязательных методов
       * Telegram WebApp, CloudStorage и DeviceStorage.
       */
      'no-empty': [
        'error',
        {
          allowEmptyCatch: true,
        },
      ],

      /*
       * Старый код содержит Promise с async executor.
       * Это нужно исправить отдельно, но сборку пока не блокируем.
       */
      'no-async-promise-executor': 'warn',

      /*
       * Эти правила появились в новых версиях React Hooks ESLint.
       * Текущая архитектура PairScreen пока с ними несовместима.
       */
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',

      /*
       * Зависимости hooks оставляем предупреждениями.
       */
      'react-hooks/exhaustive-deps': 'warn',

      /*
       * Context-файлы экспортируют Provider, hook и helpers.
       * Для такой структуры Fast Refresh предупреждение не нужно.
       */
      'react-refresh/only-export-components': 'off',
    },
  },

  // ── Cloudflare Pages Functions ──
  {
    files: [
      'functions/**/*.js',
    ],

    extends: [
      js.configs.recommended,
    ],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',

      globals: {
        ...globals.worker,
        ...globals.node,
      },
    },

    rules: {
      'no-unused-vars': [
        'warn',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      'no-empty': [
        'error',
        {
          allowEmptyCatch: true,
        },
      ],

      'no-async-promise-executor': 'warn',
    },
  },
]);
