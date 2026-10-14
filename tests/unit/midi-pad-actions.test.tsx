/**
 * Pads that run commands: learning a pad to a palette action, the press that
 * fires it, and the Settings surface that maps one.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import {
  type MidiNoteEvent,
  VIRTUAL_GAMEPAD_DEVICE_ID,
  WebMidiControllerService,
  webMidiService,
} from '../../src/js/core/services/webmidi-controller.ts';
import { padActionTarget } from '../../src/js/frontend/midi-pad-actions.ts';
import { PerformanceHardwareSection } from '../../src/js/frontend/PerformanceHardwareSection.tsx';
import { bindMidiToMilkdropControls } from '../../src/js/frontend/performance-hardware-controls.ts';
import { renderWorkspace } from '../frontend-harness.tsx';

const MIDI_STORAGE_KEY = 'stims:midi-state:v1';

afterEach(() => {
  localStorage.removeItem(MIDI_STORAGE_KEY);
});

describe('note learn', () => {
  it('maps the next pad hit without firing it, and fires every hit after', () => {
    const service = new WebMidiControllerService();
    const events: MidiNoteEvent[] = [];
    service.onNote((event) => events.push(event));

    service.beginNoteLearn(padActionTarget('next-preset'));
    service.injectNote(VIRTUAL_GAMEPAD_DEVICE_ID, 3, true);
    service.injectNote(VIRTUAL_GAMEPAD_DEVICE_ID, 3, false);
    // The hit that taught the mapping, and its release, are not gestures.
    expect(events).toEqual([]);
    expect(service.getNoteLearnTarget()).toBeNull();
    expect(service.getNoteBindings(VIRTUAL_GAMEPAD_DEVICE_ID)[3]).toEqual({
      target: 'action:next-preset',
      mode: 'trigger',
      min: 0,
      max: 1,
      velocitySensitive: false,
    });

    service.injectNote(VIRTUAL_GAMEPAD_DEVICE_ID, 3, true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      on: true,
      target: 'action:next-preset',
      value: 1,
    });
  });

  it('waits for a press: a release or a knob does not complete it', () => {
    const service = new WebMidiControllerService();
    service.beginNoteLearn(padActionTarget('toggle-playback'));
    service.injectNote(VIRTUAL_GAMEPAD_DEVICE_ID, 9, false);
    service.injectControlChange(VIRTUAL_GAMEPAD_DEVICE_ID, 4, 64);
    expect(service.getNoteLearnTarget()).toBe('action:toggle-playback');
    expect(service.getNoteBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({});
  });

  it('a cancelled learn maps nothing', () => {
    const service = new WebMidiControllerService();
    service.beginNoteLearn(padActionTarget('next-preset'));
    service.cancelNoteLearn();
    service.injectNote(VIRTUAL_GAMEPAD_DEVICE_ID, 3, true);
    expect(service.getNoteBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual({});
  });

  it('a learned pad survives a reload', () => {
    const first = new WebMidiControllerService();
    first.beginNoteLearn(padActionTarget('queue-take'));
    first.injectNote('hardware-pad', 36, true);
    const reloaded = new WebMidiControllerService();
    expect(reloaded.getAllNoteBindings()['hardware-pad']?.[36]?.target).toBe(
      'action:queue-take',
    );
  });
});

describe('pad routing', () => {
  function stubSource() {
    let noteListener:
      | ((event: {
          target?: string;
          value?: number;
          on?: boolean;
          deviceId: string;
        }) => void)
      | null = null;
    const published: string[] = [];
    return {
      source: {
        onControlChange: () => () => {},
        onNote: (listener: NonNullable<typeof noteListener>) => {
          noteListener = listener;
          return () => {
            noteListener = null;
          };
        },
        publishTargetValue: (target: string) => published.push(target),
      },
      hit: (event: { target?: string; value?: number; on?: boolean }) =>
        noteListener?.({ deviceId: 'pad', ...event }),
      published,
    };
  }

  it('runs the command once per press and never writes it as a field', () => {
    const { source, hit, published } = stubSource();
    const ran: string[] = [];
    const applied: string[] = [];
    bindMidiToMilkdropControls(
      source,
      (target) => applied.push(target),
      (actionId) => ran.push(actionId),
    );

    hit({ target: 'action:next-preset', value: 1, on: true });
    hit({ target: 'action:next-preset', on: false });
    expect(ran).toEqual(['next-preset']);
    expect(applied).toEqual([]);
    expect(published).toEqual([]);
  });

  it('leaves field-bound pads on the field path', () => {
    const { source, hit } = stubSource();
    const ran: string[] = [];
    const applied: Array<[string, number]> = [];
    bindMidiToMilkdropControls(
      source,
      (target, value) => applied.push([target, value]),
      (actionId) => ran.push(actionId),
    );
    hit({ target: 'q1', value: 1, on: true });
    expect(applied).toEqual([['q1', 1]]);
    expect(ran).toEqual([]);
  });
});

describe('Settings: map a pad to a command', () => {
  const padActions = [
    { id: 'next-preset', label: 'Next preset (random)', group: 'Presets' },
    { id: 'toggle-playback', label: 'Pause', group: 'Playback' },
  ];

  afterEach(() => {
    webMidiService.cancelNoteLearn();
    webMidiService.unbindNote(VIRTUAL_GAMEPAD_DEVICE_ID, 5);
  });

  it('learns a pad from the picker and lists it under its device', () => {
    const view = renderWorkspace(
      <PerformanceHardwareSection padActions={padActions} />,
    );
    try {
      const picker = view.byLabel(
        'Command to map to a pad',
      ) as HTMLSelectElement;
      expect(picker.value).toBe('next-preset');
      act(() => {
        picker.value = 'toggle-playback';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const learn = [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Learn' && !button.disabled,
      );
      view.click(learn);
      expect(view.text()).toContain(
        'Hit a pad, key or gamepad button to map it to "Pause"',
      );

      act(() => {
        webMidiService.injectNote(VIRTUAL_GAMEPAD_DEVICE_ID, 5, true);
      });
      expect(view.text()).toContain(
        'Mapped a pad to "Pause". Hit it to run it.',
      );
      const remove = view.byLabel('Remove mapping for pad 5 (Pause)');
      expect(remove).not.toBeNull();

      view.click(remove);
      expect(view.byLabel('Remove mapping for pad 5 (Pause)')).toBeNull();
      expect(webMidiService.getNoteBindings(VIRTUAL_GAMEPAD_DEVICE_ID)).toEqual(
        {},
      );
    } finally {
      view.dispose();
    }
  });

  it('closing Settings mid-learn stops listening for a pad', () => {
    const view = renderWorkspace(
      <PerformanceHardwareSection padActions={padActions} />,
    );
    const learn = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Learn' && !button.disabled,
    );
    view.click(learn);
    expect(webMidiService.getNoteLearnTarget()).toBe('action:next-preset');
    view.dispose();
    expect(webMidiService.getNoteLearnTarget()).toBeNull();
  });
});
