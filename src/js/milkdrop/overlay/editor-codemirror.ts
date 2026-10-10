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
  const syntaxThemeCompartment = new Compartment();
  // Undo history lives in its own compartment so a preset load can start it
  // over (see resetHistory below).
  const historyCompartment = new Compartment();
  // Read-only while A/B shows the original: it is there to look at, and an
  // edit made to it would have no slot to belong to.
  const readOnlyCompartment = new Compartment();
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
        oneDarkTheme,
        syntaxThemeCompartment.of(syntaxHighlightStyleForTheme(resolveTheme())),
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
      effects: syntaxThemeCompartment.reconfigure(
        syntaxHighlightStyleForTheme(resolveTheme(preference)),
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
