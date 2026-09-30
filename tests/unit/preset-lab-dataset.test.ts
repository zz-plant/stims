/**
 * lab:dataset's building blocks: family-level splits, the .npy encoder and
 * the per-preset run that fills each states file.
 *
 * The split test is the one that matters most for anyone training on the
 * output: a remix and its parent must never land on opposite sides, or every
 * validation score is measured on near-copies of training data.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAudioFileInputs } from '../../scripts/audio-file-inputs.ts';
import {
  assignFamilySplits,
  audioScenarioName,
  CANONICAL_VARIABLES,
  computeSignals,
  encodeFloats,
  encodeNpy,
  float32ToFloat16Bits,
  keepEvery,
  packInputs,
  resolveAudioPaths,
  runPresetForDataset,
  SIGNAL_COLUMNS,
} from '../../scripts/preset-lab-dataset.ts';
import {
  buildScenarioInputs,
  runTrace,
} from '../../scripts/preset-lab-replay.ts';
import type { LineageCatalogEntry } from '../../src/js/milkdrop/preset-lineage.ts';

const entry = (id: string, title: string, author?: string) => ({
  id,
  title,
  author,
});

/** Many unrelated two-member families, so every split receives some. */
function catalogOfFamilies(count: number): LineageCatalogEntry[] {
  const entries: LineageCatalogEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const work = `Work Number ${index}`;
    entries.push(entry(`root-${index}`, `Aderrasi - ${work}`, 'Aderrasi'));
    entries.push(
      entry(`mix-${index}`, `Aderrasi - ${work} (Kali Mix)`, 'Aderrasi'),
    );
  }
  return entries;
}

