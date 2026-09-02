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

      // Measured baseline (2026-09-02): 168 presets execute shader programs
      // directly on WebGL but fall back to extracted scalar controls on
      // WebGPU, and 8 presets reference EEL identifiers the expression VM
      // evaluates to 0.
      //
      // This number is a SHIPPED-DEFAULT number, and almost all of the reach
      // it reports as missing is gated rather than lost. Flattening
      // `if`/`else` into masked assignments and unrolling bounded `for` loops
      // takes it to 14, but that work is behind the `shaderBranchDesugar`
      // flag (`?milkdrop-webgpu-branch-desugar=1`), off by default while the
      // WebGPU executor gaps it exposes are closed. Turn the flag on and this
      // assertion is expected to fail; the desugar's own coverage in
      // tests/unit/milkdrop-compiler-shader-analysis.test.ts enables it
      // explicitly so the rewrite stays exercised either way.
      //
      // Every one of the 168 is a body the statement model cannot express
      // without the desugar — 7 `while (true)` bodies, 7 loops whose trip
      // count is a runtime value, and branchy bodies. Matrix element writes
      // are no longer among them: the node executor packs a mat2 as a vec4
      // of its columns and carries a mat3/mat4 as explicit column vectors,
      // so `M[int(0)].x = q20` on any size runs directly (57 mat2 presets
      // moved on 2026-09-02, 20 mat3 presets the same day — 19 of those also
      // branch, so only one shows up in this shipped-default number).
      //
      // These counts moving DOWN means gaps were closed — update the
      // baseline. Moving UP means a regression introduced new degradation.
      const translatedOnWebgpu = corpus.filter(({ compiled }) =>
        compiled.ir.compatibility.backends.webgpu.evidence.some(
          (entry) => entry.code === 'shader-text-translated',
        ),
      );
      expect(translatedOnWebgpu.length).toBe(168);

      const missingIdentifiers = corpus.filter(
        ({ compiled }) =>
          compiled.ir.compatibility.parity.missingAliasesOrFunctions.length > 0,
      );
      expect(missingIdentifiers.length).toBe(8);

      // Everything else stays fully supported on both backends. Measured on
      // the same corpus: 1578 with the branch desugar gated off and every
      // matrix element write still claiming to be executable, 1521 once the
      // matrix gate landed on all sizes, 1577 with the gate narrowed to
      // mat3/mat4, 1578 with mat3/mat4 executing (the gate now covers only
      // runtime-index writes, of which the corpus has none), and 1729 with
      // `shaderBranchDesugar` turned on as well.
      const fullySupported = corpus.filter(({ compiled }) => {
        const { webgl, webgpu } = compiled.ir.compatibility.backends;
        return webgl.status === 'supported' && webgpu.status === 'supported';
      });
      expect(fullySupported.length).toBe(1578);
    },
    { timeout: 30000 },
  );
});
