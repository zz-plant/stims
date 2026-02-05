import { describe, expect, test } from 'bun:test';
import {
  getDocSectionContent,
  normalizeToys,
  searchMarkdownSources,
} from '../scripts/mcp-server.ts';

describe('normalizeToys', () => {
  test('preserves optional metadata fields when provided', () => {
    const [toy] = normalizeToys([
      {
        slug: 'example',
        description: 'example toy',
        requiresWebGPU: true,
        module: 'assets/example.ts',
        type: 'module',
        allowWebGLFallback: true,
        controls: ['alpha', 'beta', 1],
      },
    ]);

    expect(toy).toBeDefined();
    expect(toy?.module).toBe('assets/example.ts');
    expect(toy?.type).toBe('module');
    expect(toy?.allowWebGLFallback).toBe(true);
    expect(toy?.controls).toEqual(['alpha', 'beta']);
  });

  test('defaults optional metadata when fields are missing', () => {
    const [toy] = normalizeToys([{ slug: 'fallback' }]);

    expect(toy).toBeDefined();
    expect(toy?.title).toBe('fallback');
    expect(toy?.description).toBe('');
    expect(toy?.requiresWebGPU).toBe(false);
    expect(toy?.controls).toEqual([]);
    expect(toy?.module).toBeNull();
    expect(toy?.type).toBeNull();
    expect(toy?.allowWebGLFallback).toBe(false);
    expect(toy?.url).toContain('toy=fallback');
  });
});

describe('getDocSectionContent', () => {
  test('returns a specific heading section when present', async () => {
    const result = await getDocSectionContent(
      'docs/MCP_SERVER.md',
      'Registered tools',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Registered tools');
      expect(result.content).toContain('list_docs');
    }
  });

  test('returns a friendly error when a heading is missing', async () => {
    const result = await getDocSectionContent(
      'docs/MCP_SERVER.md',
      'This heading does not exist',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('was not found');
    }
  });
});

describe('searchMarkdownSources', () => {
  test('finds matches across markdown files', async () => {
    const results = await searchMarkdownSources('Registered tools', {
      file: 'docs/MCP_SERVER.md',
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.file).toBe('docs/MCP_SERVER.md');
    expect(results[0]?.heading).toContain('Registered tools');
  });

  test('returns empty results when no matches exist', async () => {
    const results = await searchMarkdownSources('this should not match');

    expect(results).toHaveLength(0);
  });
});
