/**
 * Fails when a test reads a production source file as text.
 *
 * The audit of all 303 test files found one shape repeated ~70 times:
 *
 *   const source = readFileSync('src/js/frontend/X.tsx', 'utf8');
 *   expect(source).toContain('<a literal copied out of X.tsx>');
 *
 * That assertion cannot fail when behaviour changes and cannot pass when the
 * behaviour is right but the spelling moved. Renaming a local, extracting a
 * component, or reformatting a CSS selector reddens the suite while the app is
 * identical; putting the same literal in a comment turns it green while the
 * feature is gone. Tests like this also keep dead code alive, because deleting
 * the code correctly is what breaks them.
 *
 *   bun run check:test-source-greps
 *
 * The rule: assert through the module's exported behaviour instead. If the
 * property really is about a file's text — an HTML artifact we ship, a config
 * file, a generated header — allowlist it with a reason under
 * `testSourceGreps.allowed` in `agent-ergonomics.config.ts`. That one-line
 * edit with a justification is the cost this guard is trying to impose.
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['test-source-greps', ...process.argv.slice(2)]));
