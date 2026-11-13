/**
 * Parity tests for the worker-isolation path (Phase 1 of
 * docs/architecture/vm-worker-isolation.md).
 *
 * A preset's init programs run in a Web Worker, which returns a post-init
 * snapshot the main-thread VM applies. These tests assert the worker path
 * produces the same state as running init in-process.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { compileMilkdropPresetSource } from '../../packages/milkdrop-toolchain/src/compiler.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';
import { VmInitWorkerHost } from '../../src/js/milkdrop/vm-init-host.ts';

const CASES: { name: string; raw: string }[] = [
  {
    name: 'basic init assignment',
    raw: `title=Basic
per_frame_1=q1=q1+1;
init_1=q1=5;
`,
  },
  {
    name: 'custom wave init',
    raw: `title=Wave Init
wave_0_per_point_1=x=i*.1;
init_1=t1=0.5;
`,
  },
  {
    name: 'megabuf init',
    raw: `title=Megabuf
per_frame_1=megabuf(0)=bass; megabuf(1)=megabuf(0)+1;
init_1=megabuf(2)=3.14;
`,
  },
  {
    name: 'register and t init',
    raw: `title=Registers
per_frame_1=q1=sin(time); q2=q1*.5;
init_1=q3=7; t1=0.25;
`,
  },
];

async function assertParity(raw: string, id: string) {
  const preset = compileMilkdropPresetSource(raw, { id });
  const inProcess = createMilkdropVM(preset);
  const expected = inProcess.exportPostInitState();

  const host = new VmInitWorkerHost();
  const workerVm = createMilkdropVM(preset, undefined, {
    deferInit: true,
    useWorkerInit: true,
  });
  const usedWorker = await workerVm.initAsync(host);
  expect(usedWorker).toBe(true);
  const actual = workerVm.exportPostInitState();
  host.dispose();

  expect(actual.state).toEqual(expected.state);
  expect(actual.registersOwn).toEqual(expected.registersOwn);
  expect(Array.from(actual.megabuf)).toEqual(Array.from(expected.megabuf));
  expect(actual.randomCellS).toBe(expected.randomCellS);
  expect(actual.perFrameBaseKeys).toEqual(expected.perFrameBaseKeys);
  expect(actual.perFrameBaseNumbers).toEqual(expected.perFrameBaseNumbers);
  expect(actual.customWaveLocals).toEqual(expected.customWaveLocals);
  expect(actual.customShapeLocals).toEqual(expected.customShapeLocals);
}

for (const { name, raw } of CASES) {
  test(`worker init matches in-process init: ${name}`, async () => {
    await assertParity(raw, name.replace(/\s+/g, '-'));
  });
}

test('worker init matches in-process init on a bundled preset', async () => {
  const raw = readFileSync(
    'public/milkdrop-presets/eos-glowsticks-v2-03-music.milk',
    'utf8',
  );
  await assertParity(raw, 'eos-glowsticks');
});

test('initAsync falls back to in-process when the flag is off', async () => {
  const preset = compileMilkdropPresetSource('title=Fallback\ninit_1=q1=2;\n', {
    id: 'fallback',
  });
  const host = new VmInitWorkerHost();
  const vm = createMilkdropVM(preset, undefined, { useWorkerInit: false });
  const usedWorker = await vm.initAsync(host);
  expect(usedWorker).toBe(false);
  expect(vm.exportPostInitState().registersOwn.q1).toBe(2);
  host.dispose();
});

test('setPresetAsync uses the worker and marks the VM ready', async () => {
  const first = compileMilkdropPresetSource('title=First\ninit_1=q1=1;\n', {
    id: 'first',
  });
  const second = compileMilkdropPresetSource('title=Second\ninit_1=q1=9;\n', {
    id: 'second',
  });
  const host = new VmInitWorkerHost();
  const vm = createMilkdropVM(first, undefined, {
    deferInit: true,
    useWorkerInit: true,
  });
  expect(vm.isReady()).toBe(false);
  const usedWorker = await vm.setPresetAsync(second, host);
  expect(usedWorker).toBe(true);
  expect(vm.isReady()).toBe(true);
  expect(vm.exportPostInitState().registersOwn.q1).toBe(9);
  host.dispose();
});

test('setPresetAsync falls back and stays ready when the flag is off', async () => {
  const preset = compileMilkdropPresetSource('title=Sync\ninit_1=q1=4;\n', {
    id: 'sync',
  });
  const host = new VmInitWorkerHost();
  const vm = createMilkdropVM(preset, undefined, { useWorkerInit: false });
  const usedWorker = await vm.setPresetAsync(preset, host);
  expect(usedWorker).toBe(false);
  expect(vm.isReady()).toBe(true);
  expect(vm.exportPostInitState().registersOwn.q1).toBe(4);
  host.dispose();
});
