#!/usr/bin/env node
/**
 * Builds the deployable site by compiling the Vite app and Cloudflare Worker
 * concurrently, then assembling their outputs under dist/.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const workerOutputDir = await mkdtemp(
  path.join(tmpdir(), 'stims-site-worker-'),
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code}`
          }`,
        ),
      );
    });
  });
}

try {
  const buildResults = await Promise.allSettled([
    run('bun', ['run', 'build']),
    run('bunx', [
      'wrangler',
      'pages',
      'functions',
      'build',
      `--outdir=${workerOutputDir}`,
    ]),
  ]);
  const failedBuild = buildResults.find(
    (result) => result.status === 'rejected',
  );
  if (failedBuild?.status === 'rejected') {
    throw failedBuild.reason;
  }

  await mkdir(path.join(distDir, '_worker.js'), { recursive: true });
  await cp(workerOutputDir, path.join(distDir, '_worker.js'), {
    recursive: true,
  });
  await writeFile(
    path.join(distDir, '.assetsignore'),
    '_worker.js\n.vite\nmilkdrop-presets/previews\n',
  );
  await rm(path.join(distDir, 'milkdrop-presets', 'previews'), {
    recursive: true,
    force: true,
  });
} finally {
  await rm(workerOutputDir, { recursive: true, force: true });
}
