#!/usr/bin/env bun
/**
 * Deploys the current working tree as a Cloudflare Workers version preview
 * and prints the resulting URL in a form both humans and agents can parse.
 *
 * This is the "just look at the real thing" escape hatch for a cloud coding
 * agent with no local browser/GPU: instead of a SwiftShader screenshot, it
 * gets a live URL running on Cloudflare's real infrastructure and can hand
 * that to a human, or drive it with the Browser pane / claude-in-chrome
 * tooling itself.
 *
 * Requires Cloudflare deploy credentials (CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_ACCOUNT_ID, or a prior `wrangler login`) — this performs a real
 * deploy (a new Worker *version*, not production traffic; see
 * docs/DEPLOYMENT.md), so treat it as the deploy action it is.
 *
 * Usage:
 *   bun run preview:deploy            # human-readable
 *   bun run preview:deploy -- --json  # { url, versionId, raw }
 */

import { spawn } from 'node:child_process';

const JSON_OUTPUT = process.argv.includes('--json');

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!JSON_OUTPUT) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!JSON_OUTPUT) process.stderr.write(chunk);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(`${command} ${args.join(' ')} exited ${code}\n${stderr}`),
        );
      }
    });
  });
}

// wrangler versions upload prints a "Version Preview URL:" line followed by
// a workers.dev URL. Matched loosely (any https URL on that line) so a
// wrangler output-format change degrades to "no URL found" rather than a
// silent wrong match.
const PREVIEW_URL_PATTERN = /Version Preview URL:\s*(\S+)/i;
const VERSION_ID_PATTERN = /Version ID:\s*(\S+)/i;

async function main() {
  if (!JSON_OUTPUT) {
    console.log('Building production bundle...');
  }
  await run('bun', ['run', 'site:build']);

  if (!JSON_OUTPUT) {
    console.log('Uploading Worker version preview...');
  }
  const uploadOutput = await run('bunx', [
    'wrangler',
    'versions',
    'upload',
    '--config',
    'wrangler.site.jsonc',
  ]);

  const urlMatch = uploadOutput.match(PREVIEW_URL_PATTERN);
  const versionMatch = uploadOutput.match(VERSION_ID_PATTERN);
  const url = urlMatch?.[1] ?? null;
  const versionId = versionMatch?.[1] ?? null;

  if (!url) {
    const message =
      'Could not find a preview URL in wrangler output. ' +
      'wrangler CLI output format may have changed — check the raw output above.';
    if (JSON_OUTPUT) {
      console.log(
        JSON.stringify({ url: null, versionId, raw: uploadOutput }, null, 2),
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ url, versionId, raw: uploadOutput }, null, 2));
  } else {
    console.log(`\nPreview URL: ${url}`);
    if (versionId) console.log(`Version ID: ${versionId}`);
  }
}

main().catch((error) => {
  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        { url: null, versionId: null, error: String(error) },
        null,
        2,
      ),
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});
