import type { StreamParser, StringStream } from '@codemirror/language';
import { StreamLanguage } from '@codemirror/language';
import {
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
  MILKDROP_REGISTER_WORD_PATTERN,
  milkdropVariableNames,
} from 'milkdrop-toolchain/src/builtin-docs.ts';

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

// q1-Q32 persistent globals and t1-t32 registers, matching what the VM seeds.
const VARIABLE_WORD = MILKDROP_REGISTER_WORD_PATTERN;

// --- Shader-block word classes -------------------------------------------
//
// Inside [warp_shader]/[comp_shader] blocks the language is GLSL-flavoured
// HLSL (types, control flow, tex2D samplers), not EEL2. The same
// derive-don't-drift rule applies where a source exists: sampler references
// are `sampler_`-prefixed identifiers, so the shape test below can never
// fall behind the compiler's sampler table. The hand-written sets cover the
// fixed shader vocabulary the translation layer emits and accepts —
// shader-analysis-glsl.ts maps every one of these names.

/** Scalar/vector/matrix type keywords, both the GLSL and HLSL spellings. */
export const SHADER_TYPE_WORDS: ReadonlySet<string> = new Set([
  'void',
  'float',
  'float2',
  'float3',
  'float4',
  'half',
  'half2',
  'half3',
  'half4',
  'int',
  'bool',
  'vec2',
  'vec3',
  'vec4',
  'mat2',
  'mat3',
  'mat4',
  'float2x2',
  'float3x3',
  'float4x4',
  'sampler2d',
  'sampler3d',
]);

/** Control flow, qualifiers, and the shader_body entry marker. */
export const SHADER_KEYWORD_WORDS: ReadonlySet<string> = new Set([
  'shader_body',
  'if',
  'else',
  'for',
  'while',
  'do',
  'return',
  'break',
  'continue',
  'discard',
  'struct',
  'const',
  'uniform',
  'static',
  'in',
  'out',
  'inout',
]);

/** Booleans stand apart from keywords the way EEL constants are atoms. */
export const SHADER_ATOM_WORDS: ReadonlySet<string> = new Set([
  'true',
  'false',
]);

/**
 * The stage contract variables every warp/comp body is handed: `uv` and
 * `uv_orig`, the output `ret`, the polar coordinates, and the frame
 * constants. MilkDrop presets read these without declaring them.
 */
export const SHADER_STAGE_WORDS: ReadonlySet<string> = new Set([
  'uv',
  'uv_orig',
  'ret',
  'rad',
  'ang',
  'texsize',
  'time',
  'aspect',
  'rand_frame',
  'rand_preset',
]);

/**
 * Texture-sampling and math intrinsics: the HLSL names MilkDrop presets
 * write (`tex2D`, `lerp`, `saturate`), the GLSL equivalents the dialect also
 * accepts (`texture2D`, `mix`, `fract`), and the MilkDrop 2 preamble helpers
 * (`GetPixel`, `GetBlur1`..`GetBlur3`). Lowercase — matching is
 * case-insensitive the way the emitter is.
 */
export const SHADER_INTRINSIC_WORDS: ReadonlySet<string> = new Set([
  'tex2d',
  'tex3d',
  'tex2dlod',
  'tex2dbias',
  'tex2dgrad',
  'texture2d',
  'texture3d',
  'texture',
  'getpixel',
  'getblur0',
  'getblur1',
  'getblur2',
  'getblur3',
  'videotex2d',
  'lerp',
  'mix',
  'saturate',
  'frac',
  'fract',
  'ddx',
  'ddy',
  'dfdx',
  'dfdy',
  'fwidth',
  'mul',
  'transpose',
  'lum',
  'sqr',
  'sigmoid',
  'above',
  'below',
  'equal',
  'rand',
  'noise',
  'fmod',
  'atan2',
  'log10',
  'rsqrt',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'abs',
  'sign',
  'sqrt',
  'pow',
  'exp',
  'exp2',
  'log',
  'log2',
  'floor',
  'ceil',
  'trunc',
  'round',
  'min',
  'max',
  'clamp',
  'step',
  'smoothstep',
  'length',
  'dot',
  'cross',
  'normalize',
  'reflect',
  'refract',
  'mod',
]);

