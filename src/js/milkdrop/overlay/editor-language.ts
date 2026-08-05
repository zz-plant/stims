import type { StreamParser } from '@codemirror/language';
import { StreamLanguage } from '@codemirror/language';

const KEYWORD_WORDS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'abs',
  'sqrt',
  'pow',
  'mod',
  'fmod',
  'min',
  'max',
  'mix',
  'lerp',
  'floor',
  'int',
  'ceil',
  'sqr',
  'clamp',
  'step',
  'smoothstep',
  'log',
  'exp',
  'sigmoid',
  'sign',
  'frac',
  'rand',
  'if',
  'above',
  'below',
  'equal',
  'bor',
  'band',
  'bnot',
  'exec2',
  'exec3',
]);

const ATOM_WORDS = new Set([
  'bass_att',
  'bass',
  'mid_att',
  'mid',
  'treb_att',
  'treb',
  'treble',
  'beat_pulse',
  'beat',
  'rms',
  'vol',
  'time',
  'frame',
  'fps',
  'progress',
]);

const BUILTIN_WORDS = new Set(['pi', 'e']);

// q1-q8 persistent globals and t1-t32 registers.
const VARIABLE_WORD = /^(?:q[1-8]|t(?:[1-9]|[12]\d|3[0-2]))$/;

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
