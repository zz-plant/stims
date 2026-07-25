/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  options: {
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    exclude: {
      path: ['\\.milk$'],
    },
    doNotFollow: {
      path: ['^three/examples/'],
    },
  },
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {
        path: '^(src|scripts|tests)/',
      },
      to: {
        circular: true,
        path: '^(src|scripts|tests)/',
      },
    },
    {
      name: 'no-prod-to-tests',
      severity: 'error',
      comment: 'Production code should not depend on test-only helpers.',
      from: {
        path: '^(src|scripts)/',
      },
      to: {
        path: '^tests/',
      },
    },
    {
      name: 'no-ui-to-loader-internals',
      severity: 'info',
      comment:
        'UI modules should communicate through the app/loader surface instead of importing loader internals.',
      from: {
        path: '^src/js/ui/',
      },
      to: {
        path: '^src/js/loader/',
      },
    },
    {
      name: 'no-bootstrap-to-milkdrop-internals',
      severity: 'info',
      comment:
        'Bootstrap modules should stay on public app/runtime surfaces rather than MilkDrop internals.',
      from: {
        path: '^src/js/bootstrap/',
      },
      to: {
        path: '^src/js/milkdrop/',
      },
    },
  ],
};

export default config;
