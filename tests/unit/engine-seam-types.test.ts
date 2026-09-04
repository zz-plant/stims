import { describe, expect, it } from 'bun:test';
import type { EngineSnapshot } from '../../src/js/frontend/engine/engine-snapshot.ts';
import type { createMilkdropExperience } from '../../src/js/milkdrop/runtime.ts';
import type {
  MilkdropExperienceController,
  MilkdropExperienceSnapshot,
} from '../../src/js/milkdrop/runtime-types.ts';

// Type-level assertion helper:
// `IsAny<T>` is true only when T is the `any` type (or unknown in specific intersections).
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('engine-seam-types', () => {
  it('guarantees key snapshot properties at the engine seam are strictly typed and not any', () => {
    type Controller = ReturnType<typeof createMilkdropExperience>;
    type Snapshot = ReturnType<Controller['getStateSnapshot']>;

    // Assert that activePresetId is strictly typed and not any
    const activePresetIdIsAny: IsAny<Snapshot['activePresetId']> = false;
    expect(activePresetIdIsAny).toBe(false);

    // Assert that backend is strictly typed and not any
    const backendIsAny: IsAny<Snapshot['backend']> = false;
    expect(backendIsAny).toBe(false);

    // Assert that audioEnergy is strictly typed and not any
    const audioEnergyIsAny: IsAny<Snapshot['audioEnergy']> = false;
    expect(audioEnergyIsAny).toBe(false);

    // Assert that EngineSnapshot fields in the frontend shell are not any
    const shellActivePresetIdIsAny: IsAny<EngineSnapshot['activePresetId']> =
      false;
    expect(shellActivePresetIdIsAny).toBe(false);

    const shellBackendIsAny: IsAny<EngineSnapshot['backend']> = false;
    expect(shellBackendIsAny).toBe(false);

    const shellAudioEnergyIsAny: IsAny<EngineSnapshot['audioEnergy']> = false;
    expect(shellAudioEnergyIsAny).toBe(false);

    // Assert that Controller conforms to MilkdropExperienceController
    type AssignableToController =
      Controller extends MilkdropExperienceController ? true : false;
    const isAssignable: AssignableToController = true;
    expect(isAssignable).toBe(true);

    // Assert that Snapshot conforms to MilkdropExperienceSnapshot
    type AssignableToSnapshot = Snapshot extends MilkdropExperienceSnapshot
      ? true
      : false;
    const isSnapshotAssignable: AssignableToSnapshot = true;
    expect(isSnapshotAssignable).toBe(true);
  });
});
