import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { deflateSync } from 'fflate';
import {
  buildPresetSetShareUrl,
  decodePresetSetPayload,
  deleteSavedPresetSet,
  encodePresetSetPayload,
  MAX_PRESETS_PER_SET,
  MAX_SET_TITLE_LENGTH,
  PRESET_SETS_STORAGE_KEY,
  readSavedPresetSets,
  SET_PAYLOAD_PREFIX,
  sanitizeSetTitle,
  saveNamedSet,
} from '../../src/js/frontend/preset-sets.ts';

describe('preset-sets (#1412)', () => {
  beforeEach(() => {
    localStorage.removeItem(PRESET_SETS_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(PRESET_SETS_STORAGE_KEY);
  });

  describe('sanitizeSetTitle', () => {
    test('sanitizes empty and whitespace titles', () => {
      expect(sanitizeSetTitle('')).toBe('Untitled Set');
      expect(sanitizeSetTitle('   ')).toBe('Untitled Set');
    });

    test('preserves valid and Unicode titles', () => {
      expect(sanitizeSetTitle('Late Night Visuals 🌌')).toBe(
        'Late Night Visuals 🌌',
      );
      expect(sanitizeSetTitle('クラブ・ミックス')).toBe('クラブ・ミックス');
      expect(sanitizeSetTitle('Café & Chillin’')).toBe('Café & Chillin’');
    });

    test('bounds title to maximum character length', () => {
      const longTitle = 'a'.repeat(150);
      const sanitized = sanitizeSetTitle(longTitle);
      expect(sanitized.length).toBe(MAX_SET_TITLE_LENGTH);
    });
  });

  describe('local storage persistence', () => {
    test('reads empty list when storage is clear', () => {
      expect(readSavedPresetSets()).toEqual([]);
    });

    test('saves named set and reads it back', () => {
      const set1 = saveNamedSet('Chill Vibes', ['preset-1', 'preset-2']);
      expect(set1.title).toBe('Chill Vibes');
      expect(set1.presetIds).toEqual(['preset-1', 'preset-2']);

      const stored = readSavedPresetSets();
      expect(stored.length).toBe(1);
      expect(stored[0].title).toBe('Chill Vibes');
      expect(stored[0].presetIds).toEqual(['preset-1', 'preset-2']);
    });

    test('saving a shared sequence keeps repeated presets and order', () => {
      const ids = ['geiss-casino', 'shifter-curlique', 'geiss-casino'];
      const decoded = decodePresetSetPayload(
        encodePresetSetPayload('Reprise', ids),
      );
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error(decoded.error);
      saveNamedSet(decoded.set.title, decoded.set.presets);
      expect(readSavedPresetSets()[0]?.presetIds).toEqual(ids);
    });

    test('deletes saved preset set', () => {
      const set1 = saveNamedSet('Set A', ['p1']);
      const set2 = saveNamedSet('Set B', ['p2']);
      expect(readSavedPresetSets().length).toBe(2);

      deleteSavedPresetSet(set1.id);
      const remaining = readSavedPresetSets();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(set2.id);
    });

    test('bounds stored presets per set', () => {
      const manyPresets = Array.from({ length: 80 }, (_, i) => `preset-${i}`);
      const set = saveNamedSet('Big Set', manyPresets);
      expect(set.presetIds.length).toBe(MAX_PRESETS_PER_SET);
    });
  });

  describe('encode and decode share payload', () => {
    test('round-trips standard and Unicode sets', () => {
      const title = 'Midnight Rave ⚡ 踊ろう';
      const presets = ['tokamak', 'snakeskin', 'glowsticks'];

      const encoded = encodePresetSetPayload(title, presets);
      expect(encoded.startsWith('s1~')).toBe(true);

      const decoded = decodePresetSetPayload(encoded);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.set.v).toBe(1);
        expect(decoded.set.title).toBe(title);
        expect(decoded.set.presets).toEqual(presets);
      }
    });

    test('generates valid shareable URL', () => {
      const url = buildPresetSetShareUrl(
        'https://toil.fyi/?audio=demo',
        'Synthwave Mix',
        ['shifter-curlique', 'krash-cerebral'],
      );
      expect(url).toContain('https://toil.fyi/');
      expect(url).toContain('audio=demo');
      expect(url).toContain('set=s1');

      const parsedUrl = new URL(url);
      const setParam = parsedUrl.searchParams.get('set');
      expect(setParam).not.toBeNull();
      const decoded = decodePresetSetPayload(setParam ?? '');
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.set.title).toBe('Synthwave Mix');
        expect(decoded.set.presets).toEqual([
          'shifter-curlique',
          'krash-cerebral',
        ]);
      }
    });

    test('shares the set without carrying a sender draft or preset selection', () => {
      const sender = new URL(
        'https://toil.fyi/milkdrop/?preset=private-edit&audio=demo&reduceFlashing=1#code=private-draft',
      );
      const shared = new URL(
        buildPresetSetShareUrl(sender, 'Evening', ['geiss-casino']),
      );
      expect(shared.pathname).toBe('/');
      expect(shared.hash).toBe('');
      expect(shared.searchParams.has('preset')).toBe(false);
      expect(shared.searchParams.get('audio')).toBe('demo');
      expect(shared.searchParams.get('reduceFlashing')).toBe('1');
      expect(
        decodePresetSetPayload(shared.searchParams.get('set') ?? ''),
      ).toMatchObject({
        ok: true,
        set: { title: 'Evening', presets: ['geiss-casino'] },
      });
      expect(sender.hash).toBe('#code=private-draft');
    });

    test('rejects empty or unsupported prefixes', () => {
      expect(decodePresetSetPayload('').ok).toBe(false);
      expect(decodePresetSetPayload('s2~random').ok).toBe(false);
      expect(decodePresetSetPayload('invalid').ok).toBe(false);
    });

    test('rejects corrupted payload', () => {
      const result = decodePresetSetPayload(
        's1~not-valid-base64-or-deflate!!!',
      );
      expect(result.ok).toBe(false);
    });

    test('rejects payload with empty presets list', () => {
      const emptyEncoded = encodePresetSetPayload('No Presets', []);
      const result = decodePresetSetPayload(emptyEncoded);
      expect(result.ok).toBe(false);
    });

    test('rejects a payload that inflates past the size cap', () => {
      // Craft a high-ratio DEFLATE payload directly: ~1 MB of repeated
      // bytes compresses to under 1 KB, so it sails past any compressed-size
      // check and would balloon on the old post-inflation length test.
      const bomb = new Uint8Array(1_000_000).fill(65);
      const compressed = deflateSync(bomb);
      const base64 = btoa(String.fromCharCode(...compressed))
        .replace(/\+/gu, '-')
        .replace(/\//gu, '_')
        .replace(/=+$/u, '');
      const result = decodePresetSetPayload(`${SET_PAYLOAD_PREFIX}${base64}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('exceeds size limit');
      }
    });

    test('rejects a payload longer than any set can encode to', () => {
      // A valid set behind 1000 empty stored blocks (5 bytes each): it
      // decodes to well under the cap, so only the input-length check
      // refuses it — the check that bounds inflate time, which grows with
      // input even once the output buffer is full.
      const json = new TextEncoder().encode(
        JSON.stringify({ v: 1, title: 'Padded', presets: ['a'] }),
      );
      const emptyStoredBlock = [0x00, 0x00, 0x00, 0xff, 0xff];
      const finalStoredBlock = [
        0x01,
        json.length & 0xff,
        json.length >> 8,
        ~json.length & 0xff,
        (~json.length >> 8) & 0xff,
        ...json,
      ];
      const compressed = new Uint8Array([
        ...Array.from({ length: 1000 }, () => emptyStoredBlock).flat(),
        ...finalStoredBlock,
      ]);
      const base64 = btoa(String.fromCharCode(...compressed))
        .replace(/\+/gu, '-')
        .replace(/\//gu, '_')
        .replace(/=+$/u, '');
      const result = decodePresetSetPayload(`${SET_PAYLOAD_PREFIX}${base64}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('exceeds size limit');
      }
    });
  });
});
