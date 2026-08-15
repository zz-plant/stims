import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(
  join(import.meta.dir, '..', '..', 'src', 'css', 'base.css'),
  'utf8',
);

const runningStageRule = css.match(
  /\.active-toy-container\[data-transition-state="running"\] \.active-toy-stage \{([^}]*)\}/,
)?.[1];

describe('preset stage transition visual contract', () => {
  test('promotes only compositor-friendly properties while running', () => {
    expect(runningStageRule).toBeDefined();
    expect(runningStageRule).toContain('opacity 320ms ease');
    expect(runningStageRule).toContain('transform 320ms ease');
    expect(runningStageRule).toContain('will-change: opacity, transform');
    expect(runningStageRule).not.toContain('filter');
  });

  test('does not filter the incoming or outgoing live WebGL stage', () => {
    const stageTransitionRules = css.slice(
      css.indexOf(
        '.active-toy-container[data-transition-state="loading"] .active-toy-stage',
      ),
      css.indexOf('.active-toy-status'),
    );

    expect(stageTransitionRules).not.toContain('filter:');
    expect(stageTransitionRules).not.toContain('blur(');
  });

  test('releases the layer hint when reduced motion disables the transition', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.active-toy-container\[data-transition-state="running"\] \.active-toy-stage \{\s*transition: none;\s*will-change: auto;/,
    );
  });
});
