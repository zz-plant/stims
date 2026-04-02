#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getFlagValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function runCommand(command, commandArgs, { silent = false } = {}) {
  return execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  }).trim();
}

function tryRunCommand(command, commandArgs) {
  try {
    return runCommand(command, commandArgs, { silent: true });
  } catch {
    return null;
  }
}

const preview = hasFlag('--preview');
const production = hasFlag('--production');
const configPath = getFlagValue('--config') ?? 'wrangler.toml';

if (preview === production) {
  console.error(
    '[deploy-cloudflare] Pass exactly one of --preview or --production.',
  );
  process.exit(1);
}

const directory = getFlagValue('--directory') ?? 'dist';
const projectName =
  getFlagValue('--project-name') ??
  process.env.STIMS_CLOUDFLARE_PAGES_PROJECT ??
  'stims';
const distIndex = join(process.cwd(), directory, 'index.html');
const distManifest = join(process.cwd(), directory, '.vite', 'manifest.json');

if (!existsSync(distIndex) || !existsSync(distManifest)) {
  console.error(
    `[deploy-cloudflare] Expected a built Pages artifact in "${directory}/" with ".vite/manifest.json". Run "bun run build" first.`,
  );
  process.exit(1);
}

if (
  process.env.CI === 'true' &&
  (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)
) {
  console.error(
    '[deploy-cloudflare] CI deploys require CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.',
  );
  process.exit(1);
}

const gitBranch = tryRunCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const branch =
  getFlagValue('--branch') ??
  process.env.CF_PAGES_BRANCH ??
  process.env.GITHUB_HEAD_REF ??
  process.env.GITHUB_REF_NAME ??
  (gitBranch && gitBranch !== 'HEAD' ? gitBranch : null);

if (preview && !branch) {
  console.error(
    '[deploy-cloudflare] Preview deploys need a branch name. Pass --branch <name> or set CF_PAGES_BRANCH.',
  );
  process.exit(1);
}

const commitHash =
  getFlagValue('--commit-hash') ??
  process.env.GITHUB_SHA ??
  tryRunCommand('git', ['rev-parse', 'HEAD']);
const commitMessage =
  getFlagValue('--commit-message') ??
  tryRunCommand('git', ['log', '-1', '--pretty=%s']);
const dirtyWorkspace =
  tryRunCommand('git', ['status', '--porcelain'])?.length > 0;

const wranglerArgs = [
  'wrangler',
  '--config',
  configPath,
  'pages',
  'deploy',
  directory,
  '--project-name',
  projectName,
];

if (preview) {
  wranglerArgs.push('--branch', branch);
}

if (commitHash) {
  wranglerArgs.push('--commit-hash', commitHash);
}

if (commitMessage) {
  wranglerArgs.push('--commit-message', commitMessage);
}

wranglerArgs.push('--commit-dirty', dirtyWorkspace ? 'true' : 'false');

console.log(
  [
    `[deploy-cloudflare] Target: ${preview ? 'preview' : 'production'}`,
    `[deploy-cloudflare] Config: ${configPath}`,
    `[deploy-cloudflare] Project: ${projectName}`,
    `[deploy-cloudflare] Directory: ${directory}`,
    preview ? `[deploy-cloudflare] Branch: ${branch}` : null,
    commitHash ? `[deploy-cloudflare] Commit: ${commitHash}` : null,
    `[deploy-cloudflare] Dirty workspace: ${dirtyWorkspace ? 'yes' : 'no'}`,
  ]
    .filter(Boolean)
    .join('\n'),
);

runCommand('bunx', wranglerArgs);
