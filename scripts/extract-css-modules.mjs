#!/usr/bin/env node
/**
 * Safe CSS modularization by boundary extraction WITHOUT headers
 * Modules are extracted side-by-side with app-shell.css for comparison
 */

import fs from 'node:fs';

const BOUNDARIES = {
  'shell-root-variables.css': [1, 11],
  'shell-body-layout.css': [13, 42],
  'shell-scope-base.css': [44, 101],
  'shell-logo-typography.css': [103, 137],
  'shell-buttons-pills.css': [139, 215],
  'shell-layout-grid.css': [216, 340],
  'shell-sheets.css': [341, 500],
  'shell-stage-hero.css': [501, 661],
  'shell-stage-dock.css': [662, 823],
  'shell-sheet-body.css': [824, 985],
  'shell-mobile-dock.css': [986, 1147],
  'shell-panel-collections.css': [1148, 1264],
  'shell-actions.css': [1265, 1430],
  'shell-skeleton-loading.css': [1431, 1530],
  'shell-toast-animations.css': [1531, 1691],
  'shell-frame-chrome.css': [1692, 1850],
  'shell-home-preview.css': [1851, 2010],
  'shell-card-grid.css': [2011, 2150],
  'shell-breadcrumbs.css': [2151, 2230],
  'shell-confirm-dialog.css': [2231, 2320],
  'shell-skip-link.css': [2321, 2355],
  'shell-scroll-behavior.css': [2356, 2410],
  'shell-touch-targets.css': [2411, 2480],
  'shell-helpers.css': [2481, 3659],
};

try {
  const content = fs.readFileSync('assets/css/app-shell.css', 'utf-8');
  const lines = content.split('\n');

  if (!fs.existsSync('assets/css/shell')) {
    fs.mkdirSync('assets/css/shell', { recursive: true });
  }

  let success = 0,
    options = 0;

  Object.entries(BOUNDARIES).forEach(([name, [start, end]]) => {
    try {
      const module = lines.slice(start - 1, end).join('\n');
      fs.writeFileSync(`assets/css/shell/${name}`, module);
      success++;
    } catch (e) {
      console.log(`⚠️  ${name} failed: ${e.message}`);
      options++;
    }
  });

  console.log(`Done: ${success} files extracted, ${options} issues\n`);
  console.log('Modules now in: assets/css/shell/');
  console.log('Original file: assets/css/app-shell.css (still active)');
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exit(1);
}
