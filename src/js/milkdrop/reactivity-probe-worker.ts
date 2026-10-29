/**
 * Terminable worker for the audio-reactivity probe.
 *
 * `probePresetReactivity({ verify: true })` steps an untrusted preset through
 * two frame timelines on the CPU. That is fine for a preset the compiler just
 * produced from a trusted template, but a generated or pasted source can put
 * an expensive loop in per-frame code, and the probe runs it synchronously.
 * Running the probe here lets the main thread terminate the worker on a
 * timeout instead of waiting for the preset to finish.
 *
 * The request carries the raw source, not a compiled preset: parsing and
 * compilation are part of the work an untrusted source controls, so they
 * happen here too. The reply is plain data (`verdict`, `score`, variable
 * names), so no VM state crosses the boundary.
 */

import type { MilkdropPresetSource } from 'milkdrop-toolchain/src/common-types.ts';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  probePresetReactivity,
  type ReactivityProbeResult,
} from './reactivity-probe.ts';

type ProbeRequest = {
  source: MilkdropPresetSource;
  verify: boolean;
};

type ProbeReply =
  | { ok: true; result: ReactivityProbeResult }
  | { ok: false; error: string };

/** Minimal worker scope: the DOM lib types `self` as Window, whose
 * `postMessage` requires a target origin. */
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ProbeRequest>) => void) | null;
  postMessage: (message: ProbeReply) => void;
};

workerScope.onmessage = (event) => {
  const { source, verify } = event.data;
  try {
    const compiled = compileMilkdropPresetSource(source.raw, source);
    workerScope.postMessage({
      ok: true,
      result: probePresetReactivity(compiled, { verify }),
    });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
