/**
 * Bridges Strudel (live-coded audio patterns) into the Stims analyser.
 *
 * Strudel's audio engine (superdough) routes every voice through a master
 * chain that connects to `AudioContext.destination`, and exposes no API to
 * redirect that output. This module tees it instead: `AudioNode.connect` is
 * patched — before Strudel ever loads — so any connection made to a
 * context's hardware destination is duplicated into a
 * `MediaStreamAudioDestinationNode` registered for that context. The
 * resulting MediaStream feeds the same `startAudio({ stream })` seam the
 * file/tab audio sources use, so the speakers and the visualizer receive an
 * identical signal.
 */

export interface StrudelBridge {
  /** Tapped copy of everything Strudel plays; feed this to startAudioSource. */
  stream: MediaStream;
  /** Evaluate a Strudel pattern (starts/replaces playback). */
  evaluate: (code: string) => Promise<unknown>;
  /** Stop all playing patterns. */
  hush: () => void;
}

const taps = new WeakMap<BaseAudioContext, MediaStreamAudioDestinationNode>();
let connectPatched = false;

function ensureConnectTee() {
  if (connectPatched) {
    return;
  }
  connectPatched = true;

  const original = AudioNode.prototype.connect;
  const patched = function (this: AudioNode, ...args: unknown[]) {
    const result = Reflect.apply(
      original as (...callArgs: unknown[]) => unknown,
      this,
      args,
    );
    const tap = taps.get(this.context);
    if (tap && args[0] === this.context.destination) {
      (original as (this: AudioNode, destination: AudioNode) => AudioNode).call(
        this,
        tap,
      );
    }
    return result;
  };
  AudioNode.prototype.connect = patched as AudioNode['connect'];
}

let bridgePromise: Promise<StrudelBridge> | null = null;
let resolvedBridge: StrudelBridge | null = null;

/**
 * Returns the bridge if one has already finished loading, without triggering
 * a load. Lets a remounted panel (the stage remounts on the home→live
 * transition) rehydrate its state instead of losing the scope stream.
 */
export function peekStrudelBridge(): StrudelBridge | null {
  return resolvedBridge;
}

/**
 * Loads Strudel on first call and returns a singleton bridge.
 * Set prebake=false to skip downloading dirt-samples (synth-only mode).
 * Failed loads clear the cache so a retry is possible.
 */
export function loadStrudelBridge(options?: {
  prebake?: boolean;
}): Promise<StrudelBridge> {
  if (!bridgePromise) {
    bridgePromise = createBridge(options).catch((error) => {
      bridgePromise = null;
      throw error;
    });
  }
  return bridgePromise;
}

async function createBridge(options?: {
  prebake?: boolean;
}): Promise<StrudelBridge> {
  ensureConnectTee();

  const strudel = await import('@strudel/web');

  // Register the tap before initStrudel so the tee catches superdough's
  // master-chain connect no matter when it fires.
  const context = strudel.getAudioContext();
  let tap = taps.get(context);
  if (!tap) {
    tap = context.createMediaStreamDestination();
    taps.set(context, tap);
  }

  const prebake = options?.prebake ?? true;

  await strudel.initStrudel({
    prebake: prebake
      ? () => strudel.samples('github:tidalcycles/dirt-samples')
      : undefined,
  });

  resolvedBridge = {
    stream: tap.stream,
    evaluate: async (code: string) => {
      if (context.state === 'suspended') {
        await context.resume();
      }
      return strudel.evaluate(code);
    },
    hush: () => strudel.hush(),
  };
  return resolvedBridge;
}
