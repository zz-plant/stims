/**
 * Verifies the deployed site's edge is reachable and not gated behind a
 * Cloudflare challenge.
 *
 * Fetches the unfurler-facing routes on the base URL (first argument,
 * default https://toil.fyi) and fails on cf-mitigated challenges,
 * interstitial bodies, or 4xx/5xx. DNS-only failures warn instead of
 * failing unless STRICT_DNS_FAILURES=1.
 *
 * The list is the social-card surface, not the app's navigation: a share
 * link is unfurled by a crawler, not a browser, so these four are what a
 * challenge or a 404 actually breaks. /milkdrop/ used to be here and went
 * stale silently when the app routes changed, which is why this check also
 * asserts on the card endpoints rather than a human-browsed page.
 */
export {};

const baseUrl = (process.argv[2] || 'https://toil.fyi').replace(/\/$/, '');

const endpoints = [
  '/',
  // The HTML a share resolves to: title, description, canonical, OG tags.
  '/?preset=rovastar-parallel-universe',
  // The per-preset card itself, and the generic fallback it must not
  // silently become.
  '/api/og-preset?id=rovastar-parallel-universe',
  '/og/milkdrop.png',
];

let failures = 0;
let dnsFailures = 0;

for (const endpoint of endpoints) {
  const url = `${baseUrl}${endpoint}`;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const cfMitigated = res.headers.get('cf-mitigated');
    const statusLine = `HTTP/1.1 ${res.status} ${res.statusText}`;
    console.log(`[${endpoint}] ${statusLine}`);

    if (cfMitigated?.toLowerCase().includes('challenge')) {
      console.log(
        '  ❌ Cloudflare managed challenge is enabled for this endpoint.',
      );
      failures++;
    } else if (res.status === 403) {
      const text = await res.text();
      if (text.includes('Just a moment')) {
        console.log('  ❌ Received Cloudflare challenge interstitial body.');
        failures++;
      } else {
        console.log(`  ❌ Non-success response (${res.status}).`);
        failures++;
      }
    } else if (res.status >= 400) {
      console.log(`  ❌ Non-success response (${res.status}).`);
      failures++;
    } else {
      console.log('  ✅ Reachable.');
    }
  } catch (err: unknown) {
    console.log(`[${endpoint}] Request error: ${err}`);
    const errStr = String(err);
    if (
      errStr.includes('getaddrinfo') ||
      errStr.includes('ENOTFOUND') ||
      errStr.includes('DNS')
    ) {
      console.log('  ❌ DNS resolution failed.');
      dnsFailures++;
    } else {
      console.log('  ❌ Request failed.');
    }
    failures++;
  }
}

if (failures > 0) {
  if (
    dnsFailures > 0 &&
    failures === dnsFailures &&
    process.env.STRICT_DNS_FAILURES !== '1'
  ) {
    console.log('\nProduction edge checks completed with DNS warnings.');
    process.exit(0);
  }
  console.error('\n❌ Production edge checks found failures.');
  process.exit(1);
}

console.log('\nAll production edge checks passed.');
