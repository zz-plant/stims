#!/usr/bin/env bun
/**
 * Accessibility & Optimization Audit
 * Walks the DOM to detect common WCAG issues
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TARGET_URL = 'http://localhost:5173';
const OUTPUT_DIR = 'tests/accessibility';

async function audit() {
  console.log('🔍 Running comprehensive accessibility audit...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US'
  });

  const page = await context.newPage();

  try {
    console.log(`📥 Loading ${TARGET_URL}...`);

    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });

    const timestamp = new Date().toISOString();
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Take screenshot
    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'current-view.png'),
      fullPage: true
    });

    // Run accessibility checks via page.evaluate
    const results = await page.evaluate(() => {
      const issues: any[] = [];

      // Check 1: Missing fallback for images
      const images = document.querySelectorAll('img');
      images.forEach((img) => {
        if (!img.alt) {
          issues.push({
            type: 'images-missing-alt',
            severity: 'lifecycle',
            element: img.tagName.toLowerCase(),
            attributes: 'alt, src',
            suggestion: 'Add alt text for screen readers'
          });
        }
      });

      // Check 2: Buttons without accessible names
      const buttons = document.querySelectorAll('button, [role="button"]');
      (buttons as any as HTMLElement[]).forEach((btn: any) => {
        const text = btn.textContent?.trim();
        const ariaLabel = btn.getAttribute('aria-label');
        const ariaLabelledby = btn.getAttribute('aria-labelledby');

        if (!text && !ariaLabel && !ariaLabelledby) {
          issues.push({
            type: 'button-name',
            severity: 'lifecycle',
            element: btn.tagName.toLowerCase(),
            attributes: 'aria-label, aria-labelledby',
            suggestion: 'Add text content, aria-label, or aria-labelledby'
          });
        }
      });

      // Check 3: Form inputs missing labels
      const inputs = document.querySelectorAll('input, select, textarea');
      (inputs as any as HTMLElement[]).forEach((input: any) => {
        if (input.type !== 'hidden' && input.type !== 'submit' && input.type !== 'button') {
          const id = input.id;
          const label = id ? document.querySelector(`label[for="${id}"]`) : null;
          const ariaLabel = input.getAttribute('aria-label');
          const ariaLabelledby = input.getAttribute('aria-labelledby');

          if (!label && !ariaLabel && !ariaLabelledby) {
            issues.push({
              type: 'label',
              severity: 'lifecycle',
              element: input.tagName.toLowerCase(),
              attributes: 'aria-label, aria-labelledby',
              suggestion: 'Wrap in label element or add aria-label/aria-labelledby'
            });
          }
        }
      });

      // Check 4: Interaction targets too small
      const interactives = document.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])');
      interactives.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);

        if (size < 24) {
          issues.push({
            type: 'target-size',
            severity: 'usability',
            element: el.tagName.toLowerCase(),
            attributes: `width=${rect.width.toFixed(0)}, height=${rect.height.toFixed(0)}`,
            suggestion: 'Ensure interactive elements are at least 24x24px'
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
          attributes: 'viewport',
          suggestion: 'Add meta viewport tag for proper scaling'
        });
      }

      // Check 6: Links with same text content (ambiguous)
      const links: any[] = [];
      document.querySelectorAll('a[href]').forEach((link) => {
        links.push({
          text: link.textContent?.trim().toLowerCase() || '',
          href: link.getAttribute('href') || ''
        });
      });

      const textCounts = new Map<string, number>();
      links.forEach((link) => {
        if (link.text) {
          textCounts.set(link.text, (textCounts.get(link.text) || 0) + 1);
        }
      });

      textCounts.forEach((count, text) => {
        if (count > 1 && text.length < 10) {
          issues.push({
            type: 'link-text',
            severity: 'usability',
            element: 'a',
            attributes: `text="${text}"`,
            suggestion: 'Make link text descriptive to distinguish duplicates'
          });
        }
      });

      return issues;
    });

    // Limit output for non-critical issues
    const majorIssues = results.filter((i: any) =>
      i.severity === 'critical' || i.severity === 'lifecycle'
    );
    const minorIssues = results.filter((i: any) =>
      i.severity !== 'critical' && i.severity !== 'lifecycle'
    );

    if (majorIssues.length === 0) {
      console.log('✅ No critical accessibility issues found!\n');
    } else {
      console.log(`⚠️  Found ${majorIssues.length} critical accessibility issues:\n`);
      majorIssues.forEach((issue: any, i: number) => {
        console.log(`${i + 1}. [${issue.type.toUpperCase()}]`);

        if (issue.element) {
          console.log(`   Element: <${issue.element}>`);
        }

        if (issue.attributes) {
          console.log(`   Attributes: ${issue.attributes}`);
        }

        if (issue.suggestion) {
          console.log(`   Fix: ${issue.suggestion}`);
        }
        console.log('');
      });
    }

    if (minorIssues.length > 0) {
      console.log(`📋 ${minorIssues.length} additional suggestions (watch-only):\n`);
      minorIssues.forEach((issue: any, i: number) => {
        console.log(`${i + 1}. [${issue.type.toUpperCase()}]`);
        if (issue.element) {
          console.log(`   Element: <${issue.element}>`);
        }
        if (issue.suggestion) {
          console.log(`   ${issue.suggestion}`);
        }
        console.log('');
      });
    }

    // Save report
    const report = {
      timestamp,
      target: TARGET_URL,
      total: results.length,
      critical: majorIssues.length,
      minor: minorIssues.length,
      issues: results
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'report.json'),
      JSON.stringify(report, null, 2)
    );

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'summary.json'),
      JSON.stringify({
        timestamp,
        target: TARGET_URL,
        checklist: {
          issues: results.length,
          passed: majorIssues.length === 0,
          critical: majorIssues.length === 0
        }
      }, null, 2)
    );

    console.log(`💾 Report saved to: ${OUTPUT_DIR}/\n`);

    if (majorIssues.length === 0) {
      console.log('🎉 All accessibility goals met!\n');
    } else {
      console.log('Next steps: Fix critical issues and re-run\n');
    }

  } catch (error: any) {
    console.error(`❌ Audit error: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

audit();