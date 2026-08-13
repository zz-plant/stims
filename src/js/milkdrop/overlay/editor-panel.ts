import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import {
  autocompletion,
  clearSnippet,
  closeBrackets,
  closeBracketsKeymap,
  nextSnippetField,
  prevSnippetField,
  snippetCompletion,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  toggleComment,
  undo,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search';
import {
  Compartment,
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  oneDarkHighlightStyle,
  oneDarkTheme,
} from '@codemirror/theme-one-dark';
import type { KeyBinding } from '@codemirror/view';
import {
  crosshairCursor,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  getActiveThemePreference,
  subscribeToThemePreference,
} from '../../core/theme-preferences';
import { renderIconSvg } from '../../ui/icon-library.ts';
import {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_FUNCTION_SNIPPET_TEMPLATES,
} from '../builtin-docs';
import { parseMilkdropExpression, parseMilkdropStatement } from '../expression';
import { computeMidiGutterInfo, type MidiGutterEntry } from '../formatter';
import { parseMilkdropPreset } from '../preset-parser';
import type { MilkdropDiagnostic, MilkdropEditorSessionState } from '../types';
import { createMilkdropLanguage } from './editor-language';
import {
  compatibilityCategoryLabel,
  getPrimaryDegradationReason,
} from './preset-row';
import { computeSourceDiff } from './source-diff.ts';

export type SliderConfig = {
  label: string;
  key: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
};

export const DEFAULT_EDITOR_SLIDERS: SliderConfig[] = [
  {
    label: 'Zoom',
    key: 'zoom',
    min: 0.2,
    max: 3.0,
    step: 0.01,
    defaultValue: 1.0,
  },
  {
    label: 'Warp',
    key: 'warp',
    min: 0.0,
    max: 10.0,
    step: 0.05,
    defaultValue: 1.0,
  },
  {
    label: 'Rot',
    key: 'rot',
    min: -1.0,
    max: 1.0,
    step: 0.01,
    defaultValue: 0.0,
  },
  {
    label: 'Decay',
    key: 'decay',
    min: 0.8,
    max: 1.0,
    step: 0.005,
    defaultValue: 0.98,
  },
  {
    label: 'Center X',
    key: 'cx',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    defaultValue: 0.5,
  },
  {
    label: 'Center Y',
    key: 'cy',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    defaultValue: 0.5,
  },
  {
    label: 'Scale X',
    key: 'sx',
    min: 0.1,
    max: 3.0,
    step: 0.01,
    defaultValue: 1.0,
  },
  {
    label: 'Scale Y',
    key: 'sy',
    min: 0.1,
    max: 3.0,
    step: 0.01,
    defaultValue: 1.0,
  },
  {
    label: 'Shift X',
    key: 'dx',
    min: -0.5,
    max: 0.5,
    step: 0.01,
    defaultValue: 0.0,
  },
  {
    label: 'Shift Y',
    key: 'dy',
    min: -0.5,
    max: 0.5,
    step: 0.01,
    defaultValue: 0.0,
  },
  {
    label: 'Wave Alpha',
    key: 'wave_a',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    defaultValue: 0.8,
  },
  {
    label: 'Border Size',
    key: 'ob_size',
    min: 0.0,
    max: 0.5,
    step: 0.01,
    defaultValue: 0.01,
  },
];

export function computeAstDiagnostics(source: string): MilkdropDiagnostic[] {
  const diagnostics: MilkdropDiagnostic[] = [];

  const presetResult = parseMilkdropPreset(source);
  diagnostics.push(...presetResult.diagnostics);

  const lines = source.split(/\r?\n/u);
  lines.forEach((lineText, lineIdx) => {
    const lineNumber = lineIdx + 1;
    const trimmed = lineText.trim();
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith(';')
    ) {
      return;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return;
    }

    let parenDepth = 0;
    for (let i = 0; i < trimmed.length; i += 1) {
      const char = trimmed[i];
      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        parenDepth -= 1;
        if (parenDepth < 0) {
          diagnostics.push({
            severity: 'error',
            code: 'unmatched_closing_paren',
            line: lineNumber,
            message: `Unmatched closing parenthesis ')' at line ${lineNumber}.`,
          });
          parenDepth = 0;
        }
      }
    }
    if (parenDepth > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'unclosed_paren',
        line: lineNumber,
        message: `Unclosed parenthesis '(' at line ${lineNumber}.`,
      });
    }

    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.slice(0, equalsIdx).trim().toLowerCase();
      const val = trimmed.slice(equalsIdx + 1).trim();

      const isEquationKey =
        key.startsWith('per_frame') ||
        key.startsWith('per_pixel') ||
        key.startsWith('wave_') ||
        key.startsWith('shape_') ||
        key === 'warp' ||
        key === 'comp';

      if (isEquationKey && val) {
        const statements = val.split(';');
        statements.forEach((stmt) => {
          const s = stmt.trim();
          if (!s) return;
          if (s.includes('=')) {
            const res = parseMilkdropStatement(s, lineNumber);
            diagnostics.push(...res.diagnostics);
          } else {
            const res = parseMilkdropExpression(s, lineNumber);
            diagnostics.push(...res.diagnostics);
          }
        });
      } else if (val && /^[0-9A-Za-z_+\-*/\s().]+$/u.test(val)) {
        const res = parseMilkdropExpression(val, lineNumber);
        diagnostics.push(...res.diagnostics);
      }
    }
  });

  return mergeDiagnostics(diagnostics, []);
}

export function mergeDiagnostics(
  primary: MilkdropDiagnostic[],
  secondary: MilkdropDiagnostic[],
): MilkdropDiagnostic[] {
  const map = new Map<string, MilkdropDiagnostic>();
  [...primary, ...secondary].forEach((diag) => {
    const key = `${diag.line ?? 0}:${diag.code ?? ''}:${diag.message}`;
    if (!map.has(key)) {
      map.set(key, diag);
    }
  });
  return Array.from(map.values());
}

type EditorSnippet = {
  label: string;
  description: string;
  snippet: string;
};

type EditorCue = {
  label: string;
  description: string;
  snippet: string;
};

const EDITOR_SNIPPETS: EditorSnippet[] = [
  {
    label: 'Pulse zoom',
    description: 'Drop in a breathing zoom curve.',
    snippet: 'zoom=1.01 + 0.035*sin(time*0.82)\n',
  },
  {
    label: 'Hue drift',
    description: 'Animate the waveform palette.',
    snippet:
      'wave_r=0.5 + 0.35*sin(time*0.31)\nwave_g=0.5 + 0.35*sin(time*0.47)\nwave_b=0.5 + 0.35*sin(time*0.63)\n',
  },
  {
    label: 'Warp sway',
    description: 'Add a gentle audio-reactive bend.',
    snippet: 'warp=0.01 + bass_att*0.018 + 0.004*sin(time*0.5)\n',
  },
  {
    label: 'Bass zoom',
    description: 'Zoom pulses with bass energy.',
    snippet: 'zoom=1.0 + bass*0.12\n',
  },
  {
    label: 'Mid warp',
    description: 'Warp bends with midrange signal.',
    snippet: 'warp=1.0 + mid_att*0.025\n',
  },
  {
    label: 'Beat flash',
    description: 'Outer border pulses on beat.',
    snippet:
      'ob_size=0.01 + beat_pulse*0.04\nob_r=0.9; ob_g=0.5; ob_b=1;\nob_a=0.6 + beat_pulse*0.4\n',
  },
  {
    label: 'Time spin',
    description: 'Slow rotation from time phase.',
    snippet: 'rot=time*0.15\n',
  },
  {
    label: '3D projection',
    description: 'Project XY from XYZ with perspective.',
    snippet: 'x=xp/zp+0.5;\ny=yp/zp*1.3+0.5\n',
  },
  {
    label: 'Color pulse',
    description: 'Wave color modulated by treble.',
    snippet:
      'wave_r=0.5 + treb_att*0.5;\nwave_g=0.3 + mid_att*0.5;\nwave_b=0.9 + bass*0.3\n',
  },
  {
    label: 'Decay trail',
    description: 'Longer trail = softer motion.',
    snippet: 'decay=0.935\n',
  },
  {
    label: 'State toggle',
    description: 'Flip between two values each frame.',
    snippet: 'q1=above(bass, 0.1);\nzoom=1.0 + q1*0.2\n',
  },
];

