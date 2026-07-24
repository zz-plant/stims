import { describe, expect, test } from 'bun:test';
import { createDomainStore } from '../../assets/js/core/state/domain-store.ts';

describe('createDomainStore', () => {
  test('get returns initial value before any set', () => {
    const store = createDomainStore({ count: 0 });
    expect(store.get()).toEqual({ count: 0 });
  });

  test('set updates the stored value', () => {
    const store = createDomainStore(0);
    store.set(42);
    expect(store.get()).toBe(42);
  });

  test('subscribe receives current value on registration', () => {
    const store = createDomainStore('initial');
    const calls: string[] = [];
    const unsub = store.subscribe((v) => calls.push(v));
    store.set('first');
    store.set('second');
    expect(calls).toEqual(['initial', 'first', 'second']);
    unsub();
  });

  test('subscribe receives latest set value when already active', () => {
    const store = createDomainStore('hello');
    store.set('world');
    const calls: string[] = [];
    store.subscribe((v) => calls.push(v));
    expect(calls).toEqual(['world']);
  });

  test('unsubscribe stops notifications', () => {
    const store = createDomainStore(0);
    const calls: number[] = [];
    const unsub = store.subscribe((v) => calls.push(v));
    store.set(1);
    unsub();
    store.set(2);
    expect(calls).toEqual([0, 1]);
  });

  test('reset clears cached value and subscribers', () => {
    const store = createDomainStore('a');
    store.set('b');
    store.reset();
    const calls: string[] = [];
    store.subscribe((v) => calls.push(v));
    store.set('c');
    expect(calls).toEqual(['a', 'c']);
  });

  test('reset followed by get returns initial value', () => {
    const store = createDomainStore(99);
    store.set(100);
    store.reset();
    expect(store.get()).toBe(99);
  });

  test('notifies all subscribers on set', () => {
    const store = createDomainStore('x');
    const calls1: string[] = [];
    const calls2: string[] = [];
    const unsub1 = store.subscribe((v) => calls1.push(v));
    const unsub2 = store.subscribe((v) => calls2.push(v));
    store.set('y');
    expect(calls1).toEqual(['x', 'y']);
    expect(calls2).toEqual(['x', 'y']);
    unsub1();
    unsub2();
  });
});
