#!/usr/bin/env bun
/**
 * Regenerates the projectM compatibility snapshot the corpus test compares
 * against, and owns the corpus loader both sides share.
 *
 * `tests/corpus/milkdrop-projectm-compat.test.ts` pins every vendored projectM
 * fixture's compiled diagnostics, normalized program sources and compatibility
 * report, so a compiler change that alters any of them has to be looked at
 * rather than absorbed. That gate had no regeneration path: the snapshot was a
 * checked-in JSON with nothing to rebuild it, so the first intended compiler
 * change left the corpus job red with no obvious way to accept it. It stayed
 * red — `perf(milkdrop): lower zero-initialized field reads` widened GPU field
 * lowering, added the field programs to the report, and every commit and pull
 * request after it inherited the failure.
 *
 * Run `bun run generate:projectm-snapshot` to accept a deliberate change, and
 * read the diff before committing it — that diff is the whole point of the
 * gate. `--check` fails when the committed snapshot is stale, which is what
 * the test itself asserts.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import type { MilkdropCompiledPreset } from '../src/js/milkdrop/types.ts';

export const PROJECTM_CORPUS_DIR = join(
  process.cwd(),
  'tests',
  'fixtures',
  'milkdrop',
  'projectm-upstream',
);
export const PROJECTM_COMPATIBILITY_SNAPSHOT_PATH = join(
  PROJECTM_CORPUS_DIR,
  'compatibility-metadata.snapshot.json',
);

export const PROJECTM_PRESET_FILES = [
  '000-empty.milk',
  '001-line.milk',
  '100-square.milk',
  '101-per_frame.milk',
  '102-per_frame3.milk',
  '103-multiple-eqn.milk',
  '104-continued-eqn.milk',
  '105-per_frame_init.milk',
  '110-per_pixel.milk',
  '200-wave.milk',
  '201-wave.milk',
  '202-wave.milk',
  '203-wave.milk',
  '204-wave.milk',
  '205-wave.milk',
  '206-wave.milk',
  '207-wave.milk',
  '208-wave.milk',
  '209-wave.milk',
  '210-wave.milk',
  '211-wave.milk',
  '212-wave.milk',
  '213-wave.milk',
  '214-wave.milk',
  '215-wave.milk',
  '240-wave-smooth-00.milk',
  '241-wave-smooth-01.milk',
  '242-wave-smooth-80.milk',
  '243-wave-smooth-90.milk',
  '244-wave-smooth-99.milk',
  '245-wave-smooth-100.milk',
  '250-wavecode.milk',
  '251-wavecode-spectrum.milk',
  '252-wavecode-spectrum2.milk',
  '260-compshader-noise_lq.milk',
  '261-compshader-noisevol_lq.milk',
  '300-beatdetect-bassmidtreb.milk',
] as const;

export function loadProjectMPresetCorpus() {
  return PROJECTM_PRESET_FILES.map((file) => {
    const raw = readFileSync(join(PROJECTM_CORPUS_DIR, file), 'utf8');
    return {
      file,
      compiled: compileMilkdropPresetSource(raw, {
        id: basename(file, '.milk'),
        title: file,
        fileName: file,
        path: join(PROJECTM_CORPUS_DIR, file),
        origin: 'user',
      }),
    };
  });
}

export function buildCompatibilitySnapshot(
  file: string,
  compiled: MilkdropCompiledPreset,
) {
  return {
    file,
    diagnostics: compiled.diagnostics.map((entry) => ({
      severity: entry.severity,
      code: entry.code,
      field: entry.field ?? null,
    })),
    normalizedPrograms: {
      init: compiled.ir.programs.init.sourceLines,
      perFrame: compiled.ir.programs.perFrame.sourceLines,
      perPixel: compiled.ir.programs.perPixel.sourceLines,
      customWaves: compiled.ir.customWaves.map((wave) => ({
        index: wave.index,
        init: wave.programs.init.sourceLines,
        perFrame: wave.programs.perFrame.sourceLines,
        perPoint: wave.programs.perPoint.sourceLines,
      })),
      customShapes: compiled.ir.customShapes.map((shape) => ({
        index: shape.index,
        init: shape.programs.init.sourceLines,
        perFrame: shape.programs.perFrame.sourceLines,
      })),
    },
    compatibility: {
      unsupportedKeys: compiled.ir.compatibility.unsupportedKeys,
      warnings: compiled.ir.compatibility.warnings,
      featuresUsed: compiled.ir.compatibility.featureAnalysis.featuresUsed,
      gpuDescriptorPlan: {
        routing: compiled.ir.compatibility.gpuDescriptorPlans.webgpu.routing,
        proceduralWaves:
          compiled.ir.compatibility.gpuDescriptorPlans.webgpu.proceduralWaves,
        proceduralMesh:
          compiled.ir.compatibility.gpuDescriptorPlans.webgpu.proceduralMesh,
        proceduralMotionVectors:
          compiled.ir.compatibility.gpuDescriptorPlans.webgpu
            .proceduralMotionVectors,
        feedback: compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
          ? {
              kind: compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
                .kind,
              shaderExecution:
                compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
                  .shaderExecution,
              usesFeedbackTexture:
                compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
                  .usesFeedbackTexture,
              usesVideoEcho:
                compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
                  .usesVideoEcho,
              usesPostEffects:
                compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
                  .usesPostEffects,
              fallbackToLegacyFeedback:
                compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
                  .fallbackToLegacyFeedback,
            }
          : null,
        unsupported:
          compiled.ir.compatibility.gpuDescriptorPlans.webgpu.unsupported,
      },
      backends: {
        webgl: {
          status: compiled.ir.compatibility.backends.webgl.status,
          evidence: compiled.ir.compatibility.backends.webgl.evidence.map(
            (entry) => ({
              scope: entry.scope,
              status: entry.status,
              code: entry.code,
              feature: entry.feature ?? null,
            }),
          ),
        },
        webgpu: {
          status: compiled.ir.compatibility.backends.webgpu.status,
          evidence: compiled.ir.compatibility.backends.webgpu.evidence.map(
            (entry) => ({
              scope: entry.scope,
              status: entry.status,
              code: entry.code,
              feature: entry.feature ?? null,
            }),
          ),
        },
      },
      parity: {
        fidelityClass: compiled.ir.compatibility.parity.fidelityClass,
        backendDivergence: compiled.ir.compatibility.parity.backendDivergence,
        ignoredFields: compiled.ir.compatibility.parity.ignoredFields,
        blockedConstructs: compiled.ir.compatibility.parity.blockedConstructs,
        approximatedShaderLines:
          compiled.ir.compatibility.parity.approximatedShaderLines,
        missingAliasesOrFunctions:
          compiled.ir.compatibility.parity.missingAliasesOrFunctions,
      },
    },
  };
}

export function buildProjectMCompatibilitySnapshot() {
  return loadProjectMPresetCorpus().map(({ file, compiled }) =>
    buildCompatibilitySnapshot(file, compiled),
  );
}

function formatWithBiome(path: string) {
  const result = spawnSync('bunx', ['biome', 'format', '--write', path], {
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    console.warn(
      'biome format failed; the snapshot may not match the committed style.',
    );
  }
}

if (import.meta.main) {
  const checkOnly = process.argv.includes('--check');
  const snapshot = buildProjectMCompatibilitySnapshot();
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (checkOnly) {
    const committed = readFileSync(
      PROJECTM_COMPATIBILITY_SNAPSHOT_PATH,
      'utf8',
    );
    // Compare parsed values, not text: the committed file carries Biome's
    // formatting and `serialized` does not, and this gate is about content.
    if (JSON.stringify(JSON.parse(committed)) !== JSON.stringify(snapshot)) {
      console.error(
        'projectM compatibility snapshot is out of date.\nRun `bun run generate:projectm-snapshot`, read the diff, and commit it.',
      );
      process.exit(1);
    }
    console.log('projectM compatibility snapshot is current.');
  } else {
    writeFileSync(PROJECTM_COMPATIBILITY_SNAPSHOT_PATH, serialized);
    // Biome owns JSON formatting in this repo, and a snapshot written straight
    // from JSON.stringify differs from it in array wrapping — which would show
    // up as hundreds of phantom diff lines and fight the formatter on every
    // regeneration. Hand the file to Biome so the committed form is the
    // formatted one, and `--check` compares like with like.
    formatWithBiome(PROJECTM_COMPATIBILITY_SNAPSHOT_PATH);
    console.log(
      `Wrote ${snapshot.length} fixture entries to ${PROJECTM_COMPATIBILITY_SNAPSHOT_PATH}.`,
    );
  }
}
