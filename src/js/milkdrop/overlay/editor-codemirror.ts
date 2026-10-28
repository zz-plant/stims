/**
 * CodeMirror editor machinery for the MilkDrop preset IDE: theme, syntax
 * highlight styles, MIDI gutter, autocomplete, hover docs, and the
 * `createEditorView` factory that wires the extensions and keybindings.
 *
 * Extracted from editor-panel.ts so the panel class is DOM/panel composition
 * and this file is the editor surface it embeds. The builtin completion
 * options derive from the shared builtin-docs table and stay exported for
 * the derivation test in tests/unit/milkdrop-builtin-docs.test.ts.
 */
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
  toggleComment,
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
  Transaction,
} from '@codemirror/state';
import type { DecorationSet, KeyBinding } from '@codemirror/view';
import {
  crosshairCursor,
  Decoration,
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
  WidgetType,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  MILKDROP_BUILTIN_DOCS,
  MILKDROP_FUNCTION_SNIPPET_TEMPLATES,
} from 'milkdrop-toolchain/src/builtin-docs.ts';
import type { MidiGutterEntry } from 'milkdrop-toolchain/src/formatter.ts';
import {
  resolveTheme,
  subscribeToThemePreference,
} from '../../core/theme-preferences';
import type { MilkdropDiagnostic } from '../types';
import { createMilkdropLanguage } from './editor-language';
import { numberScrubExtension } from './editor-number-scrub.ts';

const defaultEditorKeymap = defaultKeymap as readonly KeyBinding[];
const historyEditorKeymap = historyKeymap as readonly KeyBinding[];
const indentWithTabKeybinding = indentWithTab as KeyBinding;

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
export const setMidiGutterInfo = StateEffect.define<MidiGutterEntry[]>();

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

// ── Driving sounds, at the end of the lines that set a field ─────
// The panel hands over a reader built from the dataflow of the compile on
// stage, and again whenever that compile changes or the buffer is reloaded.
// Between those the tags describe the compile on stage, so they follow their
// lines through edits rather than being re-read against text that has not
// run: re-reading after deleting `zoom = zoom + bass` moved its tag onto the
// `zoom = 1` above it. A deleted line takes its tag with it. The tag is
// aria-hidden: the code's accessible text stays the code, and the Tune chips
// carry the same list in their names.
export type AudioSourcesReader = (
  doc: string,
) => Array<{ line: number; text: string; title: string }>;

export const setAudioSourcesReader =
  StateEffect.define<AudioSourcesReader | null>();

class AudioSourcesWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly title: string,
  ) {
    super();
  }

  eq(other: AudioSourcesWidget): boolean {
    return other.text === this.text && other.title === this.title;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-audio-sources';
    span.textContent = this.text;
    span.title = this.title;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

function audioSourceDecorations(
  state: EditorState,
  reader: AudioSourcesReader | null,
): DecorationSet {
  if (!reader) return Decoration.none;
  const ranges = reader(state.doc.toString())
    .filter(({ line }) => line >= 1 && line <= state.doc.lines)
    .map(({ line, text, title }) =>
      Decoration.widget({
        widget: new AudioSourcesWidget(text, title),
        side: 1,
      }).range(state.doc.line(line).to),
    );
  return Decoration.set(ranges, true);
}

const audioSourcesField = StateField.define<{
  reader: AudioSourcesReader | null;
  decorations: DecorationSet;
}>({
  create: () => ({ reader: null, decorations: Decoration.none }),
  update(value, tr) {
    let reader: AudioSourcesReader | null | undefined;
    for (const effect of tr.effects) {
      if (effect.is(setAudioSourcesReader)) reader = effect.value;
    }
    if (reader !== undefined) {
      return { reader, decorations: audioSourceDecorations(tr.state, reader) };
    }
    if (!tr.docChanged) return value;
    return { ...value, decorations: value.decorations.map(tr.changes) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

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

// Token and chrome colours are the panel's CSS custom properties
// (--ed-tok-*, --ed-code-* in editor-panel.css), which html.light redefines,
// so the code well follows the app theme with the rest of the panel and one
// highlight style serves both. The well used to stay dark in light chrome
// while the light token palette painted on it, at 1.9-2.6:1. The tags are
// the ones the milkdrop StreamLanguage tokens resolve to (editor-language.ts).
const milkdropHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ed-tok-heading)', fontWeight: 'bold' },
  { tag: tags.comment, color: 'var(--ed-tok-comment)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--ed-tok-comment)' },
  { tag: tags.keyword, color: 'var(--ed-tok-keyword)' },
  { tag: tags.atom, color: 'var(--ed-tok-atom)' },
  { tag: tags.variableName, color: 'var(--ed-tok-variable)' },
  { tag: tags.standard(tags.variableName), color: 'var(--ed-tok-builtin)' },
  { tag: tags.number, color: 'var(--ed-tok-number)' },
  { tag: tags.operator, color: 'var(--ed-tok-operator)' },
  { tag: tags.propertyName, color: 'var(--ed-tok-property)' },
  { tag: tags.string, color: 'var(--ed-tok-string)' },
  { tag: tags.typeName, color: 'var(--ed-tok-type)' },
]);

function createEditorTheme() {
  return EditorView.theme({
    '&': {
      color: 'var(--ed-code-ink)',
      backgroundColor: 'transparent',
      // Martian Mono runs ~8% wider per character than the mono it replaced,
      // with a taller x-height; one step down keeps the same columns per line
      // and the same apparent size.
      fontSize: 'var(--text-sm)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-family-mono)',
      lineHeight: '1.6',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--ed-code-gutter-ink)',
      borderRight: '1px solid var(--ed-code-edge)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--ed-code-active)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--ed-code-active)',
      color: 'var(--ed-code-ink)',
    },
    '.cm-content': {
      caretColor: 'var(--ed-code-caret)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--ed-code-caret)',
    },
    // The well draws the focus ring (editor-panel.css): an outline here sat
    // under the fade at the bottom edge.
    '&.cm-focused': {
      outline: 'none',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'var(--ed-code-selection)',
      },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--ed-code-match)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--ed-code-match)',
      outline: '1px solid var(--ed-code-edge-strong)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--ed-code-selection)',
    },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'var(--ed-code-match)',
      outline: '1px solid var(--ed-code-edge-strong)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: '1px solid var(--ed-code-edge-strong)',
      color: 'var(--ed-code-gutter-ink)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--ed-code-raised)',
      color: 'var(--ed-code-ink)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--ed-code-edge-strong)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid var(--ed-code-edge-strong)',
    },
    '.cm-tooltip': {
      border: '1px solid var(--ed-code-edge-strong)',
      backgroundColor: 'var(--ed-code-raised)',
      color: 'var(--ed-code-ink)',
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: 'var(--ed-code-raised)',
      borderBottomColor: 'var(--ed-code-raised)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--ed-code-selection)',
      color: 'var(--ed-code-ink)',
    },
    '.cm-quickfix-action': {
      backgroundColor: 'color-mix(in srgb, var(--stims-cool) 16%, transparent)',
      color: 'var(--stims-cool)',
    },
    // The sounds the equations feed into this line's field; the warm colour
    // the Tune chips use for "the equations own this value".
    '.cm-audio-sources': {
      marginLeft: '1.5ch',
      color: 'var(--ed-code-sources)',
      whiteSpace: 'nowrap',
      cursor: 'default',
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
      color: 'var(--ed-code-gutter-ink)',
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
      color: 'var(--stims-good)',
    },
    '.cm-midi-gutter-marker--shadowed': {
      color: 'var(--ed-code-gutter-ink)',
    },
  });
}

