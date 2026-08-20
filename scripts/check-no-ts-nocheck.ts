/**
 * Fails the build if a whole-file TypeScript suppression directive is present
 * under src/, scripts/, or tests/.
 *
 * Scans every .ts/.tsx/.js/.jsx file and prints each offending file, line
 * number, and line before exiting 1.
 *
 * Only a line where the directive *opens* the comment counts. Matching the
 * bare substring meant prose describing the rule tripped it — a docblock
 * explaining what this guard bans read as a violation of it — which is the
 * kind of false positive that teaches people to reach for --no-verify, and
 * which the codebase had already started working around by splicing the
 * string ('@ts-' + 'nocheck') wherever it needed to be named.
 */
import { Glob } from 'bun';

const directories = ['src', 'scripts', 'tests'];
const patterns = ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];

const matches: string[] = [];

const targetDirective = '@ts-' + 'nocheck';

/**
 * True when `line` actually suppresses type checking, rather than mentioning
 * the directive in passing.
 *
 * TypeScript only honors the directive when it leads a comment, so that is
 * the test: strip the comment opener and any leading `*` of a block comment,
 * and require the directive to be what follows. "The @ts-''nocheck rule" does
 * not lead, and is prose.
 */
function isSuppressionDirective(line: string, directive: string): boolean {
  const withoutOpener = line
    .trim()
    .replace(/^\/\/+/, '')
    .replace(/^\/\*+/, '')
    .replace(/^\*+/, '')
    .trim();
  return withoutOpener.startsWith(directive);
}

for (const dir of directories) {
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: dir, absolute: false })) {
      const fullPath = `${dir}/${file}`;
      if (fullPath.endsWith('check-no-ts-nocheck.ts')) continue;
      const content = await Bun.file(fullPath).text();
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isSuppressionDirective(lines[i], targetDirective)) {
          matches.push(`${fullPath}:${i + 1}:${lines[i]}`);
        }
      }
    }
  }
}

if (matches.length > 0) {
  console.error(`Found forbidden ${targetDirective} directives:`);
  for (const match of matches) {
    console.error(match);
  }
  console.error(
    `\nRemove ${targetDirective} and resolve the underlying type issues.`,
  );
  process.exit(1);
}

console.log(
  `No ${targetDirective} directives found in src/, scripts/, or tests/.`,
);
