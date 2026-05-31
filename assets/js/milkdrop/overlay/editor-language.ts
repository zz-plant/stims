import type { StreamParser } from '@codemirror/language';
import { StreamLanguage } from '@codemirror/language';

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
      if (
        stream.match(
          /sin|cos|tan|asin|acos|atan|atan2|abs|sqrt|pow|mod|fmod|min|max|mix|lerp|floor|int|ceil|sqr|clamp|step|smoothstep|log|exp|sigmoid|sign|frac|rand|if|above|below|equal|bor|band|bnot\b/,
        )
      )
        return 'keyword';
      if (
        stream.match(
          /bass_att|bass|mid_att|mid|treb_att|treb|treble|beat_pulse|beat|rms|vol|time|frame|fps|progress\b/,
        )
      )
        return 'atom';
      if (stream.match(/q[1-8]|t[1-9]|t[12]\d|t3[0-2]\b/))
        return 'variableName';
      if (stream.match(/[0-9]+(\.[0-9]+)?/)) return 'number';
      if (stream.match(/pi|e\b/)) return 'builtin';
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
};

export function createMilkdropLanguage() {
  return StreamLanguage.define(milkdropParser);
}
