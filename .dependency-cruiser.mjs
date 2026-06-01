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
        path: '^(assets|scripts|tests)/',
      },
      to: {
        circular: true,
        path: '^(assets|scripts|tests)/',
      },
    },
    {
      name: 'no-prod-to-tests',
      severity: 'error',
      comment: 'Production code should not depend on test-only helpers.',
      from: {
        path: '^(assets|scripts)/',
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
        path: '^assets/js/ui/',
      },
      to: {
        path: '^assets/js/loader/',
      },
    },
    {
      name: 'no-bootstrap-to-milkdrop-internals',
      severity: 'info',
      comment:
        'Bootstrap modules should stay on public app/runtime surfaces rather than MilkDrop internals.',
      from: {
        path: '^assets/js/bootstrap/',
      },
      to: {
        path: '^assets/js/milkdrop/',
      },
    },
  ],
};

export default config;
