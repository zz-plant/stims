import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
import {
  handleBlackoutKeyDown,
  handleBlackoutKeyUp,
  handleFlashKeyDown,
  handleFlashKeyUp,
  resetStageUtilitiesForTests,
  stageUtilityMode,
} from '../../src/js/core/services/stage-utilities.ts';
import { StageUtilitiesOverlay } from '../../src/js/frontend/StageUtilitiesOverlay.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

/**
 * The stage utilities' visual layer, against rendered DOM: the blackout
 * must reach the canvas through the luminance service's presentation
 * channel (so it composes with the flash governor instead of fighting it),
 * and the flash must paint above the canvas as an overlay.
 */

let stage: HTMLDivElement | null = null;

beforeEach(() => {
  resetStageUtilitiesForTests();
  stage = document.createElement('div');
  document.body.appendChild(stage);
});

afterEach(() => {
  if (stage) {
    resetStageLuminance(stage);
    stage.remove();
    stage = null;
  }
  resetStageUtilitiesForTests();
});

function mountOverlay() {
  const rendered = renderWorkspace(
    createElement(StageUtilitiesOverlay, {
      stageRef: { current: stage },
    }),
  );
  return {
    ...rendered,
    dispose: () => {
      rendered.dispose();
    },
  };
}

/** Fires the key event pair the real listener would, through the service. */
function pressBlackout() {
  act(() => {
    handleBlackoutKeyDown(false, Date.now());
  });
}

function releaseBlackout() {
  act(() => {
    handleBlackoutKeyUp(Date.now());
  });
}

describe('stage utilities overlay', () => {
  test('with nothing engaged, the stage is untouched and nothing renders', () => {
    const rendered = mountOverlay();
    try {
      expect(
        rendered.container.querySelector('[data-stage-utility]'),
      ).toBeNull();
      expect(stage?.style.filter).toBe('');
    } finally {
      rendered.dispose();
    }
  });

  test('the blackout cuts the stage through the presentation channel', () => {
    const rendered = mountOverlay();
    try {
      pressBlackout();
      // The filter is written by the luminance service, not by this
      // component — a direct style write here would be erased by the next
      // governor frame.
      expect(stage?.style.filter).toBe('brightness(0.000)');
      expect(stageUtilityMode()).toBe('blackout');

      const notice = rendered.container.querySelector(
        '[data-stage-utility="blackout"]',
      );
      expect(notice).not.toBeNull();
      expect(notice?.getAttribute('role')).toBe('status');
      expect(notice?.textContent).toContain('Blackout on');
      // A performer reading the notice must also read the way out.
      expect(notice?.textContent).toContain('press');
      expect(notice?.textContent).toContain('D');
    } finally {
      rendered.dispose();
    }
  });

  test('releasing the blackout restores the stage and drops the notice', () => {
    const rendered = mountOverlay();
    try {
      pressBlackout();
      releaseBlackout();
      expect(stage?.style.filter).toBe('');
      expect(
        rendered.container.querySelector('[data-stage-utility="blackout"]'),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('the flash paints an overlay and never touches the luminance filter', () => {
    const rendered = mountOverlay();
    try {
      act(() => {
        handleFlashKeyDown(false);
      });
      const overlay = rendered.container.querySelector(
        '[data-stage-utility="flash"]',
      );
      expect(overlay).not.toBeNull();
      // White covers the canvas; no filter can make a picture brighter
      // than its brightest pixel, so the filter stays out of this path.
      expect(stage?.style.filter).toBe('');
      // No notice: the effect is its own explanation, and it ends with the
      // key.
      expect(
        rendered.container.querySelector('[data-stage-utility="blackout"]'),
      ).toBeNull();
      act(() => {
        handleFlashKeyUp();
      });
      expect(
        rendered.container.querySelector('[data-stage-utility="flash"]'),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('unmounting releases a latched blackout', () => {
    // A session that ends while the cut is latched must not hand a black
    // stage to whatever renders next.
    const rendered = mountOverlay();
    pressBlackout();
    act(() => {
      handleBlackoutKeyUp(Date.now());
    });
    pressBlackout(); // second fast press latches
    expect(stageUtilityMode()).toBe('blackout');
    expect(stage?.style.filter).toBe('brightness(0.000)');

    rendered.dispose();
    expect(stage?.style.filter).toBe('');
    expect(stageUtilityMode()).toBe('normal');
  });

  test('a visitor ceiling survives the blackout and returns after it', () => {
    const rendered = mountOverlay();
    try {
      setStageLuminanceChannel(stage!, 'ceiling', 0.5);
      pressBlackout();
      expect(stage?.style.filter).toBe('brightness(0.000)');
      releaseBlackout();
      expect(stage?.style.filter).toBe('brightness(0.500)');
    } finally {
      rendered.dispose();
    }
  });
});
