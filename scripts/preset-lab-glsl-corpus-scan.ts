/**
 * Preset lab — offline GLSL corpus scan (no browser).
 *
 * The cheapest verification tier: for every catalog preset with a native
 * GLSL warp/comp shader (or a translated one, run through the same emitter
 * the runtime uses), assemble the exact fragment-shader strings three.js
 * would hand to WebGL — via `assembleMilkdropDirectFragmentShaders`, the
 * same pure-string function `SharedMilkdropFeedbackManager` calls at
 * runtime — and validate them with `glslangValidator` (a standalone GLSL
 * compiler; `brew install glslang`). This catches shader-compile failures
 * (bad syntax, unknown builtins, type errors) that the NaN sweep cannot see,
 * since that sweep only exercises the CPU VM path, never the actual GLSL
 * text sent to the GPU.
 *
 * `precision mediump float;` is prepended before validation: the runtime
 * template omits it (three.js's WebGLProgram injects precision/version
 * boilerplate at compile time), so a bare validator run rejects every
 * shader with "type requires declaration of default precision qualifier"
 * — a false positive, not a real compile error. No other rewriting happens;
 * this is the same GLSL body the browser compiles, ESSL 1.00 defaults
 * (gl_FragColor, texture2D) included.
 *
 * Baseline workflow (same shape as lab:nan-sweep):
 *   bun run lab:glsl-corpus-scan                      # scan, compare to baseline
 *   bun run lab:glsl-corpus-scan -- --update-baseline  # rewrite the baseline file
 *   bun run lab:glsl-corpus-scan -- --only <id> [...]  # subset, no gate
 *
 * The gate fails (exit 1) only on REGRESSIONS: presets failing now that are
 * not in performance/glsl-corpus-scan-baseline.json. Fixed presets are
 * reported so the baseline can be re-tightened with --update-baseline.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGlslFromShaderStatements } from '../src/js/milkdrop/compiler/shader-analysis-glsl.ts';
import { isMilkdropShaderProgramBackendExecutable } from '../src/js/milkdrop/compiler/shader-execution-classification.ts';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { assembleMilkdropDirectFragmentShaders } from '../src/js/milkdrop/feedback-manager-shared.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

const BASELINE_PATH = 'performance/glsl-corpus-scan-baseline.json';
const VALIDATOR_BIN = 'glslangValidator';

type ShaderStage = 'warp' | 'composite';

type PresetFinding = {
  id: string;
  stage: ShaderStage;
  detail: string;
};

type BaselineFile = {
  version: 1;
  capturedAt: string;
  validatorVersion: string;
  failures: Array<{ id: string; stage: ShaderStage; detail: string }>;
};

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

function getValidatorVersion(): string | null {
  const result = spawnSync(VALIDATOR_BIN, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.split('\n')[0]?.trim() ?? 'unknown';
}

/** Validates one fragment shader body; returns an error summary or null. */
function validateFragmentShader(glsl: string): string | null {
  const source = `precision mediump float;\n${glsl}`;
  const result = spawnSync(VALIDATOR_BIN, ['--stdin', '-S', 'frag'], {
    input: source,
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`glslangValidator failed to run: ${result.error.message}`);
  }
  if (result.status === 0) {
    return null;
  }
  const firstError =
    result.stdout
      .split('\n')
      .find((line) => line.startsWith('ERROR:'))
      ?.trim() ??
    result.stdout.trim().split('\n')[0] ??
    'unknown error';
  return firstError.slice(0, 200);
}

/**
 * Mirrors `SharedMilkdropFeedbackManager.setDirectShaderPrograms`'s GLSL
 * derivation exactly: prefer `rawGlsl` (native-GLSL presets), else run the
 * translated-preset statements through the same emitter the runtime uses.
 */
function deriveStageGlsl(
  compiled: ReturnType<typeof compileMilkdropPresetSource>,
  stage: 'warp' | 'comp',
): string | null {
  const program = compiled.ir.post.shaderPrograms[stage];
  if (!program || !isMilkdropShaderProgramBackendExecutable(program)) {
    return null;
  }
  return (
    program.rawGlsl ??
    generateGlslFromShaderStatements(program.statements, stage) ??
    null
  );
}