describe('assignFamilySplits', () => {
  test('puts every member of a remix family in the same split', () => {
    const entries = catalogOfFamilies(200);
    const splits = assignFamilySplits(entries, { val: 0.2, test: 0.2 });
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const root = splits.get(`root-${index}`);
      const mix = splits.get(`mix-${index}`);
      expect(mix?.family).toBe(root?.family as string);
      expect(mix?.split).toBe(root?.split as 'train');
      seen.add(root?.split as string);
    }
    // Families really are spread across splits, not all dumped in train.
    expect([...seen].sort()).toEqual(['test', 'train', 'val']);
  });

  test('roughly honours the requested fractions', () => {
    const splits = assignFamilySplits(catalogOfFamilies(2000), {
      val: 0.1,
      test: 0.2,
    });
    const counts = { train: 0, val: 0, test: 0 };
    for (const { split } of splits.values()) counts[split] += 1;
    expect(counts.test / 4000).toBeGreaterThan(0.15);
    expect(counts.test / 4000).toBeLessThan(0.25);
    expect(counts.val / 4000).toBeGreaterThan(0.06);
    expect(counts.val / 4000).toBeLessThan(0.14);
  });

  test('is deterministic, independent of catalog order, and seedable', () => {
    const entries = catalogOfFamilies(300);
    const fractions = { val: 0.1, test: 0.1 };
    const first = assignFamilySplits(entries, fractions);
    const reversed = assignFamilySplits([...entries].reverse(), fractions);
    for (const [id, value] of first) {
      expect(reversed.get(id)).toEqual(value);
    }
    const reseeded = assignFamilySplits(entries, fractions, 'other-seed');
    const moved = [...first].filter(
      ([id, value]) => reseeded.get(id)?.split !== value.split,
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  test('a preset with no parseable credit is its own family', () => {
    const splits = assignFamilySplits([entry('lonely', '')], {
      val: 0,
      test: 0,
    });
    expect(splits.get('lonely')).toEqual({
      family: 'solo:lonely',
      split: 'train',
    });
  });
});

/** Minimal .npy reader: enough to prove the encoder's bytes are valid. */
function decodeNpy(bytes: Uint8Array) {
  expect([...bytes.slice(0, 8)]).toEqual([
    0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0,
  ]);
  const headerLength = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.slice(10, 10 + headerLength));
  const dataOffset = 10 + headerLength;
  return { header, dataOffset, data: bytes.slice(dataOffset) };
}

describe('encodeNpy', () => {
  test('writes an aligned v1.0 header and the raw float32 payload', () => {
    const values = new Float32Array([1.5, -2, 3.25, 0, 7, 1e-3]);
    const { header, dataOffset, data } = decodeNpy(encodeNpy(values, [2, 3]));
    expect(dataOffset % 64).toBe(0);
    expect(header.endsWith('\n')).toBe(true);
    expect(header).toContain("'descr': '<f4'");
    expect(header).toContain("'fortran_order': False");
    expect(header).toContain("'shape': (2, 3)");
    expect([...new Float32Array(data.buffer.slice(data.byteOffset))]).toEqual([
      ...values,
    ]);
  });

  test('declares uint8 and a one-dimensional shape correctly', () => {
    const { header, data } = decodeNpy(
      encodeNpy(new Uint8Array([0, 128, 255]), [3]),
    );
    expect(header).toContain("'descr': '|u1'");
    expect(header).toContain("'shape': (3,)");
    expect([...data]).toEqual([0, 128, 255]);
  });

  test('rejects a shape that does not match the data', () => {
    expect(() => encodeNpy(new Float32Array(5), [2, 3])).toThrow();
  });
});

const REACTIVE_PRESET = `[preset00]
zoom=1.0
per_frame_1=zoom = 1 + bass*0.1;
per_frame_2=q1 = time;
`;

const STATIC_PRESET = `[preset00]
zoom=1.0
rot=0.0
`;

describe('runPresetForDataset', () => {
  const inputs = buildScenarioInputs('bass-pulse', 60);

  test('records the canonical columns frame by frame', () => {
    const run = runPresetForDataset(
      REACTIVE_PRESET,
      'reactive',
      inputs,
      CANONICAL_VARIABLES,
    );
    expect(run.status).toBe('ok');
    expect(run.columns).toEqual([...CANONICAL_VARIABLES]);
    const states = run.states as Float32Array;
    expect(states.length).toBe(60 * CANONICAL_VARIABLES.length);
    const zoomColumn = CANONICAL_VARIABLES.indexOf('zoom');
    const zooms = Array.from(
      { length: 60 },
      (_, frame) => states[frame * CANONICAL_VARIABLES.length + zoomColumn],
    );
    // zoom follows the bass pulse, so it must actually vary and stay in the
    // range the equation allows.
    expect(Math.max(...zooms) - Math.min(...zooms)).toBeGreaterThan(0.01);
    for (const zoom of zooms) {
      expect(zoom).toBeGreaterThanOrEqual(0.99);
    }
    const q1Column = CANONICAL_VARIABLES.indexOf('q1');
    const lastQ1 = states[59 * CANONICAL_VARIABLES.length + q1Column];
    expect(lastQ1).toBeGreaterThan(states[q1Column] as number);
  });

  test('flags a preset whose output never changes as static', () => {
    const run = runPresetForDataset(
      STATIC_PRESET,
      'static',
      inputs,
      CANONICAL_VARIABLES,
    );
    expect(run.status).toBe('static');
    expect(run.states).not.toBeNull();
  });

  test('a value too large for float32 is non-finite, not ok', () => {
    // 1e39 is a finite float64 but overflows the float32 the states are
    // stored in: it must not reach the export as Infinity with status ok.
    const run = runPresetForDataset(
      `[preset00]\nper_frame_1=q1 = pow(10, 39);\n`,
      'overflow',
      inputs,
      CANONICAL_VARIABLES,
    );
    expect(run.status).toBe('nan');
    expect(run.states).toBeNull();
  });

  test("'all' exports every numeric variable the VM exposes", () => {
    const run = runPresetForDataset(REACTIVE_PRESET, 'reactive', inputs, 'all');
    expect(run.columns.length).toBeGreaterThan(CANONICAL_VARIABLES.length);
    expect(run.columns).toContain('zoom');
    expect(run.columns).toEqual([...run.columns].sort());
    expect(run.states?.length).toBe(60 * run.columns.length);
  });
});

describe('scenario inputs and signals', () => {
  test('packs spectrum then waveform per frame', () => {
    const inputs = buildScenarioInputs('full-mix', 4);
    const packed = packInputs(inputs);
    expect(packed.length).toBe(4 * 256);
    expect([...packed.slice(256, 256 + 128)]).toEqual(inputs[1]?.frequencyData);
    expect([...packed.slice(256 + 128, 512)]).toEqual(inputs[1]?.waveformData);
  });

  test('signals respond to the scenario: silence is quieter than bass', () => {
    // Band levels are relative (MilkDrop reads 1.0 as "average"), so silence
    // reports bass=1; rms is the absolute loudness.
    const rmsColumn = SIGNAL_COLUMNS.indexOf('rms');
    const mean = (values: Float32Array) => {
      let sum = 0;
      for (let frame = 0; frame < 120; frame += 1) {
        sum += values[frame * SIGNAL_COLUMNS.length + rmsColumn] as number;
      }
      return sum / 120;
    };
    const silent = computeSignals(buildScenarioInputs('silence', 120));
    const bass = computeSignals(buildScenarioInputs('bass-pulse', 120));
    expect(mean(bass)).toBeGreaterThan(mean(silent));
  });
});

/** A 120 BPM kick drum: a pitch-dropping sine burst every half second. */
function kicks(seconds: number, sampleRate: number) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    const phase = (index / sampleRate) % 0.5;
    samples[index] =
      0.8 *
      Math.exp(-phase * 12) *
      Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-phase * 30)) * phase);
  }
  return samples;
}