export function createEditorView({
  parent,
  onDocChange,
  onBufferedEdit,
  onUserCodeEditApplied,
  isChangeSuppressed,
  onQuickFixDiagnostic,
  onEscapeBlur,
  onJumpToVariable,
  onToggleAbSnapshot,
}: {
  parent: HTMLElement;
  onDocChange: (source: string) => void;
  onBufferedEdit: () => void;
  /** Fired once when a doc change that commits down the apply path carries
   * CodeMirror's own user annotation — the visitor's keys, paste, cut or
   * drop. Lets the panel count the visitor's first code edit without
   * counting the app's own buffer writes. */
  onUserCodeEditApplied?: () => void;
  isChangeSuppressed: () => boolean;
  onQuickFixDiagnostic: (diagnostic: MilkdropDiagnostic) => void;
  /** Called when Escape leaves the editor so the panel can park focus on a
   * sensible control instead of dropping it on <body>. */
  onEscapeBlur: () => void;
  /** Opens the panel's "Jump to variable" popover (Cmd/Ctrl+J). */
  onJumpToVariable: () => void;
  /** Toggles A/B snapshot comparison (Cmd/Ctrl+Shift+B). */
  onToggleAbSnapshot?: () => void;
}) {
  let debounceId: number | null = null;
  // Set when a doc change carries CodeMirror's own user annotation — the
  // visitor's keys, paste, cut or drop. Every other doc change here is the
  // app writing the buffer (Tune controls, session reloads, A/B swaps) and
  // dispatches without one. Cleared when the change commits down the apply
  // path, so the distinction is only consumed by the commit, never by the
  // paint.
  let pendingVisitorEdit = false;
  let view: EditorView;
  // Colours come from CSS (see the highlight style above); this only tells
  // CodeMirror's base theme which of its light/dark defaults to fall back on
  // for the parts it still draws itself (lint markers and tooltips).
  const darkThemeCompartment = new Compartment();
  // Undo history lives in its own compartment so a preset load can start it
  // over (see resetHistory below).
  const historyCompartment = new Compartment();
  // Read-only while A/B shows the original: it is there to look at, and an
  // edit made to it would have no slot to belong to.
  const readOnlyCompartment = new Compartment();
  const flushDocChange = () => {
    if (isChangeSuppressed()) {
      return true;
    }
    if (debounceId !== null) {
      window.clearTimeout(debounceId);
      debounceId = null;
    }
    if (pendingVisitorEdit) {
      pendingVisitorEdit = false;
      onUserCodeEditApplied?.();
    }
    onDocChange(view.state.doc.toString());
    return true;
  };

  view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        // CodeMirror's editable surface is a role="textbox" with no name of
        // its own, so a screen reader announced it as an unlabelled edit
        // field (axe: aria-input-field-name). The dialog title does not
        // carry over — the control needs its own name.
        EditorView.contentAttributes.of({
          // Tab indents in here (indentWithTabKeybinding, below), so it
          // cannot also move focus out — this is the one control in the app
          // Tab will not leave. WCAG 2.1.2 permits that only where the way
          // out is told to the user, and the way out (Escape, handled on
          // contentDOM further down) was documented nowhere. The name
          // carries it, and `aria-keyshortcuts` publishes it as a binding.
          'aria-label':
            'MilkDrop preset code. Tab indents; press Escape to leave the editor.',
          'aria-keyshortcuts': 'Escape',
        }),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        historyCompartment.of(history()),
        readOnlyCompartment.of(EditorState.readOnly.of(false)),
        createMilkdropLanguage(),
        darkThemeCompartment.of(
          EditorView.darkTheme.of(resolveTheme() === 'dark'),
        ),
        syntaxHighlighting(milkdropHighlightStyle),
        createEditorTheme(),
        audioSourcesField,
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
        // Alt-drag a numeric literal to scrub it like a slider (Alt+Arrow
        // Up/Down is the keyboard equivalent). Registered before the keymaps
        // so its Prec.highest bindings resolve ahead of moveLineUp/copyLineUp.
        numberScrubExtension(),
        keymap.of([
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...lintKeymap,
          {
            key: 'Mod-Enter',
            run: () => flushDocChange(),
          },
          { key: 'Mod-/', run: toggleComment },
          {
            key: 'Mod-j',
            run: () => {
              onJumpToVariable();
              return true;
            },
          },
          {
            key: 'Mod-Shift-b',
            run: () => {
              if (onToggleAbSnapshot) {
                onToggleAbSnapshot();
                return true;
              }
              return false;
            },
          },
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
          // The visitor's own edit, by CodeMirror's annotation: undo and redo
          // excluded, since neither makes the first edit the funnel asks
          // about (undo is only reachable after one).
          const visitorEdit = update.transactions.some((tr) => {
            const event = tr.annotation(Transaction.userEvent);
            return event !== undefined && event !== 'undo' && event !== 'redo';
          });
          if (visitorEdit) pendingVisitorEdit = true;
          // Two independent debounced timers restart on every keystroke, not
          // one: onBufferedEdit's 80ms (above, in createEditorView's caller)
          // repaints local UI (diagnostics, Tune controls) — cheap and wants
          // to feel responsive. onDocChange 120ms below propagates the draft
          // upstream to the actual preset recompile — heavier, and doesn't
          // need to run more often than the local repaint. 120ms > 80ms is
          // deliberate so the recompile settles just after the UI has
          // already caught up, not simultaneously fighting it for the CPU.
          onBufferedEdit();
          if (debounceId !== null) {
            window.clearTimeout(debounceId);
          }
          debounceId = window.setTimeout(() => {
            debounceId = null;
            if (pendingVisitorEdit) {
              pendingVisitorEdit = false;
              onUserCodeEditApplied?.();
            }
            onDocChange(update.state.doc.toString());
          }, 120);
        }),
      ],
    }),
    parent,
  });

  // Escape inside the code must never fall through to the document-level
  // handler that closes the whole editor panel. CodeMirror's own listener is
  // registered first, so its Escape bindings (snippet clear, search close,
  // selection simplify) have already run — and preventDefault'ed — by the
  // time this fires; when none of them claimed the key, Escape becomes
  // "leave the editor": blur the content DOM and hand focus back to the
  // panel. The listener dies with contentDOM on view.destroy().
  view.contentDOM.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (event.defaultPrevented) return;
    event.preventDefault();
    view.contentDOM.blur();
    onEscapeBlur();
  });

  // resolveTheme(), not the raw choice: "system" is a preference, not a
  // palette, and CodeMirror needs the one actually being painted.
  const unsubscribeTheme = subscribeToThemePreference((preference) => {
    view.dispatch({
      effects: darkThemeCompartment.reconfigure(
        EditorView.darkTheme.of(resolveTheme(preference) === 'dark'),
      ),
    });
  });

  return {
    view,
    /**
     * Start undo history over. A preset load replaces the whole buffer, and
     * as an undoable step it let Undo on a freshly opened editor empty the
     * code, or paste the previous preset's text over this one — which the
     * debounce then committed and saved as this preset's draft. Removing the
     * extension drops its state; adding it back starts an empty stack.
     */
    resetHistory() {
      view.dispatch({ effects: historyCompartment.reconfigure([]) });
      view.dispatch({ effects: historyCompartment.reconfigure(history()) });
    },
    /**
     * Show `source` read-only and hand back the state it replaced, undo
     * history included, for `restoreState` to put back exactly. Swapping the
     * text in as an ordinary change made it an undo step, and keeping it out
     * of history was worse: undo then remapped the real edits through a
     * whole-document replacement and produced garbage.
     */
    showReadOnly(source: string): EditorState {
      const previous = view.state;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(true)),
        annotations: Transaction.addToHistory.of(false),
      });
      return previous;
    },
    restoreState(state: EditorState) {
      view.setState(state);
    },
    /** Make the buffer editable again without restoring anything. */
    endReadOnly() {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          EditorState.readOnly.of(false),
        ),
      });
    },
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
