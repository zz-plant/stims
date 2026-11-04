import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { EditorShareOffer } from '../../src/js/frontend/EditorShareOffer.tsx';
import type { MilkdropEditorSessionState } from '../../src/js/milkdrop/types.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

afterEach(() => {
  localStorage.removeItem('stims:share-offer-dismissed');
});

function mount(state: { dirty: boolean; severity?: string }, shared = false) {
  const onCopyLink = mock(() => {});
  const session = {
    source: 'title=Alpha',
    latestCompiled: null,
    activeCompiled: null,
    diagnostics: state.severity ? [{ severity: state.severity }] : [],
    dirty: state.dirty,
  } as unknown as MilkdropEditorSessionState;
  const rendered = renderWorkspace(
    <EditorShareOffer
      session={session}
      shared={shared}
      onCopyLink={onCopyLink}
    />,
  );
  const offer = () =>
    rendered.container.querySelector('[aria-label="Share this edit"]');
  return { rendered, offer, onCopyLink };
}

describe('the offer to share after an edit', () => {
  test('waits for an edit, and goes once the link is copied', () => {
    const clean = mount({ dirty: false });
    expect(clean.offer()).toBeNull();
    clean.rendered.dispose();

    const copied = mount({ dirty: true }, true);
    expect(copied.offer()).toBeNull();
    copied.rendered.dispose();
  });

  test('appears for a draft that compiles, not for a broken one', () => {
    const good = mount({ dirty: true, severity: 'warning' });
    expect(good.offer()).not.toBeNull();
    good.rendered.dispose();

    const broken = mount({ dirty: true, severity: 'error' });
    expect(broken.offer()).toBeNull();
    broken.rendered.dispose();
  });

  test('Copy link runs the copy', () => {
    const { rendered, offer, onCopyLink } = mount({ dirty: true });
    act(() => {
      offer()
        ?.querySelector<HTMLElement>('[data-action="share-after-edit"]')
        ?.click();
    });
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    rendered.dispose();
  });

  test('stays dismissed on later opens', () => {
    const first = mount({ dirty: true });
    act(() => {
      first.rendered.byLabel('Dismiss sharing tip')?.click();
    });
    expect(first.offer()).toBeNull();
    first.rendered.dispose();

    const later = mount({ dirty: true });
    expect(later.offer()).toBeNull();
    later.rendered.dispose();
  });
});
