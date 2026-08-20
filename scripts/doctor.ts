/**
 * Diagnoses whether this machine's dev environment can build, test, and deploy
 * the visualizer.
 *
 * Reports Bun, tsc, Biome, Playwright, and Wrangler availability plus the
 * bundled MilkDrop catalog, then launches headless Chromium to classify the
 * advisory visual-verification tier (GPU vs. software rendering vs. no
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

// 5. Cloudflare Wrangler Tooling
const wrangRes = await $`./node_modules/.bin/wrangler --version`
  .nothrow()
  .text();
const wrangOk = wrangRes.length > 0;
report('Cloudflare Wrangler CLI', wrangOk, wrangRes.trim().split('\n')[0]);

// 6. Bundled Catalog Integrity
const catalogOk = await Bun.file(
  'public/milkdrop-presets/catalog.json',
).exists();
report(
  'MilkDrop Bundled Catalog',
  catalogOk,
  'public/milkdrop-presets/catalog.json',
);

// 7. Visual-verification tier (GPU vs. software rendering vs. no browser)
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
