/**
 * Fail when two e2e test files claim the same dev-server port.
 *
 * Each browser e2e file starts its own vite on a fixed `TEST_PORT`, and
 * `scripts/run-tests.ts` runs two files at once locally on the promise that no
 * two share one. Nothing enforced that, and two did: agent-boot-smoke and
 * flash-sampler-readback both took 5186. Run together, the second file's vite
 * exits on --strictPort; the harness used to accept the first file's server
 * as its own, and the second suite lost its server the moment the first one
 * finished and stopped it.
 *
 * The rule: every `tests/e2e/*.test.ts` that calls `startDevServer` declares
 * a top-level `const TEST_PORT = <n>;`, and no two declare the same number.
 * A port passed any other way is reported, because this scan could not see it.
 * Picking a port: run this script, which lists the ones taken.
 *
 * Collisions between checkouts (another session's worktree on the same port)
 * are outside what a source scan can see; `tests/e2e/dev-server.ts` refuses a
 * port that is already taken and names the process holding it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Directory to scan; the unit test passes a fixture directory instead. */
const ROOT =
  process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'tests/e2e';

const PORT_DECLARATION = /^const TEST_PORT = (\d+);$/gm;

function logError(msg: string) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

const errors: string[] = [];
const claims = new Map<number, string[]>();

const files = readdirSync(ROOT)
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

for (const name of files) {
  const path = relative(process.cwd(), join(ROOT, name));
  const source = readFileSync(join(ROOT, name), 'utf8');
  if (!source.includes('startDevServer(')) continue;

  const ports = [...source.matchAll(PORT_DECLARATION)].map((m) => Number(m[1]));
  if (ports.length !== 1) {
    errors.push(
      `${path} starts a dev server but declares ${ports.length} \`const TEST_PORT = <n>;\` lines; declare exactly one so its port can be checked.`,
    );
    continue;
  }
  claims.set(ports[0], [...(claims.get(ports[0]) ?? []), path]);
}

for (const [port, owners] of claims) {
  if (owners.length > 1) {
    errors.push(`port ${port} is claimed by ${owners.join(' and ')}.`);
  }
}

const table = [...claims.entries()]
  .sort(([a], [b]) => a - b)
  .map(([port, owners]) => `  ${port}  ${owners.join(', ')}`)
  .join('\n');

if (errors.length > 0) {
  for (const error of errors) logError(error);
  console.error(`\nPorts in use:\n${table}`);
  process.exit(1);
}

console.log(`e2e dev-server ports are unique:\n${table}`);
