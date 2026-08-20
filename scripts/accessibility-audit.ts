#!/usr/bin/env bun

/**
 * Accessibility & Optimization Audit
 * Walks the DOM to detect common WCAG issues across home and panel states.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from 'playwright';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5173';
const OUTPUT_DIR = 'tests/accessibility';

type IssueSeverity = 'lifecycle' | 'usability' | 'critical';

interface Issue {
  type: string;
  severity: IssueSeverity;
  element: string;
  selector?: string;
  attributes?: string;
  src?: string;
  suggestion: string;
  state: string;
}

interface LinkInfo {
  text: string;
  href: string;
}

/**
 * axe-core over the same states the hand-written checks walk.
 *
 * The bespoke checks below encode product-specific rules (canvas fallbacks,
 * live-region usage on the stage) that no generic engine knows about, and
 * they stay. What they cannot do is keep up with the ARIA spec: this codebase
 * shipped a `role="listbox"` containing a non-`option` button, and
 * `aria-setsize` on a `role="button"`, within one week — both default axe
 * rules (`aria-required-children`, `aria-allowed-attr`), both caught late by
 * reading rather than by CI. For a product whose accessibility posture is a
 * differentiator (flash safety, reduced motion, roving tabindex throughout),
 * "asserted in CI" is a stronger claim than "we were careful".
 *
 * Scoped to the app shell: the visualizer canvas is a `<canvas>` with a
 * text alternative and no internal semantics for axe to inspect, and colour
 * contrast cannot be judged against arbitrary moving artwork behind
 * translucent chrome — that is what the WCAG 2.3.1 flash audit is for.
 */
async function runAxeChecks(page: Page, stateName: string): Promise<Issue[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .disableRules([
      // Judged per-frame by scripts/analyze-preset-flash.ts instead; axe
      // would sample one arbitrary frame of a live shader and report noise.
      'color-contrast',
      // CodeMirror 6 puts tabindex="-1" on .cm-scroller and keeps the
      // focusable control on .cm-content inside it, which is what actually
      // handles arrow-key scrolling. axe sees only a scrollable element it
      // cannot tab to. Verified by keyboard: focus lands on .cm-content and
      // arrows scroll the document.
      'scrollable-region-focusable',
    ])
    .analyze();

  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      type: `axe:${violation.id}`,
      // axe's own impact scale mapped onto this report's three tiers, so a
      // violation can fail the run the same way a hand-written check does.
      severity: (violation.impact === 'critical' ||
      violation.impact === 'serious'
        ? 'lifecycle'
        : 'usability') as IssueSeverity,
      element: node.html.slice(0, 200),
      selector: node.target.join(' '),
      attributes: violation.help,
      suggestion: `${violation.description} (${violation.helpUrl})`,
      state: stateName,
    })),
  );
}

