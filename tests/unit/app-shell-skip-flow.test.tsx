import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { StimsStageFrame } from '../../src/js/frontend/StimsStageFrame.tsx';

const frontendSource = (fileName: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', fileName),
    'utf8',
  );

const cssSource = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', '..', relativePath), 'utf8');

function renderStage(liveMode: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => {
    root.render(
      <StimsStageFrame
        liveMode={liveMode}
        stageRef={createRef<HTMLDivElement | null>()}
      >
        {null}
      </StimsStageFrame>,
    );
  });
  return { host, root };
}

describe('launch shell skip-to-visualizer flow', () => {
  let mounted: { host: HTMLElement; root: Root } | null = null;

  afterEach(() => {
    mounted?.root.unmount();
    mounted?.host.remove();
    mounted = null;
  });

  test('the stage renders a focusable skip target the shell anchor points at', () => {
    // The stage half is the real component: the skip target must exist, be
    // programmatically focusable, and carry the id the anchor names. The
    // anchor half stays a source read — App.tsx is the whole shell and does
    // not mount in this suite — but the id is asserted against the RENDERED
    // element, so the two cannot drift apart without one side failing.
    mounted = renderStage(false);
    const target = mounted.host.querySelector('#stims-visualizer');
    expect(target).not.toBeNull();
    expect(target?.getAttribute('tabindex')).toBe('-1');

    const appSource = frontendSource('App.tsx');
    expect(appSource).toContain(
      '<a href="#stims-visualizer" className="skip-link">',
    );
    expect(appSource).toContain('Skip to visualizer');
  });

  test('keeps launch hero dismissal tied to live data-mode transitions', () => {
    // The attribute half renders the real component in both modes; the CSS
    // half stays a source read because this suite computes no styles.
    mounted = renderStage(false);
    const frame = () =>
      mounted?.host.querySelector('.stims-shell__stage-frame');
    expect(frame()?.getAttribute('data-mode')).toBe('home');
    mounted.root.unmount();
    mounted.host.remove();

    mounted = renderStage(true);
    expect(frame()?.getAttribute('data-mode')).toBe('live');

    const shellCss = cssSource('src/css/app-shell.css');
    expect(shellCss).toContain(
      '.stims-shell__stage-frame[data-mode="live"] .stims-shell__launch',
    );
    expect(shellCss).toContain('pointer-events: none;');
    expect(shellCss).toContain('visibility: hidden;');
  });
});