const EDITOR_CUES: EditorCue[] = [
  {
    label: 'bass_att',
    description: 'Low-end zoom lift',
    snippet: 'zoom=1.0 + bass_att*0.08\n',
  },
  {
    label: 'mid_att',
    description: 'Midrange rotation',
    snippet: 'rot = rot + mid_att*0.01\n',
  },
  {
    label: 'treb_att',
    description: 'Treble brightness',
    snippet: 'wave_a=0.4 + treb_att*0.4\n',
  },
  {
    label: 'beat_pulse',
    description: 'Beat gate',
    snippet: 'ob_size=0.01 + beat_pulse*0.02\n',
  },
  {
    label: 'time',
    description: 'Continuous phase',
    snippet: 'wave_y=0.5 + sin(time*0.35)*0.08\n',
  },
  {
    label: 'frame',
    description: 'Frame drift',
    snippet: 'warp=0.01 + sin(frame*0.02)*0.01\n',
  },
  {
    label: 'q1-q8',
    description: 'Persistent globals',
    snippet: 'q1=bass*0.5 + q1*0.95\nzoom=1.0 + q1*0.1\n',
  },
  {
    label: 'rad',
    description: 'Per-point radius',
    snippet: 'rad=0.02 + bass*0.04\n',
  },
  {
    label: 'r/g/b/a',
    description: 'Per-point color',
    snippet: 'r=0.4 + bass*0.3;\ng=0.2 + mid*0.3;\nb=1;\na=0.8\n',
  },
  {
    label: 'decay',
    description: 'Motion trail length',
    snippet: 'decay=0.92 + bass_att*0.06\n',
  },
];

const defaultEditorKeymap = defaultKeymap as readonly KeyBinding[];
const historyEditorKeymap = historyKeymap as readonly KeyBinding[];
const indentWithTabKeybinding = indentWithTab as KeyBinding;

const EDITOR_FLOW_TIPS = [
  'Queued edits patch the stage after 120ms of calm typing.',
  'Cmd/Ctrl+Enter punches the current draft in immediately.',
  'Compiler errors keep the last stable frame visible while you recover.',
] as const;

export type EditorPanelCallbacks = {
  onEditorSourceChange: (source: string) => void;
  onRevertToActive: () => void;
  onDuplicatePreset: () => void;
  onExport: () => void;
  onDeletePreset: () => void;
  onRequestImport: () => void;
};

const MILKDROP_TO_CM_SEVERITY: Record<
  MilkdropDiagnostic['severity'],
  CmDiagnostic['severity']
> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

function toLintDiagnostics(
  state: EditorState,
  diagnostics: MilkdropDiagnostic[],
  onQuickFix: (diagnostic: MilkdropDiagnostic) => void,
): CmDiagnostic[] {
  return diagnostics
    .filter(
      (diagnostic) =>
        typeof diagnostic.line === 'number' &&
        diagnostic.line >= 1 &&
        diagnostic.line <= state.doc.lines,
    )
    .map((diagnostic) => {
      const line = state.doc.line(diagnostic.line as number);
      const from =
        line.from + (line.text.length - line.text.trimStart().length);
      return {
        from: Math.min(from, line.to),
        to: line.to,
        severity: MILKDROP_TO_CM_SEVERITY[diagnostic.severity],
        message: diagnostic.message,
        source: diagnostic.code,
        actions:
          diagnostic.severity === 'error'
            ? [
                {
                  name: 'Fix with AI',
                  markClass: 'cm-quickfix-action',
                  apply: () => onQuickFix(diagnostic),
                },
              ]
            : undefined,
      };
    });
}

// ── MIDI gutter markers ───────────────────────────────────────────
// A filled diamond marks a line MIDI/MCP is actively driving; a hollow
// one marks a binding the preset's own per_frame/per_pixel equations
// reassign every frame, so the knob has no visible effect. See
// isFieldShadowedByEquations in formatter.ts for why that happens.
const setMidiGutterInfo = StateEffect.define<MidiGutterEntry[]>();

const midiGutterField = StateField.define<MidiGutterEntry[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMidiGutterInfo)) {
        return effect.value;
      }
    }
    return value;
  },
});

class MidiGutterMarker extends GutterMarker {
  constructor(
    private readonly status: MidiGutterEntry['status'],
    private readonly target: string,
  ) {
    super();
  }

  eq(other: MidiGutterMarker): boolean {
    return other.status === this.status && other.target === this.target;
  }

  toDOM(): Node {
    const span = document.createElement('span');
    span.className = `cm-midi-gutter-marker cm-midi-gutter-marker--${this.status}`;
    span.textContent = this.status === 'live' ? '◆' : '◇';
    span.title =
      this.status === 'live'
        ? `MIDI/MCP is driving ${this.target}.`
        : `MIDI/MCP is bound to ${this.target}, but this preset's own equations reassign it every frame — the binding has no visible effect.`;
    return span;
  }
}

function midiGutterExtension() {
  return [
    midiGutterField,
    gutter({
      class: 'cm-midi-gutter',
      lineMarker(view, line) {
        const entries = view.state.field(midiGutterField);
        if (entries.length === 0) return null;
        const lineNumber = view.state.doc.lineAt(line.from).number;
        const entry = entries.find((e) => e.line === lineNumber);
        return entry ? new MidiGutterMarker(entry.status, entry.target) : null;
      },
      lineMarkerChange: (update) =>
        update.startState.field(midiGutterField) !==
        update.state.field(midiGutterField),
    }),
  ];
}

// Multi-argument functions get a snippet template so accepting the
// completion drops in placeholder args the user can Tab through, instead of
// leaving them to hand-type parens and commas. Derived from the params
// declared in the shared builtin table.
const FUNCTION_SNIPPET_TEMPLATES: Readonly<Record<string, string>> =
  MILKDROP_FUNCTION_SNIPPET_TEMPLATES;

// Autocomplete options and hover docs derive from the shared builtin table in
// builtin-docs.ts, so the editor always offers exactly what the compiler and
// VM accept (all intrinsic functions, runtime signals, q1..q32/t1..t32,
// per-frame state, constants). Exported for the derivation test in
// tests/unit/milkdrop-builtin-docs.test.ts.
export const MILKDROP_BUILTIN_OPTIONS: Array<{
  label: string;
  type: string;
  detail?: string;
}> = MILKDROP_BUILTIN_DOCS.map((entry) => ({
  label: entry.name,
  type: entry.kind,
  detail: entry.doc,
}));

// Keeps the dropdown grouped by kind (functions, then variables, then
// constants) instead of letting fuzzy-match score interleave them; doc-derived
// variables (see below) sort after all of these.
const COMPLETION_TYPE_SORT_TIER: Record<string, string> = {
  function: '0',
  variable: '1',
  constant: '2',
};
const DOC_VARIABLE_SORT_TIER = '3';

const MILKDROP_BUILTIN_COMPLETIONS: Completion[] = MILKDROP_BUILTIN_OPTIONS.map(
  (opt) => {
    const withTier: Completion = {
      ...opt,
      sortText: `${COMPLETION_TYPE_SORT_TIER[opt.type] ?? '9'}${opt.label}`,
    };
    const template = FUNCTION_SNIPPET_TEMPLATES[opt.label];
    if (!template) return withTier;
    return snippetCompletion(template, withTier);
  },
);

const MILKDROP_BUILTIN_LABELS = new Set(
  MILKDROP_BUILTIN_OPTIONS.map((opt) => opt.label.toLowerCase()),
);

const MILKDROP_COMPLETIONS: CompletionSource = (context) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  return {
    from: word.from,
    options: MILKDROP_BUILTIN_COMPLETIONS.filter((opt) =>
      opt.label.toLowerCase().startsWith(word.text.toLowerCase()),
    ),
  };
};

// Surfaces identifiers the user already assigned elsewhere in this preset
// (custom accumulators, reused field names) so they don't have to scroll
// back up to recall the exact spelling.
const DOC_VARIABLE_PATTERN = /(?:^|\n|;)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/g;

