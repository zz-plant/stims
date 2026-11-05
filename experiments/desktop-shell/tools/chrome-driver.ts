/**
 * The browser baseline: real Chrome on a throwaway profile, with the same probe
 * and the same control routes as the two shells.
 *
 * bun tools/chrome-driver.ts <url> [control-port]
 *   CHROME_FLAGS="--flag --flag" adds launch flags, for picker auto-accept.
 *
 * Raw CDP on purpose. Playwright turns on focus emulation, which reports a
 * hidden tab as visible and keeps rAF at full speed: under it every hidden
 * state measured 120 fps, the opposite of what a real visitor gets.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5991/?agent=true';
const controlPort = Number(process.argv[3] ?? 5995);
const debugPort = 9444;
const here = import.meta.dir;
const profile = mkdtempSync(
  join(process.env.TMPDIR ?? tmpdir(), 'spike-chrome-'),
);
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-position=900,560',
    '--window-size=800,559',
    ...(process.env.CHROME_FLAGS?.split(' ').filter(Boolean) ?? []),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let version: { webSocketDebuggerUrl: string; Browser: string } | null = null;
for (let attempt = 0; attempt < 40 && !version; attempt++) {
  await Bun.sleep(500);
  version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
    .then((response) => response.json())
    .catch(() => null);
}
if (!version) throw new Error('Chrome did not open its debugging port');

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));
let nextId = 1;
const pending = new Map<number, (message: Record<string, unknown>) => void>();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) pending.get(message.id)?.(message);
});
const send = (
  method: string,
  params = {},
  sessionId?: string,
  // biome-ignore lint/suspicious/noExplicitAny: CDP replies are untyped here.
): Promise<any> => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    pending.set(id, (message) =>
      message.error
        ? reject(new Error(JSON.stringify(message.error)))
        : resolve(message.result),
    );
  });
};

const { targetInfos } = await send('Target.getTargets');
const targetId = targetInfos.find(
  (target: { type: string }) => target.type === 'page',
).targetId;
const { sessionId } = await send('Target.attachToTarget', {
  targetId,
  flatten: true,
});
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

const probe = readFileSync(join(here, '../shared/probe.js'), 'utf8');
const inject = (name: string, session: string) =>
  send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `window.__STIMS_SPIKE__ = { collector: 'http://127.0.0.1:5998', shell: '${name}' };\n${probe}`,
    },
    session,
  );
await inject('chrome', sessionId);
await send('Page.navigate', { url }, sessionId);

const { windowId } = await send('Browser.getWindowForTarget', { targetId });
const setState = (windowState: 'minimized' | 'normal') =>
  send('Browser.setWindowBounds', { windowId, bounds: { windowState } });

let otherTab: string | null = null;
const openOther = async (address: string) => {
  const { targetId: created } = await send('Target.createTarget', {
    url: 'about:blank',
  });
  otherTab = created;
  if (address === 'about:blank') return;
  const attached = await send('Target.attachToTarget', {
    targetId: created,
    flatten: true,
  });
  await send('Page.enable', {}, attached.sessionId);
  await inject('chrome-source', attached.sessionId);
  await send('Page.navigate', { url: address }, attached.sessionId);
};

Bun.serve({
  port: controlPort,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(request) {
    const route = new URL(request.url).pathname;
    let result: unknown = 'ok';
    switch (route) {
      case '/show':
        await send('Target.activateTarget', { targetId });
        break;
      case '/hide':
        // A hidden tab: another tab in front, in the same window.
        if (otherTab)
          await send('Target.activateTarget', { targetId: otherTab });
        else await openOther('about:blank');
        break;
      case '/minimize':
        await setState('minimized');
        break;
      case '/restore':
        await setState('normal');
        await send('Target.activateTarget', { targetId });
        break;
      case '/open-source':
        await openOther('http://127.0.0.1:5998/burst-source');
        await send('Target.activateTarget', { targetId });
        break;
      case '/focus-emulation':
        // Only for the tab-capture latency run: Chrome moves focus to the
        // captured tab, which hides this one before Stims finishes starting.
        await send(
          'Emulation.setFocusEmulationEnabled',
          { enabled: true },
          sessionId,
        );
        break;
      case '/gesture-eval': {
        const response = await send(
          'Runtime.evaluate',
          {
            expression: await request.text(),
            userGesture: true,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
        );
        result = response.result?.value ?? response.exceptionDetails ?? null;
        break;
      }
      case '/versions':
        result = version?.Browser;
        break;
      case '/quit':
        chrome.kill();
        setTimeout(() => process.exit(0), 200);
        break;
      default:
        result = 'unknown';
    }
    return new Response(
      typeof result === 'string' ? result : JSON.stringify(result),
    );
  },
});
console.log(`${version.Browser} control on ${controlPort}, pid ${chrome.pid}`);
