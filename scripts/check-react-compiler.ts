/**
 * Fails when a component or hook under `src/` stops compiling with React Compiler.
 *
 * Both Vite configs run `react({ compiler: true })`. The compiler skips any
 * function it cannot prove follows the Rules of React, silently: the app
 * still works, it just loses the memoization. Four files slipped out between
 * two hand-run censuses in November (#1540), each on the same pattern, and
 * nothing noticed for weeks. This runs the compiler over every `.ts` and
 * `.tsx` file in `src/` with diagnostics on, which takes about half a second.
 *
 *   bun run check:react-compiler
 *
 * A file that reports a diagnostic fails unless `KNOWN_BAILOUTS` lists it with a
 * reason. A listed file that now compiles cleanly also fails, so the list can
 * only shrink: delete its entry. The usual fixes:
 *
 * - "Cannot reassign variable after render completes": an effect-local `let`
 *   that a later callback reassigns. Hold it in an object, or use an
 *   `AbortController` for a cancelled flag.
 * - "Cannot access refs during render": move the ref write into an effect.
 * - "Handle Import expressions": move the `import()` to a module-scope loader.
 */
import { globSync, readFileSync } from 'node:fs';
import { transformSync } from 'oxc-transform-react';

const KNOWN_BAILOUTS: Record<string, string> = {
  'src/js/frontend/BrowsePresetList.tsx':
    "By design (#1577): isolates TanStack Virtual's useVirtualizer, which the compiler cannot memoize safely.",
  'src/js/frontend/PresetGrid.tsx':
    'By design: uses useVirtualizer, like BrowsePresetList.',

  // Open debt in #1540, enumerated so it cannot grow silently.
  'src/js/frontend/audio-signal-state.ts': 'DEBT: reassigned local.',
  'src/js/frontend/workspace-hooks.ts':
    'DEBT: import(), try/finally, reassigned local, refs during render.',
  'src/js/frontend/workspace-shell-hooks.ts':
    'DEBT: import(), try/finally, throw inside try, reassigned local.',
  'src/js/frontend/workspace-youtube-preview.ts':
    'DEBT: try/finally, throw inside try.',
  'src/js/frontend/hooks/use-agent-state-install.ts':
    'DEBT: refs during render (the agent bridge reads refs by design).',
  'src/js/frontend/hooks/use-catalog-loading.ts': 'DEBT: import().',
  'src/js/frontend/hooks/use-compass-midi.ts':
    'DEBT: reassigned local, ref written during render.',
  'src/js/frontend/hooks/use-escape-handler.ts':
    'DEBT: ref written during render.',
  'src/js/frontend/hooks/use-media-session.ts': 'DEBT: refs during render.',
  'src/js/frontend/hooks/use-performance-hardware.ts':
    'DEBT: import(), refs during render.',
  'src/js/frontend/hooks/use-preset-previews.ts':
    'DEBT: import(), refs during render.',
  'src/js/frontend/hooks/use-shared-launch.ts': 'DEBT: refs during render.',
  'src/js/frontend/hooks/use-two-step-confirm.ts': 'DEBT: refs during render.',
  'src/js/frontend/hooks/use-voice-vj.ts':
    'DEBT: latest-value refs written during render.',
  'src/js/frontend/hooks/useAutoHideActivity.ts': 'DEBT: refs during render.',
  'src/js/frontend/hooks/useKeyboardShortcuts.ts': 'DEBT: refs during render.',
  'src/js/frontend/hooks/usePictureInPicture.ts': 'DEBT: refs during render.',
  'src/js/frontend/hooks/useStageGesture.ts':
    'DEBT: reassigned local, refs written during render.',
};

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

const newBailouts: string[] = [];
const nowClean: string[] = [];

for (const path of globSync('src/**/*.{ts,tsx}').sort()) {
  const source = readFileSync(path, 'utf8');
  const result = transformSync(path, source, {
    lang: path.endsWith('.tsx') ? 'tsx' : 'ts',
    reactCompiler: { reportDiagnostics: true },
  });
  const errors = result.errors ?? [];
  const known = path in KNOWN_BAILOUTS;
  if (errors.length === 0) {
    if (known) nowClean.push(path);
    continue;
  }
  if (known) continue;
  for (const error of errors) {
    const label = error.labels?.[0];
    const where = label ? `:${lineOf(source, label.start)}` : '';
    newBailouts.push(`${path}${where} — ${error.message.split('\n')[0]}`);
  }
}

if (newBailouts.length > 0) {
  console.error('React Compiler skips code in these files:');
  for (const line of newBailouts) console.error(`  ${line}`);
  console.error(
    '\nFix the pattern (see the docblock in scripts/check-react-compiler.ts),',
  );
  console.error('or list the file in KNOWN_BAILOUTS with a reason.');
}
if (nowClean.length > 0) {
  console.error(
    'These files compile cleanly now; delete their KNOWN_BAILOUTS entry:',
  );
  for (const path of nowClean) console.error(`  ${path}`);
}
if (newBailouts.length > 0 || nowClean.length > 0) process.exit(1);
console.log(
  'React Compiler: every component and hook compiles, apart from the listed exceptions.',
);
