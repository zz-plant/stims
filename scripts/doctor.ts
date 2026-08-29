/**
 * Diagnoses whether this machine's dev environment can build, test, and deploy
 * the visualizer.
 *
 * Reports Bun, tsc, Biome, Playwright, and Wrangler availability, whether
 * node_modules still matches the manifests, and the bundled MilkDrop catalog,
 * then resolves the Chromium binary and launches headless Chromium to classify
 * the advisory visual-verification tier (GPU vs. software rendering vs. no
 * browser). Exits non-zero when any counted check fails.
 */
import { $ } from 'bun';

console.log('🩺 Running Stims Dev Environment Doctor...\n');

let checksPassed = 0;
let totalChecks = 0;

function report(name: string, ok: boolean, details?: string) {
  totalChecks++;
  if (ok) {
    checksPassed++;
    console.log(`  ✅ ${name}${details ? ` (${details})` : ''}`);
  } else {
    console.error(`  ❌ ${name}${details ? ` (${details})` : ''}`);
  }
}

// 1. Bun Runtime
const bunVer = Bun.version;
const bunOk = !!bunVer;
report('Bun Runtime', bunOk, `v${bunVer}`);

// 2. TypeScript Compiler
const tscRes = await $`./node_modules/.bin/tsc --version`.nothrow().text();
const tscOk = tscRes.includes('Version');
report('TypeScript Compiler', tscOk, tscRes.trim());

// 3. Biome Linter
const biomeRes = await $`./node_modules/.bin/biome --version`.nothrow().text();
const biomeOk = biomeRes.includes('2.');
report('Biome Linter/Formatter', biomeOk, biomeRes.trim());

// 4. Playwright Browser
const pwOk = await Bun.file('node_modules/playwright/package.json').exists();
report('Playwright Test Harness', pwOk, pwOk ? 'installed' : 'missing');

// 4b. Chromium binary. The package being installed says nothing about whether
// a browser exists: remote containers ship one via PLAYWRIGHT_BROWSERS_PATH
// (so `playwright install` is wrong there), while a fresh local clone has the
// package and no binary. Advisory — a browserless box is an environment fact,
// and check 7 below classifies what still works there.
let chromiumStatus = 'unknown (Playwright package missing)';
if (pwOk) {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const suffix = browsersPath
    ? ` via PLAYWRIGHT_BROWSERS_PATH=${browsersPath}`
    : '';
  try {
    const { chromium } = await import('playwright');
    const executable = chromium.executablePath();
    chromiumStatus = (await Bun.file(executable).exists())
      ? `${executable}${suffix}`
      : `missing — expected at ${executable}${suffix}; run 'bun run setup:browsers' to link a pre-installed build, or 'bunx playwright install chromium' where downloads are allowed`;
  } catch (error) {
    chromiumStatus = `unresolvable (${(error as Error).message.split('\n')[0]})${suffix}`;
  }
}
console.log(`  🌐 Chromium binary: ${chromiumStatus}`);

// 5. Cloudflare Wrangler Tooling
const wrangRes = await $`./node_modules/.bin/wrangler --version`
  .nothrow()
  .text();
const wrangOk = wrangRes.length > 0;
report('Cloudflare Wrangler CLI', wrangOk, wrangRes.trim().split('\n')[0]);

// 6. Dependency install freshness. A node_modules tree that predates a
// package.json/bun.lock or Bun change is the most common source of
// inexplicable failures, and it looks identical to a healthy one. Reuse the
// setup script's own fingerprint rather than reimplementing it here.
const setupStatus = await $`bash scripts/codex-setup.sh --status`
  .nothrow()
  .text();
const installLine =
  setupStatus
    .split('\n')
    .find((line) => line.startsWith('- Dependency install:'))
    ?.replace('- Dependency install:', '')
    .trim() ?? 'unknown';
// `uncached` means node_modules exists but was installed outside the setup
// script (a plain `bun install`), so there is nothing to contradict — only
// states that positively disagree with the manifests count as failures.
report(
  'Dependency install state',
  installLine.startsWith('current') || installLine.startsWith('uncached'),
  installLine,
);

// 7. Bundled Catalog Integrity
const catalogOk = await Bun.file(
  'public/milkdrop-presets/catalog.json',
).exists();
report(
  'MilkDrop Bundled Catalog',
  catalogOk,
  'public/milkdrop-presets/catalog.json',
);

// 8. Visual-verification tier (GPU vs. software rendering vs. no browser)
//
// Advisory only — doesn't count toward checksPassed/totalChecks, since
// missing a GPU is an environment fact, not a broken setup. Tells an agent
// which tier of `docs/agents/visual-testing.md` applies here before it
// wastes a capture on a black canvas.
let visualTier = 'lab:reactivity only (no browser)';
if (pwOk) {
  try {
    const { chromium } = await import('playwright');
    const { resolveAgentChromiumArgs } = await import('./browser-launch.ts');
    const browser = await chromium.launch({
      headless: true,
      args: resolveAgentChromiumArgs(),
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const renderer = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      return String(gl.getParameter(param));
    });
    await browser.close();
    if (renderer) {
      const isSoftware = /swiftshader|llvmpipe|software/i.test(renderer);
      visualTier = isSoftware
        ? `headless Chromium + software rendering (${renderer}) — bun run lab:visual / ctl / mcp work, set STIMS_GPU_RENDER=1 to try hardware`
        : `headless Chromium + GPU (${renderer}) — full lab:visual / ctl / mcp / sweep tooling available`;
    } else {
      visualTier =
        'headless Chromium launches but WebGL is unavailable — text-only tools only (lab:reactivity)';
    }
  } catch (error) {
    visualTier = `headless Chromium failed to launch (${(error as Error).message.split('\n')[0]}) — text-only tools only (lab:reactivity)`;
  }
}
console.log(`  🖥️  Visual-verification tier: ${visualTier}`);

console.log(
  `\nDiagnosis: ${checksPassed}/${totalChecks} checks passed cleanly.`,
);

if (checksPassed < totalChecks) {
  process.exit(1);
}
