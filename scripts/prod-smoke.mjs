const BASE_URL = process.env.SITE_URL;
if (!BASE_URL) {
  console.error('SITE_URL environment variable is required');
  process.exit(1);
}

const routes = ['/', '/about'];
if (process.env.CRITICAL_ROUTES) {
  routes.push(...process.env.CRITICAL_ROUTES.split(','));
}

let failures = 0;
for (const route of routes) {
  const url = BASE_URL.replace(/\/$/, '') + route;
  try {
    const res = await fetch(url);
    if (res.status !== 200) {
      console.error('FAIL ' + url + ' => ' + res.status);
      failures++;
    } else {
      console.log('OK   ' + url + ' => ' + res.status);
    }
  } catch (e) {
    console.error('FAIL ' + url + ' => ' + e.message);
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
