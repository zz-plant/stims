/** Stims policy for the generic agent-ergonomics commands; script docblocks remain the documentation source. */
import { defineConfig } from 'agent-ergonomics';

export default defineConfig({
  scriptsDir: 'scripts',
  runner: 'bun run',
  commands: {
    help: 'bun run help',
    gate: 'bun run check',
    gateQuick: 'bun run check:quick',
    generateGuardrails: 'bun run generate:guardrails',
    branchRestart: 'bun run branch:restart',
    worktreeNew: 'bun run worktree:new',
    prBody: 'bun run pr:body',
  },
  help: {
    title: 'Stims scripts',
    prefixNotes: {
      agent: 'agent-session helpers',
      assets: 'static asset tooling',
      audit: 'historical fix and safety audits',
      bench: 'benchmarks against native or baseline engines',
      biome: 'Biome linter/formatter commands',
      build: 'production builds',
      catalog: 'catalog tooling',
      cf: 'Cloudflare wrangler helpers',
      check: 'quality gates and guard scripts',
      cron: 'scheduled Worker deploy/dev',
      ctl: 'stims CLI controller and automation',
      dev: 'local development servers',
      docs: 'docs generation',
      format: 'Biome formatting',
      generate: 'artifact/doc generators (idempotent; most accept --check)',
      lab: 'preset measurement labs',
      lint: 'Biome linting',
      mcp: 'MCP server deploy/dev',
      model: 'local model routing',
      parity: 'MilkDrop parity corpus pipeline',
      perf: 'perf certification suites',
      play: 'interactive toy runners',
      preview: 'preview deployments and visual review',
      previews: 'preset preview generation',
      profile: 'frame profiling',
      session: 'codex session control',
      setup: 'local environment and browser bootstrapping',
      site: 'site Worker build/deploy pipeline',
      spec: 'spec conformance runners',
      sweep: 'batch preset sweeps',
      telemetry: 'crash and performance telemetry reports',
      test: 'test suite runners (profiles via --profile)',
      trace: 'differential execution traces',
      typecheck: 'TypeScript no-emit checking',
      ui: 'UI harness tooling',
    },
    routes: [
      {
        when: [
          'worktree',
          'another session',
          'other session',
          'concurrent',
          'parallel',
          'separate checkout',
          'shared checkout',
        ],
        run: ['worktree:new'],
        note: "Several sessions share the main checkout's index and working tree, so one session's staged files or stash can take another's work. A worktree per change avoids that; this creates one off origin/main and installs it.",
      },
      {
        when: [
          'preset looks wrong',
          'wrong',
          'fidelity',
          'different',
          'inaccurate',
          'parity',
        ],
        run: ['parity:capture', 'parity:diff'],
        note: "Ground truth lives outside this repo, in MilkDrop's actual behavior. Capture a reference and diff frames — do not write a unit test asserting what you think is correct.",
      },
      {
        when: ['not reacting', 'audio', 'reactivity', 'music', 'beat', 'quiet'],
        run: ['lab:dataflow', 'lab:reactivity', 'lab:visual'],
        note: 'lab:dataflow reads the equations and says instantly which audio can reach which control or drawn program (dead code and disabled waves included); lab:reactivity (~15s, no browser) measures how strongly it reacts; lab:visual (1-3 min) confirms the reaction is visible in pixels, not just in the numbers.',
      },
      {
        when: ['portrait', 'phone', 'mobile', 'tall screen', 'aspect'],
        run: ['lab:visual', 'lab:backend-diff'],
        note: "lab:visual --viewport 390x844 measures a preset on a phone held upright; lab:backend-diff takes --width/--height. A preset that is black only on tall screens is usually MilkDrop's own maths (cx/cy sit in aspect-squeezed space), not a renderer bug: compare with the 1280x720 run before changing the renderer.",
      },
      {
        when: [
          'nan',
          'black',
          'blank',
          'frozen',
          'crash',
          'compile',
          'broken preset',
        ],
        run: ['lab:nan-sweep', 'sweep:milkdrop-loops'],
        note: 'nan-sweep finds NaN/compile/step failures corpus-wide without a browser; sweep:milkdrop-loops finds presets that render blank, frozen or slow.',
      },
      {
        when: [
          'webgpu',
          'webgl',
          'backend',
          'differs',
          'gpu',
          'divergence',
          'tier',
          'mirrored',
          'flipped',
          'upside down',
          'tone mapped',
        ],
        run: ['lab:backend-diff', 'lab:gpu-differential', 'lab:replay'],
        note: 'Reach for lab:backend-diff first: it is the only one that compares RENDERED FRAMES across the two backends, scoring each preset against its own same-backend noise floor and naming a mirrored frame or a constant colour shift outright. lab:gpu-differential and lab:replay --tier gpu compare VM execution tiers instead, and name the first divergent frame once you know the backends disagree.',
      },
      {
        when: [
          'vm',
          'semantics',
          'expression',
          'eel',
          'changed behavior',
          'regression',
        ],
        run: ['lab:replay'],
        note: 'Record a trace before your edit, replay after. Bisects semantic drift to a frame instead of leaving you to eyeball it.',
      },
      {
        when: [
          'slow',
          'fps',
          'performance',
          'frame',
          'budget',
          'jank',
          'stutter',
        ],
        run: [
          'lab:profile',
          'perf:certification-corpus',
          'profile:frame',
          'bench:butterchurn',
        ],
        note: 'Measure before optimising; intuition about which loop dominates a frame is usually wrong. lab:profile runs a real rAF loop and is the one whose numbers reflect a user frame; profile:frame steps synthetic frames, so use it only for controlled A/B micro-comparisons.',
      },
      {
        when: [
          'flash',
          'seizure',
          'photosensitive',
          'strobe',
          'wcag',
          'safety',
        ],
        run: ['lab:flash-audit'],
        note: 'lab:flash-audit (~12 min) is the real WCAG 2.3.1 instrument. lab:flash-risk is a rough placeholder heuristic and is not a compliance check.',
      },
      {
        when: ['ui', 'css', 'layout', 'visual regression', 'chrome', 'panel'],
        run: ['ui:diff', 'dev'],
        note: 'ui:diff screenshot-diffs the workspace. For live QA use bun run dev and open /?agent=true.',
      },
      {
        when: [
          'rule',
          'guard',
          'rejected',
          'gate',
          'lint',
          'why did check fail',
        ],
        run: ['check:quick'],
        note: 'docs/GUARDRAILS.md lists every enforced rule and its rationale, generated from the guards themselves.',
      },
      {
        when: ['where do i start', 'onboard', 'new', 'learn', 'confused'],
        run: ['help'],
        note: 'docs/ONBOARDING.md maps which parts of the codebase are hard, why, and what order to learn them in.',
      },
      {
        when: [
          'typecheck',
          'typescript',
          'types',
          'tsc',
          'ts error',
          'fix typescript',
        ],
        run: ['typecheck', 'check:quick'],
        note: 'typecheck verifies all TypeScript files without emitting JS; check:quick runs typechecking plus Biome linting and fast guards.',
      },
      {
        when: [
          'doctor',
          'environment',
          'setup',
          'bootstrap',
          'missing browser',
          'install broken',
        ],
        run: ['doctor', 'setup'],
        note: 'doctor diagnoses environment dependencies, browsers, and port collisions; setup synchronizes packages and links browser binaries.',
      },
      {
        when: [
          'production bundle',
          'build bundle',
          'bundle size',
          'dist artifacts',
        ],
        run: ['build', 'site:build', 'check:bundle-size'],
        note: 'build produces the visualizer bundle; site:build packages the Cloudflare worker and site assets.',
      },
      {
        when: ['mcp', 'model context protocol', 'agent tooling', 'ai server'],
        run: ['mcp', 'mcp:check'],
        note: 'mcp starts the local MCP server for AI agents; mcp:check validates its Worker deployment config.',
      },
      {
        when: [
          'train',
          'dataset',
          'neural',
          'machine learning',
          'learned model',
          'remember',
          'audio history',
        ],
        run: [
          'lab:dataset',
          'lab:memory-probe',
          'lab:vj-baseline',
          'lab:dataflow',
        ],
        note: 'lab:dataset exports audio and per-frame preset state as NumPy; lab:memory-probe measures how long each preset control remembers a bump in the audio; lab:vj-baseline is the audio R² (and event-timing F1) a learned model has to beat, split by memory class with --memory; lab:dataflow labels which signals each column reads, from the equations. docs/guides/training-models.md walks through them.',
      },
      {
        when: [
          'edit model',
          'preset editing',
          'remix',
          'fix shader',
          'generate preset',
          'llm',
          'eval',
        ],
        run: ['lab:edit-eval', 'lab:remix-pairs', 'lab:shader-fix-bench'],
        note: 'lab:edit-eval scores a preset-editing model on directed edits derived from human remixes (validity, instructions, behaviour, and the audio edits it reproduces, read from the equations); lab:remix-pairs is the underlying (parent, remix, changes) data; lab:shader-fix-bench scores a shader-fixing model. Tasks come from held-out remix families.',
      },
      {
        when: ['benchmark', 'butterchurn', 'speed test', 'fps compare'],
        run: ['bench:butterchurn', 'perf:certification-corpus'],
        note: 'bench:butterchurn benchmarks performance directly against Butterchurn; perf:certification-corpus measures frame rates across presets.',
      },
      {
        when: [
          'og image',
          'og card',
          'social preview',
          'share card',
          'unfurl',
          'oembed',
          'twitter card',
          'seo',
          'sitemap',
        ],
        run: ['check:seo', 'previews:audit', 'generate:seo', 'og:warm'],
        note: 'check:seo verifies the generated OG/sitemap artifacts without writing; previews:audit checks what production actually serves (black/flat frames); generate:seo --check is the same verification, and without --check it rewrites tracked icons and sitemaps; og:warm writes to the production edge cache, so run it deliberately.',
      },
      {
        when: [
          'live url',
          'show a human',
          'no gpu',
          'gpu-less',
          'branch preview',
        ],
        run: ['preview:deploy'],
        note: 'A GPU-less session cannot judge rendering itself; preview:deploy prints a real Workers preview URL a human or a GPU machine can open.',
      },
      {
        when: [
          'catalog',
          'curate',
          'duplicate preset',
          'preset quality',
          'catalog integrity',
        ],
        run: ['catalog:dedup', 'catalog:score', 'check:catalog-integrity'],
        note: 'catalog:dedup finds near-duplicate presets, catalog:score ranks quality, check:catalog-integrity validates every entry and its preview.',
      },
      {
        when: [
          'flaky test',
          'flake',
          'intermittent',
          'only fails in ci',
          'passes locally',
          'timed out',
          'timeout',
        ],
        run: ['test:changed', 'test:gate', 'test:budget'],
        note: 'Never assert on timing: wait on a condition (__stims_agent.waitFor) instead, and never skip a test to get green. Also check mock or global-state leaks by running the file alone and with its neighbours. A test that "timed out after 5000ms" only under load is usually CPU-bound on the default timeout: test:budget lists every test that relies on it and uses more than half.',
      },
    ],
    noMatchPointers: [
      { name: 'bun run help'.padEnd(27), text: 'every script, grouped' },
      {
        name: 'docs/ONBOARDING.md'.padEnd(27),
        text: 'which areas are hard, and in what order',
      },
      {
        name: 'docs/GUARDRAILS.md'.padEnd(27),
        text: 'every rule this repo enforces',
      },
    ],
  },
  gate: {
    quietEnv: 'STIMS_QUIET',
    agentEnvs: ['CLAUDECODE'],
    summaryLabel: 'Quality gate',
    preflight: [
      {
        label: ['No ', '@ts-', 'nocheck', ' guard'].join(''),
        cmd: ['bun', 'run', 'check:no-ts-nocheck'],
      },
      {
        label: 'CI config drift check',
        cmd: ['bun', 'run', 'check:ci-config'],
      },
    ],
    concurrent: [
      {
        label: 'Biome lint (changed files)',
        cmd: ['bun', 'run', 'lint:changed'],
        modes: ['quick'],
        envCmd: {
          name: 'STIMS_LINT_STAGED',
          value: '1',
          cmd: ['bun', 'run', 'lint:changed', '--staged'],
        },
      },
      {
        label: 'Biome check',
        cmd: ['bun', 'run', 'biome:check'],
        modes: ['full', 'all'],
      },
      {
        label: 'Asset health check',
        cmd: ['bun', 'run', 'assets:check'],
      },
      {
        label: 'Bundled catalog fidelity',
        cmd: ['bun', 'run', 'check:catalog-fidelity'],
      },
      {
        label: 'Bundled catalog integrity',
        cmd: ['bun', 'run', 'check:catalog-integrity'],
      },
      {
        label: 'README public claim drift',
        cmd: ['bun', 'run', 'check:readme-claims'],
      },
      {
        label: 'SEO surface check',
        cmd: ['bun', 'run', 'check:seo'],
      },
      {
        label: 'CSS token resolution',
        cmd: ['bun', 'run', 'check:css-tokens'],
      },
      {
        label: 'CSS radius/type scale',
        cmd: ['bun', 'run', 'check:css-scale'],
      },
      {
        label: 'Z-index layer scale',
        cmd: ['bun', 'run', 'check:z-layers'],
      },
      {
        label: 'Agent action id drift',
        cmd: ['bun', 'run', 'check:agent-action-ids'],
      },
      {
        label: 'Unique e2e dev-server ports',
        cmd: ['bun', 'run', 'check:e2e-ports'],
      },
      {
        label: 'WebGPU target sampling',
        cmd: ['bun', 'run', 'check:webgpu-target-sampling'],
      },
      {
        label: 'Stale assets/ path check',
        cmd: ['bun', 'run', 'check:stale-paths'],
      },
      {
        label: 'Doc reference check',
        cmd: ['bun', 'run', 'check:doc-references'],
      },
      {
        label: 'Script docblock coverage',
        cmd: ['bun', 'run', 'check:script-docs'],
      },
      {
        label: 'Module docblock coverage',
        cmd: ['bun', 'run', 'check:module-docs'],
      },
      {
        label: 'Guardrails doc freshness',
        cmd: ['bun', 'run', 'check:guardrails-doc'],
      },
      {
        label: 'Reference audio header freshness',
        cmd: ['bun', 'run', 'check:reference-audio-header'],
      },
      {
        label: 'No new source-text tests',
        cmd: ['bun', 'run', 'check:test-source-greps'],
      },
      {
        label: 'First-run preset evidence freshness',
        cmd: ['bun', 'run', 'check:first-run-evidence'],
      },
      {
        label: 'Preset frame-cost sidecar',
        cmd: ['bun', 'run', 'check:preset-cost'],
      },
      {
        label: 'Authoring examples and reference',
        cmd: ['bun', 'run', 'check:authoring-docs'],
      },
      {
        label: 'Duplicate CSS check',
        cmd: ['bun', 'run', 'check:duplicate-css'],
      },
      {
        label: 'UI anti-pattern scan (impeccable)',
        cmd: ['bun', 'run', 'check:design'],
      },
      {
        label: 'Agent skill index',
        cmd: ['bun', 'run', 'check:skill-index'],
      },
      {
        label: 'Architecture boundary check',
        cmd: ['bun', 'run', 'check:architecture'],
      },
      {
        label: 'Dead code scan (knip)',
        cmd: ['bun', 'run', 'check:dead-code'],
        modes: ['full', 'all'],
      },
      {
        label: 'Standalone packages (typecheck + tests)',
        cmd: ['bun', 'run', 'check:packages'],
        modes: ['full', 'all'],
      },
      {
        label: 'Unbounded cache check',
        cmd: ['bun', 'run', 'check:cache-bounds'],
      },
      {
        label: 'File size ratchet',
        cmd: ['bun', 'run', 'check:file-size'],
      },
      {
        label: 'Package source seams',
        cmd: ['bun', 'run', 'check:no-source-seams'],
      },
      {
        label: 'Package site stylesheet',
        cmd: ['bun', 'run', 'check:site-styles-identical'],
      },
      {
        label: 'Banned pattern guard (changed files)',
        cmd: ['bun', 'run', 'check:guard-registry'],
      },
      {
        label: 'TypeScript typecheck',
        cmd: ['bun', 'run', 'typecheck'],
      },
    ],
    postflight: {
      full: [
        {
          label: 'Gate test suite',
          cmd: ['bun', 'run', 'test:gate'],
        },
      ],
      all: [
        {
          label: 'Full test suite (all profiles)',
          cmd: ['bun', 'run', 'test', '--profile', 'all'],
        },
      ],
    },
  },
  guardrails: {
    output: 'docs/GUARDRAILS.md',
    exclude: ['check', 'check:quick', 'check:all'],
    gateCommands: { quick: 'check:quick', full: 'check' },
    intro: [
      'Stims has more automated rules than a newcomer can discover by reading code,',
      'and historically the only way to meet them was to trip one. This page is that',
      'set of rules, generated from the guards themselves so it cannot go stale.',
      '',
      'Run `bun run check:quick` early and often — it is seconds, and it is how these',
      'become fast feedback instead of a surprise at PR time.',
    ],
  },
  docRefs: {
    roots: ['docs', '.agent', '.claude', '.github', '.opencode'],
    extraFiles: ['AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'tests/INDEX.md'],
    generatedDocs: ['docs/GUARDRAILS.md'],
    skipDirs: [
      'archive',
      'evidence',
      'node_modules',
      'worktrees',
      '.git',
      'dist',
      'screenshots',
    ],
    historicalRecord:
      /(AUDIT|CRITIQUE|ANTI_PATTERNS|RESEARCH|_REPORT_|assessment|STATUS_|critiques)/i,
    placeholder: /path\/to|your-file|YYYY-MM|<[a-z-]+>/,
    historicalPath: /\b[0-9a-f]{7,40}:$/,
    proposalLine: /\(NEW\)|New follow-up/,
    pathPrefixes: [
      'src',
      'tests',
      'scripts',
      'docs',
      '.agent',
      '.claude',
      '.github',
      '.opencode',
      'functions',
      'public',
    ],
  },
  moduleDocs: {
    include: 'src/js/**/*.{ts,tsx}',
    minLines: 400,
    minSummaryLength: 40,
    backlog: [],
    seeAlso: 'docs/ONBOARDING.md',
  },
  testSourceGreps: {
    testsDir: 'tests',
    sourceDirs: ['src', 'scripts'],
    allowed: {
      // The shipped artifact IS the text. jsdom computes no layout or stacking
      // contexts, so there is no behavioural observation point in this suite.
      'tests/unit/theme-boot-parity.test.ts':
        'Extracts and EXECUTES the pre-paint theme IIFE from index.html against the real resolveTheme — the script runs before any module loads, so reading the shipped HTML is the only way to test it.',
      'tests/unit/seo-canonical-intent.test.ts':
        'index.html and milkdrop/index.html are the crawlable artifacts; the meta tags are the contract a crawler sees.',
      'tests/unit/site-build.test.ts':
        'Asserts the built output and _headers, which are files we ship rather than modules we can import.',
      'tests/unit/milkdrop-overlay-stacking.test.ts':
        'src/css/tokens.css z-index scale — the cascade is the behaviour and jsdom does not compute stacking contexts.',

      // Known debt, enumerated so it cannot grow silently. Each of these asserts
      // component or CSS source text and should become a behavioural test or move
      // to tests/e2e/chrome-visual-contract.test.ts. See the 2026-08-25 audit.
      'tests/unit/app-shell-minimal-surfaces.test.ts':
        'DEBT: greps panel components and app-shell.css for copy and selectors.',
      'tests/unit/app-shell-passive-guidance.test.ts':
        'DEBT (reduced): the audio-match toast is rendered with fake timers now; the remaining greps are App.tsx wiring and toast/hint copy, pending a harness mount of those surfaces.',
      'tests/unit/app-shell-performance-hardware.test.ts':
        'DEBT: greps for hardware-tier branching.',
      'tests/unit/app-shell-performance-regression.test.ts':
        'DEBT: greps for import specifiers and memo/cache spellings.',
      'tests/unit/app-shell-route-sync.test.ts':
        'The route-sync test renders the real hook now; the remaining source read is the toast attribute/media-query pair, a cross-artifact presentational contract with no layout engine in this suite.',
      'tests/unit/app-shell-skip-flow.test.tsx':
        'Renders the real StimsStageFrame for the focus-target and data-mode halves; the remaining reads are the App.tsx anchor (the shell does not mount in this suite) and the CSS rules (no style engine).',
      'tests/unit/app-shell-stage-tools.test.tsx':
        'The no-backdrop invariant renders the real SidePanel both ways; the remaining read is the App.tsx wiring of stageAnchored to the editor panel, since the shell does not mount here.',
      'tests/unit/app-shell-ui-simplification.test.ts':
        'DEBT: greps eight components for copy.',
      'tests/unit/arrival-url.test.ts':
        'The snapshot module gets a full behavioural suite (frozen-at-load, survives replaceState) in this same file; the two remaining greps are entry-graph structure — app.ts must eagerly import the snapshot (that eager import IS the load-time pin) and NewHomePage must read it rather than live location.search — wiring contracts no harness in this suite mounts to observe.',
      'tests/unit/assisted-edit-gate.test.ts':
        'One remaining routing check on editor-panel source (all AI actions go through the proposal path); the exact-count brittleness is gone and the rest of the file is behavioural.',
      'tests/unit/keyboard-shortcut-matching.test.ts':
        'Generates its rows from the live registry; the source read is a dangling-reference check, not a copy assertion.',
      'tests/unit/mobile-viewport-matrix.test.ts':
        'Reduced to declarations a rendered check cannot observe (safe-area env() math, live-mode rules needing a booted engine); the overflow and short-landscape invariants moved to chrome-visual-contract e2e as computed measurements.',
      'tests/unit/primitive-rasterization-fidelity.test.ts':
        'DEBT: greps renderer source for rasterisation constants.',
      'tests/unit/workspace-first-fold-actions.test.tsx':
        'Renders the real NewHomePage/AudioSourcePanel through the harness; the one remaining read checks app-shell.css styles the classes the RENDERED page produces (no style engine here).',
    },
    debtPrefix: 'DEBT:',
  },
  prBody: {
    docPath:
      /^(docs\/|README\.md$|CONTRIBUTING\.md$|AGENTS\.md$|\.claude\/|\.agent\/|\.github\/AGENTS\.md$)/,
    testPath: /^tests\/.*\.test\.(?:ts|tsx|js|jsx)$/,
    ciRuleSource: '.github/workflows/pr-automation.yml',
  },
  commitMsg: {
    badSubjects:
      /^(fixes|fixed|stims|various fixes|certainly this works|hopefully works|hopefully|it works|works now|wip)$/i,
    badSubjectHint:
      'Describe what changed and why. "certainly this works" / "fixes" / "Various fixes" gave no signal and preceded repeated fix flurries.',
  },
});
