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

console.log(
  `\nDiagnosis: ${checksPassed}/${totalChecks} checks passed cleanly.`,
);

if (checksPassed < totalChecks) {
  process.exit(1);
}
