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
import { webMidiService } from '../../core/services/webmidi-controller.ts';
import {
  getActiveThemePreference,
  subscribeToThemePreference,
} from '../../core/theme-preferences';
import { renderIconSvg } from '../../ui/icon-library.ts';
import {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_FUNCTION_SNIPPET_TEMPLATES,
} from '../builtin-docs';
import {
  computeMidiGutterInfo,
  findMilkdropEquationLine,
  getFieldOverwriteKind,
  isFieldShadowedByEquations,
  type MidiGutterEntry,
  readMilkdropField,
  upsertMilkdropFields,
} from '../formatter';
import {
  COLOR_GROUPS,
  CONTROL_SECTIONS,
  type ColorGroupConfig,
  channelsToHex,
  clamp01,
  ENUM_CONTROLS,
  type EnumControlConfig,
  formatControlValue,
  hexToChannels,
  positionToValue,
  RANGE_CONTROLS,
  type RangeControlConfig,
  SCALAR_CONTROLS,
  type ScalarControlConfig,
  TOGGLE_CONTROLS,
  type ToggleControlConfig,
  valueToPosition,
} from '../preset-controls.ts';
import {
  MODULATION_SOURCES,
  type Modulation,
  type ModulationMode,
  type ModulationSource,
  readModulation,
  writeModulation,
} from '../preset-modulation.ts';
import type { MilkdropDiagnostic, MilkdropEditorSessionState } from '../types';
import { createMilkdropLanguage } from './editor-language';
import { computeAstDiagnostics, mergeDiagnostics } from './editor-parser';

export { computeAstDiagnostics, mergeDiagnostics };

import {
  compatibilityCategoryLabel,
  getPrimaryDegradationReason,
} from './preset-row';
import { computeSourceDiff } from './source-diff.ts';

/**
 * Kept as the module's public names because tests, the MIDI layer and the MCP
 * tools address the Tune pane through them; the declarations themselves now
 * live in preset-controls.ts alongside the scale maths.
 */