const NUMBER_TOKEN_PATTERN =
  /^(?:0[xX][0-9a-fA-F]+|(?:[0-9]*\.)?[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+\.)/;

type MilkdropParserState = {
  afterEquals: boolean;
  /** The `[section]` the current line sits in, lowercased; null before the
   * first header. Tracked so shader blocks highlight as GLSL, not EEL2.
   * Optional only so hand-built fallback states stay assignable; startState
   * always seeds it. */
  section?: string | null;
};

function isShaderSection(section: string | null | undefined): boolean {
  return section === 'warp_shader' || section === 'comp_shader';
}

/**
 * One token inside a warp/comp shader block. The shape follows what the
 * parser reads: `//` is still a comment, but `#` starts a preprocessor
 * directive (shader text, not a comment), and every identifier is an
 * expression — there is no key=value split to wait for.
 */
function shaderToken(stream: StringStream): string | null {
  if (stream.match(/\/\//u)) {
    stream.skipToEnd();
    return 'comment';
  }

  if (stream.match(/#/u)) {
    stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/u);
    return 'meta';
  }

  if (stream.match(/^"([^"\\]|\\.)*"/u) || stream.match(/^'([^'\\]|\\.)*'/u)) {
    return 'string';
  }

  if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/u)) {
    const word = stream.current();
    const lower = word.toLowerCase();
    // Sampler references (`sampler_main`, `sampler_fw_main`, …) take their
    // class from their shape rather than a list, so a sampler the compiler
    // accepts can never highlight as a plain identifier.
    if (lower.startsWith('sampler_')) return 'builtin';
    if (SHADER_TYPE_WORDS.has(lower)) return 'type';
    if (SHADER_KEYWORD_WORDS.has(lower)) return 'keyword';
    if (SHADER_ATOM_WORDS.has(lower)) return 'atom';
    if (SHADER_INTRINSIC_WORDS.has(lower)) return 'keyword';
    if (SHADER_STAGE_WORDS.has(lower)) return 'atom';
    if (VARIABLE_WORD.test(word)) return 'variableName';
    return null;
  }

  if (stream.match(NUMBER_TOKEN_PATTERN)) return 'number';
  if (stream.match(/[+\-*/%^<>=!&|~]+/u)) return 'operator';
  stream.next();
  return null;
}

export const milkdropParser: StreamParser<MilkdropParserState> = {
  name: 'milkdrop-preset',
  token(stream, state) {
    if (stream.eatSpace()) return null;

    // Any line that is just a `[...]` group opens a section — the same rule
    // the preset parser applies, even inside a shader body, so a header
    // ends the block here exactly where the parser ends it there.
    const header = stream.match(/^\[\s*(\w*)\s*\]/u);
    if (header) {
      // A RegExp pattern always returns the match array here; the boolean
      // arm of StringStream.match's union belongs to its string overload,
      // which this call never takes.
      const name = (header as RegExpMatchArray)[1] ?? '';
      state.section = name.toLowerCase();
      return 'heading';
    }

    if (isShaderSection(state.section)) {
      return shaderToken(stream);
    }

    if (
      stream.match('//') ||
      stream.match('#') ||
      (stream.sol() && stream.match(';'))
    ) {
      stream.skipToEnd();
      return 'comment';
    }

    if (
      stream.match(/^"([^"\\]|\\.)*"/u) ||
      stream.match(/^'([^'\\]|\\.)*'/u)
    ) {
      return 'string';
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
      if (stream.match(NUMBER_TOKEN_PATTERN)) return 'number';
      if (stream.match(/[+\-*/%^<>=!&|~]+/)) return 'operator';
      stream.next();
      return null;
    }

    if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) return 'propertyName';
    if (stream.match(/=/)) {
      state.afterEquals = true;
      return 'operator';
    }
    if (stream.match(NUMBER_TOKEN_PATTERN)) {
      state.afterEquals = false;
      return 'number';
    }
    stream.next();
    return null;
  },
  startState() {
    return { afterEquals: false, section: null };
  },
  languageData: {
    commentTokens: { line: '//' },
  },
};

export function createMilkdropLanguage() {
  return StreamLanguage.define(milkdropParser);
}
