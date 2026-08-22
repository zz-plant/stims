import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

const BUTTERCHURN_DIR = join(
  process.cwd(),
  'public',
  'milkdrop-presets',
  'butterchurn',
);

function loadButterchurnCorpus() {
  return readdirSync(BUTTERCHURN_DIR)
    .filter((file) => file.endsWith('.milk'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(BUTTERCHURN_DIR, file), 'latin1');
      return {
        file,
        compiled: compileMilkdropPresetSource(raw, {
          id: file.replace(/\.milk$/u, ''),
          origin: 'bundled',
        }),
      };
    });
}

describe('butterchurn preset corpus support', () => {
  // Reading and compiling the full 1,700+ preset corpus takes 6-8s on a warm
  // laptop, so bun's 5s default made this fail as a matter of course rather
  // than because anything regressed.
  test(
    'corpus support statuses match the measured baseline',
    () => {
      const corpus = loadButterchurnCorpus();

      expect(corpus.length).toBeGreaterThan(1700);

      // Hard floor: nothing in the bundled corpus may be flat-out
      // unsupported on either backend.
      const unsupported = corpus.filter(
        ({ compiled }) =>
          compiled.ir.compatibility.backends.webgl.status === 'unsupported' ||
          compiled.ir.compatibility.backends.webgpu.status === 'unsupported',
      );
      expect(unsupported.map(({ file }) => file)).toEqual([]);

      // Partial statuses must be explained by a known evidence code — an
      // unexplained partial means a new gap slipped in unclassified.
      const knownPartialCodes = new Set([
        'shader-text-translated',
        'unknown-function',
        'unknown-field',
      ]);
      const unexplainedPartials = corpus.filter(({ compiled }) => {
        const { webgl, webgpu } = compiled.ir.compatibility.backends;
        return [webgl, webgpu].some(
          (backend) =>
            backend.status === 'partial' &&
            !backend.evidence.every((entry) =>
              knownPartialCodes.has(entry.code),
            ),
        );
      });
      expect(unexplainedPartials.map(({ file }) => file)).toEqual([]);

      // Measured baseline (2026-08-22): 19 presets execute shader programs
      // directly on WebGL but fall back to extracted scalar controls on
      // WebGPU, and 9 presets reference EEL identifiers the expression VM
      // evaluates to 0. The WebGPU count was 169 until `if`/`else` bodies
      // were flattened into masked assignments and the shader tokenizer
      // learned scientific notation, then 40 until bounded `for` loops were
      // unrolled. What is left are 7 `while (true)` bodies, 7 loops whose
      // trip count is a runtime value, and 5 bodies that assign to `mat2`
      // elements — none of which the statement model can express. These
      // counts moving DOWN means gaps were closed — update the baseline.
      // Moving UP means a regression introduced new degradation.
      const translatedOnWebgpu = corpus.filter(({ compiled }) =>
        compiled.ir.compatibility.backends.webgpu.evidence.some(
          (entry) => entry.code === 'shader-text-translated',
        ),
      );
      expect(translatedOnWebgpu.length).toBe(19);

      const missingIdentifiers = corpus.filter(
        ({ compiled }) =>
          compiled.ir.compatibility.parity.missingAliasesOrFunctions.length > 0,
      );
      expect(missingIdentifiers.length).toBe(9);

      // Everything else stays fully supported on both backends. 1577 until
      // branch flattening moved 125 presets off the WebGPU control fallback,
      // and 1702 until loop unrolling moved 21 more.
      const fullySupported = corpus.filter(({ compiled }) => {
        const { webgl, webgpu } = compiled.ir.compatibility.backends;
        return webgl.status === 'supported' && webgpu.status === 'supported';
      });
      expect(fullySupported.length).toBe(1723);
    },
    { timeout: 30000 },
  );
});
