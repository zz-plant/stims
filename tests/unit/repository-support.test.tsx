import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { RepositorySupport } from '../../src/js/frontend/RepositorySupport.tsx';
import { STIMS_REPO_URL } from '../../src/js/frontend/workspace-helpers.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

afterEach(() => {
  localStorage.removeItem('stims:repository-support-dismissed');
});

function mount() {
  const rendered = renderWorkspace(<RepositorySupport />);
  const prompt = () =>
    rendered.container.querySelector('[aria-label="Support Stims"]');
  return { rendered, prompt };
}

describe('the GitHub prompt after a share or save', () => {
  test('a fresh visitor sees a link to the repository', () => {
    const { rendered, prompt } = mount();
    const link = prompt()?.querySelector<HTMLAnchorElement>('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(STIMS_REPO_URL);
    expect(link?.getAttribute('href')).toContain('github.com/zz-plant/stims');
    rendered.dispose();
  });

  test('Dismiss removes the prompt', () => {
    const { rendered, prompt } = mount();
    act(() => {
      rendered.byLabel('Dismiss GitHub suggestion')?.click();
    });
    expect(prompt()).toBeNull();
    rendered.dispose();
  });

  test('stays hidden on a later mount once dismissed', () => {
    const first = mount();
    act(() => {
      first.rendered.byLabel('Dismiss GitHub suggestion')?.click();
    });
    first.rendered.dispose();

    const later = mount();
    expect(later.prompt()).toBeNull();
    later.rendered.dispose();
  });
});
