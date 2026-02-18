import { beforeEach, describe, expect, test } from 'bun:test';

import { initOpportunitySignals } from '../assets/js/utils/init-opportunity-signals.ts';

describe('opportunity signal interactions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('stims:growth-lab-enabled', '1');
    document.body.innerHTML = `
      <div data-opportunity-signals>
        <select data-opportunity-priority-select>
          <option value="creator-mode" selected>Creator mode</option>
          <option value="partnership-licensing">Partnership licensing</option>
        </select>
        <button type="button" data-opportunity-action="interest">Cast priority vote</button>
        <a href="https://github.com/zz-plant/stims/discussions/new" data-opportunity-action="contact">Share your use case</a>

        <select data-segment-select>
          <option value="experiential-installations" selected>Experiential</option>
          <option value="wellness-focus-environments">Wellness</option>
        </select>
        <button type="button" data-segment-action="preview">Mark segment priority</button>
        <a href="https://github.com/zz-plant/stims/discussions/new" data-segment-action="contact">Discuss a pilot</a>
        <p data-segment-outcome></p>

        <p data-opportunity-summary></p>
      </div>
    `;
  });

  test('records selected priority vote and updates summary copy', () => {
    initOpportunitySignals();

    const button = document.querySelector<HTMLButtonElement>(
      '[data-opportunity-action="interest"]',
    );
    const summary = document.querySelector<HTMLElement>(
      '[data-opportunity-summary]',
    );

    expect(button).not.toBeNull();
    button?.click();

    expect(button?.textContent).toContain('Vote recorded');
    expect(summary?.textContent).toContain('server endpoint');
  });

  test('keeps panel hidden when growth lab mode is disabled', () => {
    window.localStorage.removeItem('stims:growth-lab-enabled');
    const panel = document.querySelector<HTMLElement>(
      '[data-opportunity-signals]',
    );

    initOpportunitySignals();

    expect(panel?.hasAttribute('hidden')).toBe(true);
  });

  test('updates discussion draft URL to match selected track', () => {
    initOpportunitySignals();

    const select = document.querySelector<HTMLSelectElement>(
      '[data-opportunity-priority-select]',
    );
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-opportunity-action="contact"]',
    );

    expect(link).not.toBeNull();
    if (select) select.value = 'partnership-licensing';
    select?.dispatchEvent(new window.Event('change', { bubbles: true }));

    const href = link?.getAttribute('href') ?? '';
    expect(href).toContain('Interest%3A+Partnership+licensing');
  });

  test('shows concise prioritized outcome for selected segment and segment draft URL', () => {
    initOpportunitySignals();

    const preview = document.querySelector<HTMLButtonElement>(
      '[data-segment-action="preview"]',
    );
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-segment-action="contact"]',
    );
    const outcome = document.querySelector<HTMLElement>(
      '[data-segment-outcome]',
    );
    const segmentSelect = document.querySelector<HTMLSelectElement>(
      '[data-segment-select]',
    );

    if (segmentSelect) segmentSelect.value = 'wellness-focus-environments';
    segmentSelect?.dispatchEvent(new window.Event('change', { bubbles: true }));
    preview?.click();

    expect(outcome?.textContent).toContain('P1:');
    expect(outcome?.textContent).toContain('Unlocks');
    expect(link?.href ?? '').toContain(
      'Pilot+interest%3A+Wellness+%2F+focus+environments',
    );
  });
});
