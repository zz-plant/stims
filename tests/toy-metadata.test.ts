import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import toysData from '../assets/js/toys-metadata.ts';
import { validateToyMetadata } from '../assets/js/utils/toy-schema.ts';

const projectRoot = path.join(import.meta.dir, '..');

function resolveHtmlPath(entry: string) {
  if (entry.startsWith('http://') || entry.startsWith('https://')) return null;
  const url = new URL(entry, 'http://localhost/');
  return path.resolve(projectRoot, url.pathname.replace(/^\//, ''));
}

function findHtmlEntry(modulePath: string) {
  if (!fs.existsSync(modulePath)) return null;
  const contents = fs.readFileSync(modulePath, 'utf8');
  const match = contents.match(/path:\s*['"](.+?\.html)['"]/);
  return match ? match[1] : null;
}

test('toy metadata matches the runtime schema', () => {
  expect(() => validateToyMetadata(toysData)).not.toThrow();
});

describe('iframe/page entry points', () => {
  const iframeEntries = toysData
    .map((toy) => {
      if (toy.type === 'page') return { toy, entry: toy.module };
      const modulePath = path.resolve(projectRoot, toy.module);
      const entry = findHtmlEntry(modulePath);
      if (!entry) return null;
      return { toy, entry };
    })
    .filter((value): value is { toy: (typeof toysData)[number]; entry: string } => Boolean(value));

  test('HTML entry points exist and reflect capability policy', () => {
    expect(iframeEntries.length).toBeGreaterThan(0);

    iframeEntries.forEach(({ toy, entry }) => {
      const diskPath = resolveHtmlPath(entry);
      expect(diskPath).toBeTruthy();
      if (!diskPath) return;

      expect(fs.existsSync(diskPath)).toBe(true);

      if (toy.capabilityPolicy.requiresWebGPU) {
        const htmlContent = fs.readFileSync(diskPath, 'utf8').toLowerCase();
        expect(htmlContent.includes('webgpu')).toBe(true);
        if (toy.capabilityPolicy.allowWebGLFallback) {
          expect(htmlContent.includes('webgl')).toBe(true);
        }
      }
    });
  });
});
