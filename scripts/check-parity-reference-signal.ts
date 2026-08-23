/**
 * Checks whether each certified projectM reference frame carries enough signal
 * to prove anything.
 *
 * Guard for the promote stage of the parity pipeline (capture -> diff ->
 * promote). Scores every reference image against the one frame a dead renderer
 * always produces — solid black — using that preset's own diff threshold. When
 * a black frame already scores at or under the preset's fail threshold, the
 * reference passes trivially: it certifies nothing, and a real regression
 * cannot make it fail. Also reports luminance spread, entropy and distinct
 * colours so a near-empty reference is visible before it is trusted.
 *
 *   bun run parity:check-references [-- --preset <id>] [--strict] [--json]
 *
 * `--strict` exits non-zero on any reference without signal (used by
 * parity:promote-reference to refuse certifying one), `--min-headroom <n>`
 * changes how many times the fail threshold a reference must clear.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadImagePixels } from './diff-parity-artifacts.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

/**
 * How many times its own fail threshold a reference's blank-frame score must
 * clear before the reference is worth diffing against.
 *
 * At exactly 1x a solid-black capture lands on the pass/fail line, so the
 * reference distinguishes "correct" from "renderer produced nothing" by
 * nothing at all. 4x is the smallest margin that survived the measured
 * run-to-run noise on this corpus, where serial captures of a single preset
 * moved by ~0.5 percentage points between runs.
 */
export const DEFAULT_MIN_SIGNAL_HEADROOM = 4;

export type ReferenceSignalReport = {
  presetId: string;
  imagePath: string;
  width: number;
  height: number;
  threshold: number;
  failThreshold: number;
  /** Mismatch ratio a solid-black frame scores against this reference. */
  blankFrameMismatch: number;
  /** blankFrameMismatch / failThreshold. Below 1, a black frame passes. */
  signalHeadroom: number;
  meanLuminance: number;
  luminanceStdDev: number;
  /** Shannon entropy of the luminance histogram, in bits (0-8). */
  luminanceEntropy: number;
  distinctColors: number;
  status: 'ok' | 'weak' | 'no-signal';
  reason: string | null;
};

export async function scoreReferenceSignal({
  presetId,
  imagePath,
  threshold,
  failThreshold,
  minHeadroom,
}: {
  presetId: string;
  imagePath: string;
  threshold: number;
  failThreshold: number;
  minHeadroom: number;
}): Promise<ReferenceSignalReport> {
  const image = await loadImagePixels(imagePath);
  const totalPixels = image.width * image.height;
  const histogram = new Float64Array(256);
  const colors = new Set<number>();
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let blankMismatchedPixels = 0;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    const offset = pixelIndex * image.channels;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    // Against a solid-black frame the per-channel delta is the channel value,
    // so the reference's own brightest channel decides whether that frame
    // would have registered as a mismatch here.
    if (Math.max(red, green, blue) > threshold) {
      blankMismatchedPixels += 1;
    }
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    histogram[Math.round(luminance)] += 1;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    colors.add(((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3));
  }

  const meanLuminance = luminanceSum / totalPixels;
  const variance = luminanceSquaredSum / totalPixels - meanLuminance ** 2;
  let entropy = 0;
  for (const count of histogram) {
    if (count > 0) {
      const probability = count / totalPixels;
      entropy -= probability * Math.log2(probability);
    }
  }

  const blankFrameMismatch = blankMismatchedPixels / totalPixels;
  const signalHeadroom =
    failThreshold === 0
      ? Number.POSITIVE_INFINITY
      : blankFrameMismatch / failThreshold;

  let status: ReferenceSignalReport['status'] = 'ok';
  let reason: string | null = null;
  if (blankFrameMismatch <= failThreshold) {
    status = 'no-signal';
    reason =
      `A solid-black frame scores ${(blankFrameMismatch * 100).toFixed(3)}% against this ` +
      `reference, at or under its ${(failThreshold * 100).toFixed(2)}% fail threshold. ` +
      `A renderer that draws nothing passes this preset, so the reference cannot fail for a real reason.`;
  } else if (signalHeadroom < minHeadroom) {
    status = 'weak';
    reason =
      `A solid-black frame scores ${(blankFrameMismatch * 100).toFixed(3)}%, only ` +
      `${signalHeadroom.toFixed(1)}x this preset's ${(failThreshold * 100).toFixed(2)}% fail threshold ` +
      `(want ${minHeadroom}x). Most of the frame is background, so most of a regression would land where nothing is drawn.`;
  }

  return {
    presetId,
    imagePath,
    width: image.width,
    height: image.height,
    threshold,
    failThreshold,
    blankFrameMismatch,
    signalHeadroom,
    meanLuminance: meanLuminance / 255,
    luminanceStdDev: Math.sqrt(Math.max(0, variance)) / 255,
    luminanceEntropy: entropy,
    distinctColors: colors.size,
    status,
    reason,
  };
}

