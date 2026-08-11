import type { StreamParser } from '@codemirror/language';
import { StreamLanguage } from '@codemirror/language';
import {
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
  MILKDROP_REGISTER_WORD_PATTERN,
  milkdropVariableNames,
} from '../builtin-docs';

// All four word classes derive from the shared builtin table so the
// highlighter can never drift from what the compiler accepts. Exported for
// the derivation test in tests/unit/milkdrop-builtin-docs.test.ts.
export const KEYWORD_WORDS: ReadonlySet<string> = new Set(
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
);

export const ATOM_WORDS: ReadonlySet<string> = new Set(
  milkdropVariableNames('signal'),
);

export const BUILTIN_WORDS: ReadonlySet<string> = new Set(
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
);

// q1-q32 persistent globals and t1-t32 registers, matching what the VM seeds.
const VARIABLE_WORD = MILKDROP_REGISTER_WORD_PATTERN;

const milkdropParser: StreamParser<{ afterEquals: boolean }> = {
  name: 'milkdrop-preset',
  token(stream, state) {
    if (stream.sol() && stream.match(/^\[(\w+)\]/)) return 'heading';

    if (stream.sol() && stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (state.afterEquals) {
      if (stream.eol()) {
        state.afterEquals = false;
        return null;
      }
      // Match the whole identifier before classifying it: CodeMirror's
      // StringStream.match() tests regexes against a slice starting at the
      // current position, so a leading \b in an alternation like
      // /\bbass\b/ is trivially satisfied at index 0 of that slice and
      // can't see the real preceding character. That let "time" match
      // mid-word inside "basstime" once the earlier characters had been
      // consumed one at a time. Matching the full word first and checking
      // set membership sidesteps the issue entirely.
      if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) {
        const word = stream.current();
        if (KEYWORD_WORDS.has(word)) return 'keyword';
        if (ATOM_WORDS.has(word)) return 'atom';
        if (VARIABLE_WORD.test(word)) return 'variableName';
        if (BUILTIN_WORDS.has(word)) return 'builtin';
        return null;
      }
      if (stream.match(/[0-9]+(\.[0-9]+)?/)) return 'number';
      if (stream.match(/[+\-*/%^<>=!&|]+/)) return 'operator';
      stream.next();
      return null;
    }

    if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) return 'propertyName';
    if (stream.match(/=/)) {
      state.afterEquals = true;
      return 'operator';
    }
    if (stream.match(/[0-9]+(\.[0-9]+)?/)) {
      state.afterEquals = false;
      return 'number';
    }
    stream.next();
    return null;
  },
  startState() {
    return { afterEquals: false };
  },
  languageData: {
    commentTokens: { line: '//' },
  },
};

export function createMilkdropLanguage() {
  return StreamLanguage.define(milkdropParser);
}