const MILKDROP_DOC_VARIABLE_COMPLETIONS: CompletionSource = (context) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const doc = context.state.doc.toString();
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const match of doc.matchAll(DOC_VARIABLE_PATTERN)) {
    const name = match[1];
    const key = name.toLowerCase();
    if (MILKDROP_BUILTIN_LABELS.has(key) || seen.has(key)) continue;
    seen.add(key);
    options.push({
      label: name,
      type: 'variable',
      detail: 'used in this preset',
      sortText: `${DOC_VARIABLE_SORT_TIER}${name}`,
    });
  }

  return {
    from: word.from,
    options: options.filter((opt) =>
      opt.label.toLowerCase().startsWith(word.text.toLowerCase()),
    ),
  };
};

// Reuses the same label/type/detail already authored for autocomplete so
// hovering a builtin doesn't require the completion popup to be open.
const MILKDROP_DOC_LOOKUP = new Map(
  MILKDROP_BUILTIN_OPTIONS.map((opt) => [opt.label.toLowerCase(), opt]),
);

function wordAtPos(view: EditorView, pos: number) {
  const { text, from } = view.state.doc.lineAt(pos);
  let start = pos - from;
  let end = pos - from;
  while (start > 0 && /\w/.test(text[start - 1])) start -= 1;
  while (end < text.length && /\w/.test(text[end])) end += 1;
  if (start === end) return null;
  return { from: from + start, to: from + end, word: text.slice(start, end) };
}

const milkdropHoverTooltip = hoverTooltip((view, pos) => {
  const match = wordAtPos(view, pos);
  if (!match) return null;
  const entry = MILKDROP_DOC_LOOKUP.get(match.word.toLowerCase());
  if (!entry) return null;
  return {
    pos: match.from,
    end: match.to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-milkdrop-hover-doc';
      const label = document.createElement('strong');
      label.textContent = entry.label;
      dom.appendChild(label);
      if (entry.detail) {
        const detail = document.createElement('span');
        detail.textContent = ` — ${entry.detail}`;
        dom.appendChild(detail);
      }
      const kind = document.createElement('div');
      kind.className = 'cm-milkdrop-hover-doc__kind';
      kind.textContent = entry.type;
      dom.appendChild(kind);
      return { dom };
    },
  };
});

// oneDark bundles both chrome colors and token colors into a single
// Extension; we only want its token colors for dark mode, and swap in an
// equivalent light-mode HighlightStyle when the app theme flips, using the
// same lezer tags the milkdrop StreamLanguage tokens resolve to (see
// editor-language.ts): heading, comment, keyword, atom, variableName
// (registers) / variableName.standard (the legacy "builtin" token, used for
// pi/e), number, operator, propertyName.
const milkdropLightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: '#0f766e', fontWeight: 'bold' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#9333ea' },
  { tag: tags.atom, color: '#0891b2' },
  { tag: tags.variableName, color: '#b45309' },
  { tag: tags.standard(tags.variableName), color: '#be185d' },
  { tag: tags.number, color: '#059669' },
  { tag: tags.operator, color: '#475569' },
  { tag: tags.propertyName, color: '#1d4ed8' },
]);

function createEditorTheme() {
  return EditorView.theme({
    '&': {
      color: '#eff6ff',
      background:
        'linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(8, 47, 73, 0.68))',
      fontSize: '0.95rem',
    },
    '.cm-scroller': {
      fontFamily: '"IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace',
      lineHeight: '1.6',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(8, 47, 73, 0.42)',
      color: 'rgba(125, 211, 252, 0.65)',
      borderRight: '1px solid rgba(125, 211, 252, 0.14)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(34, 211, 238, 0.08)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(34, 211, 238, 0.12)',
    },
    '.cm-content': {
      caretColor: '#67e8f9',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#67e8f9',
    },
    '&.cm-focused': {
      outline: '2px solid rgba(34, 211, 238, 0.4)',
      outlineOffset: '-2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(34, 211, 238, 0.22)',
    },
    '.cm-quickfix-action': {
      backgroundColor: 'rgba(34, 211, 238, 0.16)',
      color: '#67e8f9',
    },
    '.cm-milkdrop-hover-doc': {
      maxWidth: '280px',
      padding: '6px 8px',
      fontSize: '0.82rem',
      lineHeight: '1.4',
    },
    '.cm-milkdrop-hover-doc__kind': {
      marginTop: '2px',
      fontSize: '0.7rem',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      opacity: 0.65,
    },
    '.cm-midi-gutter': {
      width: '14px',
    },
    '.cm-midi-gutter-marker': {
      display: 'inline-block',
      width: '100%',
      textAlign: 'center',
      fontSize: '0.72rem',
      lineHeight: '1',
      cursor: 'default',
    },
    '.cm-midi-gutter-marker--live': {
      color: '#4ade80',
    },
    '.cm-midi-gutter-marker--shadowed': {
      color: 'rgba(148, 163, 184, 0.55)',
    },
  });
}

function createEditorView({
  parent,
  onDocChange,
  onBufferedEdit,
  isChangeSuppressed,
  onQuickFixDiagnostic,
}: {
  parent: HTMLElement;
  onDocChange: (source: string) => void;
  onBufferedEdit: () => void;
  isChangeSuppressed: () => boolean;
  onQuickFixDiagnostic: (diagnostic: MilkdropDiagnostic) => void;
}) {
  let debounceId: number | null = null;
  let view: EditorView;
  const syntaxThemeCompartment = new Compartment();
  const syntaxHighlightStyleForTheme = (theme: 'light' | 'dark') =>
    syntaxHighlighting(
      theme === 'light' ? milkdropLightHighlightStyle : oneDarkHighlightStyle,
    );

  const flushDocChange = () => {
    if (isChangeSuppressed()) {
      return true;
    }
    if (debounceId !== null) {
      window.clearTimeout(debounceId);
      debounceId = null;
    }
    onDocChange(view.state.doc.toString());
    return true;
  };

  view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        createMilkdropLanguage(),
        oneDarkTheme,
        syntaxThemeCompartment.of(
          syntaxHighlightStyleForTheme(getActiveThemePreference().theme),
        ),
        createEditorTheme(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          activateOnTyping: true,
          override: [MILKDROP_COMPLETIONS, MILKDROP_DOC_VARIABLE_COMPLETIONS],
        }),
        milkdropHoverTooltip,
        search(),
        highlightSelectionMatches(),
        foldGutter(),
        indentOnInput(),
        lintGutter(),
        midiGutterExtension(),
        // Editing MilkDrop presets means repeatedly touching aligned
        // per-channel triples (wave_r/g/b, shapecode_N_border_r/g/b, ...);
        // multi-cursor + column selection make that a single edit instead
        // of N repetitive ones.
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        crosshairCursor(),
        keymap.of([
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...lintKeymap,
          {
            key: 'Mod-Enter',
            run: () => flushDocChange(),
          },
          { key: 'Mod-/', run: toggleComment },
          ...defaultEditorKeymap,
          ...historyEditorKeymap,
          indentWithTabKeybinding,
        ]),
        Prec.highest(
          keymap.of([
            { key: 'Tab', run: nextSnippetField, shift: prevSnippetField },
            { key: 'Escape', run: clearSnippet },
          ]),
        ),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || isChangeSuppressed()) {
            return;
          }
          onBufferedEdit();
          if (debounceId !== null) {
            window.clearTimeout(debounceId);
          }
          debounceId = window.setTimeout(() => {
            debounceId = null;
            onDocChange(update.state.doc.toString());
          }, 120);
        }),
      ],
    }),
    parent,
  });

  const unsubscribeTheme = subscribeToThemePreference(({ theme }) => {
    view.dispatch({
      effects: syntaxThemeCompartment.reconfigure(
        syntaxHighlightStyleForTheme(theme),
      ),
    });
  });

  return {
    view,
    clearDebounce() {
      if (debounceId !== null) {
        window.clearTimeout(debounceId);
        debounceId = null;
      }
    },
    unsubscribeTheme,
    flushDocChange,
    setDiagnostics(diagnostics: MilkdropDiagnostic[]) {
      view.dispatch(
        setDiagnostics(
          view.state,
          toLintDiagnostics(view.state, diagnostics, onQuickFixDiagnostic),
        ),
      );
    },
  };
}