export async function checkParityReferenceSignal({
  repoRoot,
  presetIds,
  minHeadroom = DEFAULT_MIN_SIGNAL_HEADROOM,
}: {
  repoRoot: string;
  presetIds?: string[];
  minHeadroom?: number;
}) {
  const manifest = loadVisualReferenceManifest(repoRoot);
  const filter = presetIds?.length ? new Set(presetIds) : null;
  const reports: ReferenceSignalReport[] = [];
  for (const preset of manifest.presets) {
    if (filter && !filter.has(preset.id)) {
      continue;
    }
    const imagePath = path.join(repoRoot, manifest.fixtureRoot, preset.image);
    if (!fs.existsSync(imagePath)) {
      continue;
    }
    reports.push(
      await scoreReferenceSignal({
        presetId: preset.id,
        imagePath,
        threshold: preset.tolerance.threshold,
        failThreshold: preset.tolerance.failThreshold,
        minHeadroom,
      }),
    );
  }
  return {
    minHeadroom,
    reports,
    noSignalCount: reports.filter((report) => report.status === 'no-signal')
      .length,
    weakCount: reports.filter((report) => report.status === 'weak').length,
  };
}

function usage() {
  console.error(
    'Usage: bun scripts/check-parity-reference-signal.ts [options]',
  );
  console.error('Options:');
  console.error('  --preset <id>        Check one reference (repeatable)');
  console.error(
    '  --min-headroom <n>   Required blank-frame margin (default: 4)',
  );
  console.error(
    '  --strict             Exit non-zero when a reference has no signal',
  );
  console.error('  --json               Print the full report as JSON');
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  const presetIds = argv.flatMap((arg, index) =>
    arg === '--preset' && argv[index + 1] ? [argv[index + 1] as string] : [],
  );
  const headroomIndex = argv.indexOf('--min-headroom');
  const minHeadroom =
    headroomIndex !== -1 && argv[headroomIndex + 1]
      ? Number.parseFloat(argv[headroomIndex + 1] as string)
      : DEFAULT_MIN_SIGNAL_HEADROOM;

  const result = await checkParityReferenceSignal({
    repoRoot: process.cwd(),
    presetIds,
    minHeadroom: Number.isFinite(minHeadroom)
      ? minHeadroom
      : DEFAULT_MIN_SIGNAL_HEADROOM,
  });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `${'preset'.padEnd(40)}${'status'.padEnd(11)}${'blank-frame'.padEnd(13)}${'headroom'.padEnd(10)}entropy`,
    );
    for (const report of result.reports) {
      console.log(
        report.presetId.padEnd(40) +
          report.status.padEnd(11) +
          `${(report.blankFrameMismatch * 100).toFixed(3)}%`.padEnd(13) +
          `${report.signalHeadroom.toFixed(1)}x`.padEnd(10) +
          report.luminanceEntropy.toFixed(2),
      );
    }
    for (const report of result.reports) {
      if (report.reason) {
        console.log(`\n${report.presetId}: ${report.reason}`);
      }
    }
    console.log(
      `\n${result.reports.length} reference(s): ${result.noSignalCount} with no signal, ${result.weakCount} weak.`,
    );
  }

  if (argv.includes('--strict') && result.noSignalCount > 0) {
    process.exit(1);
  }
}
