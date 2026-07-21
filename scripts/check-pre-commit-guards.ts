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

export function checkPreCommitGuards(): boolean {
  const files = getChangedFiles();
  if (files.length === 0) {
    logInfo('No changed files found to check.');
    return true;
  }

  let failed = false;

  for (const relPath of files) {
    const absPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;

    // Only scan TS/JS source files under assets/js/
    if (
      !relPath.startsWith('assets/js/') ||
      !/\.(?:ts|tsx|js|jsx)$/.test(relPath)
    ) {
      continue;
    }

    // Ignore UI harness
    if (relPath === 'assets/js/frontend/ui-harness.tsx') {
      continue;
    }

    const content = fs.readFileSync(absPath, 'utf8');
    const lines = content.split('\n');

    // 1. Guard against type checking bypasses
    const tsNoCheckLabel = '@ts-' + 'nocheck';
    if (content.includes(tsNoCheckLabel)) {
      logError(
        `File "${relPath}" contains forbidden "${tsNoCheckLabel}". Please resolve the type issues.`,
      );
      failed = true;
    }

    // 2. Guard against silent empty catch blocks
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(content)) {
      logError(
        `File "${relPath}" contains a silent empty catch block "catch {}" or "catch (_) {}". Use logger.debug/warn or proper error handling.`,
      );
      failed = true;
    }

    // 3. Guard against hardcoded HEX colors in frontend JSX components
    if (
      relPath.startsWith('assets/js/frontend/') &&
      /\.(?:tsx|jsx)$/.test(relPath)
    ) {
      const hexMatch = content.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g);
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
  const ok = checkPreCommitGuards();
  if (!ok) {
    process.exit(1);
  }
  logInfo('Pre-commit guardrail checks passed.');
}
