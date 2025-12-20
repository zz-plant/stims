import { describe, expect, test } from 'bun:test';
import { getDocSectionContent, normalizeToys } from '../scripts/mcp-server.ts';

describe('normalizeToys', () => {
  test('preserves optional metadata fields when provided', () => {
    const [toy] = normalizeToys([
      {
        slug: 'example',
        title: 'Example Toy',
        description: 'example toy',
        requiresWebGPU: true,
        module: 'assets/example.ts',
        type: 'module',
        allowWebGLFallback: true,
        controls: ['alpha', 'beta'],
      },
    ]);

    expect(toy).toBeDefined();
    expect(toy?.module).toBe('assets/example.ts');
    expect(toy?.type).toBe('module');
    expect(toy?.allowWebGLFallback).toBe(true);
    expect(toy?.controls).toEqual(['alpha', 'beta']);
  });

  test('defaults capability metadata when optional fields are missing', () => {
    const [toy] = normalizeToys([
      {
        slug: 'fallback',
        title: 'Fallback Toy',
        description: 'Provides defaults',
        module: 'assets/example.ts',
        type: 'module',
      },
    ]);

    expect(toy).toBeDefined();
    expect(toy?.requiresWebGPU).toBe(false);
    expect(toy?.controls).toEqual([]);
    expect(toy?.allowWebGLFallback).toBe(false);
    expect(toy?.url).toContain('toy=fallback');
  });

  test('throws for incomplete toy definitions', () => {
    expect(() => normalizeToys([{ slug: 'broken' }])).toThrow();
  });

  test('throws when controls include non-string values', () => {
    expect(() =>
      normalizeToys([
        {
          slug: 'invalid-controls',
          title: 'Bad Controls',
          description: 'Contains invalid control types',
          module: 'assets/example.ts',
          type: 'module',
          controls: ['ok', 42],
        },
      ])
    ).toThrow();
  });
});

describe('getDocSectionContent', () => {
  test('returns a specific heading section when present', async () => {
    const result = await getDocSectionContent('docs/MCP_SERVER.md', 'Registered tools');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Registered tools');
      expect(result.content).toContain('list_docs');
    }
  });

  test('returns a friendly error when a heading is missing', async () => {
    const result = await getDocSectionContent('docs/MCP_SERVER.md', 'This heading does not exist');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('was not found');
    }
  });
});
