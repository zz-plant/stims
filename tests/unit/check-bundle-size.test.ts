import { describe, expect, test } from 'bun:test';
import {
  eagerChunks,
  findBootPathLeaks,
  staticClosure,
} from '../../scripts/check-bundle-size.ts';

/**
 * The boot-path rules in check:bundle-size, run against small synthetic
 * builds. Minified chunks import each other as `from"./x.js"` with no
 * spaces, and list lazily loaded chunks only as strings for the preload
 * helper, so both shapes appear here.
 */

const INDEX_HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-a1.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-react-b2.js">
<link rel="modulepreload" crossorigin href="/assets/vendor-other-c3.js">
</head></html>`;

function build(chunks: Record<string, string>) {
  const read = (assetPath: string) => chunks[assetPath] ?? null;
  return { read, assetPaths: Object.keys(chunks) };
}

const CLEAN_BUILD: Record<string, string> = {
  'assets/index-a1.js':
    'import{a}from"./vendor-react-b2.js";import"./vendor-other-c3.js";const m=["assets/vendor-codemirror-d4.js"];',
  'assets/vendor-react-b2.js': 'export const a=1;',
  'assets/vendor-other-c3.js': 'export const o=1;',
  'assets/vendor-codemirror-d4.js': 'export const k=1;',
  'assets/runtime-e5.js':
    'import{t}from"./vendor-three-f6.js";const lazy=()=>import("./renderer-adapter-webgpu-g7.js");',
  'assets/vendor-three-f6.js': 'export const t=1;',
  'assets/renderer-adapter-webgpu-g7.js':
    'import{W}from"./vendor-three-webgpu-h8.js";',
  'assets/vendor-three-webgpu-h8.js': 'export const W=1;',
};

describe('check:bundle-size boot-path rules', () => {
  test('reads the module script and modulepreloads as the eager set', () => {
    expect(eagerChunks(INDEX_HTML)).toEqual([
      'assets/index-a1.js',
      'assets/vendor-react-b2.js',
      'assets/vendor-other-c3.js',
    ]);
  });

  test('follows static imports but not dynamic imports or preload lists', () => {
    const { read } = build(CLEAN_BUILD);
    expect([...staticClosure(['assets/runtime-e5.js'], read)].sort()).toEqual([
      'assets/runtime-e5.js',
      'assets/vendor-three-f6.js',
    ]);
  });

  test('passes a build that keeps the editor and WebGPU code lazy', () => {
    const { read, assetPaths } = build(CLEAN_BUILD);
    expect(findBootPathLeaks(INDEX_HTML, assetPaths, read)).toEqual([]);
  });

  test('flags CodeMirror reached statically from an eager vendor chunk', () => {
    const { read, assetPaths } = build({
      ...CLEAN_BUILD,
      'assets/vendor-other-c3.js':
        'import{k as r}from"./vendor-codemirror-d4.js";export const o=r;',
    });
    const leaks = findBootPathLeaks(INDEX_HTML, assetPaths, read);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toContain('vendor-codemirror is in the eager load set');
  });

  test('flags three.js reached statically from the entry', () => {
    const { read, assetPaths } = build({
      ...CLEAN_BUILD,
      'assets/index-a1.js':
        'import{a}from"./vendor-react-b2.js";import{t}from"./vendor-three-f6.js";',
    });
    const leaks = findBootPathLeaks(INDEX_HTML, assetPaths, read);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toContain('vendor-three is in the eager load set');
  });

  test('flags three/webgpu in the runtime closure WebGL sessions load', () => {
    const { read, assetPaths } = build({
      ...CLEAN_BUILD,
      'assets/runtime-e5.js':
        'import{t}from"./vendor-three-f6.js";import{W}from"./vendor-three-webgpu-h8.js";',
    });
    const leaks = findBootPathLeaks(INDEX_HTML, assetPaths, read);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toContain(
      'vendor-three-webgpu is in the runtime load set',
    );
  });
});