export class EditorPanel {
  readonly element: HTMLElement;

  private readonly callbacks: EditorPanelCallbacks;
  private readonly editorStatus: HTMLElement;
  private readonly editorLiveBadge: HTMLElement;
  private readonly editorSyncBadge: HTMLElement;
  private readonly editorSafetyBadge: HTMLElement;
  private readonly diagnosticsList: HTMLElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly editor: EditorView;
  private readonly clearEditorDebounce: () => void;
  private readonly unsubscribeTheme: () => void;
  private readonly flushEditorDocChange: () => boolean;
  private readonly setEditorDiagnostics: (
    diagnostics: MilkdropDiagnostic[],
  ) => void;
  private readonly consoleHeaderLabel: HTMLElement;
  private suppressEditorChange = false;
  private hasBufferedEdits = false;
  private lastSessionState: MilkdropEditorSessionState | null = null;
  private quickFixBtn: HTMLButtonElement | null = null;
  private mostRecentDiagnostic: MilkdropDiagnostic | null = null;
  private snapshots: Array<{
    source: string;
    timestamp: number;
    label: string;
  }> = [];
  private historyList: HTMLElement | null = null;
  private assistedEditContainer: HTMLElement | null = null;
  // True while any AI-backed action (Refine, Explain, Quick-fix, Batch,
  // Blend) has a request in flight. All of those share one /api endpoint
  // family and one proposed-diff slot, so letting two run at once let a
  // second response clobber the first proposal with no indication anything
  // was lost.
  private aiPending = false;
  private refineBtn: HTMLButtonElement | null = null;
  private explainBtn: HTMLButtonElement | null = null;
  private batchButton: HTMLButtonElement | null = null;
  private blendSubmitButton: HTMLButtonElement | null = null;
  private disposeDiagnosticsListener: (() => void) | null = null;
  private sliderInputs: Map<
    string,
    { input: HTMLInputElement; display: HTMLSpanElement; defaultValue: number }
  > = new Map();
  private midiTargets: Set<string> = new Set();

  constructor(callbacks: EditorPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('section');
    this.element.className = 'milkdrop-overlay__tab-panel';

    const editorTransport = document.createElement('div');
    editorTransport.className = 'milkdrop-overlay__editor-transport';
    const editorIntroCopy = document.createElement('div');
    editorIntroCopy.className = 'milkdrop-overlay__editor-intro-copy';
    const editorEyebrow = document.createElement('span');
    editorEyebrow.className = 'milkdrop-overlay__editor-eyebrow';
    editorEyebrow.textContent = 'Live code REPL';
    const editorHeading = document.createElement('strong');
    editorHeading.className = 'milkdrop-overlay__editor-heading';
    editorHeading.textContent = 'Patch the active preset';
    const editorSubheading = document.createElement('p');
    editorSubheading.className = 'milkdrop-overlay__editor-subheading';
    editorSubheading.textContent =
      'Keep the stage running while you type. Cmd/Ctrl+Enter forces an instant punch-in.';
    editorIntroCopy.append(editorEyebrow, editorHeading, editorSubheading);
    const editorMeta = document.createElement('div');
    editorMeta.className = 'milkdrop-overlay__editor-badges';
    const editorShortcutBadge = document.createElement('span');
    editorShortcutBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--shortcut';
    editorShortcutBadge.textContent = 'Cmd/Ctrl+Enter';
    this.editorLiveBadge = document.createElement('span');
    this.editorLiveBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--live';
    this.editorLiveBadge.textContent = 'Auto 120ms';
    this.editorSyncBadge = document.createElement('span');
    this.editorSyncBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--sync';
    this.editorSyncBadge.textContent = 'Synced';
    this.editorSafetyBadge = document.createElement('span');
    this.editorSafetyBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--safety';
    this.editorSafetyBadge.textContent = 'Safety net on';
    editorMeta.append(
      editorShortcutBadge,
      this.editorLiveBadge,
      this.editorSyncBadge,
      this.editorSafetyBadge,
    );
    editorTransport.append(editorIntroCopy, editorMeta);

    this.editorStatus = document.createElement('div');
    this.editorStatus.className = 'milkdrop-overlay__editor-status';
    this.editorStatus.textContent = '';
    this.editorStatus.hidden = true;

    const editorActions = document.createElement('div');
    editorActions.className = 'milkdrop-overlay__editor-actions';

    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'milkdrop-overlay__editor-apply';
    applyButton.textContent = 'Update now';
    applyButton.addEventListener('click', () => this.applyCurrentSource());
    editorActions.appendChild(applyButton);

    const revertButton = document.createElement('button');
    revertButton.type = 'button';
    revertButton.textContent = 'Reset draft';
    revertButton.setAttribute(
      'aria-label',
      'Reset draft to active preset source',
    );
    revertButton.addEventListener('click', () =>
      this.callbacks.onRevertToActive(),
    );
    editorActions.appendChild(revertButton);

    // CodeMirror's history() extension already answers to Cmd/Ctrl+Z, but
    // that was invisible outside the editor — no button, no way to tell
    // undo is even possible without trying it.
    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.textContent = '↶ Undo';
    undoButton.title = 'Undo (Cmd/Ctrl+Z)';
    undoButton.setAttribute('aria-label', 'Undo last edit');
    undoButton.addEventListener('click', () => {
      undo(this.editor);
      this.editor.focus();
    });
    editorActions.appendChild(undoButton);

    const redoButton = document.createElement('button');
    redoButton.type = 'button';
    redoButton.textContent = '↷ Redo';
    redoButton.title = 'Redo (Cmd/Ctrl+Shift+Z)';
    redoButton.setAttribute('aria-label', 'Redo last undone edit');
    redoButton.addEventListener('click', () => {
      redo(this.editor);
      this.editor.focus();
    });
    editorActions.appendChild(redoButton);

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.textContent = 'Remix';
    duplicateButton.setAttribute(
      'aria-label',
      'Remix current preset (keeps its credit lineage)',
    );
    duplicateButton.addEventListener('click', () =>
      this.callbacks.onDuplicatePreset(),
    );
    editorActions.appendChild(duplicateButton);

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import';
    importButton.setAttribute('aria-label', 'Import a preset');
    importButton.addEventListener('click', () =>
      this.callbacks.onRequestImport(),
    );
    editorActions.appendChild(importButton);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Export';
    exportButton.setAttribute('aria-label', 'Export current preset');
    exportButton.addEventListener('click', () => this.callbacks.onExport());
    editorActions.appendChild(exportButton);

    const importButton2 = document.createElement('button');
    importButton2.type = 'button';
    importButton2.textContent = 'Batch';
    importButton2.title = 'Generate variations (Shift+Enter)';
    importButton2.setAttribute('aria-label', 'Generate preset variations');
    importButton2.addEventListener('click', () => this.handleBatchGenerate());
    editorActions.appendChild(importButton2);
    this.batchButton = importButton2;

    const blendButton = document.createElement('button');
    blendButton.type = 'button';
    blendButton.textContent = 'Blend';
    blendButton.title = 'Blend with another preset';
    blendButton.setAttribute('aria-label', 'Blend with another preset');
    blendButton.addEventListener('click', () => this.handleBlend());
    editorActions.appendChild(blendButton);

    this.deleteButton = document.createElement('button');
    this.deleteButton.type = 'button';
    this.deleteButton.textContent = 'Delete';
    this.deleteButton.hidden = true;
    this.deleteButton.addEventListener('click', () =>
      this.callbacks.onDeletePreset(),
    );
    editorActions.appendChild(this.deleteButton);

    const editorWorkbench = document.createElement('div');
    editorWorkbench.className = 'milkdrop-overlay__editor-workbench';
    const editorMain = document.createElement('div');
    editorMain.className = 'milkdrop-overlay__editor-main';
    const editorHost = document.createElement('div');
    editorHost.className = 'milkdrop-overlay__editor';

    const editorViewState = createEditorView({
      parent: editorHost,
      onDocChange: (source) => this.callbacks.onEditorSourceChange(source),
      onBufferedEdit: () => {
        this.hasBufferedEdits = true;
        const currentDoc = this.editor.state.doc.toString();
        const astDiag = computeAstDiagnostics(currentDoc);
        const combined = mergeDiagnostics(
          this.lastSessionState?.diagnostics ?? [],
          astDiag,
        );
        this.setEditorDiagnostics(combined);
        if (this.lastSessionState) {
          this.renderSessionState({
            ...this.lastSessionState,
            source: currentDoc,
            diagnostics: combined,
          });
        }
      },
      isChangeSuppressed: () => this.suppressEditorChange,
      onQuickFixDiagnostic: (diagnostic) =>
        this.applyQuickFixForDiagnostic(diagnostic),
    });
    this.editor = editorViewState.view;
    this.clearEditorDebounce = editorViewState.clearDebounce;
    this.unsubscribeTheme = editorViewState.unsubscribeTheme;
    this.flushEditorDocChange = editorViewState.flushDocChange;
    this.setEditorDiagnostics = editorViewState.setDiagnostics;

    const editorBody = document.createElement('div');
    editorBody.className = 'editor-body';
    editorBody.appendChild(editorHost);
    editorBody.appendChild(this.renderSliders());
    editorMain.append(this.editorStatus, editorBody);

    const editorRail = document.createElement('div');
    editorRail.className = 'milkdrop-overlay__editor-rail';

    const editorCueSection = document.createElement('section');
    editorCueSection.className = 'milkdrop-overlay__editor-section';
    const editorCueLabel = document.createElement('span');
    editorCueLabel.className = 'milkdrop-overlay__editor-quick-ideas-label';
    editorCueLabel.textContent = 'Live cues';
    const editorCueCopy = document.createElement('p');
    editorCueCopy.className = 'milkdrop-overlay__editor-section-copy';
    editorCueCopy.textContent =
      'Drop safe reactive starter lines into the draft and shape them from there.';
    const editorCueGrid = document.createElement('div');
    editorCueGrid.className = 'milkdrop-overlay__editor-cue-grid';
    EDITOR_CUES.forEach((cue) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'milkdrop-overlay__editor-cue';
      const label = document.createElement('strong');
      label.textContent = cue.label;
      const description = document.createElement('span');
      description.textContent = cue.description;
      button.append(label, description);
      button.addEventListener('click', () => this.insertSnippet(cue.snippet));
      editorCueGrid.appendChild(button);
    });
    editorCueSection.append(editorCueLabel, editorCueCopy, editorCueGrid);

