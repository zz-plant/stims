import type { CompletionSource } from '@codemirror/autocomplete';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
} from '@codemirror/language';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search';
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import type { KeyBinding } from '@codemirror/view';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { MilkdropDiagnostic, MilkdropEditorSessionState } from '../types';
import { createMilkdropLanguage } from './editor-language';
import {
  compatibilityCategoryLabel,
  getPrimaryDegradationReason,
} from './preset-row';

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

function buildDiagnosticDecorations(
  state: EditorState,
  diagnostics: MilkdropDiagnostic[],
) {
  const lineDecorations = new Map<number, MilkdropDiagnostic['severity']>();
  const severityRank = {
    info: 1,
    warning: 2,
    error: 3,
  } as const;

  diagnostics.forEach((diagnostic) => {
    if (!diagnostic.line) {
      return;
    }
    const current = lineDecorations.get(diagnostic.line);
    if (!current || severityRank[diagnostic.severity] > severityRank[current]) {
      lineDecorations.set(diagnostic.line, diagnostic.severity);
    }
  });

  const builder = new RangeSetBuilder<Decoration>();
  [...lineDecorations.entries()].forEach(([lineNumber, severity]) => {
    if (lineNumber < 1 || lineNumber > state.doc.lines) {
      return;
    }
    const line = state.doc.line(lineNumber);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        attributes: {
          class: `milkdrop-editor-line--${severity}`,
        },
      }),
    );
  });
  return builder.finish();
}

const MILKDROP_COMPLETIONS: CompletionSource = (context) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const options = [
    { label: 'sin', type: 'function', detail: 'sine' },
    { label: 'cos', type: 'function', detail: 'cosine' },
    { label: 'tan', type: 'function' },
    { label: 'asin', type: 'function' },
    { label: 'acos', type: 'function' },
    { label: 'atan', type: 'function' },
    { label: 'atan2', type: 'function' },
    { label: 'abs', type: 'function' },
    { label: 'sqrt', type: 'function' },
    { label: 'pow', type: 'function' },
    { label: 'mod', type: 'function' },
    { label: 'floor', type: 'function', detail: 'round down' },
    { label: 'ceil', type: 'function', detail: 'round up' },
    { label: 'sqr', type: 'function', detail: 'x*x' },
    { label: 'clamp', type: 'function', detail: 'clamp(x, min, max)' },
    { label: 'step', type: 'function' },
    { label: 'smoothstep', type: 'function' },
    { label: 'log', type: 'function' },
    { label: 'exp', type: 'function' },
    { label: 'sigmoid', type: 'function' },
    { label: 'sign', type: 'function' },
    { label: 'frac', type: 'function', detail: 'fractional part' },
    { label: 'rand', type: 'function', detail: 'random 0-scale' },
    { label: 'if', type: 'function', detail: 'if(cond, then, else)' },
    { label: 'above', type: 'function' },
    { label: 'below', type: 'function' },
    { label: 'equal', type: 'function' },
    { label: 'min', type: 'function' },
    { label: 'max', type: 'function' },
    { label: 'mix', type: 'function' },
    { label: 'lerp', type: 'function' },
    { label: 'bass', type: 'variable', detail: 'bass energy' },
    { label: 'mid', type: 'variable', detail: 'mid energy' },
    { label: 'treb', type: 'variable', detail: 'treble energy' },
    { label: 'bass_att', type: 'variable', detail: 'bass with envelope' },
    { label: 'mid_att', type: 'variable', detail: 'mid with envelope' },
    { label: 'treb_att', type: 'variable', detail: 'treble with envelope' },
    { label: 'beat', type: 'variable' },
    { label: 'time', type: 'variable', detail: 'seconds' },
    { label: 'frame', type: 'variable', detail: 'frame count' },
    { label: 'fps', type: 'variable' },
    { label: 'rms', type: 'variable' },
    { label: 'vol', type: 'variable' },
    { label: 'q1', type: 'variable', detail: 'persistent state' },
    { label: 'q2', type: 'variable' },
    { label: 'q3', type: 'variable' },
    { label: 'q4', type: 'variable' },
    { label: 'q5', type: 'variable' },
    { label: 'q6', type: 'variable' },
    { label: 'q7', type: 'variable' },
    { label: 'q8', type: 'variable' },
    { label: 'zoom', type: 'variable' },
    { label: 'rot', type: 'variable' },
    { label: 'warp', type: 'variable' },
    { label: 'sx', type: 'variable' },
    { label: 'sy', type: 'variable' },
    { label: 'dx', type: 'variable' },
    { label: 'dy', type: 'variable' },
    { label: 'cx', type: 'variable' },
    { label: 'cy', type: 'variable' },
    { label: 'pi', type: 'constant' },
    { label: 'e', type: 'constant' },
  ];

  return {
    from: word.from,
    options: options.filter((opt) =>
      opt.label.startsWith(word.text.toLowerCase()),
    ),
  };
};

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
    '.cm-line.milkdrop-editor-line--info': {
      backgroundColor: 'rgba(14, 116, 144, 0.12)',
    },
    '.cm-line.milkdrop-editor-line--warning': {
      backgroundColor: 'rgba(180, 83, 9, 0.16)',
    },
    '.cm-line.milkdrop-editor-line--error': {
      backgroundColor: 'rgba(153, 27, 27, 0.18)',
    },
  });
}