describe('audio-file scenarios', () => {
  const sampleRate = 44100;
  const audioInputs = () =>
    buildAudioFileInputs(
      { sampleRate, channels: [kicks(2, sampleRate)] },
      { frames: 90 },
    );

  test('presets step with the recorded live signals, as lab:replay does', async () => {
    const inputs = await audioInputs();
    const run = runPresetForDataset(
      REACTIVE_PRESET,
      'reactive',
      inputs,
      CANONICAL_VARIABLES,
    );
    expect(run.status).toBe('ok');
    // The same frames replayed by lab:replay must give the same zoom: one
    // signal path for both tools, not a second interpretation of the bytes.
    const replayed = runTrace(REACTIVE_PRESET, 'reactive', inputs);
    const zoomColumn = CANONICAL_VARIABLES.indexOf('zoom');
    const states = run.states as Float32Array;
    replayed.forEach((frame, index) => {
      expect(
        states[index * CANONICAL_VARIABLES.length + zoomColumn],
      ).toBeCloseTo(frame.variables?.zoom ?? Number.NaN, 5);
    });
    const zooms = replayed.map((frame) => frame.variables?.zoom ?? 0);
    expect(Math.max(...zooms) - Math.min(...zooms)).toBeGreaterThan(0.01);
  });

  test('signals are the recorded ones, and inputs keep the live shape', async () => {
    const inputs = await audioInputs();
    const signals = computeSignals(inputs);
    const bass = SIGNAL_COLUMNS.indexOf('bass');
    const beat = SIGNAL_COLUMNS.indexOf('beat');
    inputs.forEach((input, frame) => {
      expect(signals[frame * SIGNAL_COLUMNS.length + bass]).toBeCloseTo(
        Number(input.signals?.bass),
        5,
      );
      expect(signals[frame * SIGNAL_COLUMNS.length + beat]).toBe(
        Number(input.signals?.beat ?? 0),
      );
    });
    const packed = packInputs(inputs);
    expect(packed.length).toBe(90 * (512 + 1024));
    expect([...packed.slice(1536 * 40, 1536 * 40 + 512)]).toEqual(
      inputs[40]?.frequencyData,
    );
  });

  test('packInputs refuses a scenario whose shape changes mid-way', () => {
    const inputs = buildScenarioInputs('full-mix', 3);
    const broken = [
      ...inputs.slice(0, 2),
      { ...inputs[2], frequencyData: [1, 2, 3] },
    ] as typeof inputs;
    expect(() => packInputs(broken)).toThrow('changes the input shape');
  });

  test('audio paths expand directories and names stay unique', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-dataset-'));
    try {
      for (const name of ['b.wav', 'a.WAV', 'notes.txt']) {
        fs.writeFileSync(path.join(dir, name), '');
      }
      expect(
        resolveAudioPaths([dir]).map((file) => path.basename(file)),
      ).toEqual(['a.WAV', 'b.wav']);
      const taken = new Set(['full-mix']);
      expect(audioScenarioName('/x/My Song.wav', taken)).toBe('audio-My_Song');
      expect(audioScenarioName('/y/My Song.wav', taken)).toBe(
        'audio-My_Song-2',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('storage options', () => {
  test('float16 conversion matches the platform Float16Array bit for bit', () => {
    let seed = 5;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const values = [
      0,
      -0,
      1,
      -1,
      0.1,
      1 / 3,
      65504,
      -65504,
      65519,
      6.1e-5,
      5.96e-8,
      2.98e-8,
      1e-9,
      2049,
      2051,
      1.0009765625,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (let i = 0; i < 20000; i += 1) {
      // Spread across the whole float16 range, subnormals included.
      values.push((random() * 2 - 1) * 2 ** (random() * 40 - 25));
    }
    const input = new Float32Array(values);
    const { bits } = float32ToFloat16Bits(input);
    const expected = new Uint16Array(new Float16Array(input).buffer);
    const mismatches = [...bits].filter((b, i) => b !== expected[i]).length;
    expect(mismatches).toBe(0);
    const nan = float32ToFloat16Bits(new Float32Array([Number.NaN])).bits[0];
    expect(
      ((nan as number) & 0x7c00) === 0x7c00 && (nan as number) & 0x3ff,
    ).toBeTruthy();
  });

  test('values beyond float16 range are clamped and counted, not made infinite', () => {
    const { bits, clamped } = float32ToFloat16Bits(
      new Float32Array([1e6, -3e5, 12, Number.POSITIVE_INFINITY]),
    );
    expect(clamped).toBe(2);
    expect([...bits]).toEqual([0x7bff, 0xfbff, 0x4a00, 0x7c00]);
  });

  test('encodeFloats writes <f2 for float16 and <f4 for float32', () => {
    const header = (bytes: Uint8Array) =>
      new TextDecoder().decode(bytes.slice(10, 10 + (bytes[8] as number)));
    const values = new Float32Array([1, 2, 3, 4]);
    const half = encodeFloats(values, [2, 2], 'float16');
    expect(header(half.bytes)).toContain("'descr': '<f2'");
    expect(half.bytes.length - 10 - (half.bytes[8] as number)).toBe(8);
    expect(header(encodeFloats(values, [2, 2], 'float32').bytes)).toContain(
      "'descr': '<f4'",
    );
  });

  test('keepEvery keeps rows 0, n, 2n and the partial tail', () => {
    const rows = new Float32Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect([...keepEvery(rows, 2, 2)]).toEqual([0, 0, 2, 2, 4, 4]);
    expect(keepEvery(rows, 2, 1)).toBe(rows);
    expect([...keepEvery(new Uint8Array([7, 8, 9]), 1, 3)]).toEqual([7]);
  });
});
