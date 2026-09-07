import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SidePanel } from '../../src/js/frontend/SidePanel.tsx';

describe('Workspace shell stage tool interaction regression', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  function renderPanel(stageAnchored: boolean) {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <SidePanel
          open
          onClose={() => {}}
          title="Editor"
          stageAnchored={stageAnchored}
        >
          <p>panel body</p>
        </SidePanel>,
      );
    });
    // The backdrop div is the aria-hidden click-to-dismiss layer; the panel
    // itself is a dialog, so counting aria-hidden overlay divs isolates it.
    return host.querySelectorAll('div[aria-hidden="true"][data-exiting]')
      .length;
  }

  test('a stage-anchored panel renders no backdrop overlay', () => {
    // The regression: the editor is stage-anchored — the user edits while
    // watching the visuals react — and a full-screen backdrop between them
    // blocked every stage interaction. Rendered both ways so the probe is
    // proven live: the ordinary sheet DOES have its dismiss backdrop.
    expect(renderPanel(false)).toBe(1);
    act(() => root?.unmount());
    host?.remove();
    expect(renderPanel(true)).toBe(0);
  });

  test('App anchors the editor panel to the stage', () => {
    // The wiring half: which panel id gets stageAnchored. App does not mount
    // in this suite, so this stays a source read — but the behaviour the flag
    // controls is asserted on the rendered SidePanel above, so the two cannot
    // drift apart silently.
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    expect(appSource).toMatch(
      /stageAnchoredToolOpen =[\s\S]*?routeState\.panel === 'editor'/u,
    );
    expect(appSource).toContain('stageAnchored={stageAnchoredToolOpen}');
  });
});
