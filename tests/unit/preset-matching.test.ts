import { describe, expect, test } from 'bun:test';
import {
  createFieldMatcher,
  FIELD_PENALTY,
  type MatchField,
  matchesFields,
  normalizeMatchText,
  scoreFields,
  toMatchField,
} from '../../src/js/frontend/preset-matching.ts';

function presetFields({
  title,
  author,
  id = 'preset-id',
  tags = [],
}: {
  title: string;
  author?: string;
  id?: string;
  tags?: string[];
}): MatchField[] {
  return [
    toMatchField(title, FIELD_PENALTY.title),
    toMatchField(author ?? '', FIELD_PENALTY.author),
    toMatchField(id, FIELD_PENALTY.id),
    ...tags.map((tag) => toMatchField(tag, FIELD_PENALTY.tag)),
  ].filter((field) => field.text.length > 0);
}

describe('normalizeMatchText', () => {
  test('lowercases and collapses punctuation to single spaces', () => {
    expect(normalizeMatchText('Eo.S. - Ether')).toBe('eo s ether');
    expect(normalizeMatchText('  cream-of-the-crop  ')).toBe(
      'cream of the crop',
    );
  });
});

describe('empty query', () => {
  const fields = presetFields({ title: 'Anything' });

  test('scores 0 and matches everything', () => {
    expect(scoreFields('', fields)).toBe(0);
    expect(scoreFields('   ', fields)).toBe(0);
    expect(scoreFields('!!', fields)).toBe(0);
    expect(matchesFields('', fields)).toBe(true);
  });
});

describe('tier ordering', () => {
  const score = (query: string, text: string) =>
    scoreFields(query, [toMatchField(text)]) ?? Number.NEGATIVE_INFINITY;

  test('exact > prefix > word-start > mid-word substring > subsequence', () => {
    const exact = score('neon tunnel', 'Neon Tunnel');
    const prefix = score('neon', 'Neon Tunnel Drive');
    const wordStart = score('tunnel', 'Neon Tunnel Drive');
    const substring = score('unnel', 'Neon Tunnel Drive');
    const subsequence = score('ntd', 'Neon Tunnel Drive');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  test('no match returns null', () => {
    expect(scoreFields('zzz', [toMatchField('Neon Tunnel')])).toBeNull();
  });

  test('subsequence hits are excluded from the boolean filter', () => {
    const fields = [toMatchField('Neon Tunnel Drive')];
    expect(scoreFields('ntd', fields)).not.toBeNull();
    expect(scoreFields('ntd', fields, { allowSubsequence: false })).toBeNull();
    expect(matchesFields('ntd', fields)).toBe(false);
    expect(matchesFields('tunnel', fields)).toBe(true);
  });
});

describe('field coverage and weighting', () => {
  const entry = presetFields({
    title: 'Ether',
    author: 'Eo.S.',
    id: 'eos-ether',
    tags: ['collection:cream-of-the-crop', 'liquid'],
  });

  test('matches title, author, id and tags', () => {
    expect(matchesFields('ether', entry)).toBe(true);
    expect(matchesFields('eos', entry)).toBe(true); // via the id field
    expect(matchesFields('liquid', entry)).toBe(true);
    expect(matchesFields('cream of the crop', entry)).toBe(true);
    expect(matchesFields('cream-of-the-crop', entry)).toBe(true);
    expect(matchesFields('nothing here', entry)).toBe(false);
  });

  test('a title hit outranks the same hit on a weaker field', () => {
    const titled = presetFields({ title: 'Aurora', author: 'Someone' });
    const authored = presetFields({ title: 'Someone', author: 'Aurora' });
    const tagged = presetFields({ title: 'Someone', tags: ['aurora'] });
    const titleScore = scoreFields('aurora', titled) ?? 0;
    const authorScore = scoreFields('aurora', authored) ?? 0;
    const tagScore = scoreFields('aurora', tagged) ?? 0;
    expect(titleScore).toBeGreaterThan(authorScore);
    expect(authorScore).toBeGreaterThan(tagScore);
  });
});

describe('multi-token AND', () => {
  const neonTunnel = presetFields({
    title: 'Neon Drive',
    author: 'Rovastar',
    id: 'neon-drive',
    tags: ['tunnel', 'fast'],
  });

  test('every token must hit some field', () => {
    expect(matchesFields('neon tunnel', neonTunnel)).toBe(true);
    expect(matchesFields('tunnel neon', neonTunnel)).toBe(true);
    expect(matchesFields('neon rovastar fast', neonTunnel)).toBe(true);
    expect(matchesFields('neon lagoon', neonTunnel)).toBe(false);
  });

  test('a whole-phrase hit outranks the same words spread across fields', () => {
    const phrase = presetFields({ title: 'Neon Tunnel', tags: ['fast'] });
    const spread = presetFields({ title: 'Neon Drive', tags: ['tunnel'] });
    expect(scoreFields('neon tunnel', phrase) ?? 0).toBeGreaterThan(
      scoreFields('neon tunnel', spread) ?? 0,
    );
  });

  test('a spread multi-token hit still beats a whole-phrase subsequence', () => {
    const spread = presetFields({ title: 'Neon Drive', tags: ['tunnel'] });
    const fuzzy = [toMatchField('Nice Evening On A Tundra Nightfall')];
    expect(scoreFields('neon tunnel', spread) ?? 0).toBeGreaterThan(
      scoreFields('neon tunnel', fuzzy) ?? Number.NEGATIVE_INFINITY,
    );
  });
});

describe('createFieldMatcher', () => {
  const fields = presetFields({
    title: 'Neon Drive',
    author: 'Rovastar',
    tags: ['tunnel'],
  });

  test('pre-compiles tokens and performs identical matches and scores', () => {
    const matcher = createFieldMatcher('neon tunnel');
    expect(matcher.normalizedQuery).toBe('neon tunnel');
    expect(matcher.tokens).toEqual(['neon', 'tunnel']);
    expect(matcher.matches(fields)).toBe(true);
    expect(matcher.score(fields)).toBe(scoreFields('neon tunnel', fields));
  });

  test('handles empty query gracefully', () => {
    const emptyMatcher = createFieldMatcher('   ');
    expect(emptyMatcher.matches(fields)).toBe(true);
    expect(emptyMatcher.score(fields)).toBe(0);
  });
});
