import { describe, expect, test } from 'bun:test';
import {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_FUNCTION_SNIPPET_TEMPLATES,
  MILKDROP_Q_REGISTER_COUNT,
  MILKDROP_REGISTER_WORD_PATTERN,
  MILKDROP_T_REGISTER_COUNT,
  milkdropVariableNames,
} from '../../src/js/milkdrop/builtin-docs.ts';
import {
  MILKDROP_INTRINSIC_FUNCTIONS,
  MILKDROP_INTRINSIC_IDENTIFIERS,
} from '../../src/js/milkdrop/expression.ts';
import {
  ATOM_WORDS,
  BUILTIN_WORDS,
  KEYWORD_WORDS,
} from '../../src/js/milkdrop/overlay/editor-language.ts';
import { MILKDROP_BUILTIN_OPTIONS } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import { buildMilkdropInputSignalOverrides } from '../../src/js/milkdrop/runtime/interaction-response.ts';

describe('milkdrop builtin table integrity', () => {
  test('has no duplicate names', () => {
    const names = MILKDROP_BUILTIN_DOCS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every entry carries a non-empty doc string', () => {
    for (const entry of MILKDROP_BUILTIN_DOCS) {
      expect(entry.doc.trim().length).toBeGreaterThan(0);
    }
  });

  test('variable entries declare a group; others do not', () => {
    for (const entry of MILKDROP_BUILTIN_DOCS) {
      if (entry.kind === 'variable') {
        expect(entry.group).toBeDefined();
      } else {
        expect(entry.group).toBeUndefined();
      }
    }
  });
});

describe('compiler intrinsic sets derive from the table', () => {
  const tableFunctions = MILKDROP_BUILTIN_DOCS.filter(
    (entry) => entry.kind === 'function' && !entry.editorOnly,
  ).map((entry) => entry.name);
  const tableConstants = MILKDROP_BUILTIN_DOCS.filter(
    (entry) => entry.kind === 'constant' && !entry.editorOnly,
  ).map((entry) => entry.name);

  test('MILKDROP_INTRINSIC_FUNCTIONS matches the table exactly', () => {
    expect([...MILKDROP_INTRINSIC_FUNCTIONS].sort()).toEqual(
      [...tableFunctions].sort(),
    );
  });

  test('MILKDROP_INTRINSIC_IDENTIFIERS matches the table exactly', () => {
    expect([...MILKDROP_INTRINSIC_IDENTIFIERS].sort()).toEqual(
      [...tableConstants].sort(),
    );
  });

  test('no variable or editor-only entry claims to be an intrinsic', () => {
    for (const entry of MILKDROP_BUILTIN_DOCS) {
      if (entry.kind === 'variable' || entry.editorOnly) {
        expect(MILKDROP_INTRINSIC_FUNCTIONS.has(entry.name)).toBe(false);
        expect(MILKDROP_INTRINSIC_IDENTIFIERS.has(entry.name)).toBe(false);
      }
    }
  });
});

describe('editor surfaces derive from the table', () => {
  test('every intrinsic function is highlighted as a keyword', () => {
    for (const name of MILKDROP_INTRINSIC_FUNCTIONS) {
      expect(KEYWORD_WORDS.has(name)).toBe(true);
    }
  });

  test('every signal variable is highlighted as an atom', () => {
    for (const name of milkdropVariableNames('signal')) {
      expect(ATOM_WORDS.has(name)).toBe(true);
    }
  });

  test('every intrinsic constant is highlighted as a builtin', () => {
    for (const name of MILKDROP_INTRINSIC_IDENTIFIERS) {
      expect(BUILTIN_WORDS.has(name)).toBe(true);
    }
  });

  test('every table entry appears in autocomplete with matching kind', () => {
    const byLabel = new Map(
      MILKDROP_BUILTIN_OPTIONS.map((opt) => [opt.label, opt]),
    );
    for (const entry of MILKDROP_BUILTIN_DOCS) {
      const option = byLabel.get(entry.name);
      expect(option).toBeDefined();
      expect(option?.type).toBe(entry.kind);
      expect(option?.detail).toBe(entry.doc);
    }
  });

  test('previously missing intrinsics now reach autocomplete', () => {
    const labels = new Set(MILKDROP_BUILTIN_OPTIONS.map((opt) => opt.label));
    for (const name of [
      'randint',
      'log10',
      'fmod',
      'bor',
      'band',
      'bnot',
      'exec2',
      'exec3',
      'megabuf',
      'gmegabuf',
      'int',
    ]) {
      expect(labels.has(name)).toBe(true);
    }
  });
});