    const editorQuickIdeas = document.createElement('div');
    editorQuickIdeas.className =
      'milkdrop-overlay__editor-quick-ideas milkdrop-overlay__editor-section';
    const editorQuickIdeasLabel = document.createElement('span');
    editorQuickIdeasLabel.className =
      'milkdrop-overlay__editor-quick-ideas-label';
    editorQuickIdeasLabel.textContent = 'Pattern moves';
    const editorSnippetButtons = document.createElement('div');
    editorSnippetButtons.className = 'milkdrop-overlay__editor-snippet-buttons';
    EDITOR_SNIPPETS.forEach((snippetConfig) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'milkdrop-overlay__editor-snippet';
      const label = document.createElement('strong');
      label.textContent = snippetConfig.label;
      const description = document.createElement('span');
      description.textContent = snippetConfig.description;
      button.append(label, description);
      button.addEventListener('click', () => {
        this.insertSnippet(snippetConfig.snippet);
      });
      editorSnippetButtons.appendChild(button);
    });
    editorQuickIdeas.append(editorQuickIdeasLabel, editorSnippetButtons);

    const editorTips = document.createElement('div');
    editorTips.className =
      'milkdrop-overlay__editor-tips milkdrop-overlay__editor-section';
    const editorTipsLabel = document.createElement('span');
    editorTipsLabel.className = 'milkdrop-overlay__editor-quick-ideas-label';
    editorTipsLabel.textContent = 'Flow';
    EDITOR_FLOW_TIPS.forEach((tip) => {
      const item = document.createElement('div');
      item.className = 'milkdrop-overlay__editor-tip';
      item.textContent = tip;
      editorTips.appendChild(item);
    });
    editorTips.prepend(editorTipsLabel);

    const editorConsole = document.createElement('section');
    editorConsole.className = 'milkdrop-overlay__editor-section';
    const editorConsoleLabel = document.createElement('span');
    editorConsoleLabel.className = 'milkdrop-overlay__editor-quick-ideas-label';
    editorConsoleLabel.textContent = 'Console';
    this.consoleHeaderLabel = editorConsoleLabel;
    this.diagnosticsList = document.createElement('div');
    this.diagnosticsList.className = 'milkdrop-overlay__diagnostics';
    const quickFixBtn = this.renderQuickFix();
    this.quickFixBtn = quickFixBtn;
    editorConsole.append(editorConsoleLabel, this.diagnosticsList, quickFixBtn);

    // ── AI refinement bar ──────────────────────────────
    const refineSection = document.createElement('section');
    refineSection.className = 'milkdrop-overlay__editor-section';
    const refineLabel = document.createElement('span');
    refineLabel.className = 'milkdrop-overlay__editor-quick-ideas-label';
    refineLabel.textContent = 'Refine with AI';
    const refineForm = document.createElement('div');
    refineForm.className = 'milkdrop-overlay__refine-form';
    const refineInput = document.createElement('input');
    refineInput.type = 'text';
    refineInput.placeholder = '"make it more blue" or "add a slow rotation"';
    refineInput.className = 'milkdrop-overlay__refine-input';
    const refineBtn = document.createElement('button');
    refineBtn.type = 'button';
    refineBtn.textContent = 'Refine';
    refineBtn.className = 'milkdrop-overlay__refine-btn';
    refineBtn.addEventListener('click', async () => {
      const instruction = refineInput.value.trim();
      if (!instruction || this.aiPending) return;
      this.setRefinePending(true);
      refineBtn.textContent = '…';
      try {
        const currentSource = this.editor.state.doc.toString();
        const res = await fetch('/api/refine-preset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentSource, instruction }),
        });
        if (!res.ok) throw new Error(`Refine API: ${res.status}`);
        const json = await res.json();

        if (json.explanation) {
          const explanationMsg = document.createElement('div');
          explanationMsg.className = 'milkdrop-overlay__refine-explanation';
          explanationMsg.textContent = json.explanation;
          const closeBtn = document.createElement('button');
          closeBtn.textContent = '\u2715';
          closeBtn.className = 'editor-explanation-close';
          closeBtn.addEventListener('click', () => explanationMsg.remove());
          explanationMsg.appendChild(closeBtn);
          refineForm.appendChild(explanationMsg);
        }

        if (json.milkSource) {
          this.proposeAssistedEdit(json.milkSource, 'Refine');
          refineInput.value = '';
        }
        refineBtn.textContent = 'Refine';
        this.setRefinePending(false);
      } catch (err) {
        console.error('Refinement failed:', err);
        this.setRefinePending(false);
        refineBtn.textContent = 'Error';
        refineBtn.disabled = true;
        refineBtn.classList.add('milkdrop-overlay__refine-btn--error');
        setTimeout(() => {
          refineBtn.classList.remove('milkdrop-overlay__refine-btn--error');
          refineBtn.textContent = 'Refine';
          refineBtn.disabled = false;
        }, 2000);
      }
    });
    refineInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') refineBtn.click();
    });
    refineForm.append(refineInput, refineBtn);

    const explainBtn = document.createElement('button');
    explainBtn.type = 'button';
    explainBtn.textContent = 'Explain';
    explainBtn.className = 'milkdrop-overlay__refine-btn';
    explainBtn.title = 'Explain what this preset does visually';
    explainBtn.addEventListener('click', async () => {
      if (this.aiPending) return;
      this.setRefinePending(true);
      explainBtn.textContent = '…';
      try {
        const currentSource = this.editor.state.doc.toString();
        const res = await fetch('/api/refine-preset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentSource,
            instruction: 'explain this preset',
          }),
        });
        if (!res.ok) throw new Error(`Refine API: ${res.status}`);
        const json = await res.json();

        if (json.explanation) {
          const explanationMsg = document.createElement('div');
          explanationMsg.className = 'milkdrop-overlay__refine-explanation';
          explanationMsg.textContent = json.explanation;
          const closeBtn = document.createElement('button');
          closeBtn.textContent = '\u2715';
          closeBtn.className = 'editor-explanation-close';
          closeBtn.addEventListener('click', () => explanationMsg.remove());
          explanationMsg.appendChild(closeBtn);
          refineForm.appendChild(explanationMsg);
        }
        explainBtn.textContent = 'Explain';
        this.setRefinePending(false);
      } catch (err) {
        console.error('Explanation failed:', err);
        this.setRefinePending(false);
        explainBtn.textContent = 'Error';
        explainBtn.disabled = true;
        explainBtn.classList.add('milkdrop-overlay__refine-btn--error');
        setTimeout(() => {
          explainBtn.classList.remove('milkdrop-overlay__refine-btn--error');
          explainBtn.textContent = 'Explain';
          explainBtn.disabled = false;
        }, 2000);
      }
    });
    refineForm.appendChild(explainBtn);
    refineSection.append(refineLabel, refineForm);

    const historySection = document.createElement('section');
    historySection.className = 'milkdrop-overlay__editor-section';
    const historyLabel = document.createElement('span');
    historyLabel.className = 'milkdrop-overlay__editor-quick-ideas-label';
    historyLabel.textContent = 'History';
    this.historyList = document.createElement('div');
    this.historyList.className = 'milkdrop-overlay__editor-history';
    historySection.append(historyLabel, this.historyList);
    this.renderHistorySnapshots();

    editorRail.append(
      editorCueSection,
      editorQuickIdeas,
      editorTips,
      editorConsole,
      historySection,
      refineSection,
    );
    this.refineBtn = refineBtn;
    this.explainBtn = explainBtn;
    editorWorkbench.append(editorMain, editorRail);
    this.element.append(
      editorTransport,
      editorActions,
      this.renderBlendInput(),
      editorWorkbench,
    );

    const diagnosticsListener = ((
      e: CustomEvent<{ diagnostics: MilkdropDiagnostic[] }>,
    ) => {
      this.setEditorDiagnostics(e.detail.diagnostics);
    }) as EventListener;
    window.addEventListener('stims:editor:diagnostics', diagnosticsListener);
    this.disposeDiagnosticsListener = () => {
      window.removeEventListener(
        'stims:editor:diagnostics',
        diagnosticsListener,
      );
    };
  }

  setVisible(visible: boolean) {
    this.element.hidden = !visible;
  }

  setDeleteEnabled(enabled: boolean) {
    this.deleteButton.hidden = !enabled;
  }

  setSessionState(state: MilkdropEditorSessionState) {
    const nextSource = state.source;
    const currentDoc = this.editor.state.doc.toString();
    const preserveBufferedDraft =
      this.hasBufferedEdits && nextSource !== currentDoc;

    const astDiag = computeAstDiagnostics(
      preserveBufferedDraft ? currentDoc : nextSource,
    );
    const combinedDiagnostics = mergeDiagnostics(state.diagnostics, astDiag);

    if (preserveBufferedDraft) {
      if (this.lastSessionState) {
        this.renderSessionState({
          ...this.lastSessionState,
          source: currentDoc,
          diagnostics: combinedDiagnostics,
        });
      }
      return;
    }

    this.lastSessionState = state;
    if (nextSource !== currentDoc) {
      // A pending AI proposal was reviewed against the outgoing document;
      // it must not survive a preset switch.
      this.discardAssistedEdit();
      this.suppressEditorChange = true;
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: nextSource,
        },
      });
      this.suppressEditorChange = false;
    }
    if (nextSource === this.editor.state.doc.toString()) {
      this.hasBufferedEdits = false;
    }
    this.setEditorDiagnostics(combinedDiagnostics);
    this.renderSessionState({
      ...state,
      diagnostics: combinedDiagnostics,
    });
  }

  getEditorSource(): string {
    return this.editor.state.doc.toString();
  }

  private renderSessionState(state: MilkdropEditorSessionState) {
    const errors = state.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    const warnings = state.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'warning',
    );
    const hasErrors = errors.length > 0;
    const primaryReason = getPrimaryDegradationReason(state.latestCompiled);
    const activeCompatibility = state.latestCompiled?.ir.compatibility.parity;
    const latestWebglStatus =
      state.latestCompiled?.ir.compatibility.backends.webgl.status;
    const latestWebgpuStatus =
      state.latestCompiled?.ir.compatibility.backends.webgpu.status;
    const isDegraded = Boolean(
      activeCompatibility &&
        (activeCompatibility.fidelityClass === 'partial' ||
          activeCompatibility.fidelityClass === 'fallback' ||
          latestWebglStatus !== 'supported' ||
          latestWebgpuStatus !== 'supported'),
    );
    const shouldShowStatus = hasErrors || state.dirty || this.hasBufferedEdits;
    const baseStatus = hasErrors
      ? `${errors.length} compile/syntax error${errors.length === 1 ? '' : 's'} in draft. The stage is holding the last good frame.`
      : this.hasBufferedEdits
        ? 'Typing… the next patch is queued. Press Cmd/Ctrl+Enter to punch it in immediately.'
        : state.dirty
          ? 'Live patch applied. Keep shaping the draft or reset to return to the active source.'
          : '';

    if (hasErrors) {
      this.editorStatus.innerHTML = `${renderIconSvg('warning', {
        className: 'milkdrop-overlay__editor-status-icon',
      })}${baseStatus}`;
    } else {
      this.editorStatus.textContent = baseStatus;
    }
    this.editorStatus.hidden = !shouldShowStatus;
    if (hasErrors) {
      this.editorStatus.classList.add('milkdrop-overlay__editor-status--error');
    } else {
      this.editorStatus.classList.remove(
        'milkdrop-overlay__editor-status--error',
      );
    }

    this.editorLiveBadge.textContent = hasErrors
      ? 'Last good frame'
      : 'Auto 120ms';
    this.editorLiveBadge.dataset.tone = hasErrors ? 'warning' : 'accent';
    this.editorLiveBadge.hidden = false;
    this.editorSyncBadge.textContent = this.hasBufferedEdits
      ? 'Queued'
      : state.dirty
        ? 'Draft live'
        : 'Synced';
    this.editorSyncBadge.dataset.tone =
      this.hasBufferedEdits || state.dirty ? 'accent' : 'muted';
    this.editorSyncBadge.hidden = false;
    this.editorSafetyBadge.hidden = !hasErrors && !isDegraded;
    this.editorSafetyBadge.textContent = hasErrors
      ? `${errors.length} issue${errors.length === 1 ? '' : 's'}`
      : isDegraded
        ? 'Showing a simpler preset'
        : 'Stable';
    this.editorSafetyBadge.dataset.tone = hasErrors
      ? 'danger'
      : isDegraded
        ? 'warning'
        : 'muted';

    if (this.consoleHeaderLabel) {
      this.consoleHeaderLabel.textContent =
        errors.length > 0 || warnings.length > 0
          ? `Console (${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
          : 'Console (Clean)';
    }

    this.diagnosticsList.replaceChildren();
    const errorsForQuickFix = state.diagnostics.filter(
      (d) => d.severity === 'error',
    );
    if (this.quickFixBtn) {
      this.quickFixBtn.style.display =
        errorsForQuickFix.length > 0 ? '' : 'none';
    }
    this.mostRecentDiagnostic = errorsForQuickFix[0] ?? null;
    const derivedNotices = [
      primaryReason
        ? {
            severity: primaryReason.blocking
              ? ('warning' as const)
              : ('info' as const),
            message: `${compatibilityCategoryLabel(primaryReason.category)}: ${primaryReason.message}`,
          }
        : null,
    ].filter(Boolean) as Array<{
      severity: 'warning' | 'info';
      message: string;
    }>;
    const consoleMessages = [
      ...state.diagnostics.slice(0, 12),
      ...derivedNotices,
    ];

    if (consoleMessages.length === 0) {
      const item = document.createElement('div');
      item.className =
        'milkdrop-overlay__diagnostic milkdrop-overlay__diagnostic--info';
      item.textContent =
        'Console is clear. Try bass_att, beat_pulse, or time to push the scene around.';
      this.diagnosticsList.appendChild(item);
    } else {
      consoleMessages.slice(0, 15).forEach((diagnostic) => {
        const item = document.createElement('div');
        item.className = `milkdrop-overlay__diagnostic milkdrop-overlay__diagnostic--${diagnostic.severity}`;

        const severityTag = document.createElement('span');
        severityTag.className = `milkdrop-overlay__diagnostic-tag milkdrop-overlay__diagnostic-tag--${diagnostic.severity}`;
        severityTag.textContent = diagnostic.severity.toUpperCase();
        severityTag.style.marginRight = '6px';
        severityTag.style.fontWeight = 'bold';
        severityTag.style.fontSize = '0.7rem';
        severityTag.style.padding = '1px 5px';
        severityTag.style.borderRadius = '4px';
        if (diagnostic.severity === 'error') {
          severityTag.style.background = 'rgba(239, 68, 68, 0.3)';
          severityTag.style.color = '#fca5a5';
        } else if (diagnostic.severity === 'warning') {
          severityTag.style.background = 'rgba(245, 158, 11, 0.3)';
          severityTag.style.color = '#fde68a';
        } else {
          severityTag.style.background = 'rgba(59, 130, 246, 0.3)';
          severityTag.style.color = '#93c5fd';
        }

        const messageSpan = document.createElement('span');
        messageSpan.textContent =
          'line' in diagnostic && diagnostic.line
            ? `Line ${diagnostic.line}: ${diagnostic.message}`
            : diagnostic.message;

        item.append(severityTag, messageSpan);

        if ('line' in diagnostic && diagnostic.line) {
          const lineNum = diagnostic.line;
          item.style.cursor = 'pointer';
          item.title = 'Click to jump to line in editor';
          item.addEventListener('click', () => {
            if (lineNum >= 1 && lineNum <= this.editor.state.doc.lines) {
              const line = this.editor.state.doc.line(lineNum);
              this.editor.dispatch({
                selection: { anchor: line.from },
                scrollIntoView: true,
              });
              this.editor.focus();
            }
          });
        }
        this.diagnosticsList.appendChild(item);
      });
    }

    this.updateSlidersFromDoc();
    this.refreshMidiGutter();
  }

  /** Called whenever the set of MIDI/MCP-bound targets changes (a knob is
   * learned or unbound, a device is enabled/disabled). The gutter itself
   * re-renders on the next renderSessionState pass, which already fires on
   * every doc change. */
  public setMidiTargets(targets: Iterable<string>): void {
    this.midiTargets = new Set(targets);
    this.refreshMidiGutter();
  }

  private refreshMidiGutter(): void {
    const entries =
      this.midiTargets.size === 0
        ? []
        : computeMidiGutterInfo(
            this.editor.state.doc.toString(),
            this.midiTargets,
          );
    this.editor.dispatch({ effects: setMidiGutterInfo.of(entries) });
  }

  dispose() {
    this.disposeDiagnosticsListener?.();
    this.disposeDiagnosticsListener = null;
    this.clearEditorDebounce();
    this.unsubscribeTheme();
    this.editor.destroy();
    this.element.remove();
  }

  private applyCurrentSource() {
    this.hasBufferedEdits = true;
    if (this.lastSessionState) {
      this.renderSessionState(this.lastSessionState);
    }
    this.flushEditorDocChange();
    this.editor.focus();
  }

  private insertSnippet(snippet: string) {
    const selection = this.editor.state.selection.main;
    const prefix =
      selection.from > 0 &&
      this.editor.state.doc.sliceString(selection.from - 1, selection.from) !==
        '\n'
        ? '\n'
        : '';
    const suffix =
      selection.to < this.editor.state.doc.length &&
      this.editor.state.doc.sliceString(selection.to, selection.to + 1) !== '\n'
        ? '\n'
        : '';
    const text = `${prefix}${snippet}${suffix}`;
    this.editor.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: text,
      },
      selection: {
        anchor: selection.from + text.length,
      },
      scrollIntoView: true,
    });
    this.editor.focus();
  }

  private renderSliders(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'editor-sliders';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Parameter sliders');

    const title = document.createElement('h4');
    title.textContent = 'Tune';
    title.className = 'editor-sliders__title';
    panel.appendChild(title);

    this.sliderInputs.clear();

    for (const s of DEFAULT_EDITOR_SLIDERS) {
      const row = document.createElement('div');
      row.className = 'editor-slider-row';

      const labelRow = document.createElement('div');
      labelRow.className = 'editor-slider-row__label-row';

      const label = document.createElement('label');
      label.className = 'editor-slider-row__label';
      label.textContent = s.label;
      label.title = `Double-click to reset ${s.label} to ${s.defaultValue}`;
      label.style.cursor = 'pointer';

      const resetToDefault = () => {
        this.writeVariableToEditor(s.key, s.defaultValue);
        const item = this.sliderInputs.get(s.key);
        if (item) {
          item.input.value = String(s.defaultValue);
          item.display.textContent = s.defaultValue.toFixed(2);
        }
      };

      label.addEventListener('dblclick', resetToDefault);

      // Double-click on the label was the only way to reset a slider — a
      // real button gives keyboard/click-only users the same path a mouse
      // user already had.
      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'editor-slider-row__reset';
      resetButton.textContent = '↺';
      resetButton.setAttribute('aria-label', `Reset ${s.label} to default`);
      resetButton.title = `Reset to ${s.defaultValue}`;
      resetButton.addEventListener('click', resetToDefault);

      labelRow.appendChild(label);
      labelRow.appendChild(resetButton);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.className = 'editor-slider-row__input';

      const val = this.readVariableFromEditor(s.key);
      const initialVal = val !== null ? val : s.defaultValue;
      input.value = String(initialVal);

      const valDisplay = document.createElement('span');
      valDisplay.className = 'editor-slider-row__value';
      valDisplay.textContent = initialVal.toFixed(2);

      input.addEventListener('input', () => {
        const numVal = Number.parseFloat(input.value);
        valDisplay.textContent = numVal.toFixed(2);
        this.writeVariableToEditor(s.key, numVal);
      });

      this.sliderInputs.set(s.key, {
        input,
        display: valDisplay,
        defaultValue: s.defaultValue,
      });

      row.appendChild(labelRow);
      row.appendChild(input);
      row.appendChild(valDisplay);
      panel.appendChild(row);
    }

    return panel;
  }

  private updateSlidersFromDoc() {
    this.sliderInputs.forEach((item, key) => {
      if (document.activeElement === item.input) {
        return;
      }
      const val = this.readVariableFromEditor(key);
      const displayVal = val !== null ? val : item.defaultValue;
      item.input.value = String(displayVal);
      item.display.textContent = displayVal.toFixed(2);
    });
  }

  public readVariableFromEditor(variableName: string): number | null {
    const doc = this.editor.state.doc.toString();
    const regex = new RegExp(
      `(?:^|\\n|;)\\s*${variableName}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`,
      'i',
    );
    const match = doc.match(regex);
    return match ? Number.parseFloat(match[1]) : null;
  }

  public writeVariableToEditor(variableName: string, value: number): void {
    const doc = this.editor.state.doc.toString();
    const formattedValue = value.toFixed(3);
    const regex = new RegExp(
      `((?:^|\\n|;)\\s*${variableName}\\s*=\\s*)-?\\d+(?:\\.\\d+)?`,
      'i',
    );
    let newDoc: string;

    if (regex.test(doc)) {
      newDoc = doc.replace(regex, `$1${formattedValue}`);
    } else {
      const prefix = doc.length === 0 || doc.endsWith('\n') ? '' : '\n';
      newDoc = `${doc}${prefix}${variableName}=${formattedValue}\n`;
    }

    if (newDoc !== doc) {
      this.editor.dispatch({
        changes: { from: 0, to: doc.length, insert: newDoc },
        scrollIntoView: false,
      });
      this.hasBufferedEdits = true;
      if (this.lastSessionState) {
        this.renderSessionState(this.lastSessionState);
      }
      this.flushEditorDocChange();
    }
  }

  // Every AI-assisted edit lands here instead of replacing the buffer:
  // the user reviews a line diff and explicitly applies or discards it
  // (the Remix-studio "inspectable as source diffs" roadmap bullet).
  private discardAssistedEdit() {
    this.assistedEditContainer?.remove();
    this.assistedEditContainer = null;
  }

  private proposeAssistedEdit(nextSource: string, label: string) {
    const currentSource = this.editor.state.doc.toString();
    if (nextSource === currentSource) {
      return;
    }
    // The diff below is only valid against this exact source; Apply
    // re-checks it so a stale proposal can never clobber newer edits or a
    // different preset.
    const baseSource = currentSource;
    this.discardAssistedEdit();

    const container = document.createElement('div');
    container.className = 'editor-assisted-diff';
    const heading = document.createElement('div');
    heading.className = 'editor-assisted-diff__head';
    heading.textContent = `${label}: review the proposed change`;
    const lines = document.createElement('pre');
    lines.className = 'editor-assisted-diff__lines';
    for (const line of computeSourceDiff(currentSource, nextSource)) {
      const row = document.createElement('span');
      row.className = `editor-assisted-diff__line editor-assisted-diff__line--${line.kind}`;
      const prefix =
        line.kind === 'add'
          ? '+ '
          : line.kind === 'del'
            ? '- '
            : line.kind === 'gap'
              ? '\u22EF '
              : '  ';
      row.textContent = `${prefix}${line.text}`;
      lines.append(row, document.createTextNode('\n'));
    }

    const actions = document.createElement('div');
    actions.className = 'editor-assisted-diff__actions';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'milkdrop-overlay__refine-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => {
      const sourceNow = this.editor.state.doc.toString();
      if (sourceNow !== baseSource) {
        lines.remove();
        actions.remove();
        heading.textContent = `${label}: the source changed while this diff was open, so the proposal was discarded. Re-run the action against the current source.`;
        window.setTimeout(() => {
          if (this.assistedEditContainer === container) {
            this.discardAssistedEdit();
          }
        }, 6000);
        return;
      }
      this.pushSnapshot(sourceNow, `Before ${label.toLowerCase()}`);
      this.editor.dispatch({
        changes: { from: 0, to: sourceNow.length, insert: nextSource },
      });
      this.callbacks.onEditorSourceChange(nextSource);
      container.remove();
      this.assistedEditContainer = null;
    });
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'milkdrop-overlay__refine-btn';
    discardBtn.textContent = 'Discard';
    discardBtn.addEventListener('click', () => {
      container.remove();
      this.assistedEditContainer = null;
    });
    actions.append(applyBtn, discardBtn);
    container.append(heading, lines, actions);
    this.editor.dom.insertAdjacentElement('beforebegin', container);
    this.assistedEditContainer = container;
  }

  private renderQuickFix(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'editor-quick-fix';
    btn.textContent = '\u26A1 Fix with AI';
    btn.title = 'Send this error to the AI for automatic correction';
    btn.style.display = 'none';
    btn.addEventListener('click', () => this.handleQuickFix());
    return btn;
  }

  private handleQuickFix() {
    if (!this.mostRecentDiagnostic) return;
    this.applyQuickFixForDiagnostic(this.mostRecentDiagnostic);
  }

  private applyQuickFixForDiagnostic(diag: MilkdropDiagnostic) {
    if (this.aiPending) return;
    const source = this.editor.state.doc.toString();
    const instruction = `Fix this compiler error: "${diag.message}" at line ${diag.line}. Keep the preset style but fix the syntax or math.`;

    this.setRefinePending(true);
    fetch('/api/refine-preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSource: source, instruction }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.milkSource) {
          this.proposeAssistedEdit(data.milkSource, 'AI fix');
        }
        this.setRefinePending(false);
      })
      .catch(() => this.setRefinePending(false));
  }

  private handleBatchGenerate() {
    if (this.aiPending) return;
    const source = this.editor.state.doc.toString();
    this.setRefinePending(true);
    fetch('/api/batch-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: source.slice(0, 500), count: 3 }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.presets && data.presets.length > 0) {
          this.proposeAssistedEdit(data.presets[0], 'Variation');
          document.dispatchEvent(
            new CustomEvent('stims:batch-results', {
              detail: { presets: data.presets.slice(1) },
            }),
          );
        }
        this.setRefinePending(false);
      })
      .catch(() => this.setRefinePending(false));
  }

  private handleBlend() {
    const container = this.element.querySelector(
      '.editor-blend-input',
    ) as HTMLElement | null;
    if (container) {
      container.style.display =
        container.style.display === 'none' ? '' : 'none';
    }
  }

  private doBlend(sourceB: string) {
    if (this.aiPending) return;
    const source = this.editor.state.doc.toString();
    this.setRefinePending(true);
    fetch('/api/blend-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceA: source, sourceB }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.milkSource) {
          this.proposeAssistedEdit(data.milkSource, 'Blend');
        }
        this.setRefinePending(false);
      })
      .catch(() => this.setRefinePending(false));
  }

  private renderBlendInput(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'editor-blend-input';
    container.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.className = 'editor-blend-textarea';
    textarea.placeholder = 'Paste second preset source or preset ID';
    textarea.rows = 4;

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';

    const submitBtn = document.createElement('button');
    submitBtn.className = 'editor-blend-submit';
    submitBtn.textContent = 'Blend';
    submitBtn.addEventListener('click', () => {
      const sourceB = textarea.value.trim();
      if (!sourceB || this.aiPending) return;
      this.doBlend(sourceB);
      container.style.display = 'none';
      textarea.value = '';
    });
    this.blendSubmitButton = submitBtn;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'editor-blend-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      container.style.display = 'none';
      textarea.value = '';
    });

    btnRow.appendChild(submitBtn);
    btnRow.appendChild(cancelBtn);
    container.appendChild(textarea);
    container.appendChild(btnRow);
    return container;
  }

  private setRefinePending(pending: boolean) {
    this.aiPending = pending;
    // Refine/Explain manage their own button text ("…", "Error") locally,
    // but every AI-backed action shares one proposed-diff slot, so a second
    // request finishing while the first is still pending would silently
    // clobber it. Disabling every AI trigger while one is in flight makes
    // that impossible instead of racy.
    [
      this.refineBtn,
      this.explainBtn,
      this.quickFixBtn,
      this.batchButton,
      this.blendSubmitButton,
    ].forEach((btn) => {
      if (btn) btn.disabled = pending;
    });
  }

  private pushSnapshot(source: string, label: string) {
    this.snapshots.push({ source, timestamp: Date.now(), label });
    // Cap history so a long editing session doesn't grow this unbounded;
    // only the most recent checkpoints are ever useful to restore.
    if (this.snapshots.length > 8) {
      this.snapshots.splice(0, this.snapshots.length - 8);
    }
    this.renderHistorySnapshots();
  }

  private renderHistorySnapshots() {
    if (!this.historyList) return;
    this.historyList.replaceChildren();
    if (this.snapshots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'milkdrop-overlay__editor-history-empty';
      empty.textContent =
        'Checkpoints appear here before each applied AI edit, so you can step back.';
      this.historyList.appendChild(empty);
      return;
    }
    [...this.snapshots].reverse().forEach((snapshot) => {
      const row = document.createElement('div');
      row.className = 'milkdrop-overlay__editor-history-row';

      const meta = document.createElement('span');
      meta.className = 'milkdrop-overlay__editor-history-meta';
      meta.textContent = `${snapshot.label} · ${formatRelativeTime(snapshot.timestamp)}`;

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'milkdrop-overlay__editor-history-restore';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => {
        const currentSource = this.editor.state.doc.toString();
        if (currentSource === snapshot.source) return;
        this.pushSnapshot(currentSource, 'Before restore');
        this.editor.dispatch({
          changes: {
            from: 0,
            to: this.editor.state.doc.length,
            insert: snapshot.source,
          },
        });
        this.callbacks.onEditorSourceChange(snapshot.source);
        this.editor.focus();
      });

      row.append(meta, restoreBtn);
      this.historyList?.appendChild(row);
    });
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
