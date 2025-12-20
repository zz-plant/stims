import { describe, expect, mock, test } from 'bun:test';
import { createToyRuntime } from '../assets/js/core/toy-runtime.ts';

describe('toy runtime state machine', () => {
  test('emits navigation events when switching toys', () => {
    const runtime = createToyRuntime();
    const states: string[] = [];

    runtime.onLoading(({ toy }) => states.push(`loading:${toy?.slug}`));
    runtime.onActive(({ toy }) => states.push(`active:${toy?.slug}`));
    runtime.onDisposed(({ reason, toy }) => states.push(`disposed:${reason}:${toy?.slug ?? ''}`));

    runtime.startLoading({ toy: { slug: 'alpha' } });
    runtime.setActiveToy(() => {});
    runtime.dispose({ reason: 'swap' });
    runtime.startLoading({ toy: { slug: 'beta' } });

    expect(states).toEqual(['loading:alpha', 'active:alpha', 'disposed:swap:alpha', 'loading:beta']);
  });

  test('guards against double dispose', () => {
    const runtime = createToyRuntime();
    const disposeFn = mock();

    runtime.setActiveToy({ dispose: disposeFn });
    runtime.dispose();
    runtime.dispose();

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  test('recovers from errors with a new loading cycle', () => {
    const runtime = createToyRuntime();
    const events: string[] = [];

    runtime.onError(({ error }) => events.push(`error:${error.type}`));
    runtime.onActive(({ toy }) => events.push(`active:${toy?.slug}`));
    runtime.onLoading(({ toy }) => events.push(`loading:${toy?.slug}`));

    runtime.startLoading({ toy: { slug: 'broken' } });
    runtime.setError({ type: 'import', toy: { slug: 'broken' } });
    runtime.startLoading({ toy: { slug: 'recovered' } });
    runtime.setActiveToy(() => {});

    expect(events).toEqual(['loading:broken', 'error:import', 'loading:recovered', 'active:recovered']);
    expect(runtime.getState()).toBe('active');
  });
});
