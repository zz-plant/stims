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

      // Measured baseline (2026-08-22): 226 presets execute shader programs
      // directly on WebGL but fall back to extracted scalar controls on
      // WebGPU, and 9 presets reference EEL identifiers the expression VM
      // evaluates to 0.
      //
      // This number is a SHIPPED-DEFAULT number, and most of the reach it
      // reports as missing is gated rather than lost. Flattening `if`/`else`
      // into masked assignments and unrolling bounded `for` loops takes it to
      // 19, but that work is behind the `shaderBranchDesugar` flag
      // (`?milkdrop-webgpu-branch-desugar=1`), off by default while the WebGPU
      // executor gaps it exposes are closed — one of them kills the GPU
      // process. Turn the flag on and this assertion is expected to fail; the
      // desugar's own coverage in
      // tests/unit/milkdrop-compiler-shader-analysis.test.ts enables it
      // explicitly so the rewrite stays exercised either way.
      //
      // Of the 226, 168 is what this was before the desugar existed at all —
      // 7 `while (true)` bodies, 7 loops whose trip count is a runtime value,
      // and the branchy bodies the statement model cannot express. The other
      // 58 are bodies that assign to a `mat2`/`mat3`/`mat4` element, which is
      // NOT gated: the node executor has no way to express that write, and
      // what it built instead was a 44641-member WGSL uniform struct that
      // took the GPU process down.
      //
      // These counts moving DOWN means gaps were closed — update the
      // baseline. Moving UP means a regression introduced new degradation.
      const translatedOnWebgpu = corpus.filter(({ compiled }) =>
        compiled.ir.compatibility.backends.webgpu.evidence.some(
          (entry) => entry.code === 'shader-text-translated',
        ),
      );
      expect(translatedOnWebgpu.length).toBe(226);

      const missingIdentifiers = corpus.filter(
        ({ compiled }) =>
          compiled.ir.compatibility.parity.missingAliasesOrFunctions.length > 0,
      );
      expect(missingIdentifiers.length).toBe(8);

      // Everything else stays fully supported on both backends. Measured on
      // the same corpus: 1578 with the branch desugar gated off and matrix
      // element writes still claiming to be executable, 1521 once the matrix
      // gate lands, and 1612 with `shaderBranchDesugar` turned on as well.
      const fullySupported = corpus.filter(({ compiled }) => {
        const { webgl, webgpu } = compiled.ir.compatibility.backends;
        return webgl.status === 'supported' && webgpu.status === 'supported';
      });
      expect(fullySupported.length).toBe(1521);
    },
    { timeout: 30000 },
  );
});