describe('snippet templates derive from declared params', () => {
  test('exactly the multi-parameter functions get templates', () => {
    const multiArg = MILKDROP_BUILTIN_DOCS.filter(
      (entry) => entry.kind === 'function' && (entry.params?.length ?? 0) >= 2,
    ).map((entry) => entry.name);
    expect(Object.keys(MILKDROP_FUNCTION_SNIPPET_TEMPLATES).sort()).toEqual(
      multiArg.sort(),
    );
  });

  test('templates mention every declared parameter in order', () => {
    for (const entry of MILKDROP_BUILTIN_DOCS) {
      if (entry.kind !== 'function' || (entry.params?.length ?? 0) < 2) {
        continue;
      }
      const template = MILKDROP_FUNCTION_SNIPPET_TEMPLATES[entry.name];
      const params = entry.params as readonly string[];
      expect(template).toBe(
        `${entry.name}(${params.map((p) => `#{${p}}`).join(', ')})`,
      );
    }
  });
});

describe('q/t register range matches the VM', () => {
  test('table exposes q1..q32 and t1..t32, matching what vm.ts seeds', () => {
    const registers = new Set(milkdropVariableNames('register'));
    expect(MILKDROP_Q_REGISTER_COUNT).toBe(32);
    expect(MILKDROP_T_REGISTER_COUNT).toBe(32);
    for (let i = 1; i <= 32; i += 1) {
      expect(registers.has(`q${i}`)).toBe(true);
      expect(registers.has(`t${i}`)).toBe(true);
    }
    expect(registers.size).toBe(64);
  });

  test('register word pattern accepts the full range and nothing else', () => {
    for (let i = 1; i <= 32; i += 1) {
      expect(MILKDROP_REGISTER_WORD_PATTERN.test(`q${i}`)).toBe(true);
      expect(MILKDROP_REGISTER_WORD_PATTERN.test(`t${i}`)).toBe(true);
    }
    for (const rejected of ['q0', 'q33', 'q01', 't0', 't33', 'q', 't', 'r1']) {
      expect(MILKDROP_REGISTER_WORD_PATTERN.test(rejected)).toBe(false);
    }
  });
});

/**
 * The interaction vocabulary was published to preset code for its whole life
 * without appearing here — so the editor never completed it, hover said
 * nothing, and the generated reference had no entry. A preset author had no
 * way to learn the names existed.
 *
 * Derived from the runtime's own output rather than a second hand-written
 * list: a signal added there and not documented here would be invisible in
 * exactly the same way.
 */
describe('the interaction signals the runtime publishes are documented', () => {
  const published = Object.keys(buildMilkdropInputSignalOverrides(null)).filter(
    (name) => name.includes('_'),
  );
  const documented = new Set(MILKDROP_BUILTIN_DOCS.map((entry) => entry.name));

  test('the runtime publishes an interaction vocabulary at all', () => {
    expect(published.length).toBeGreaterThan(20);
  });

  test.each(published)('%s is in the builtin table', (name) => {
    expect(documented.has(name)).toBe(true);
  });

  test('none of them is claimed as a compiler intrinsic', () => {
    for (const name of published) {
      expect(MILKDROP_INTRINSIC_IDENTIFIERS.has(name)).toBe(false);
    }
  });
});
