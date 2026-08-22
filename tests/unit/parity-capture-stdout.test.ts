/**
 * Guards how the capture suite finds play-toy's JSON payload.
 *
 * The suite took `stdout.lastIndexOf('{')`, which lands *inside* the payload
 * as soon as a reported console error contains a brace. A real WebGPU device
 * loss — "WebGPU device lost: unknown {reason: unknown}" — therefore surfaced
 * as "Failed to parse play-toy JSON output", which is how blank WebGPU
 * captures went unexplained for weeks.
 */
import { describe, expect, test } from 'bun:test';
import { parsePlayToyStdout } from '../../scripts/capture-visual-reference-suite.ts';

describe('reading play-toy stdout', () => {
  test('a console error containing braces does not break the parse', () => {
    const stdout = [
      'Launching milkdrop on port 5206...',
      'Toy loaded.',
      JSON.stringify(
        {
          slug: 'milkdrop',
          success: false,
          consoleErrors: [
            'WebGPU device lost: unknown {reason: unknown, message: gone}',
          ],
        },
        null,
        2,
      ),
    ].join('\n');

    const result = parsePlayToyStdout(stdout);
    expect(result.success).toBe(false);
    expect(result.slug).toBe('milkdrop');
  });

  test('log lines before the payload are ignored', () => {
    const stdout = `noise { not json\n${JSON.stringify({ slug: 'milkdrop', success: true })}`;
    expect(parsePlayToyStdout(stdout).success).toBe(true);
  });

  test('output with no JSON at all is an error, not a silent pass', () => {
    expect(() => parsePlayToyStdout('nothing here')).toThrow();
  });
});
