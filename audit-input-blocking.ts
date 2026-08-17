/**
 * Temporary audit: measure how long user input is blocked during page load.
 * Records the full-screen splash window, long tasks, and what element actually
 * receives early pointer events.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

function serveDist() {
  const server = createServer((req, res) => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    let file = normalize(join('dist', path));
    if (!file.startsWith('dist')) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, 'index.html');
    }
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise<{ port: number; stop: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve({ port: address.port, stop: () => server.close() });
      }
    });
  });
}

const distServer = await serveDist();
const url = `http://127.0.0.1:${distServer.port}`;

const INIT = `
  try {
  const timestamps = (window.__audit = {
    navStart: performance.timeOrigin,
    domContentLoaded: 0,
    load: 0,
    overlayHidden: null,
    shellMounted: null,
    longTasks: [],
    earlyPointerTargets: [],
    firstInput: null,
  });
  document.addEventListener('DOMContentLoaded', () => {
    timestamps.domContentLoaded = performance.now();
  });
  window.addEventListener('load', () => {
    timestamps.load = performance.now();
  });
  if ('PerformanceObserver' in window) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          timestamps.longTasks.push({
            start: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  }
  const overlay = () => document.getElementById('stims-loading');
  const watchOverlay = () => {
    const el = overlay();
    if (!el) return;
    if (el.hidden && timestamps.overlayHidden === null) {
      timestamps.overlayHidden = performance.now();
    }
    if (!el.dataset.auditObserved) {
      el.dataset.auditObserved = '1';
      new MutationObserver(() => {
        if (el.hidden && timestamps.overlayHidden === null) {
          timestamps.overlayHidden = performance.now();
        }
      }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    }
  };
  const watchBody = () => {
    if (!document.body) return;
    new MutationObserver(() => {
      if (document.getElementById('stims-main') && timestamps.shellMounted === null) {
        timestamps.shellMounted = performance.now();
      }
      watchOverlay();
    }).observe(document.body, { childList: true, subtree: true });
  };
  watchOverlay();
  if (document.body) watchBody();
  else document.addEventListener('DOMContentLoaded', watchBody, { once: true });
  document.addEventListener('pointerdown', (e) => {
    const target = e.target;
    const cls =
      typeof target.className === 'string'
        ? target.className.split(' ').slice(0, 2).join('.')
        : target.tagName;
    timestamps.earlyPointerTargets.push({
      at: Math.round(performance.now()),
      cls,
    });
  }, true);
  document.addEventListener('pointerdown', () => {
    if (timestamps.firstInput === null) timestamps.firstInput = performance.now();
  }, true);
  } catch (e) { window.__auditError = String(e); }
`;

async function runAudit({ cpuThrottle }: { cpuThrottle: number }) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page).catch(() => null);
  if (cdp) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  } else if (cpuThrottle > 1) {
    console.log('  (no CDP session; CPU throttle skipped)');
  }
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('vite')) return;
    if (m.type() === 'error' || m.type() === 'warning') {
      console.log(`  [page:${m.type()}]`, t.slice(0, 200));
    }
  });

  const t0 = Date.now();
  await page.goto(`${url}/?agent=true&renderer=webgl`, {
    waitUntil: 'commit',
  });
  const commitMs = Date.now() - t0;

  // Instrument after commit but before the body-end module script runs: the
  // module is async and mounts the shell ~600ms later, so this lands first.
  await page.addScriptTag({ content: INIT });

  // Probe real pointer hit-testing during the load window, before and around
  // first shell mount. page.mouse.click is raw (no actionability wait).
  const probes = [100, 300, 600, 1000, 2000, 4000];
  for (const offset of probes) {
    const at = offset - probes[0];
    await page.waitForTimeout(at === 0 ? 100 : offset - (probes[probes.indexOf(offset) - 1] ?? 0));
    await page.mouse.click(640, 400);
  }

  // Wait for the shell to mount and overlay to clear.
  try {
    await page.waitForFunction(
      () => (window as any).__audit?.shellMounted ?? false,
      undefined,
      { timeout: 30000 },
    );
  } catch (error) {
    const diag = await page.evaluate(() => ({
      audit: (window as any).__audit,
      auditError: (window as any).__auditError ?? null,
      hasMain: !!document.getElementById('stims-main'),
      hasApp: !!document.getElementById('app'),
      bodyChildren: document.body?.childElementCount ?? -1,
      overlayHidden: document.getElementById('stims-loading')?.hidden ?? null,
    }));
    console.log('DIAG', JSON.stringify(diag, null, 2));
    throw error;
  }
  await page.waitForTimeout(500);

  const data = await page.evaluate(() => (window as any).__audit);
  await browser.close();
  return { cpuThrottle, commitMs, data };
}

for (const rate of [1, 4]) {
  const { cpuThrottle, commitMs, data } = await runAudit({
    cpuThrottle: rate,
  });
  console.log(`\n=== CPU throttle ${cpuThrottle}x ===`);
  console.log(`commit ~${commitMs}ms after navigation`);
  console.log(
    `overlay hidden at ${data.overlayHidden === null ? 'NEVER' : `${Math.round(data.overlayHidden)}ms`}`,
  );
  console.log(
    `shell mounted at ${data.shellMounted === null ? 'NEVER' : `${Math.round(data.shellMounted)}ms`}`,
  );
  console.log(
    `input-blocked window (DCL -> overlay hidden): ${Math.round((data.overlayHidden ?? 0) - data.domContentLoaded)}ms`,
  );
  console.log('long tasks (start,dur):', JSON.stringify(data.longTasks));
  console.log('early pointer targets:', JSON.stringify(data.earlyPointerTargets));
  console.log('first pointerdown at:', Math.round(data.firstInput ?? -1), 'ms');
}

await distServer.stop();