function createEditorView({
  parent,
  onDocChange,
  onBufferedEdit,
  isChangeSuppressed,
}: {
  parent: HTMLElement;
  onDocChange: (source: string) => void;
  onBufferedEdit: () => void;
  isChangeSuppressed: () => boolean;
}) {
  let debounceId: number | null = null;
  const diagnosticsCompartment = new Compartment();
  let view: EditorView;

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
        history(),
        createMilkdropLanguage(),
        oneDark,
        createEditorTheme(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          activateOnTyping: true,
          override: [MILKDROP_COMPLETIONS],
        }),
        search(),
        highlightSelectionMatches(),
        foldGutter(),
        indentOnInput(),
        diagnosticsCompartment.of(
          EditorView.decorations.of(Decoration.set([])),
        ),
        keymap.of([
          ...searchKeymap,
          {
            key: 'Mod-Enter',
            run: () => flushDocChange(),
          },
          ...defaultEditorKeymap,
          ...historyEditorKeymap,
          indentWithTabKeybinding,
        ]),
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

  return {
    view,
    clearDebounce() {
      if (debounceId !== null) {
        window.clearTimeout(debounceId);
        debounceId = null;
      }
    },
    flushDocChange,
    setDiagnostics(diagnostics: MilkdropDiagnostic[]) {
      view.dispatch({
        effects: diagnosticsCompartment.reconfigure(
          EditorView.decorations.of(
            buildDiagnosticDecorations(view.state, diagnostics),
          ),
        ),
      });
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
  private readonly flushEditorDocChange: () => boolean;
  private readonly setEditorDiagnostics: (
    diagnostics: MilkdropDiagnostic[],
  ) => void;
  private suppressEditorChange = false;
  private hasBufferedEdits = false;
  private lastSessionState: MilkdropEditorSessionState | null = null;
  private quickFixBtn: HTMLButtonElement | null = null;
  private mostRecentDiagnostic: MilkdropDiagnostic | null = null;
  private snapshots: Array<{ source: string; timestamp: number }> = [];

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
    revertButton.setAttribute('aria-label', 'Reset draft to active preset source');
    revertButton.addEventListener('click', () =>
      this.callbacks.onRevertToActive(),
    );
    editorActions.appendChild(revertButton);

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.textContent = 'Duplicate';
    duplicateButton.setAttribute('aria-label', 'Duplicate current preset');
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
        if (this.lastSessionState) {
          this.renderSessionState(this.lastSessionState);
        }
      },
      isChangeSuppressed: () => this.suppressEditorChange,
    });
    this.editor = editorViewState.view;
    this.clearEditorDebounce = editorViewState.clearDebounce;
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
    let refining = false;
    refineBtn.addEventListener('click', async () => {
      const instruction = refineInput.value.trim();
      if (!instruction || refining) return;
      refining = true;
      refineBtn.textContent = '…';
      refineBtn.disabled = true;
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
          const preAiSource = this.editor.state.doc.toString();
          callbacks.onEditorSourceChange(json.milkSource);
          refineInput.value = '';

          if (preAiSource !== json.milkSource) {
            const revertBtn = document.createElement('button');
            revertBtn.textContent = 'Revert AI';
            revertBtn.type = 'button';
            revertBtn.className = 'milkdrop-overlay__refine-btn';
            revertBtn.style.marginLeft = '6px';
            revertBtn.addEventListener(
              'click',
              () => {
                callbacks.onEditorSourceChange(preAiSource);
                revertBtn.remove();
              },
              { once: true },
            );
            refineBtn.insertAdjacentElement('afterend', revertBtn);
          }
        }
        refining = false;
        refineBtn.textContent = 'Refine';
        refineBtn.disabled = false;
      } catch (err) {
        console.error('Refinement failed:', err);
        refineBtn.textContent = 'Error';
        refineBtn.classList.add('milkdrop-overlay__refine-btn--error');
        setTimeout(() => {
          refineBtn.classList.remove('milkdrop-overlay__refine-btn--error');
          refineBtn.textContent = 'Refine';
          refineBtn.disabled = false;
          refining = false;
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
    let explaining = false;
    explainBtn.addEventListener('click', async () => {
      if (explaining) return;
      explaining = true;
      explainBtn.textContent = '…';
      explainBtn.disabled = true;
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
        explaining = false;
        explainBtn.textContent = 'Explain';
        explainBtn.disabled = false;
      } catch (err) {
        console.error('Explanation failed:', err);
        explainBtn.textContent = 'Error';
        explainBtn.classList.add('milkdrop-overlay__refine-btn--error');
        setTimeout(() => {
          explainBtn.classList.remove('milkdrop-overlay__refine-btn--error');
          explainBtn.textContent = 'Explain';
          explainBtn.disabled = false;
          explaining = false;
        }, 2000);
      }
    });
    refineForm.appendChild(explainBtn);
    refineSection.append(refineLabel, refineForm);

    editorRail.append(
      editorCueSection,
      editorQuickIdeas,
      editorTips,
      editorConsole,
      refineSection,
    );
    editorWorkbench.append(editorMain, editorRail);
    this.element.append(
      editorTransport,
      editorActions,
      this.renderBlendInput(),
      editorWorkbench,
    );

    window.addEventListener('stims:editor:diagnostics', ((
      e: CustomEvent<{ diagnostics: MilkdropDiagnostic[] }>,
    ) => {
      this.setEditorDiagnostics(e.detail.diagnostics);
    }) as EventListener);
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
    if (preserveBufferedDraft) {
      if (this.lastSessionState) {
        this.renderSessionState(this.lastSessionState);
      }
      return;
    }

    this.lastSessionState = state;
    if (nextSource !== currentDoc) {
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
    this.setEditorDiagnostics(state.diagnostics);
    this.renderSessionState(state);
  }

  private renderSessionState(state: MilkdropEditorSessionState) {
    const errors = state.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
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
      ? `${errors.length} issue${errors.length === 1 ? '' : 's'} in the draft. The stage is holding the last good frame.`
      : this.hasBufferedEdits
        ? 'Typing… the next patch is queued. Press Cmd/Ctrl+Enter to punch it in immediately.'
        : state.dirty
          ? 'Live patch applied. Keep shaping the draft or reset to return to the active source.'
          : '';
    this.editorStatus.textContent = baseStatus;
    this.editorStatus.hidden = !shouldShowStatus;
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
            severity: primaryReason.blocking ? 'warning' : 'info',
            message: `${compatibilityCategoryLabel(primaryReason.category)}: ${primaryReason.message}`,
          }
        : null,
    ].filter(Boolean) as Array<{
      severity: 'warning' | 'info';
      message: string;
    }>;
    const consoleMessages = [
      ...state.diagnostics.slice(0, 8),
      ...derivedNotices,
    ];

    if (consoleMessages.length === 0) {
      const item = document.createElement('div');
      item.className =
        'milkdrop-overlay__diagnostic milkdrop-overlay__diagnostic--info';
      item.textContent =
        'Console is clear. Try bass_att, beat_pulse, or time to push the scene around.';
      this.diagnosticsList.appendChild(item);
      return;
    }

    consoleMessages.slice(0, 10).forEach((diagnostic) => {
      const item = document.createElement('div');
      item.className = `milkdrop-overlay__diagnostic milkdrop-overlay__diagnostic--${diagnostic.severity}`;
      item.textContent =
        'line' in diagnostic && diagnostic.line
          ? `Line ${diagnostic.line}: ${diagnostic.message}`
          : diagnostic.message;
      if ('line' in diagnostic && diagnostic.line) {
        const lineNum = diagnostic.line;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
          const line = this.editor.state.doc.line(lineNum);
          this.editor.dispatch({
            selection: { anchor: line.from },
            scrollIntoView: true,
          });
        });
      }
      this.diagnosticsList.appendChild(item);
    });
  }

  dispose() {
    this.clearEditorDebounce();
    this.editor.destroy();
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

    const sliders: Array<{
      label: string;
      key: string;
      min: number;
      max: number;
      step: number;
    }> = [
      { label: 'Zoom', key: 'zoom', min: 0.2, max: 3, step: 0.05 },
      { label: 'Warp', key: 'warp', min: 0, max: 1, step: 0.05 },
      { label: 'Rot', key: 'rot', min: 0, max: 1, step: 0.02 },
      { label: 'Decay', key: 'decay', min: 0.8, max: 0.995, step: 0.005 },
      { label: 'Hue', key: 'hue_rot', min: 0, max: 6.28, step: 0.1 },
    ];

    for (const s of sliders) {
      const row = document.createElement('div');
      row.className = 'editor-slider-row';

      const label = document.createElement('label');
      label.className = 'editor-slider-row__label';
      label.textContent = s.label;

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.className = 'editor-slider-row__input';

      const val = this.readVariableFromEditor(s.key);
      input.value = val !== null ? String(val) : String((s.min + s.max) / 2);

      const valDisplay = document.createElement('span');
      valDisplay.className = 'editor-slider-row__value';
      valDisplay.textContent = parseFloat(input.value).toFixed(2);

      input.addEventListener('input', () => {
        valDisplay.textContent = parseFloat(input.value).toFixed(2);
        this.writeVariableToEditor(s.key, parseFloat(input.value));
      });

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(valDisplay);
      panel.appendChild(row);
    }

    return panel;
  }

  private readVariableFromEditor(variableName: string): number | null {
    const doc = this.editor.state.doc.toString();
    const regex = new RegExp(`${variableName}\\s*=\\s*([\\d.]+)`, 'i');
    const match = doc.match(regex);
    return match ? parseFloat(match[1]) : null;
  }

  private writeVariableToEditor(variableName: string, value: number): void {
    const doc = this.editor.state.doc.toString();
    const regex = new RegExp(`(${variableName}\\s*=\\s*)[\\d.]+`, 'gi');
    const newDoc = doc.replace(regex, `$1${value.toFixed(3)}`);

    if (newDoc !== doc) {
      this.editor.dispatch({
        changes: { from: 0, to: doc.length, insert: newDoc },
        scrollIntoView: false,
      });
      this.editor.dispatch({
        effects: EditorView.scrollIntoView(
          this.editor.state.selection.main.head,
        ),
      });
    }
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
    const source = this.editor.state.doc.toString();
    const diag = this.mostRecentDiagnostic;
    if (!diag) return;

    const instruction = `Fix this compiler error: "${diag.message}" at line ${diag.line}. Keep the preset style but fix the syntax or math.`;

    this.setRefinePending(true);
    fetch('https://toil.fyi/api/refine-preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentSource: source, instruction }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.milkSource) {
          const currentSource = this.editor.state.doc.toString();
          this.snapshots.push({ source: currentSource, timestamp: Date.now() });
          this.editor.dispatch({
            changes: {
              from: 0,
              to: currentSource.length,
              insert: data.milkSource,
            },
          });
          this.callbacks.onEditorSourceChange(data.milkSource);
        }
        this.setRefinePending(false);
      })
      .catch(() => this.setRefinePending(false));
  }

  private handleBatchGenerate() {
    const source = this.editor.state.doc.toString();
    this.setRefinePending(true);
    fetch('https://toil.fyi/api/batch-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: source.slice(0, 500), count: 3 }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.presets && data.presets.length > 0) {
          const currentSource = this.editor.state.doc.toString();
          this.snapshots.push({ source: currentSource, timestamp: Date.now() });
          this.editor.dispatch({
            changes: {
              from: 0,
              to: currentSource.length,
              insert: data.presets[0],
            },
          });
          this.callbacks.onEditorSourceChange(data.presets[0]);
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
    const source = this.editor.state.doc.toString();
    this.setRefinePending(true);
    fetch('https://toil.fyi/api/blend-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceA: source, sourceB }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.milkSource) {
          const currentSource = this.editor.state.doc.toString();
          this.snapshots.push({ source: currentSource, timestamp: Date.now() });
          this.editor.dispatch({
            changes: {
              from: 0,
              to: currentSource.length,
              insert: data.milkSource,
            },
          });
          this.callbacks.onEditorSourceChange(data.milkSource);
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
      if (!sourceB) return;
      this.doBlend(sourceB);
      container.style.display = 'none';
      textarea.value = '';
    });

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

  private setRefinePending(_pending: boolean) {
    // noop: pending state tracked locally in the refine section
  }
}
