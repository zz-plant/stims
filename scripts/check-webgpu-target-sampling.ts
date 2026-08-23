#!/usr/bin/env bun
/**
 * Blocks a bare `.sample()` against one of the WebGPU feedback manager's own
 * render targets.
 *
 * Rendering into a render target lands the image with its rows in the opposite
 * order from the uv a later pass samples it with, so every read of one of those
 * targets has to flip back into screen space. That convention shipped broken:
 * every pass wrote with the inversion and read without it, which mirrored the
 * whole frame against WebGL and — because the feedback loop is a cycle through
 * one target — made history come back flipped every frame, so motion piled up
 * in both directions instead of streaming. It survived for months because a
 * missing flip produces a plausible frame, not an error.
 *
 * The fix is only as durable as the discipline enforcing it: one new call site
 * that samples a target directly silently reintroduces the bug, and no test
 * catches it. So the convention is a build gate instead. Read a target through
 * `sampleFeedbackTarget(node, screenUv)`, or through a coordinate that has been
 * put in target space by `sampleUvNode` (which flips), and this guard is happy.
 *
 * Uploaded textures — noise, aura, video, the glyph atlas — are NOT flipped and
 * are none of this guard's business.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

/** The modules that own the WebGPU feedback render targets. */
const GUARDED_FILES = [
  'src/js/milkdrop/feedback-manager-webgpu-tsl.ts',
  'src/js/milkdrop/feedback-manager-webgpu-composite.ts',
  'src/js/milkdrop/feedback-manager-webgpu-bindings.ts',
];

/**
 * Uniform names bound to a render target this manager writes. `currentTex` is
 * the scene target, `previousTex` the retired feedback half, `internalTex` and
 * `warpTex` this frame's internal image, and the rest are display, blur and
 * transition targets.
 */
const TARGET_UNIFORMS = [
  'currentTex',
  'previousTex',
  'internalTex',
  'warpTex',
  'displayHistoryTex',
  'savedTex',
  'sourceTex',
  'blur1Tex',
  'blur2Tex',
  'blur3Tex',
];

/** A coordinate already in target space needs no further flip. */
const TARGET_SPACE_COORDS = /sampleUvNode|sampleUv\b|flipFeedbackSampleUv/u;

type Violation = { file: string; line: number; text: string };

/**
 * Finds `<expr>.sample(<coord>)` where the receiver names a target uniform.
 * Reads the joined text of the whole file so a call broken across lines by the
 * formatter is still seen as one expression.
 */
function findViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const uniformAlternation = TARGET_UNIFORMS.join('|');
  const pattern = new RegExp(
    String.raw`\b(?:\w+\.)*(${uniformAlternation})\s*\.\s*sample\s*\(([^()]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\)[^()]*)*)\)`,
    'gu',
  );
  for (const match of source.matchAll(pattern)) {
    const coordinate = match[2] ?? '';
    if (TARGET_SPACE_COORDS.test(coordinate)) {
      continue;
    }
    const line = source.slice(0, match.index).split('\n').length;
    violations.push({
      file,
      line,
      text: match[0].replace(/\s+/gu, ' ').slice(0, 120),
    });
  }
  return violations;
}

function main() {
  const violations: Violation[] = [];
  for (const file of GUARDED_FILES) {
    let source: string;
    try {
      source = readFileSync(join(REPO_ROOT, file), 'utf8');
    } catch {
      // A guarded module that no longer exists is a rename, not a violation;
      // the architecture check owns file layout.
      continue;
    }
    violations.push(...findViolations(file, source));
  }

  if (violations.length > 0) {
    console.error(
      '\x1b[31m[ERROR]\x1b[0m WebGPU render target sampled without the row-order flip:',
    );
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
    }
    console.error(
      '\nRead it through sampleFeedbackTarget(node, screenUv) instead — a target\n' +
        'sampled at a raw screen coordinate comes back vertically mirrored, which\n' +
        'renders as a plausible frame rather than an error.',
    );
    process.exit(1);
  }

  console.log(
    `\x1b[32m[INFO]\x1b[0m WebGPU target sampling goes through the flip helper (${GUARDED_FILES.length} modules checked).`,
  );
}

main();
