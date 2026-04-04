import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { MilkdropDiagnostic, MilkdropEditorSessionState } from '../types';
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
];

const EDITOR_FLOW_TIPS = [
  'Queued edits patch the stage after 220ms of calm typing.',
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
      outline: 'none',
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
        StreamLanguage.define(properties),
        oneDark,
        createEditorTheme(),
        diagnosticsCompartment.of(
          EditorView.decorations.of(Decoration.set([])),
        ),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => flushDocChange(),
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
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
          }, 220);
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
    editorHeading.textContent = 'Patch the active look';
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
    this.editorLiveBadge.textContent = 'Auto 220ms';
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
    revertButton.addEventListener('click', () =>
      this.callbacks.onRevertToActive(),
    );
    editorActions.appendChild(revertButton);

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.textContent = 'Duplicate';
    duplicateButton.addEventListener('click', () =>
      this.callbacks.onDuplicatePreset(),
    );
    editorActions.appendChild(duplicateButton);

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import';
    importButton.addEventListener('click', () =>
      this.callbacks.onRequestImport(),
    );
    editorActions.appendChild(importButton);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Export';
    exportButton.addEventListener('click', () => this.callbacks.onExport());
    editorActions.appendChild(exportButton);

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
    editorMain.append(this.editorStatus, editorHost);

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
    editorConsole.append(editorConsoleLabel, this.diagnosticsList);

    editorRail.append(
      editorCueSection,
      editorQuickIdeas,
      editorTips,
      editorConsole,
    );
    editorWorkbench.append(editorMain, editorRail);
    this.element.append(editorTransport, editorActions, editorWorkbench);

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
      : 'Auto 220ms';
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
        ? 'Showing a simpler look'
        : 'Stable';
    this.editorSafetyBadge.dataset.tone = hasErrors
      ? 'danger'
      : isDegraded
        ? 'warning'
        : 'muted';

    this.diagnosticsList.replaceChildren();
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
}
