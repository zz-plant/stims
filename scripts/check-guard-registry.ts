/**
 * Blocks banned patterns in changed source files before they land.
 *
 * Scans staged files (falling back to unstaged edits) for whole-file TypeScript
 * suppression directives, silent empty catch blocks, hardcoded hex colors in
 * frontend JSX, `console.log`, and un-themed color literals in component
 * `src/css/*.module.css` stylesheets, pointing offenders at the design tokens
 * and debug-snapshot systems instead. Exits non-zero on any hit.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();

function logError(msg: string) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

function logInfo(msg: string) {
  console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`);
}

function getChangedFiles(): string[] {
  try {
    // Get staged files first
    let stdout = execSync('git diff --cached --name-only --diff-filter=d', {
      encoding: 'utf8',
    }).trim();
    if (!stdout) {
      // Fallback to unstaged modified files
      stdout = execSync('git diff --name-only --diff-filter=d', {
        encoding: 'utf8',
      }).trim();
    }
    return stdout ? stdout.split('\n') : [];
  } catch (error) {
    console.warn(
      'Failed to query git for changed files, checking all repository files instead.',
      error,
    );
    return [];
  }
}

export function checkGuardRegistry(): boolean {
  const files = getChangedFiles();
  if (files.length === 0) {
    logInfo('No changed files found to check.');
    return true;
  }

  let failed = false;

  for (const relPath of files) {
    const absPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;

    // 0. Component stylesheets: bare color literals that no theme can reach.
    //
    // The palette sheets (tokens.css, shell-theme.css, base.css, app-shell.css,
    // index.css) are where hex belongs — they *define* the themes. A literal in
    // a per-component `*.module.css` is different: it was picked against
    // whichever theme the author had open, and the other theme cannot override
    // it. That is the exact shape of the stage-dock regression, where 23
    // dark-picked literals rendered near-white ink on a light-theme cream pill
    // at roughly 1:1 contrast.
    //
    // Literals inside a `var(--token, fallback)` are fine: the token still
    // themes the value and the fallback only applies when it is missing.
    // A deliberate literal opts out with a `guard-allow-hex` comment stating
    // why — the reveal handle keeps a theme-independent dark surface, so its
    // ink has to be theme-independent too.
    if (/^src\/css\/.+\.module\.css$/.test(relPath)) {
      const cssLines = fs.readFileSync(absPath, 'utf8').split('\n');
      for (let i = 0; i < cssLines.length; i += 1) {
        const raw = cssLines[i] ?? '';
        const bare = raw.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, '');
        const hits = bare.match(
          /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
        );
        if (!hits) continue;
        const scope = cssLines.slice(Math.max(0, i - 12), i + 1).join('\n');
        if (scope.includes('guard-allow-hex')) continue;
        logError(
          `File "${relPath}" line ${i + 1} hardcodes ${hits.join(', ')} in a component stylesheet: "${raw.trim()}". Use a themed token from tokens.css, or annotate the line with a "guard-allow-hex: <reason>" comment if the surface is deliberately theme-independent.`,
        );
        failed = true;
      }
      continue;
    }

    // Only scan TS/JS source files under src/js/
    if (
      !relPath.startsWith('src/js/') ||
      !/\.(?:ts|tsx|js|jsx)$/.test(relPath)
    ) {
      continue;
    }

    // Ignore UI harness
    if (relPath === 'src/js/frontend/ui-harness.tsx') {
      continue;
    }

    const content = fs.readFileSync(absPath, 'utf8');
    const lines = content.split('\n');

    // Prose that *describes* a banned pattern is not the banned pattern. A
    // docblock explaining why a helper exists ("call sites each wrapped their
    // own try/catch") tripped the empty-catch rule, which is the kind of false
    // positive that teaches people to reach for --no-verify.
    //
    // Comments collapse to a placeholder rather than vanishing, so that a
    // catch whose body is a written justification still reads as non-empty —
    // deleting them outright would newly condemn `catch { /* why */ }`, which
    // this guard has always accepted. The suppression-directive rule below
    // keeps using the raw source, because that directive *is* a comment.
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '0')
      .replace(/(^|[^:])\/\/.*$/gm, '$10');

    // 1. Guard against type checking bypasses
    const tsNoCheckLabel = '@ts-' + 'nocheck';
    if (content.includes(tsNoCheckLabel)) {
      logError(
        `File "${relPath}" contains forbidden "${tsNoCheckLabel}". Please resolve the type issues.`,
      );
      failed = true;
    }

    // 2. Guard against silent empty catch blocks
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(codeOnly)) {
      logError(
        `File "${relPath}" contains a silent empty catch block "catch {}" or "catch (_) {}". Use logger.debug/warn or proper error handling.`,
      );
      failed = true;
    }

    // 3. Guard against hardcoded HEX colors in frontend JSX components
    if (
      relPath.startsWith('src/js/frontend/') &&
      /\.(?:tsx|jsx)$/.test(relPath)
    ) {
      const hexMatch = codeOnly.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g);
      if (hexMatch) {
        logError(
          `File "${relPath}" contains hardcoded HEX color literal(s): ${hexMatch.join(', ')}. Use unified CSS tokens from tokens.css.`,
        );
        failed = true;
      }
    }

    // 4. Guard against console.log
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]?.trim() ?? '';

      // Skip lines starting with comments
      if (
        line.startsWith('//') ||
        line.startsWith('*') ||
        line.startsWith('/*')
      ) {
        continue;
      }

      // Match console.log( but ignore if commented later in the line (basic check)
      if (
        line.includes('console.log(') &&
        !line.match(/\/\/.*console\.log\(/)
      ) {
        logError(
          `File "${relPath}" line ${i + 1} contains "console.log": "${line}"`,
        );
        logError(
          'Please remove console.log and use the debug snapshot system (stimState.getDebugSnapshot) or the agent API instead.',
        );
        failed = true;
      }
    }
  }

  return !failed;
}

if (import.meta.main) {
  const ok = checkGuardRegistry();
  if (!ok) {
    process.exit(1);
  }
  logInfo('Guard-registry checks passed.');
}