export type SliderConfig = ScalarControlConfig;
export const DEFAULT_EDITOR_SLIDERS: ScalarControlConfig[] = SCALAR_CONTROLS;
export const DEFAULT_EDITOR_COLOR_GROUPS: ColorGroupConfig[] = COLOR_GROUPS;
export type { ColorGroupConfig };

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export type EditorPanelCallbacks = {
  onEditorSourceChange: (source: string) => void;
  /** Live feedback for a numeric field during a drag: applied to the running
   * VM without a recompile. The value is committed to the source separately
   * (on release), so the runtime staying absent only degrades to the old
   * compile-only behavior. */
  onLiveFieldChange?: (key: string, value: number) => void;
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

/**
 * Transient hint shown under a control while it is being dragged. It only
 * appears on fields a preset's equations rewrite every frame — the readout is
 * moving and the stage may not be, so the row says which. Relative equations
 * (`cx = cx + sin(time)`) reload the base first, so a drag does move the
 * stage; absolute equations discard it. Returns '' when nothing to warn about.
 */
function liveHintForFields(doc: string, keys: string[]): string {
  for (const key of keys) {
    const kind = getFieldOverwriteKind(doc, key);
    if (kind === 'none') continue;
    return kind === 'relative'
      ? 'Overwritten every frame — this drag moves its base'
      : "Overwritten every frame — this value won't stick";
  }
  return '';
}

export class EditorPanel {
  readonly element: HTMLElement;

  private readonly callbacks: EditorPanelCallbacks;
  private readonly note: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly stateLabel: HTMLElement;
  private readonly safetyFlag: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly problems: HTMLElement;
  private readonly problemsCount: HTMLElement;
  private readonly diagnosticsList: HTMLElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly editor: EditorView;
  private readonly clearEditorDebounce: () => void;
  private readonly unsubscribeTheme: () => void;
  private readonly flushEditorDocChange: () => boolean;
  private readonly setEditorDiagnostics: (
    diagnostics: MilkdropDiagnostic[],
  ) => void;
  private disposeMenuDismiss: (() => void) | null = null;
  private suppressEditorChange = false;
  private hasBufferedEdits = false;
  /** Identity of the preset the buffer currently belongs to, so a preset
   * switch can be told apart from the session echoing back the user's own
   * in-progress edits. */
  private lastPresetId: string | null = null;
  private lastSessionState: MilkdropEditorSessionState | null = null;
  private quickFixBtn: HTMLButtonElement | null = null;
  private mostRecentDiagnostic: MilkdropDiagnostic | null = null;
  private snapshots: Array<{
    source: string;
    timestamp: number;
    label: string;
  }> = [];
  private historyList: HTMLElement | null = null;
  private assistPane: HTMLElement | null = null;
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
  private disposeMidiListener: (() => void) | null = null;
  private sliderInputs: Map<
    string,
    {
      input: HTMLInputElement;
      display: HTMLSpanElement;
      defaultValue: number;
      learnButton: HTMLButtonElement;
      liveHint: HTMLDivElement;
      config: ScalarControlConfig;
    }
  > = new Map();
  private toggleInputs: Map<
    string,
    { button: HTMLButtonElement; config: ToggleControlConfig }
  > = new Map();
  private enumInputs: Map<
    string,
    { buttons: HTMLButtonElement[]; config: EnumControlConfig }
  > = new Map();
  private rangeInputs: Map<
    string,
    {
      minInput: HTMLInputElement;
      maxInput: HTMLInputElement;
      readout: HTMLSpanElement;
      liveHint: HTMLDivElement;
      config: RangeControlConfig;
    }
  > = new Map();
  private modulationRows: Map<
    string,
    {
      row: HTMLElement;
      sourceSelect: HTMLSelectElement;
      modeButton: HTMLButtonElement;
      depth: HTMLInputElement;
      readout: HTMLSpanElement;
      config: ScalarControlConfig;
    }
  > = new Map();
  private colorInputs: Map<
    string,
    {
      group: ColorGroupConfig;
      swatch: HTMLInputElement;
      hexLabel: HTMLSpanElement;
      alphaInput: HTMLInputElement | null;
      liveHint: HTMLDivElement;
    }
  > = new Map();
  /** One entry per Tune control: the fields it writes and the chip reporting
   * who currently owns them. */
  private fieldStateCells: Array<{
    chip: HTMLButtonElement;
    keys: string[];
    label: string;
  }> = [];
  private midiTargets: Set<string> = new Set();
  // The slider whose "learn" button is currently armed, waiting for the
  // next CC from any device — mirrors webMidiService.getLearnTarget() but
  // scoped to "was it *this* editor's UI that armed it", so a learn
  // started from the Performance hardware panel doesn't light up a slider.
  private learningSliderKey: string | null = null;

  constructor(callbacks: EditorPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('section');
    this.element.className = 'stims-editor';
    this.element.setAttribute('aria-label', 'Preset code editor');

    // ── Status line ───────────────────────────────────────────────
    // One row replaces the old marketing header plus four static badges.
    // The dot carries the buffer state; the flag only appears when the
    // stage is showing something other than what the draft says.
    const statusBar = document.createElement('div');
    statusBar.className = 'stims-editor__status';

    this.stateEl = document.createElement('span');
    this.stateEl.className = 'stims-editor__state';
    this.stateEl.dataset.state = 'synced';
    const stateDot = document.createElement('span');
    stateDot.className = 'stims-editor__dot';
    this.stateLabel = document.createElement('span');
    this.stateLabel.textContent = 'Synced';
    this.stateEl.append(stateDot, this.stateLabel);

    const flags = document.createElement('div');
    flags.className = 'stims-editor__flags';
    this.safetyFlag = document.createElement('span');
    this.safetyFlag.className = 'stims-editor__flag stims-editor__flag--safety';
    this.safetyFlag.hidden = true;
    const shortcutHint = document.createElement('span');
    shortcutHint.className = 'stims-editor__shortcut';
    shortcutHint.textContent = '⌘/Ctrl+⏎';
    shortcutHint.title = 'Apply the draft immediately';
    flags.append(this.safetyFlag, shortcutHint);
    statusBar.append(this.stateEl, flags);

    // ── Toolbar ───────────────────────────────────────────────────
    // One primary action, one destructive-free secondary, undo/redo as a
    // single segmented control, and everything preset-level behind an
    // overflow menu. The old row gave nine buttons identical weight.
    const toolbar = document.createElement('div');
    toolbar.className = 'stims-editor__toolbar';

    const applyButton = this.createButton('Update now', {
      variant: 'primary',
      title: 'Apply the draft now (Cmd/Ctrl+Enter)',
      onClick: () => this.applyCurrentSource(),
    });
    applyButton.dataset.action = 'apply';

    const revertButton = this.createButton('Reset', {
      title: 'Reset draft to the active preset source',
      ariaLabel: 'Reset draft to active preset source',
      onClick: () => this.callbacks.onRevertToActive(),
    });

    // CodeMirror's history() extension already answers to Cmd/Ctrl+Z, but
    // that was invisible outside the editor — no button, no way to tell
    // undo is even possible without trying it.
    const undoRedo = document.createElement('div');
    undoRedo.className = 'stims-editor__pair';
    undoRedo.append(
      this.createButton('↶', {
        variant: 'icon',
        title: 'Undo (Cmd/Ctrl+Z)',
        ariaLabel: 'Undo last edit',
        onClick: () => {
          undo(this.editor);
          this.editor.focus();
        },
      }),
      this.createButton('↷', {
        variant: 'icon',
        title: 'Redo (Cmd/Ctrl+Shift+Z)',
        ariaLabel: 'Redo last undone edit',
        onClick: () => {
          redo(this.editor);
          this.editor.focus();
        },
      }),
    );

    const spacer = document.createElement('div');
    spacer.className = 'stims-editor__spacer';

    const menuWrap = document.createElement('div');
    menuWrap.className = 'stims-editor__menu-wrap';
    const menu = document.createElement('div');
    menu.className = 'stims-editor__menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    const menuButton = this.createButton('⋯', {
      variant: 'icon',
      title: 'Preset actions',
      ariaLabel: 'Preset actions',
      onClick: () => {
        menu.hidden = !menu.hidden;
        menuButton.setAttribute('aria-expanded', String(!menu.hidden));
      },
    });
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'false');

    const closeMenu = () => {
      if (menu.hidden) return;
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
    };
    const menuItem = (
      label: string,
      onClick: () => void,
      tone?: 'danger',
    ): HTMLButtonElement => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'stims-editor__menu-item';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      if (tone) item.dataset.tone = tone;
      item.addEventListener('click', () => {
        closeMenu();
        onClick();
      });
      return item;
    };
    const menuSeparator = document.createElement('div');
    menuSeparator.className = 'stims-editor__menu-sep';
    this.deleteButton = menuItem(
      'Delete preset',
      () => this.callbacks.onDeletePreset(),
      'danger',
    );
    this.deleteButton.hidden = true;
    menu.append(
      menuItem('Remix', () => this.callbacks.onDuplicatePreset()),
      menuItem('Import…', () => this.callbacks.onRequestImport()),
      menuItem('Export', () => this.callbacks.onExport()),
      menuSeparator,
      this.deleteButton,
    );
    menuWrap.append(menuButton, menu);

    // A menu that only closes by re-clicking its own trigger reads as stuck.
    const dismissMenu = (event: MouseEvent) => {
      if (!menuWrap.contains(event.target as Node)) closeMenu();
    };
    const dismissMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', dismissMenu);
    document.addEventListener('keydown', dismissMenuOnEscape);
    this.disposeMenuDismiss = () => {
      document.removeEventListener('pointerdown', dismissMenu);
      document.removeEventListener('keydown', dismissMenuOnEscape);
    };

    toolbar.append(applyButton, revertButton, undoRedo, spacer, menuWrap);

    this.note = document.createElement('div');
    this.note.className = 'stims-editor__note';
    this.note.textContent = '';
    this.note.hidden = true;

    // ── Stage: the code, and anything layered over it ─────────────
    this.stage = document.createElement('div');
    this.stage.className = 'stims-editor__stage';
    const editorHost = document.createElement('div');
    editorHost.className = 'stims-editor__code';

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

    this.stage.append(this.note, editorHost);

    // ── Problems strip ────────────────────────────────────────────
    // An IDE problems panel: pinned directly under the code, collapsible,
    // and scrolling on its own so a noisy compile can't push the dock off
    // screen. The old "Console" section sat ~2000px below the editor.
    this.problems = document.createElement('section');
    this.problems.className = 'stims-editor__problems';
    this.problems.dataset.open = 'true';
    const problemsHead = document.createElement('div');
    problemsHead.className = 'stims-editor__problems-head';
    const problemsToggle = document.createElement('button');
    problemsToggle.type = 'button';
    problemsToggle.className = 'stims-editor__problems-toggle';
    problemsToggle.setAttribute('aria-expanded', 'true');
    const problemsCaret = document.createElement('span');
    problemsCaret.className = 'stims-editor__caret';
    problemsCaret.textContent = '▾';
    problemsCaret.setAttribute('aria-hidden', 'true');
    const problemsLabel = document.createElement('span');
    problemsLabel.className = 'stims-editor__legend';
    problemsLabel.textContent = 'Problems';
    this.problemsCount = document.createElement('span');
    this.problemsCount.className = 'stims-editor__count';
    this.problemsCount.textContent = 'clean';
    problemsToggle.append(problemsCaret, problemsLabel, this.problemsCount);
    problemsToggle.addEventListener('click', () => {
      const open = this.problems.dataset.open !== 'true';
      this.problems.dataset.open = String(open);
      problemsToggle.setAttribute('aria-expanded', String(open));
    });
    const quickFixBtn = this.renderQuickFix();
    this.quickFixBtn = quickFixBtn;
    problemsHead.append(problemsToggle, quickFixBtn);
    const problemsBody = document.createElement('div');
    problemsBody.className = 'stims-editor__problems-body';
    this.diagnosticsList = document.createElement('div');
    this.diagnosticsList.className = 'stims-editor__problems-list';
    problemsBody.appendChild(this.diagnosticsList);
    this.problems.append(problemsHead, problemsBody);

    // ── Dock ──────────────────────────────────────────────────────
    // Four tabs replace six stacked rail sections. At this panel width
    // stacking meant everything past the first section was unreachable;
    // tabs make each tool one click away and give it the full width.
    const dock = document.createElement('div');
    dock.className = 'stims-editor__dock';
    dock.dataset.open = 'true';
    const tabs = document.createElement('div');
    tabs.className = 'stims-editor__tabs';
    tabs.setAttribute('role', 'tablist');
    const dockBody = document.createElement('div');
    dockBody.className = 'stims-editor__dock-body';

    const panes: Array<{ id: string; label: string; content: HTMLElement }> = [
      { id: 'tune', label: 'Tune', content: this.renderSliders() },
      { id: 'insert', label: 'Insert', content: this.renderInsertPane() },
      { id: 'assist', label: 'Assist', content: this.renderAssistPane() },
      { id: 'history', label: 'History', content: this.renderHistoryPane() },
    ];
    const tabButtons: HTMLButtonElement[] = [];
    panes.forEach((pane, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'stims-editor__tab';
      tab.textContent = pane.label;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(index === 0));
      tab.dataset.pane = pane.id;
      pane.content.classList.add('stims-editor__pane');
      pane.content.setAttribute('role', 'tabpanel');
      pane.content.hidden = index !== 0;
      tab.addEventListener('click', () => {
        // Selecting a tab in a collapsed dock should show it, not silently
        // change a hidden selection.
        dock.dataset.open = 'true';
        dockToggle.textContent = '▾';
        tabButtons.forEach((other, otherIndex) => {
          other.setAttribute('aria-selected', String(other === tab));
          panes[otherIndex].content.hidden = other !== tab;
        });
      });
      tabButtons.push(tab);
      tabs.appendChild(tab);
      dockBody.appendChild(pane.content);
    });

    const dockToggle = document.createElement('button');
    dockToggle.type = 'button';
    dockToggle.className = 'stims-editor__dock-toggle';
    dockToggle.textContent = '▾';
    dockToggle.title = 'Collapse the dock to give the code more room';
    dockToggle.setAttribute('aria-label', 'Toggle editor dock');
    dockToggle.addEventListener('click', () => {
      const open = dock.dataset.open !== 'true';
      dock.dataset.open = String(open);
      dockToggle.textContent = open ? '▾' : '▴';
    });
    tabs.appendChild(dockToggle);
    dock.append(tabs, dockBody);

    this.element.append(statusBar, toolbar, this.stage, this.problems, dock);

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

    this.midiTargets = webMidiService.getEnabledTargets();
    this.disposeMidiListener = webMidiService.onDevicesChanged(() => {
      this.midiTargets = webMidiService.getEnabledTargets();
      if (this.learningSliderKey && webMidiService.getLearnTarget() === null) {
        this.learningSliderKey = null;
      }
      this.refreshMidiGutter();
      this.refreshSliderMidiState();
    });
    this.refreshSliderMidiState();
  }

  setVisible(visible: boolean) {
    this.element.hidden = !visible;
  }

  setDeleteEnabled(enabled: boolean) {
    this.deleteButton.hidden = !enabled;
  }

  private createButton(
    label: string,
    options: {
      variant?: 'primary' | 'icon' | 'danger';
      title?: string;
      ariaLabel?: string;
      onClick: () => void;
    },
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.variant
      ? `stims-editor__btn stims-editor__btn--${options.variant}`
      : 'stims-editor__btn';
    button.textContent = label;
    if (options.title) button.title = options.title;
    button.setAttribute('aria-label', options.ariaLabel ?? label);
    button.addEventListener('click', options.onClick);
    return button;
  }

  /** Insert pane: signal references and multi-line patterns. Both were
   * separate rail sections with identical affordances — one grid of
   * insertable code, grouped by whether it is a single reactive term or a
   * whole move. */
  private renderInsertPane(): HTMLElement {
    const pane = document.createElement('div');

    const build = (
      legend: string,
      hint: string,
      entries: ReadonlyArray<{
        label: string;
        description: string;
        snippet: string;
      }>,
    ) => {
      const heading = document.createElement('span');
      heading.className = 'stims-editor__legend';
      heading.textContent = legend;
      const copy = document.createElement('p');
      copy.className = 'stims-editor__hint';
      copy.textContent = hint;
      const grid = document.createElement('div');
      grid.className = 'stims-editor__inserts';
      entries.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stims-editor__insert';
        button.dataset.insert = entry.label;
        const label = document.createElement('strong');
        label.textContent = entry.label;
        const description = document.createElement('span');
        description.textContent = entry.description;
        button.append(label, description);
        button.addEventListener('click', () =>
          this.insertSnippet(entry.snippet),
        );
        grid.appendChild(button);
      });
      pane.append(heading, copy, grid);
    };

    build(
      'Signals',
      'Reactive terms, inserted at the cursor as a working line.',
      EDITOR_CUES,
    );
    const spacer = document.createElement('div');
    spacer.style.height = '12px';
    pane.appendChild(spacer);
    build(
      'Patterns',
      'Complete moves you can shape from there.',
      EDITOR_SNIPPETS,
    );

    return pane;
  }

  /** Assist pane: every AI-backed action in one place. They share a single
   * proposal slot and a single pending flag, so grouping them makes the
   * mutual exclusion visible instead of surprising. */
  private renderAssistPane(): HTMLElement {
    const pane = document.createElement('div');

    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'Every result arrives as a reviewable diff over the code — nothing is applied until you accept it.';

    const form = document.createElement('div');
    form.className = 'stims-editor__assist-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'stims-editor__assist-input';
    input.placeholder = 'make it more blue · add a slow rotation';
    input.setAttribute('aria-label', 'Describe the change you want');
    const refineBtn = this.createButton('Refine', {
      onClick: () => {
        void this.runAssist({
          button: refineBtn,
          label: 'Refine',
          instruction: input.value.trim(),
          proposalLabel: 'Refine',
          onApplied: () => {
            input.value = '';
          },
        });
      },
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') refineBtn.click();
    });
    form.append(input, refineBtn);

    const actions = document.createElement('div');
    actions.className = 'stims-editor__assist-actions';
    const explainBtn = this.createButton('Explain', {
      title: 'Explain what this preset does visually',
      onClick: () => {
        void this.runAssist({
          button: explainBtn,
          label: 'Explain',
          instruction: 'explain this preset',
        });
      },
    });
    const variationsBtn = this.createButton('Variations', {
      title: 'Generate preset variations',
      onClick: () => this.handleBatchGenerate(),
    });

    const blend = document.createElement('div');
    blend.className = 'stims-editor__blend';
    blend.hidden = true;
    const blendBtn = this.createButton('Blend…', {
      title: 'Blend with another preset',
      onClick: () => {
        blend.hidden = !blend.hidden;
        if (!blend.hidden) blendTextarea.focus();
      },
    });
    actions.append(explainBtn, variationsBtn, blendBtn);

    const blendTextarea = document.createElement('textarea');
    blendTextarea.className = 'stims-editor__assist-textarea';
    blendTextarea.placeholder = 'Paste a second preset source or preset ID';
    blendTextarea.rows = 4;
    blendTextarea.setAttribute('aria-label', 'Second preset to blend with');
    const blendActions = document.createElement('div');
    blendActions.className = 'stims-editor__assist-actions';
    const blendSubmit = this.createButton('Blend', {
      onClick: () => {
        const sourceB = blendTextarea.value.trim();
        if (!sourceB || this.aiPending) return;
        this.doBlend(sourceB);
        blend.hidden = true;
        blendTextarea.value = '';
      },
    });
    const blendCancel = this.createButton('Cancel', {
      onClick: () => {
        blend.hidden = true;
        blendTextarea.value = '';
      },
    });
    blendActions.append(blendSubmit, blendCancel);
    blend.append(blendTextarea, blendActions);

    this.refineBtn = refineBtn;
    this.explainBtn = explainBtn;
    this.batchButton = variationsBtn;
    this.blendSubmitButton = blendSubmit;
    this.assistPane = pane;

    pane.append(hint, form, actions, blend);
    return pane;
  }

  /** Shared plumbing for the two /api/refine-preset callers: pending state,
   * transient error label, explanation card, and the proposed diff. */
  private async runAssist(options: {
    button: HTMLButtonElement;
    label: string;
    instruction: string;
    proposalLabel?: string;
    onApplied?: () => void;
  }): Promise<void> {
    if (!options.instruction || this.aiPending) return;
    this.setRefinePending(true);
    options.button.textContent = '…';
    try {
      const currentSource = this.editor.state.doc.toString();
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: options.instruction,
        }),
      });
      if (!res.ok) throw new Error(`Refine API: ${res.status}`);
      const json = await res.json();

      if (json.explanation) {
        this.showExplanation(json.explanation);
      }
      if (options.proposalLabel && json.milkSource) {
        this.proposeAssistedEdit(json.milkSource, options.proposalLabel);
        options.onApplied?.();
      }
      options.button.textContent = options.label;
      this.setRefinePending(false);
    } catch (err) {
      console.error(`${options.label} failed:`, err);
      this.setRefinePending(false);
      options.button.textContent = 'Error';
      options.button.disabled = true;
      options.button.classList.add('stims-editor__btn--error');
      setTimeout(() => {
        options.button.classList.remove('stims-editor__btn--error');
        options.button.textContent = options.label;
        options.button.disabled = false;
      }, 2000);
    }
  }

  private showExplanation(text: string) {
    if (!this.assistPane) return;
    this.assistPane.querySelector('.stims-editor__explanation')?.remove();
    const card = document.createElement('div');
    card.className = 'stims-editor__explanation';
    card.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'stims-editor__explanation-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Dismiss explanation');
    close.addEventListener('click', () => card.remove());
    card.appendChild(close);
    this.assistPane.appendChild(card);
  }

  private renderHistoryPane(): HTMLElement {
    const pane = document.createElement('div');
    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'A checkpoint is taken before each applied AI edit and before each restore.';
    this.historyList = document.createElement('div');
    this.historyList.className = 'stims-editor__history';
    pane.append(hint, this.historyList);
    this.renderHistorySnapshots();
    return pane;
  }

  setSessionState(state: MilkdropEditorSessionState) {
    const nextSource = state.source;
    const currentDoc = this.editor.state.doc.toString();

    // A buffered draft belongs to the preset it was typed against. Holding on
    // to it across a preset switch would leave the editor showing one preset
    // while another renders, and the pending debounce would then commit the
    // old preset's text as the new one's source.
    const nextPresetId =
      state.latestCompiled?.source.id ??
      state.activeCompiled?.source.id ??
      null;
    const presetChanged =
      nextPresetId !== null &&
      this.lastPresetId !== null &&
      nextPresetId !== this.lastPresetId;
    if (presetChanged) {
      this.hasBufferedEdits = false;
      this.clearEditorDebounce();
    }
    if (nextPresetId !== null) {
      this.lastPresetId = nextPresetId;
    }

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
    // The status label already names the state and the problems strip
    // already counts it, so the note only carries what neither says: what
    // to do next.
    const baseStatus = hasErrors
      ? 'Fix the errors below, or Reset to return to the active source.'
      : this.hasBufferedEdits
        ? 'Queued — Cmd/Ctrl+Enter punches it in now.'
        : state.dirty
          ? 'Draft is live on stage. Reset returns to the saved source.'
          : '';

    if (hasErrors) {
      this.note.innerHTML = `${renderIconSvg('warning', {
        className: 'stims-editor__note-icon',
      })}<span>${escapeHtml(baseStatus)}</span>`;
    } else {
      this.note.textContent = baseStatus;
    }
    this.note.hidden = !shouldShowStatus;
    this.note.classList.toggle('stims-editor__note--error', hasErrors);

    // The dot answers "is what I see on stage what I typed?" — the only
    // question the old four badges were collectively trying to answer.
    const state_ = hasErrors
      ? 'error'
      : this.hasBufferedEdits
        ? 'queued'
        : state.dirty
          ? 'dirty'
          : 'synced';
    this.stateEl.dataset.state = state_;
    this.stateLabel.textContent = hasErrors
      ? 'Holding last good frame'
      : this.hasBufferedEdits
        ? 'Queued'
        : state.dirty
          ? 'Draft live'
          : 'Synced';

    // Fidelity degradation only. Error counts are the status label's and the
    // problems strip's job — this flag reports the one thing neither can:
    // the stage is rendering a simplified version of what compiled.
    this.safetyFlag.hidden = !isDegraded;
    this.safetyFlag.textContent = 'Simplified';
    this.safetyFlag.dataset.tone = 'warning';
    this.safetyFlag.title =
      'This preset uses features the active backend cannot render at full fidelity.';

    const problemTotal = errors.length + warnings.length;
    this.problemsCount.textContent =
      problemTotal === 0
        ? 'clean'
        : `${errors.length} err · ${warnings.length} warn`;
    this.problemsCount.dataset.tone =
      errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'muted';

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
      item.className = 'stims-editor__problems-empty';
      item.textContent =
        'No problems. Try bass_att, beat_pulse, or time to push the scene around.';
      this.diagnosticsList.appendChild(item);
    } else {
      consoleMessages.slice(0, 15).forEach((diagnostic) => {
        const item = document.createElement('div');
        item.className = `stims-editor__problem stims-editor__problem--${diagnostic.severity}`;

        // Severity as a fixed-width mono tag rather than a filled pill: the
        // column reads as a log, and the tags stop competing with the code
        // for attention. (These were inline styles before.)
        const severityTag = document.createElement('span');
        severityTag.className = 'stims-editor__problem-tag';
        severityTag.textContent = diagnostic.severity;

        const hasLine = 'line' in diagnostic && Boolean(diagnostic.line);
        if (hasLine) {
          const lineTag = document.createElement('span');
          lineTag.className = 'stims-editor__problem-line';
          lineTag.textContent = `Line ${diagnostic.line}`;
          item.append(severityTag, lineTag);
        } else {
          item.append(severityTag);
        }

        const messageSpan = document.createElement('span');
        messageSpan.textContent = diagnostic.message;
        item.appendChild(messageSpan);

        if (hasLine && diagnostic.line) {
          const lineNum = diagnostic.line;
          item.classList.add('stims-editor__problem--jump');
          item.title = 'Jump to this line';
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
    this.updateColorsFromDoc();
    this.updateTogglesFromDoc();
    this.updateEnumsFromDoc();
    this.updateRangesFromDoc();
    this.updateModulationsFromDoc();
    this.refreshMidiGutter();
    this.refreshSliderMidiState();
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

  /** Keeps every Tune control's state chip and the sliders' "listening"
   * learn-button state in sync with the buffer and webMidiService. Cheap
   * enough to call on every doc change — there are under 20 controls. */
  private refreshSliderMidiState(): void {
    const doc = this.editor.state.doc.toString();

    for (const cell of this.fieldStateCells) {
      const driven = cell.keys.filter((key) =>
        isFieldShadowedByEquations(doc, key),
      );
      const bound = cell.keys.filter((key) => this.midiTargets.has(key));
      const state =
        driven.length > 0 && bound.length > 0
          ? 'shadowed'
          : driven.length > 0
            ? 'driven'
            : bound.length > 0
              ? 'bound'
              : 'static';

      cell.chip.dataset.state = state;
      cell.chip.textContent =
        state === 'static'
          ? 'set'
          : state === 'bound'
            ? 'midi'
            : state === 'driven'
              ? 'eq'
              : 'eq ⚠';
      // Only the equation states have somewhere to jump to.
      cell.chip.disabled = driven.length === 0;
      cell.chip.title =
        state === 'static'
          ? `${cell.label} is a literal value in this preset — the control owns it.`
          : state === 'bound'
            ? `MIDI/MCP is driving ${bound.join(', ')}.`
            : state === 'driven'
              ? `This preset recomputes ${driven.join(', ')} every frame, so the control's value is overwritten. Click to jump to the equation.`
              : `MIDI/MCP is bound to ${bound.join(', ')}, but this preset's own equations reassign ${driven.join(', ')} every frame — no visible effect. Click to jump to the equation.`;
      cell.chip.setAttribute(
        'aria-label',
        `${cell.label} value source: ${state}`,
      );
    }

    this.sliderInputs.forEach((item, key) => {
      const armed = this.learningSliderKey === key;
      item.learnButton.dataset.armed = armed ? 'true' : 'false';
      item.learnButton.title = armed
        ? `Listening… move a knob or fader to map it to ${key}.`
        : `MIDI-learn ${key}: click, then move a knob or fader.`;
    });
    this.refreshLiveHintsFromDoc();
  }

  /**
   * The transient overwrite hint, recomputed cheaply on every doc change and
   * on focus. It only shows while a control is actually being edited: the
   * readout is moving and the stage may not be, so the row says which. Blur
   * listeners hide it; focus and doc changes (re)populate it.
   */
  private refreshLiveHintsFromDoc(): void {
    const doc = this.editor.state.doc.toString();
    const update = (
      input: Element | null,
      hint: HTMLDivElement,
      keys: string[],
    ) => {
      const active = document.activeElement === input;
      hint.textContent = active ? liveHintForFields(doc, keys) : '';
      hint.hidden = !active || hint.textContent === '';
    };
    this.sliderInputs.forEach((item) => {
      update(item.input, item.liveHint, [item.config.key]);
    });
    this.rangeInputs.forEach((item) => {
      const active =
        document.activeElement === item.minInput ||
        document.activeElement === item.maxInput;
      if (!active) {
        item.liveHint.hidden = true;
        item.liveHint.textContent = '';
        return;
      }
      item.liveHint.textContent = liveHintForFields(doc, [
        item.config.minKey,
        item.config.maxKey,
      ]);
      item.liveHint.hidden = item.liveHint.textContent === '';
    });
    this.colorInputs.forEach((item) => {
      const keys = [...item.group.rgb];
      if (item.group.alpha) keys.push(item.group.alpha.key);
      const active =
        document.activeElement === item.swatch ||
        document.activeElement === item.alphaInput;
      if (!active) {
        item.liveHint.hidden = true;
        item.liveHint.textContent = '';
        return;
      }
      item.liveHint.textContent = liveHintForFields(doc, keys);
      item.liveHint.hidden = item.liveHint.textContent === '';
    });
  }

  private toggleSliderLearn(key: string): void {
    if (this.learningSliderKey === key) {
      webMidiService.cancelLearn();
      this.learningSliderKey = null;
    } else {
      webMidiService.beginLearn(key);
      this.learningSliderKey = key;
    }
    this.refreshSliderMidiState();
  }

  dispose() {
    this.disposeDiagnosticsListener?.();
    this.disposeDiagnosticsListener = null;
    this.disposeMidiListener?.();
    this.disposeMidiListener = null;
    this.disposeMenuDismiss?.();
    this.disposeMenuDismiss = null;
    this.clearEditorDebounce();
    this.unsubscribeTheme();
    this.discardAssistedEdit();
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

  /**
   * A control's state cell. Any MilkDrop field is either a literal the buffer
   * owns or a value the preset's own equations rewrite every frame, and a
   * control that cannot tell you which is lying about roughly half the
   * catalog: the fader moves, the line changes, and the next frame overwrites
   * it. The chip names the owner, and on a driven field it jumps to the
   * equation doing the overwriting.
   */
  private createFieldStateChip(
    keys: string[],
    label: string,
  ): HTMLButtonElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'stims-editor__state-chip';
    chip.dataset.state = 'static';
    chip.addEventListener('click', () => {
      const doc = this.editor.state.doc.toString();
      const driven = keys.find((key) => isFieldShadowedByEquations(doc, key));
      const line = driven ? findMilkdropEquationLine(doc, driven) : null;
      if (line === null) return;
      const target = this.editor.state.doc.line(line);
      this.editor.dispatch({
        selection: { anchor: target.from },
        scrollIntoView: true,
      });
      this.editor.focus();
    });
    this.fieldStateCells.push({ chip, keys, label });
    return chip;
  }

  /** Tune pane. Each row is label + live value on one line, fader and its
   * two controls on the next. In the old 140px column beside the code the
   * label, value, MIDI dot, learn and reset controls all fought for the
   * same line; at full panel width they no longer have to. */
  private renderSliders(): HTMLElement {
    const panel = document.createElement('div');
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Parameter sliders');

    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'Controls rewrite the matching line in the draft, so every move stays inspectable as code. The chip beside each one says whether the draft owns that value or the preset recomputes it per frame.';
    panel.appendChild(hint);

    this.sliderInputs.clear();
    this.colorInputs.clear();
    this.toggleInputs.clear();
    this.enumInputs.clear();
    this.rangeInputs.clear();
    this.modulationRows.clear();
    this.fieldStateCells = [];

    for (const section of CONTROL_SECTIONS) {
      panel.appendChild(this.renderSection(section));
    }

    return panel;
  }

  /**
   * One subject's controls, in whatever forms that subject needs.
   *
   * The pane used to be ordered by widget type — every fader, then every
   * switch, then every mode, then every range, then every colour. That is a
   * taxonomy of controls rather than of the thing being edited, and it split
   * the main wave across four separate places: its mode under Modes, its
   * colour under Colour, its four flags under Switches, and its volume
   * fade-in under Ranges. Ordering by subject puts them back together, and
   * widget type becomes just how each field happens to render.
   */
  private renderSection(
    section: (typeof CONTROL_SECTIONS)[number],
  ): HTMLElement {
    const wrap = document.createElement('section');
    wrap.className = 'stims-editor__section';
    wrap.dataset.section = section.id;
    wrap.setAttribute('aria-label', section.label);

    const heading = this.createSubhead(section.label);
    heading.title = section.hint;
    wrap.appendChild(heading);

    const enums = ENUM_CONTROLS.filter((c) => c.section === section.id);
    const scalars = SCALAR_CONTROLS.filter((c) => c.section === section.id);
    const colors = COLOR_GROUPS.filter((c) => c.section === section.id);
    const toggles = TOGGLE_CONTROLS.filter((c) => c.section === section.id);
    const ranges = RANGE_CONTROLS.filter((c) => c.section === section.id);

    // Mode first: for the wave it decides what the rest of the section even
    // means, and it is the one control here that is not a quantity.
    for (const config of enums) {
      wrap.appendChild(this.renderEnumControl(config));
    }

    if (colors.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'stims-editor__colors';
      for (const group of colors) {
        grid.appendChild(this.renderColorGroup(group));
      }
      wrap.appendChild(grid);
    }

    if (scalars.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'stims-editor__sliders';
      for (const config of scalars) {
        grid.appendChild(this.renderScalarControl(config));
      }
      wrap.appendChild(grid);
    }

    for (const config of ranges) {
      wrap.appendChild(this.renderRangeControl(config));
    }

    // Switches last: they are the cheapest to scan and the least likely to
    // be what someone opened the section for.
    if (toggles.length > 0) {
      const bank = document.createElement('div');
      bank.className = 'stims-editor__toggle-bank';
      for (const config of toggles) {
        bank.appendChild(this.renderToggleControl(config));
      }
      wrap.appendChild(bank);
    }

    return wrap;
  }

  /**
   * One scalar row: fader on its declared scale, live value in that scale's
   * own units, MIDI-learn, reset, and a modulation control that writes the
   * per_frame equation when a fader alone cannot reach the field.
   */
  private renderScalarControl(s: ScalarControlConfig): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__slider';

    const label = document.createElement('label');
    label.className = 'stims-editor__slider-label';
    label.textContent = s.label;
    label.title = s.hint ?? `Double-click to reset ${s.label}`;

    const valDisplay = document.createElement('span');
    valDisplay.className = 'stims-editor__slider-value';

    const controls = document.createElement('div');
    controls.className = 'stims-editor__slider-row';

    // The input always spans 0..1; the scale maps that onto the field. Giving
    // the input the field's own min/max would put the value back on a linear
    // track and undo the whole point.
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.001';
    input.className = 'stims-editor__slider-input';
    input.dataset.scale = s.scale;
    input.setAttribute('aria-label', s.label);

    const applyValue = (value: number) => {
      input.value = String(valueToPosition(value, s));
      valDisplay.textContent = formatControlValue(value, s);
      input.setAttribute('aria-valuetext', formatControlValue(value, s));
    };

    const resetToDefault = () => {
      this.writeVariableToEditor(s.key, s.defaultValue);
      applyValue(s.defaultValue);
    };
    label.addEventListener('dblclick', resetToDefault);

    applyValue(this.readVariableFromEditor(s.key) ?? s.defaultValue);

    input.addEventListener('input', () => {
      let value = positionToValue(Number.parseFloat(input.value), s);
      // Snap to the neutral value near the detent. Without it a ratio control
      // can only reach exactly 1.0 by luck, and "no change" is the single
      // most useful position on the track.
      if (s.neutral !== undefined) {
        const neutralPos = valueToPosition(s.neutral, s);
        if (Math.abs(Number.parseFloat(input.value) - neutralPos) < 0.012) {
          value = s.neutral;
        }
      }
      const quantised = Number(
        (Math.round(value / s.step) * s.step).toFixed(6),
      );
      valDisplay.textContent = formatControlValue(quantised, s);
      // Live first: the running VM reflects the drag immediately. The doc
      // write below still recompiles so the value persists into the source.
      this.callbacks.onLiveFieldChange?.(s.key, quantised);
      this.writeVariableToEditor(s.key, quantised);
    });

    const learnButton = document.createElement('button');
    learnButton.type = 'button';
    learnButton.className = 'stims-editor__slider-btn';
    learnButton.textContent = '⏺';
    learnButton.setAttribute('aria-label', `MIDI-learn ${s.label}`);
    learnButton.addEventListener('click', () => this.toggleSliderLearn(s.key));

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'stims-editor__slider-btn';
    resetButton.textContent = '↺';
    resetButton.setAttribute('aria-label', `Reset ${s.label} to default`);
    resetButton.title = `Reset to ${s.defaultValue}`;
    resetButton.addEventListener('click', resetToDefault);

    controls.append(input, learnButton, resetButton);

    const liveHint = document.createElement('div');
    liveHint.className = 'stims-editor__live-hint';
    liveHint.hidden = true;
    liveHint.setAttribute('aria-hidden', 'true');

    this.sliderInputs.set(s.key, {
      input,
      display: valDisplay,
      defaultValue: s.defaultValue,
      learnButton,
      liveHint,
      config: s,
    });

    // Shown only while the handle is held: the readout is moving and the
    // stage may not be, and the permanent chip is too easy to miss mid-drag.
    input.addEventListener('focus', () => this.refreshLiveHintsFromDoc());
    input.addEventListener('blur', () => {
      liveHint.hidden = true;
      liveHint.textContent = '';
    });

    const head = document.createElement('div');
    head.className = 'stims-editor__control-head';
    head.append(label, this.createFieldStateChip([s.key], s.label), valDisplay);

    row.append(head, controls, liveHint, this.renderModulationRow(s));
    return row;
  }

  /**
   * The modulation control, folded under each scalar row.
   *
   * On a per-frame-heavy preset most of these fields are not literals — the
   * fader above writes a value the next frame discards, which is what the
   * `eq` chip reports. This is the control that actually reaches them: pick a
   * signal and a depth and it writes the `per_frame_` equation, leaving the
   * fader's value as the base the modulation swings around.
   */
  private renderModulationRow(s: ScalarControlConfig): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__mod';

    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'stims-editor__mod-select';
    sourceSelect.setAttribute('aria-label', `${s.label} modulation source`);
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No modulation';
    sourceSelect.appendChild(none);
    for (const source of MODULATION_SOURCES) {
      const option = document.createElement('option');
      option.value = source.key;
      option.textContent = source.label;
      option.title = source.hint;
      sourceSelect.appendChild(option);
    }

    const modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.className = 'stims-editor__mod-mode';

    const depth = document.createElement('input');
    depth.type = 'range';
    depth.className = 'stims-editor__slider-input';
    depth.min = '-1';
    depth.max = '1';
    depth.step = '0.01';
    depth.setAttribute('aria-label', `${s.label} modulation depth`);

    const readout = document.createElement('span');
    readout.className = 'stims-editor__mod-readout';

    const state = () => readModulation(this.editor.state.doc.toString(), s.key);

    const commit = (next: Modulation | null) => {
      const doc = this.editor.state.doc.toString();
      const updated = writeModulation(doc, s.key, next);
      if (updated === doc) return;
      this.replaceDoc(updated);
    };

    const currentModulation = (): Modulation => {
      const now = state();
      if (now.kind === 'modulated') return now.modulation;
      return {
        // A new modulation swings around whatever the fader currently says,
        // so switching one on does not jump the value.
        base: this.readVariableFromEditor(s.key) ?? s.defaultValue,
        depth: s.scale === 'ratio' ? 0.2 : 0.1,
        mode: s.scale === 'ratio' ? 'multiply' : 'add',
        source: 'bass_att',
      };
    };

    sourceSelect.addEventListener('change', () => {
      const value = sourceSelect.value;
      if (!value) {
        commit(null);
      } else {
        commit({
          ...currentModulation(),
          source: value as ModulationSource,
        });
      }
      this.updateModulationsFromDoc();
    });

    modeButton.addEventListener('click', () => {
      const now = state();
      if (now.kind !== 'modulated') return;
      const mode: ModulationMode =
        now.modulation.mode === 'add' ? 'multiply' : 'add';
      commit({ ...now.modulation, mode });
      this.updateModulationsFromDoc();
    });

    depth.addEventListener('input', () => {
      const now = state();
      if (now.kind !== 'modulated') return;
      commit({
        ...now.modulation,
        depth: Number.parseFloat(depth.value),
      });
    });

    row.append(sourceSelect, modeButton, depth, readout);
    this.modulationRows.set(s.key, {
      row,
      sourceSelect,
      modeButton,
      depth,
      readout,
      config: s,
    });
    return row;
  }

  private updateModulationsFromDoc(): void {
    const doc = this.editor.state.doc.toString();
    this.modulationRows.forEach((item, key) => {
      const state = readModulation(doc, key);

      if (state.kind === 'custom') {
        // The preset wrote something richer than this control can express.
        // Offering to "edit" it would mean silently replacing their code, so
        // the row steps aside and points at the line instead.
        item.row.dataset.state = 'custom';
        item.sourceSelect.disabled = true;
        item.modeButton.disabled = true;
        item.depth.disabled = true;
        item.sourceSelect.value = '';
        item.readout.textContent = 'hand-written equation';
        item.readout.title = `Line ${state.line}: ${state.text}`;
        return;
      }

      item.sourceSelect.disabled = false;
      if (state.kind === 'none') {
        item.row.dataset.state = 'none';
        item.sourceSelect.value = '';
        item.modeButton.disabled = true;
        item.depth.disabled = true;
        item.modeButton.textContent = '+';
        item.readout.textContent = '';
        item.readout.title = '';
        return;
      }

      const { modulation } = state;
      item.row.dataset.state = 'on';
      item.sourceSelect.value = modulation.source;
      item.modeButton.disabled = false;
      item.depth.disabled = false;
      if (document.activeElement !== item.depth) {
        item.depth.value = String(modulation.depth);
      }
      item.modeButton.textContent = modulation.mode === 'add' ? '+' : '×';
      item.modeButton.title =
        modulation.mode === 'add'
          ? 'Added to the base value. Click for multiply.'
          : 'Scales the base value. Click for add.';
      item.readout.textContent = `${modulation.depth >= 0 ? '+' : ''}${modulation.depth.toFixed(2)}`;
      item.readout.title = `${item.config.label} = ${modulation.base} ${
        modulation.mode === 'add' ? '+' : '×'
      } ${modulation.depth} × ${modulation.source}`;
    });
  }

  /** Single place that swaps the whole buffer and pushes it downstream, so
   * equation edits and field edits commit through identical plumbing. */
  private replaceDoc(next: string): void {
    const doc = this.editor.state.doc.toString();
    if (next === doc) return;
    this.editor.dispatch({
      changes: { from: 0, to: doc.length, insert: next },
      scrollIntoView: false,
    });
    this.hasBufferedEdits = true;
    if (this.lastSessionState) {
      this.renderSessionState(this.lastSessionState);
    }
    this.flushEditorDocChange();
  }

  private createSubhead(text: string): HTMLElement {
    const heading = document.createElement('h3');
    heading.className = 'stims-editor__subhead';
    heading.textContent = text;
    return heading;
  }

  /**
   * One boolean field. The format stores these as floats, so they arrived
   * here as faders you had to drag to 1.000 to switch on.
   */
  private renderToggleControl(toggle: ToggleControlConfig): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stims-editor__toggle';
    button.textContent = toggle.label;
    button.title = toggle.hint;
    button.setAttribute('role', 'switch');

    button.addEventListener('click', () => {
      const current = this.readVariableFromEditor(toggle.key);
      const on = (current ?? toggle.defaultValue) >= 0.5;
      this.writeVariableToEditor(toggle.key, on ? 0 : 1);
      this.updateTogglesFromDoc();
    });

    this.toggleInputs.set(toggle.key, { button, config: toggle });

    // The chip belongs on the switch itself: one the preset overwrites every
    // frame looks identical to one that works.
    const wrap = document.createElement('div');
    wrap.className = 'stims-editor__toggle-wrap';
    wrap.append(button, this.createFieldStateChip([toggle.key], toggle.label));
    return wrap;
  }

  private updateTogglesFromDoc(): void {
    this.toggleInputs.forEach((item, key) => {
      const value =
        this.readVariableFromEditor(key) ?? item.config.defaultValue;
      const on = value >= 0.5;
      item.button.dataset.on = on ? 'true' : 'false';
      item.button.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /**
   * A small-integer field that picks one of a fixed set. "Wave mode: 5" is
   * not a number you can reason about, and as a fader it was a value you
   * scrubbed past looking for the shape you wanted.
   */
  private renderEnumControl(config: EnumControlConfig): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__enum';

    const label = document.createElement('span');
    label.className = 'stims-editor__slider-label';
    label.textContent = config.label;
    label.title = config.hint;

    const head = document.createElement('div');
    head.className = 'stims-editor__control-head';
    head.append(label, this.createFieldStateChip([config.key], config.label));

    const bank = document.createElement('div');
    bank.className = 'stims-editor__segmented';
    bank.setAttribute('role', 'radiogroup');
    bank.setAttribute('aria-label', config.label);

    const buttons: HTMLButtonElement[] = [];
    for (const option of config.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stims-editor__segment';
      button.textContent = option.label;
      button.title = option.hint ?? `${config.label}: ${option.label}`;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => {
        this.writeVariableToEditor(config.key, option.value);
        this.updateEnumsFromDoc();
      });
      buttons.push(button);
      bank.appendChild(button);
    }

    this.enumInputs.set(config.key, { buttons, config });
    row.append(head, bank);
    return row;
  }

  private updateEnumsFromDoc(): void {
    this.enumInputs.forEach((item, key) => {
      const value = Math.round(
        this.readVariableFromEditor(key) ?? item.config.defaultValue,
      );
      item.config.options.forEach((option, index) => {
        const selected = option.value === value;
        item.buttons[index].dataset.on = selected ? 'true' : 'false';
        item.buttons[index].setAttribute(
          'aria-checked',
          selected ? 'true' : 'false',
        );
      });
    });
  }

  /**
   * A field pair that is two ends of one thing — a blur pass's output range,
   * or the loudness window the wave fades in across. Two faders that only
   * make sense together become one control that shows the span directly.
   */
  private renderRangeControl(config: RangeControlConfig): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__range';

    const label = document.createElement('span');
    label.className = 'stims-editor__slider-label';
    label.textContent = config.label;
    label.title = config.hint;

    const readout = document.createElement('span');
    readout.className = 'stims-editor__slider-value';

    const head = document.createElement('div');
    head.className = 'stims-editor__control-head';
    head.append(
      label,
      this.createFieldStateChip([config.minKey, config.maxKey], config.label),
      readout,
    );

    // Two overlaid range inputs rather than a custom-drawn track: keyboard
    // support, focus handling and screen-reader semantics come for free, and
    // each handle stays an independently addressable control.
    const track = document.createElement('div');
    track.className = 'stims-editor__range-track';

    const makeHandle = (which: 'min' | 'max') => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(config.min);
      input.max = String(config.max);
      input.step = String(config.step);
      input.className = 'stims-editor__range-input';
      input.dataset.handle = which;
      input.setAttribute(
        'aria-label',
        `${config.label} ${which === 'min' ? 'lower' : 'upper'} bound`,
      );
      return input;
    };

    const minInput = makeHandle('min');
    const maxInput = makeHandle('max');

    const commit = () => {
      // The handles may cross while dragging and are sorted on commit, which
      // is far less frustrating than a hard stop that makes the handle you
      // are dragging stick to the other one.
      const low = Math.min(
        Number.parseFloat(minInput.value),
        Number.parseFloat(maxInput.value),
      );
      const high = Math.max(
        Number.parseFloat(minInput.value),
        Number.parseFloat(maxInput.value),
      );
      readout.textContent = `${low.toFixed(2)} – ${high.toFixed(2)}`;
      this.callbacks.onLiveFieldChange?.(config.minKey, low);
      this.callbacks.onLiveFieldChange?.(config.maxKey, high);
      this.writeVariablesToEditor({
        [config.minKey]: low,
        [config.maxKey]: high,
      });
    };

    minInput.addEventListener('input', commit);
    maxInput.addEventListener('input', commit);

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'stims-editor__slider-btn';
    resetButton.textContent = '↺';
    resetButton.setAttribute('aria-label', `Reset ${config.label}`);
    resetButton.title = `Reset to ${config.defaultMin} – ${config.defaultMax}`;
    resetButton.addEventListener('click', () => {
      this.writeVariablesToEditor({
        [config.minKey]: config.defaultMin,
        [config.maxKey]: config.defaultMax,
      });
      this.updateRangesFromDoc();
    });

    track.append(minInput, maxInput);

    const controls = document.createElement('div');
    controls.className = 'stims-editor__slider-row';
    controls.append(track, resetButton);

    const liveHint = document.createElement('div');
    liveHint.className = 'stims-editor__live-hint';
    liveHint.hidden = true;
    liveHint.setAttribute('aria-hidden', 'true');

    this.rangeInputs.set(config.label, {
      minInput,
      maxInput,
      readout,
      liveHint,
      config,
    });
    minInput.addEventListener('focus', () => this.refreshLiveHintsFromDoc());
    maxInput.addEventListener('focus', () => this.refreshLiveHintsFromDoc());
    const clearRangeHint = () => {
      liveHint.hidden = true;
      liveHint.textContent = '';
    };
    minInput.addEventListener('blur', clearRangeHint);
    maxInput.addEventListener('blur', clearRangeHint);
    row.append(head, controls, liveHint);
    return row;
  }

  private updateRangesFromDoc(): void {
    this.rangeInputs.forEach((item) => {
      const active = document.activeElement;
      if (active === item.minInput || active === item.maxInput) return;
      const low =
        this.readVariableFromEditor(item.config.minKey) ??
        item.config.defaultMin;
      const high =
        this.readVariableFromEditor(item.config.maxKey) ??
        item.config.defaultMax;
      item.minInput.value = String(low);
      item.maxInput.value = String(high);
      item.readout.textContent = `${low.toFixed(2)} – ${high.toFixed(2)}`;
    });
  }

  /**
   * One colour group. MilkDrop stores every colour as separate 0..1 scalars,
   * so a preset's palette arrives as ~21 unrelated numbers; editing them as
   * faders means guessing what (0.65, 0.20, 0.90) looks like and moving three
   * controls to shift one hue.
   */
  private renderColorGroup(group: ColorGroupConfig): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__color';

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'stims-editor__color-swatch';
    swatch.setAttribute('aria-label', `${group.label} colour`);
    swatch.title = group.hint;

    const label = document.createElement('label');
    label.className = 'stims-editor__slider-label';
    label.textContent = group.label;

    const hexLabel = document.createElement('span');
    hexLabel.className = 'stims-editor__color-hex';

    // Alpha rides with the colour rather than sitting rows away as its own
    // fader: for four of these six groups alpha defaults to 0, so the swatch
    // alone would be a colour you cannot see and cannot explain.
    let alphaInput: HTMLInputElement | null = null;
    const controls = document.createElement('div');
    controls.className = 'stims-editor__color-controls';
    controls.appendChild(swatch);

    if (group.alpha) {
      const alpha = group.alpha;
      alphaInput = document.createElement('input');
      alphaInput.type = 'range';
      alphaInput.min = '0';
      alphaInput.max = '1';
      alphaInput.step = '0.01';
      alphaInput.className = 'stims-editor__slider-input';
      alphaInput.setAttribute('aria-label', `${group.label} alpha`);
      alphaInput.addEventListener('input', () => {
        const next = Number.parseFloat(alphaInput?.value ?? '0');
        this.callbacks.onLiveFieldChange?.(alpha.key, next);
        this.writeVariableToEditor(alpha.key, next);
        this.updateColorHexLabel(group);
      });
      controls.appendChild(alphaInput);
    }

    swatch.addEventListener('input', () => {
      const [r, g, b] = hexToChannels(swatch.value);
      this.callbacks.onLiveFieldChange?.(group.rgb[0], r);
      this.callbacks.onLiveFieldChange?.(group.rgb[1], g);
      this.callbacks.onLiveFieldChange?.(group.rgb[2], b);
      this.writeVariablesToEditor({
        [group.rgb[0]]: r,
        [group.rgb[1]]: g,
        [group.rgb[2]]: b,
      });
      this.updateColorHexLabel(group);
    });

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'stims-editor__slider-btn';
    resetButton.textContent = '↺';
    resetButton.setAttribute('aria-label', `Reset ${group.label} colour`);
    resetButton.title = 'Reset to the MilkDrop default';
    resetButton.addEventListener('click', () => {
      const updates: Record<string, number> = {
        [group.rgb[0]]: group.defaultRgb[0],
        [group.rgb[1]]: group.defaultRgb[1],
        [group.rgb[2]]: group.defaultRgb[2],
      };
      if (group.alpha) {
        updates[group.alpha.key] = group.alpha.defaultValue;
      }
      this.writeVariablesToEditor(updates);
      this.updateColorsFromDoc();
    });
    controls.appendChild(resetButton);

    const keys = [...group.rgb];
    if (group.alpha) keys.push(group.alpha.key);

    const head = document.createElement('div');
    head.className = 'stims-editor__control-head';
    head.append(label, this.createFieldStateChip(keys, group.label), hexLabel);

    row.append(head, controls);

    const liveHint = document.createElement('div');
    liveHint.className = 'stims-editor__live-hint';
    liveHint.hidden = true;
    liveHint.setAttribute('aria-hidden', 'true');

    this.colorInputs.set(group.label, {
      group,
      swatch,
      hexLabel,
      alphaInput,
      liveHint,
    });
    swatch.addEventListener('focus', () => this.refreshLiveHintsFromDoc());
    alphaInput?.addEventListener('focus', () => this.refreshLiveHintsFromDoc());
    const clearColorHint = () => {
      liveHint.hidden = true;
      liveHint.textContent = '';
    };
    swatch.addEventListener('blur', clearColorHint);
    alphaInput?.addEventListener('blur', clearColorHint);
    row.append(liveHint);
    return row;
  }

  private readColorChannels(group: ColorGroupConfig): {
    rgb: [number, number, number];
    alpha: number | null;
  } {
    const rgb = group.rgb.map((key, index) => {
      const value = this.readVariableFromEditor(key);
      return value === null ? group.defaultRgb[index] : value;
    }) as [number, number, number];
    const alpha = group.alpha
      ? (this.readVariableFromEditor(group.alpha.key) ??
        group.alpha.defaultValue)
      : null;
    return { rgb, alpha };
  }

  private updateColorHexLabel(group: ColorGroupConfig): void {
    const item = this.colorInputs.get(group.label);
    if (!item) return;
    const { rgb, alpha } = this.readColorChannels(group);
    item.hexLabel.textContent =
      alpha === null
        ? channelsToHex(rgb)
        : `${channelsToHex(rgb)} · ${alpha.toFixed(2)}`;
  }

  private updateColorsFromDoc(): void {
    this.colorInputs.forEach((item) => {
      const active = document.activeElement;
      if (active === item.swatch || active === item.alphaInput) {
        return;
      }
      const { rgb, alpha } = this.readColorChannels(item.group);
      item.swatch.value = channelsToHex(rgb);
      if (item.alphaInput && alpha !== null) {
        item.alphaInput.value = String(clamp01(alpha));
      }
      this.updateColorHexLabel(item.group);
    });
  }

  private updateSlidersFromDoc() {
    this.sliderInputs.forEach((item, key) => {
      if (document.activeElement === item.input) {
        return;
      }
      const val = this.readVariableFromEditor(key) ?? item.defaultValue;
      item.input.value = String(valueToPosition(val, item.config));
      item.display.textContent = formatControlValue(val, item.config);
      item.input.setAttribute(
        'aria-valuetext',
        formatControlValue(val, item.config),
      );
    });
  }

  public readVariableFromEditor(variableName: string): number | null {
    return readMilkdropField(this.editor.state.doc.toString(), variableName);
  }

  public writeVariableToEditor(variableName: string, value: number): void {
    this.writeVariablesToEditor({ [variableName]: value });
  }

  /**
   * One transaction for a whole group — the four channels of a colour, both
   * halves of an XY pair. Writing them one at a time dispatched four separate
   * doc changes and four separate recompiles for a single swatch drag.
   */
  public writeVariablesToEditor(updates: Record<string, number>): void {
    const doc = this.editor.state.doc.toString();
    // Was a hand-rolled regex that only matched the canonical spelling and,
    // on a miss, appended the new line to the very end of the buffer — i.e.
    // inside [warp_shader] for any preset that has one, where the parser
    // swallows it as shader text. upsertMilkdropFields knows the aliases and
    // inserts ahead of the shader sections.
    const newDoc = upsertMilkdropFields(doc, updates);

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
    container.className = 'stims-editor__proposal';
    const heading = document.createElement('div');
    heading.className = 'stims-editor__proposal-head';
    heading.textContent = `${label} — review the proposed change`;
    const lines = document.createElement('pre');
    lines.className = 'stims-editor__proposal-lines';
    for (const line of computeSourceDiff(currentSource, nextSource)) {
      const row = document.createElement('span');
      row.className = `stims-editor__proposal-line stims-editor__proposal-line--${line.kind}`;
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
    actions.className = 'stims-editor__proposal-actions';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'stims-editor__btn stims-editor__btn--primary';
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
    discardBtn.className = 'stims-editor__btn';
    discardBtn.textContent = 'Discard';
    discardBtn.addEventListener('click', () => {
      container.remove();
      this.assistedEditContainer = null;
    });
    actions.append(applyBtn, discardBtn);
    container.append(heading, lines, actions);
    // Layered over the code rather than pushed above it: the review happens
    // where the change would land, and it can't grow the panel.
    this.stage.appendChild(container);
    this.assistedEditContainer = container;
  }

  private renderQuickFix(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stims-editor__btn stims-editor__fix';
    btn.textContent = 'Fix with AI';
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
      empty.className = 'stims-editor__history-empty';
      empty.textContent = 'No checkpoints yet.';
      this.historyList.appendChild(empty);
      return;
    }
    [...this.snapshots].reverse().forEach((snapshot) => {
      const row = document.createElement('div');
      row.className = 'stims-editor__history-row';

      const meta = document.createElement('span');
      meta.className = 'stims-editor__history-meta';
      meta.textContent = `${snapshot.label} · ${formatRelativeTime(snapshot.timestamp)}`;

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'stims-editor__btn';
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
