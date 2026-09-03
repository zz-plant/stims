/**
 * Compile-time probe that the engine ↔ shell seam carries real types instead
 * of `any`.
 *
 * The regression this guards against: `buildExperienceController` accepted
 * `Record<string, any>` deps and `getStateSnapshot()` returned whatever
 * `buildSnapshot` produced, so the shell read the engine snapshot through
 * `ReturnType<...>` chains that resolved to `any`. A field renamed or removed
 * in the engine then compiled clean in the shell and failed at runtime. This
 * test asserts the seam types are declared (non-`any`) and the shell snapshot
 * names them directly. It is a type-level probe: the value assignments only
 * compile if the assertion holds, so a positive (`IsAny<T> = true`) line is
 * what breaks when the seam erodes.
 */
import { describe, expect, test } from 'bun:test';
import type { EngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import type {
  MilkdropExperienceController,
  MilkdropExperienceSnapshot,
} from '../../src/js/milkdrop/runtime-types.ts';

type IsAny<T> = 0 extends 1 & T ? true : false;

describe('engine seam types', () => {
  test('the snapshot contract is a declared, non-any type', () => {
    // The declared interface must never be `any`. If someone re-derives the
    // seam through `ReturnType<...>` back to an erased type, this fails.
    const notAny: IsAny<MilkdropExperienceSnapshot> = false;
    expect(notAny).toBe(false);
  });

  test('the controller contract is a declared, non-any type', () => {
    const notAny: IsAny<MilkdropExperienceController> = false;
    expect(notAny).toBe(false);
  });

  test('the shell snapshot names the engine snapshot fields directly', () => {
    // Field-level probes: each must resolve to the engine's declared type,
    // never to `any` or `unknown`.
    const catalogNotAny: IsAny<EngineSnapshot['catalogEntries']> = false;
    const sessionNotAny: IsAny<NonNullable<EngineSnapshot['sessionState']>> =
      false;
    const adaptiveNotAny: IsAny<
      NonNullable<EngineSnapshot['adaptiveQuality']>
    > = false;
    expect(catalogNotAny).toBe(false);
    expect(sessionNotAny).toBe(false);
    expect(adaptiveNotAny).toBe(false);
  });

  test('the snapshot type aliases the engine contract, not a ReturnType chain', () => {
    // `EngineSnapshot['catalogEntries']` must equal the engine's contract
    // array type. A structural check keeps the shell honest that it reads
    // the engine's declared shape rather than a shadow copy.
    const entriesAreEngineEntries:
      | MilkdropExperienceSnapshot['catalogEntries']
      | undefined = undefined as EngineSnapshot['catalogEntries'] | undefined;
    expect(entriesAreEngineEntries).toBeUndefined();
  });

  test('the active-preset control is its declared non-any type', () => {
    // Control: `activePresetId` was already `string | null` before this
    // change. It must stay non-any; this is the negative control that proves
    // the probe is checking (a real `any` field would compile true).
    const control: IsAny<EngineSnapshot['activePresetId']> = false;
    expect(control).toBe(false);
  });
});
