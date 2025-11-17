import js from '@eslint/js';

export default [
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
        URLSearchParams: 'readonly',
        localStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        CustomEvent: 'readonly',
      },
    },
    ignores: ['assets/js/**'],
  },
];
