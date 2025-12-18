import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const tsconfigRootDir = new URL('.', import.meta.url).pathname;

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/bun.lock',
      '**/package-lock.json',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        document: 'readonly',
        global: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        performance: 'readonly',
        Event: 'readonly',
        DOMException: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        localStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        CustomEvent: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['assets/js/lib/**'],
  },
];
