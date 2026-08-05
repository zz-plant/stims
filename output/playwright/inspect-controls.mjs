import { chromium } from 'playwright';

const URL = 'http://localhost:5173/?agent=true&audio=demo&preset=100-square';

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 873 } });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => document.querySelector('main.stims-shell')?.getAttribute('data-mode') === 'live',
  { timeout: 12000 },
).catch(() => {});
await page.waitForTimeout(2000);

// Resolve the CSS-module hashed class names at runtime.
const cls = await page.evaluate(() => {
  const find = (substr) => {
    const el = [...document.querySelectorAll('*')].find((e) =>
      (e.className?.toString?.() || '').includes(substr) &&
      e.tagName !== 'STYLE' && e.tagName !== 'LINK'
    );
    return el ? el.className.toString().split(' ')[0] : null;
  };
  return {
    pill: find('_pill_'),
    bar: find('_bar_'),
    menuBtn: find('_menuBtn_'),
    menu: find('_menu_'),
  };
});
console.log('cls=', JSON.stringify(cls));

// Move mouse near the dock to reveal auto-hidden controls.
await page.mouse.move(600, 820);
await page.waitForTimeout(400);
await page.mouse.move(700, 820);
await page.waitForTimeout(200);

// open the menu
await page.click(`.${cls.menuBtn}`).catch((e) => console.log('click fail:', e.message));
await page.waitForTimeout(400);

const visible = await page.evaluate((c) => {
  const bar = document.querySelector(`.${c.bar}`);
  return { visible: bar?.getAttribute('data-visible'), display: bar ? getComputedStyle(bar).visibility : null };
}, cls);
console.log('bar visible state=', JSON.stringify(visible));

const report = await page.evaluate((c) => {
  const targets = ['pill', 'menuBtn', 'menu'].map((k) => c[k] ? document.querySelector(`.${c[k]}`) : null);
  const results = [];
  for (const el of targets) {
    if (!el) { results.push({ note: 'missing' }); continue; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { results.push({ el: (el.className?.toString?.()||'').slice(0,90), note: 'zero-size' }); continue; }
    const pts = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 4, r.top + r.height / 2],
      [r.left + r.width - 4, r.top + r.height / 2],
      [r.left + r.width / 2, r.top + 2],
      [r.left + r.width / 2, r.top + r.height - 2],
    ];
    results.push({
      el: (el.className?.toString?.()||'').slice(0,90),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      stack: pts.map(([x, y]) => {
        const t = document.elementFromPoint(x, y);
        return {
          p: `${Math.round(x)},${Math.round(y)}`,
          top: t ? { tag: t.tagName, cls: (t.className?.toString?.()||'').slice(0,60), z: getComputedStyle(t).zIndex, pe: getComputedStyle(t).pointerEvents, inert: !!t.closest?.('[inert]') } : null,
          self: t === el || el?.contains(t),
        };
      }),
    });
  }
  const hi = [...document.querySelectorAll('*')].map((e) => {
    const s = getComputedStyle(e);
    const z = s.zIndex === 'auto' ? 0 : parseInt(s.zIndex, 10);
    if (z < 20 || (s.position !== 'fixed' && s.position !== 'absolute')) return null;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    if (r.bottom < 780 || r.top > 873) return null;
    return { tag: e.tagName, cls: (e.className?.toString?.()||'').slice(0,60), pos: s.position, z: s.zIndex, pe: s.pointerEvents, r: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  }).filter(Boolean);
  return { results, hi };
}, cls);

console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: '/tmp/stims-controls.png' });
await browser.close();
