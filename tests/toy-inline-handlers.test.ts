import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

const TOYS_DIR = path.resolve('toys');

const INLINE_HANDLER_PATTERN = /\son[a-z]+\s*=/i;

describe('toy HTML markup safety', () => {
  test('does not use inline DOM event handler attributes in toy pages', async () => {
    const files = await fs.readdir(TOYS_DIR);
    const htmlFiles = files.filter((file) => file.endsWith('.html'));
    const offenders: string[] = [];

    for (const file of htmlFiles) {
      const filePath = path.join(TOYS_DIR, file);
      const content = await fs.readFile(filePath, 'utf8');
      if (INLINE_HANDLER_PATTERN.test(content)) {
        offenders.push(`toys/${file}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
