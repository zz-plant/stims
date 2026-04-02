import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { MilkdropEditorSessionState } from '../types';
import {
  compatibilityCategoryLabel,
  getPrimaryDegradationReason,
} from './preset-row';

type EditorSnippet = {
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

export type EditorPanelCallbacks = {
  onEditorSourceChange: (source: string) => void;
  onRevertToActive: () => void;
  onDuplicatePreset: () => void;
  onExport: () => void;
  onDeletePreset: () => void;
  onRequestImport: () => void;
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
      outline: 'none',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(34, 211, 238, 0.22)',
    },
  });
}

function createEditorView({
  parent,
  onDocChange,
  isChangeSuppressed,
}: {
  parent: HTMLElement;
  onDocChange: (source: string) => void;
  isChangeSuppressed: () => boolean;
}) {
  let debounceId: number | null = null;
  const view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        history(),
        StreamLanguage.define(properties),
        oneDark,
        createEditorTheme(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || isChangeSuppressed()) {
            return;
          }
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
  private suppressEditorChange = false;

  constructor(callbacks: EditorPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('section');
    this.element.className = 'milkdrop-overlay__tab-panel';

    const editorHost = document.createElement('div');
    editorHost.className = 'milkdrop-overlay__editor';
    const editorIntro = document.createElement('div');
    editorIntro.className = 'milkdrop-overlay__editor-intro';
    const editorIntroCopy = document.createElement('div');
    editorIntroCopy.className = 'milkdrop-overlay__editor-intro-copy';
    const editorEyebrow = document.createElement('span');
    editorEyebrow.className = 'milkdrop-overlay__editor-eyebrow';
    editorEyebrow.textContent = 'Live coding';
    const editorHeading = document.createElement('strong');
    editorHeading.className = 'milkdrop-overlay__editor-heading';
    editorHeading.textContent = 'Edit the active look';
    const editorSubheading = document.createElement('p');
    editorSubheading.className = 'milkdrop-overlay__editor-subheading';
    editorSubheading.textContent = 'Edit here. Reset draft takes you back.';
    editorIntroCopy.append(editorEyebrow, editorHeading, editorSubheading);
    const editorBadgeRow = document.createElement('div');
    editorBadgeRow.className = 'milkdrop-overlay__editor-badges';
    this.editorLiveBadge = document.createElement('span');
    this.editorLiveBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--live';
    this.editorLiveBadge.textContent = 'Live';
    this.editorSyncBadge = document.createElement('span');
    this.editorSyncBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--sync';
    this.editorSyncBadge.textContent = 'Changes pending';
    this.editorSafetyBadge = document.createElement('span');
    this.editorSafetyBadge.className =
      'milkdrop-overlay__editor-badge milkdrop-overlay__editor-badge--safety';
    this.editorSafetyBadge.textContent = 'Safety net on';
    editorBadgeRow.append(
      this.editorLiveBadge,
      this.editorSyncBadge,
      this.editorSafetyBadge,
    );
    editorIntro.append(editorIntroCopy, editorBadgeRow);
    this.editorStatus = document.createElement('div');
    this.editorStatus.className = 'milkdrop-overlay__editor-status';
    this.editorStatus.textContent = '';
    this.editorStatus.hidden = true;

    const editorActions = document.createElement('div');
    editorActions.className = 'milkdrop-overlay__editor-actions';

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

    const editorQuickIdeas = document.createElement('div');
    editorQuickIdeas.className = 'milkdrop-overlay__editor-quick-ideas';
    const editorQuickIdeasLabel = document.createElement('span');
    editorQuickIdeasLabel.className =
      'milkdrop-overlay__editor-quick-ideas-label';
    editorQuickIdeasLabel.textContent = 'Quick moves';
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
    editorTips.className = 'milkdrop-overlay__editor-tips';
    [
      'Auto-updates after 220ms of calm typing.',
      'Errors keep the last stable preset visible.',
      'Tab indents, undo/redo stays local to the draft.',
    ].forEach((tip) => {
      const item = document.createElement('div');
      item.className = 'milkdrop-overlay__editor-tip';
      item.textContent = tip;
      editorTips.appendChild(item);
    });

    this.diagnosticsList = document.createElement('div');
    this.diagnosticsList.className = 'milkdrop-overlay__diagnostics';
    this.element.append(
      editorIntro,
      this.editorStatus,
      editorActions,
      editorQuickIdeas,
      editorHost,
      editorTips,
      this.diagnosticsList,
    );

    const editorViewState = createEditorView({
      parent: editorHost,
      onDocChange: (source) => this.callbacks.onEditorSourceChange(source),
      isChangeSuppressed: () => this.suppressEditorChange,
    });
    this.editor = editorViewState.view;
    this.clearEditorDebounce = editorViewState.clearDebounce;
  }

  setVisible(visible: boolean) {
    this.element.hidden = !visible;
  }

  setDeleteEnabled(enabled: boolean) {
    this.deleteButton.hidden = !enabled;
  }

  setSessionState(state: MilkdropEditorSessionState) {
    const nextSource = state.source;
    if (nextSource !== this.editor.state.doc.toString()) {
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
    const shouldShowStatus = hasErrors || state.dirty;
    const baseStatus = hasErrors
      ? `${errors.length} issue${errors.length === 1 ? '' : 's'}. Showing the last good frame.`
      : state.dirty
        ? 'Changes are live'
        : '';
    this.editorStatus.textContent = baseStatus;
    this.editorStatus.hidden = !shouldShowStatus;
    this.editorLiveBadge.textContent = 'Showing last good frame';
    this.editorLiveBadge.dataset.tone = 'warning';
    this.editorLiveBadge.hidden = !hasErrors;
    this.editorSyncBadge.textContent = 'Changes pending';
    this.editorSyncBadge.dataset.tone = state.dirty ? 'accent' : 'muted';
    this.editorSyncBadge.hidden = !state.dirty;
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

    [...state.diagnostics.slice(0, 8), ...derivedNotices]
      .slice(0, 10)
      .forEach((diagnostic) => {
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