function runDomChecks(stateName: string) {
  const issues: Issue[] = [];
  const hiddenSelector = '[aria-hidden="true"]';

  function getSelector(element: Element): string {
    return element.getAttribute('class') || element.tagName.toLowerCase();
  }

  function isHidden(element: Element): boolean {
    return element.closest(hiddenSelector) !== null;
  }

  // Check 1: Meaningful images missing alt
  const images = document.querySelectorAll('img');
  images.forEach((img) => {
    if (img.hasAttribute('alt') || isHidden(img)) return;

    issues.push({
      type: 'images-missing-alt',
      severity: 'lifecycle',
      element: img.tagName.toLowerCase(),
      selector: getSelector(img),
      src: img.src?.split('/').pop() || '',
      suggestion:
        'Add alt text, or alt="" with aria-hidden="true" if purely decorative',
      state: stateName,
    });
  });

  // Check 2: Buttons without accessible names
  const buttons = document.querySelectorAll<HTMLElement>(
    'button, [role="button"]',
  );
  buttons.forEach((btn) => {
    if (isHidden(btn)) return;
    const text = btn.textContent?.trim();
    const ariaLabel = btn.getAttribute('aria-label');
    const ariaLabelledby = btn.getAttribute('aria-labelledby');

    if (!text && !ariaLabel && !ariaLabelledby) {
      issues.push({
        type: 'button-name',
        severity: 'lifecycle',
        element: btn.tagName.toLowerCase(),
        selector: getSelector(btn),
        suggestion: 'Add text content, aria-label, or aria-labelledby',
        state: stateName,
      });
    }
  });

  // Check 3: Form inputs missing labels
  const inputs = document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input, select, textarea');
  inputs.forEach((input) => {
    if (isHidden(input)) return;
    const inputType = input.getAttribute('type');
    if (
      inputType === 'hidden' ||
      inputType === 'submit' ||
      inputType === 'button'
    ) {
      return;
    }

    const id = input.id;
    const label = id ? document.querySelector(`label[for="${id}"]`) : null;
    const wrappedLabel = input.closest('label');
    const ariaLabel = input.getAttribute('aria-label');
    const ariaLabelledby = input.getAttribute('aria-labelledby');
    const placeholder = input.getAttribute('placeholder');

    if (
      !label &&
      !wrappedLabel &&
      !ariaLabel &&
      !ariaLabelledby &&
      !placeholder
    ) {
      issues.push({
        type: 'label',
        severity: 'lifecycle',
        element: input.tagName.toLowerCase(),
        selector: getSelector(input),
        suggestion: 'Wrap in label element or add aria-label/aria-labelledby',
        state: stateName,
      });
    }
  });

  // Check 4: Interaction targets too small
  const interactives = document.querySelectorAll<HTMLElement>(
    'a, button, [tabindex]:not([tabindex="-1"])',
  );
  interactives.forEach((el) => {
    if (isHidden(el)) return;
    const rect = el.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const isOffScreen = rect.bottom < 0 || rect.top > window.innerHeight;

    if (!isOffScreen && size > 0 && size < 24) {
      issues.push({
        type: 'target-size',
        severity: 'usability',
        element: el.tagName.toLowerCase(),
        selector: getSelector(el),
        attributes: `width=${rect.width.toFixed(0)}, height=${rect.height.toFixed(0)}`,
        suggestion:
          'Ensure interactive elements are at least 24x24px (WCAG 2.5.5 target size)',
        state: stateName,
      });
    }
  });

  // Check 5: Missing meta viewport
  const metaViewport = document.querySelector('meta[name="viewport"]');
  if (!metaViewport) {
    issues.push({
      type: 'meta-viewport',
      severity: 'critical',
      element: 'meta',
      selector: 'head',
      suggestion: 'Add meta viewport tag for proper scaling',
      state: stateName,
    });
  }

  // Check 6: Links with same text content (ambiguous)
  const links: LinkInfo[] = [];
  document.querySelectorAll('a[href]').forEach((link) => {
    if (isHidden(link)) return;

    links.push({
      text: link.textContent?.trim().toLowerCase() || '',
      href: link.getAttribute('href') || '',
    });
  });

  const textCounts = new Map<string, number>();
  links.forEach((link) => {
    if (link.text && link.text.length < 10) {
      textCounts.set(link.text, (textCounts.get(link.text) || 0) + 1);
    }
  });

  textCounts.forEach((count, text) => {
    if (count > 1) {
      issues.push({
        type: 'link-text',
        severity: 'usability',
        element: 'a',
        selector: `text="${text}"`,
        suggestion: 'Make link text descriptive to distinguish duplicates',
        state: stateName,
      });
    }
  });

  // Check 7: Duplicate IDs
  const ids = new Map<string, number>();
  document.querySelectorAll('[id]').forEach((el) => {
    if (isHidden(el)) return;
    const id = el.id;
    if (id) {
      ids.set(id, (ids.get(id) || 0) + 1);
    }
  });
  ids.forEach((count, id) => {
    if (count > 1) {
      issues.push({
        type: 'duplicate-id',
        severity: 'lifecycle',
        element: '*',
        selector: `id="${id}"`,
        suggestion:
          'Use unique id values; duplicate IDs break labels and skip links',
        state: stateName,
      });
    }
  });

  // Check 8: Empty headings
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    if (isHidden(heading)) return;
    if (!heading.textContent?.trim()) {
      issues.push({
        type: 'empty-heading',
        severity: 'lifecycle',
        element: heading.tagName.toLowerCase(),
        selector: getSelector(heading),
        suggestion: 'Provide text content for headings',
        state: stateName,
      });
    }
  });

  // Check 9: Missing h1
  const h1 = document.querySelector('h1');
  if (!h1) {
    issues.push({
      type: 'missing-h1',
      severity: 'usability',
      element: 'h1',
      selector: 'body',
      suggestion:
        'Each page should have exactly one h1 describing the main topic',
      state: stateName,
    });
  }

  // Check 10: Skip link target exists
  const skipLink = document.querySelector('a[href^="#"]');
  if (skipLink) {
    const targetId = skipLink.getAttribute('href')?.slice(1);
    if (targetId && !document.getElementById(targetId)) {
      issues.push({
        type: 'skip-link-target',
        severity: 'lifecycle',
        element: 'a',
        selector: getSelector(skipLink),
        suggestion: 'Ensure skip-link target element exists in the document',
        state: stateName,
      });
    }
  }

  // Check 11: Links opening in new window without warning
  document.querySelectorAll('a[target="_blank"]').forEach((link) => {
    if (isHidden(link)) return;
    const hasWarning =
      link.textContent?.toLowerCase().includes('new window') ||
      link.textContent?.toLowerCase().includes('external') ||
      link.getAttribute('aria-label')?.toLowerCase().includes('new window') ||
      link.getAttribute('aria-label')?.toLowerCase().includes('external');
    if (!hasWarning) {
      issues.push({
        type: 'new-window-warning',
        severity: 'usability',
        element: 'a',
        selector: getSelector(link),
        suggestion: 'Warn users when links open in a new window',
        state: stateName,
      });
    }
  });

  // Check 12: Modal dialogs missing aria-modal.
  //
  // Only *modal* ones. aria-modal defaults to false and a non-modal dialog is
  // valid ARIA — the stage-anchored editor is deliberately one, because it
  // sits beside the visualizer and leaves it interactive. Declaring
  // aria-modal="true" there would tell a screen reader the rest of the page
  // is inert when it is not, which is worse than the omission this check was
  // flagging. SidePanel encodes the distinction itself
  // (`aria-modal={stageAnchored ? undefined : 'true'}`), so trust the same
  // signal rather than assuming every dialog traps the user.
  document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
    if (isHidden(dialog)) return;
    if (dialog.getAttribute('data-stage-anchored') === 'true') return;
    if (dialog.getAttribute('aria-modal') !== 'true') {
      issues.push({
        type: 'dialog-aria-modal',
        severity: 'lifecycle',
        element: 'div',
        selector: getSelector(dialog),
        suggestion: 'Add aria-modal="true" to modal dialogs',
        state: stateName,
      });
    }
  });

  return issues;
}