function scanPreset(raw: string, presetId: string): PresetFinding[] {
  let compiled: ReturnType<typeof compileMilkdropPresetSource>;
  try {
    compiled = compileMilkdropPresetSource(raw, { id: presetId });
  } catch (error) {
    return [
      {
        id: presetId,
        stage: 'warp',
        detail: `compile-error: ${(error as Error).message.slice(0, 200)}`,
      },
    ];
  }

  const warpGlsl = deriveStageGlsl(compiled, 'warp');
  const compGlsl = deriveStageGlsl(compiled, 'comp');
  if (warpGlsl === null && compGlsl === null) {
    // No custom shader on either stage — nothing for the validator to check;
    // the preset renders through the shared pass-through pair.
    return [];
  }

  const { warp, composite } = assembleMilkdropDirectFragmentShaders(
    warpGlsl,
    compGlsl,
  );
  const findings: PresetFinding[] = [];
  const warpError = validateFragmentShader(warp);
  if (warpError) {
    findings.push({ id: presetId, stage: 'warp', detail: warpError });
  }
  const compositeError = validateFragmentShader(composite);
  if (compositeError) {
    findings.push({ id: presetId, stage: 'composite', detail: compositeError });
  }
  return findings;
}

function readBaseline(repoRoot: string): BaselineFile | null {
  const filePath = path.join(repoRoot, BASELINE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as BaselineFile;
}

function findingKey(finding: { id: string; stage: ShaderStage }) {
  return `${finding.id}::${finding.stage}`;
}

function main() {
  const repoRoot = repoRootFromScript();
  const validatorVersion = getValidatorVersion();
  if (!validatorVersion) {
    console.error(
      `${VALIDATOR_BIN} not found on PATH. Install with: brew install glslang`,
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  // `--only <id> [...]` takes every id up to the next flag, as the usage above
  // advertises. Reading just the one argument after the flag silently scanned
  // a single preset when handed a list, and reported success for the rest.
  const only: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--only') continue;
    let cursor = index + 1;
    while (cursor < args.length && !args[cursor]?.startsWith('--')) {
      only.push(args[cursor] as string);
      cursor += 1;
    }
    index = cursor - 1;
  }

  const entries = [...loadCatalogEntries(repoRoot).values()].filter(
    (entry) => only.length === 0 || only.includes(entry.id),
  );
  if (entries.length === 0) {
    console.error('No matching presets.');
    process.exit(1);
  }

  const failures: PresetFinding[] = [];
  let failedPresetCount = 0;
  const startedAt = Date.now();

  for (const [index, entry] of entries.entries()) {
    const filePath = path.join(
      repoRoot,
      'public',
      entry.file.replace(/^\//, ''),
    );
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'latin1');
    } catch {
      failures.push({
        id: entry.id,
        stage: 'warp',
        detail: `missing preset file: ${entry.file}`,
      });
      continue;
    }
    const findings = scanPreset(raw, entry.id);
    if (findings.length > 0) {
      failedPresetCount += 1;
      failures.push(...findings);
    }
    if ((index + 1) % 200 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `… ${index + 1}/${entries.length} scanned (${failures.length} shader errors) [${elapsed}s]`,
      );
    }
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `\nScanned ${entries.length} presets in ${elapsedSeconds}s ` +
      `(glslangValidator ${validatorVersion}): ` +
      `${failures.length} shader compile error(s) across ${failedPresetCount} preset(s).`,
  );
  for (const failure of failures) {
    console.log(`  ✗ ${failure.id} [${failure.stage}] ${failure.detail}`);
  }

  if (only.length > 0) {
    // Subsets are for iteration, never gated.
    return;
  }

  if (updateBaseline) {
    const baseline: BaselineFile = {
      version: 1,
      capturedAt: new Date().toISOString(),
      validatorVersion,
      failures: failures.map(({ id, stage, detail }) => ({
        id,
        stage,
        detail,
      })),
    };
    fs.writeFileSync(
      path.join(repoRoot, BASELINE_PATH),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    console.log(`Baseline written to ${BASELINE_PATH}.`);
    return;
  }

  const baseline = readBaseline(repoRoot);
  if (!baseline) {
    console.log(
      `No baseline at ${BASELINE_PATH}; run with --update-baseline to create one.`,
    );
    process.exit(failures.length > 0 ? 1 : 0);
  }

  const knownKeys = new Set(baseline.failures.map(findingKey));
  const regressions = failures.filter(
    (failure) => !knownKeys.has(findingKey(failure)),
  );
  const currentKeys = new Set(failures.map(findingKey));
  const fixed = baseline.failures.filter(
    (failure) => !currentKeys.has(findingKey(failure)),
  );

  if (fixed.length > 0) {
    console.log(
      `${fixed.length} baseline failure(s) no longer fail — re-tighten with --update-baseline: ` +
        fixed.map((failure) => `${failure.id}[${failure.stage}]`).join(', '),
    );
  }
  if (regressions.length > 0) {
    console.error(
      `\n${regressions.length} NEW shader compile error(s) vs baseline:`,
    );
    for (const failure of regressions) {
      console.error(`  ✗ ${failure.id} [${failure.stage}] ${failure.detail}`);
    }
    process.exit(1);
  }
  console.log('✔ no new shader compile errors vs baseline.');
}

main();
