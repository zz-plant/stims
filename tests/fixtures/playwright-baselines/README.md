# Playwright baseline snapshots

This directory stores canonical, reviewable Playwright baseline images that are intentionally committed.

## Policy

- Keep exactly **one authoritative image per scenario**.
- Use stable, scenario-focused file names (for example `holy-mobile-shell.png`).
- Replace baseline files in place when intentionally updating expected visuals.
- Keep transient run output in `output/playwright/` (gitignored), not here.