async function audit() {
  console.log('🔍 Running comprehensive accessibility audit...\n');

  // Headless by default so the audit can run in CI; set HEADFUL=1 to watch
  // the run locally.
  const browser = await chromium.launch({
    headless: process.env.HEADFUL !== '1',
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    console.log(`📥 Loading ${TARGET_URL}...`);

    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });

    const timestamp = new Date().toISOString();
    mkdirSync(OUTPUT_DIR, { recursive: true });

    // Take screenshot
    await page.screenshot({
      path: join(OUTPUT_DIR, 'current-view.png'),
      fullPage: true,
    });

    const allIssues: Issue[] = [];
    // What was genuinely audited, versus what the panel list hoped for.
    const visitedStates: string[] = ['home'];
    const skippedStates: string[] = [];

    // Home state
    const homeIssues = await page.evaluate(runDomChecks, 'home');
    allIssues.push(...homeIssues);
    allIssues.push(...(await runAxeChecks(page, 'home')));

    // Panel states
    // Reached by route rather than by clicking. The old version hunted for
    // buttons by rendered text, which found only the ones that happen to be
    // on screen with a visible label — settings and the editor live behind
    // a "More actions" menu, so they were never opened, while the report
    // still listed them as audited. `?tool=<panel>` is the same state the
    // buttons produce (see url-state.ts) and does not depend on which
    // chrome is currently visible or how it is labelled.
    const panels = ['browse', 'settings', 'editor'];

    for (const panel of panels) {
      const url = new URL(TARGET_URL);
      url.searchParams.set('tool', panel);
      // `?agent=true` is required, not cosmetic: on a cold visit the boot
      // path rewrites the query to the startup preset and drops `tool`
      // entirely, so a plain `?tool=browse` lands on the home screen. Agent
      // mode preserves it — the same reason it is this repo's documented URL
      // for browser QA.
      url.searchParams.set('agent', 'true');
      await page.goto(url.toString(), {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(1200);

      // Not every tool is a sheet panel — the editor mounts as a
      // stage-anchored role="dialog" (see stageAnchoredToolOpen in App.tsx),
      // so keying on the sheet class alone would have reported it as
      // unreachable while it was in fact on screen.
      const opened = await page.evaluate(
        (name) =>
          document.querySelector(`.stims-shell__sheet-panel--${name}`) !==
            null || document.querySelector('[role="dialog"]') !== null,
        panel,
      );
      if (!opened) {
        skippedStates.push(panel);
        console.warn(`⚠️  "?tool=${panel}" did not open a panel — NOT audited.`);
        continue;
      }

      const panelIssues = await page.evaluate(runDomChecks, panel);
      allIssues.push(...panelIssues);
      allIssues.push(...(await runAxeChecks(page, panel)));
      visitedStates.push(panel);
    }

    // Deduplicate within a state, not across them. The key used to omit
    // `state`, so the same issue appearing in home and browse collapsed to
    // whichever ran first — every finding was then attributed to `home`,
    // making the report look like the panels were clean when they simply
    // had not been credited.
    const seen = new Set<string>();
    const uniqueIssues = allIssues.filter((issue) => {
      const key = `${issue.state}|${issue.type}|${issue.selector || ''}|${issue.attributes || ''}|${issue.element}|${issue.suggestion}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const majorIssues = uniqueIssues.filter((i) => i.severity === 'lifecycle');
    const minorIssues = uniqueIssues.filter((i) => i.severity === 'usability');

    if (majorIssues.length === 0) {
      console.log('✅ No critical accessibility issues found!\n');
    } else {
      console.log(
        `⚠️  Found ${majorIssues.length} critical accessibility issues:\n`,
      );
      majorIssues.forEach((issue, i) => {
        console.log(
          `${i + 1}. [${issue.type.toUpperCase()}] ${issue.state} — ${issue.selector || issue.element}`,
        );
        if (issue.attributes) {
          console.log(`   ${issue.attributes}`);
        }
        if (issue.suggestion) {
          console.log(`   Fix: ${issue.suggestion}`);
        }
        console.log('');
      });
    }

    if (minorIssues.length > 0) {
      console.log(`📋 ${minorIssues.length} additional suggestions:\n`);
      minorIssues.forEach((issue, i) => {
        console.log(
          `${i + 1}. [${issue.type.toUpperCase()}] ${issue.state} — ${issue.selector || issue.element}`,
        );
        if (issue.attributes) {
          console.log(`   ${issue.attributes}`);
        }
        if (issue.suggestion) {
          console.log(`   ${issue.suggestion}`);
        }
        console.log('');
      });
    }

    const report = {
      timestamp,
      target: TARGET_URL,
      // What was actually audited — not the wish list.
      states: visitedStates,
      skippedStates,
      total: uniqueIssues.length,
      critical: majorIssues.length,
      minor: minorIssues.length,
      issues: uniqueIssues,
    };

    writeFileSync(
      join(OUTPUT_DIR, 'report.json'),
      JSON.stringify(report, null, 2),
    );

    writeFileSync(
      join(OUTPUT_DIR, 'summary.json'),
      JSON.stringify(
        {
          timestamp,
          target: TARGET_URL,
          checklist: {
            issues: uniqueIssues.length,
            passed: majorIssues.length === 0,
            critical: majorIssues.length === 0,
          },
        },
        null,
        2,
      ),
    );

    console.log(`💾 Report saved to: ${OUTPUT_DIR}/\n`);

    if (majorIssues.length === 0) {
      console.log('🎉 All accessibility goals met!\n');
    } else {
      console.log('Next steps: Fix reported issues and re-run\n');
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Audit error: ${message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

audit();
