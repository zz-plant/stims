import { describe, expect, test } from 'bun:test';
import { StageFramingGuides } from '../../src/js/frontend/StageFramingGuides.tsx';

describe('StageFramingGuides', () => {
  test('returns null when ratio is off', () => {
    const result = StageFramingGuides({ ratio: 'off' });
    expect(result).toBeNull();
  });

  test('renders guide when ratio is 9:16', () => {
    const result = StageFramingGuides({ ratio: '9:16' });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('div');
  });

  test('renders guide when ratio is 1:1', () => {
    const result = StageFramingGuides({ ratio: '1:1' });
    expect(result).not.toBeNull();
  });

  test('renders guide when ratio is 16:9', () => {
    const result = StageFramingGuides({ ratio: '16:9' });
    expect(result).not.toBeNull();
  });
});
