/**
 * In-Session MilkDrop IDE & Editor Panel — implements the live CodeMirror preset IDE with syntax
 * autocompletions, AST diagnostics, parameter sliders, A/B snapshot toggling, and instant compilation.
 */

import { isolateHistory, redo, undo } from '@codemirror/commands';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  computeMidiGutterInfo,
  findMilkdropEquationLine,
  getFieldOverwriteKind,
  isFieldShadowedByEquations,
  readMilkdropField,
  upsertMilkdropFields,
} from 'milkdrop-toolchain/src/formatter.ts';
import {
  analyzePresetDataflow,
  controlAudio,
  dataflowSignature,
  drawnPartAudio,
  frameValueName,
  type PresetDataflow,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';
import { analyzePresetMath } from 'milkdrop-toolchain/src/preset-math-analyzer.ts';
import { webMidiService } from '../../core/services/webmidi-controller.ts';
import { renderIconSvg } from '../../ui/icon-library.ts';
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
import {
  blendPresetSources,
  mutatePresetStyle,
  PRESET_MUTATION_STYLES,
} from '../preset-mutations.ts';
import { parseSlotName, slotControls } from '../slot-controls.ts';
import type { MilkdropDiagnostic, MilkdropEditorSessionState } from '../types';
import { subscribeVariables } from '../variable-probe.ts';
import { createEditorView, setMidiGutterInfo } from './editor-codemirror.ts';
import { computeAstDiagnostics, mergeDiagnostics } from './editor-parser';
import {
  type AssignedVariable,
  filterVariables,
  nextOccurrence,
  scanAssignedVariables,
} from './editor-variable-jump';

export { computeAstDiagnostics, mergeDiagnostics };

import {
  browserVersionStorage,
  createVersionStore,
  type VersionStorage,
} from '../named-versions.ts';
import {
  findPresetKnobs,
  formatKnobValue,
  type PresetKnob,
} from '../preset-knobs.ts';
import { CompatPane } from './editor-pane-compat.ts';
import { InsertPane } from './editor-pane-insert.ts';
import { InspectPane } from './editor-pane-inspect.ts';
import { OutlinePane } from './editor-pane-outline.ts';
import { ReferencePane } from './editor-pane-reference.ts';
import { ShaderPane } from './editor-pane-shader.ts';
import { TexturesPane } from './editor-pane-textures.ts';
import {
  compatibilityCategoryLabel,
  getPrimaryDegradationReason,
} from './preset-row';
import {
  computeSourceDiff,
  type SourceDiffLine,
  samePresetSource,
} from './source-diff.ts';
import {
  formatAudioReachSummary,
  summarizeAudioReach,
} from './version-compare-summary.ts';
import { setWatchedVariables } from './watcher-hud.ts';

/**
 * Kept as the module's public names because tests, the MIDI layer and the MCP
 * tools address the Tune pane through them; the declarations themselves now
 * live in preset-controls.ts alongside the scale maths.
 */
export type SliderConfig = ScalarControlConfig;
export const DEFAULT_EDITOR_SLIDERS: ScalarControlConfig[] = SCALAR_CONTROLS;
export const DEFAULT_EDITOR_COLOR_GROUPS: ColorGroupConfig[] = COLOR_GROUPS;
export type { ColorGroupConfig };

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export type EditorPanelCallbacks = {
  onEditorSourceChange: (source: string) => void;
  /**
   * A code edit the visitor typed, pasted, cut or dropped into the buffer has
   * been committed down the apply path (the same debounce that hands the draft
   * to the engine). Panel-driven writes — Tune controls, session reloads, AI
   * proposals — dispatch without a user annotation and never fire this.
   */
  onUserCodeEditApplied?: () => void;
  /**
   * A Tune-pane control committed a value into the draft: a fader, swatch,
   * switch, mode, range, parameter knob, or modulation. Fired when the value
   * actually changed the buffer, whatever the commit cadence.
   */
  onTuneControlCommit?: () => void;
  /** Live feedback for a numeric field during a drag: applied to the running
   * VM without a recompile. The value is committed to the source separately
   * (on release), so the runtime staying absent only degrades to the old
   * compile-only behavior. */
  onLiveFieldChange?: (key: string, value: number) => void;
  /** Hold or release the stage; returns the state actually applied (holding
   * needs live audio). */
  onSetStageFrozen?: (frozen: boolean) => boolean;
  /** Render exactly one frame while the stage is held. */
  onStepFrame?: () => boolean;
  /**
   * The preset's source as it was before any edit: the bundled file, or the
   * saved version of a preset the visitor made. Revert and A/B compare read
   * it. Resolves null when there is nothing to compare against.
   */
  getOriginalSource?: () => Promise<string | null>;
  /**
   * The backend the stage is currently rendering with, or null when the
   * caller cannot tell. Panes that report per-backend behavior (volume
   * texture samples differ: WebGL slices a bundled 2D atlas, WebGPU reads
   * native 3D volumes) say which view they are showing instead of guessing.
   */
  getActiveBackend?: () => 'webgl' | 'webgpu' | null;
  onDuplicatePreset: () => void;
  onExport: () => void;
  onDeletePreset: () => void;
  onRequestImport: () => void;
  /**
   * Copy a link that carries the editor's live source in a `#code=` hash.
   *
   * The shell has written that hash into the address bar on every keystroke
   * since remix links shipped, so the link already existed — it just had no
   * name, no button, and nothing anywhere saying an unsaved draft travels in
   * a URL. Sharing work in progress was a feature you could only use if you
   * had read the router.
   */
  onCopyShareLink: () => void;
};

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

/**
 * The audio signals the equations on stage feed into any of `keys`: [] when
 * none reaches them, null when the analysis has none of them (nothing on
 * stage yet, or the draft has run ahead of the last compile). Read from the
 * dataflow, so a field that follows bass through a q variable says bass.
 */
function audioReaching(
  dataflow: PresetDataflow | null,
  keys: readonly string[],
): string[] | null {
  if (!dataflow) return null;
  const reached = keys
    .map((key) => controlAudio(dataflow, key))
    .filter((audio): audio is string[] => audio !== null);
  return reached.length > 0 ? [...new Set(reached.flat())].sort() : null;
}

export class EditorPanel {
  readonly element: HTMLElement;

  private readonly referencePane: ReferencePane;
  private readonly insertPane: InsertPane;
  private readonly compatPane: CompatPane;
  private readonly texturesPane: TexturesPane;
  private readonly outlinePane: OutlinePane;
  private readonly inspectPane: InspectPane;
  private readonly shaderPane: ShaderPane;
  private readonly callbacks: EditorPanelCallbacks;
  private readonly note: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly stateLabel: HTMLElement;
  private readonly safetyFlag: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly problems: HTMLElement;
  private readonly problemsCount: HTMLElement;
  private readonly problemsBody: HTMLElement;
  private readonly diagnosticsList: HTMLElement;
  private readonly deleteButton: HTMLButtonElement;
  /** Relabelled per compile: what the link carries depends on `state.dirty`. */
  private readonly shareLinkItem: HTMLButtonElement;
  private readonly editor: EditorView;
  private readonly clearEditorDebounce: () => void;
  private readonly resetEditorHistory: () => void;
  private readonly showReadOnlySource: (source: string) => EditorState;
  private readonly restoreEditorState: (state: EditorState) => void;
  private readonly endReadOnly: () => void;
  /** The edit, with its undo history, while A/B shows the original. */
  private abEditState: EditorState | null = null;
  private readonly unsubscribeTheme: () => void;
  private readonly flushEditorDocChange: () => boolean;
  private readonly setEditorDiagnostics: (
    diagnostics: MilkdropDiagnostic[],
  ) => void;
  private disposeMenuDismiss: (() => void) | null = null;
  private suppressEditorChange = false;
  private hasBufferedEdits = false;
  private bufferedEditDebounceId: number | null = null;
  /** Identity of the preset the buffer currently belongs to, so a preset
   * switch can be told apart from the session echoing back the user's own
   * in-progress edits. */
  private lastPresetId: string | null = null;
  private lastSessionState: MilkdropEditorSessionState | null = null;
  private quickFixBtn: HTMLButtonElement | null = null;
  private mostRecentDiagnostic: MilkdropDiagnostic | null = null;
  /** Checkpoints, each tagged with the preset it was taken on: Restore
   * pastes the whole buffer, so a checkpoint from another preset would
   * replace this one's code with that one's. */
  private snapshots: Array<{
    presetId: string | null;
    source: string;
    timestamp: number;
    label: string;
  }> = [];
  private historyList: HTMLElement | null = null;
  private readonly versions: ReturnType<typeof createVersionStore>;
  private versionsList: HTMLElement | null = null;
  private versionNameInput: HTMLInputElement | null = null;
  private versionSaveButton: HTMLButtonElement | null = null;
  private versionStatus: HTMLElement | null = null;
  private knobsWrap: HTMLElement | null = null;
  private knobsSignature = '';
  private readonly knobInputs = new Map<
    string,
    { input: HTMLInputElement; display: HTMLElement }
  >();
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
      liveTick: HTMLSpanElement;
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
  /** Which audio reaches each field, read from the equations on stage. Kept
   * with its signature: every fader move recompiles, and only an equation
   * change can change the answer. */
  private controlDataflow: {
    signature: string;
    dataflow: PresetDataflow;
  } | null = null;
  /** Whether the Tune pane is on screen: its tab selected, the dock open. */
  private tuneVisible = true;
  /** Faders whose tick follows the frame, keyed to the name the VM keeps
   * that field's value under. */
  private readonly liveTickNames = new Map<string, string>();
  private disposeLiveFeed: (() => void) | null = null;
  /** The custom wave or shape Tune shows controls for (`shape_1`). */
  private tunedSlot: string | null = null;
  private slotWrap: HTMLElement | null = null;
  private slotPicker: HTMLSelectElement | null = null;
  private slotControlsWrap: HTMLElement | null = null;
  private slotSignature = '';
  /** What the shown slot's controls registered, so the next pick can take
   * it back out of the shared control maps. */
  private slotKeys: string[] = [];
  private slotColorLabels: string[] = [];
  /** Selects a dock tab by pane id; set once the tabs exist. */
  private selectPane: ((id: string) => void) | null = null;
  private midiTargets: Set<string> = new Set();
  // The slider whose "learn" button is currently armed, waiting for the
  // next CC from any device — mirrors webMidiService.getLearnTarget() but
  // scoped to "was it *this* editor's UI that armed it", so a learn
  // started from the Performance hardware panel doesn't light up a slider.
  private learningSliderKey: string | null = null;
  private snapshotSlot: 'A' | 'B' = 'A';
  /** Whether slot A was seeded from the original preset (labels read
   * "Original" / "Your edit") or captured by hand ("Slot A" / "Slot B"). */
  private abBaseline: 'original' | 'snapshot' = 'snapshot';
  private abNoticeTimer: number | undefined;
  private snapshotSourceA: string | null = null;
  private snapshotSourceB: string | null = null;
  private abButton: HTMLButtonElement | null = null;

  constructor(
    callbacks: EditorPanelCallbacks,
    options: { versionStorage?: VersionStorage | null } = {},
  ) {
    this.callbacks = callbacks;
    this.versions = createVersionStore(
      'versionStorage' in options
        ? (options.versionStorage ?? null)
        : browserVersionStorage(),
    );
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
    // The apply shortcut is also part of the Update button's accessible
    // name, so the visual chip can stay decorative.
    const shortcutHint = document.createElement('span');
    shortcutHint.className = 'stims-editor__shortcut';
    shortcutHint.textContent = '⌘/Ctrl+⏎';
    shortcutHint.title = 'Apply the draft immediately';
    shortcutHint.setAttribute('aria-hidden', 'true');
    const scrubHint = document.createElement('span');
    scrubHint.className = 'stims-editor__shortcut';
    scrubHint.textContent = '⌥ drag number to scrub';
    flags.append(this.safetyFlag, scrubHint, shortcutHint);
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
      ariaLabel: 'Update now — apply the draft (Cmd/Ctrl+Enter)',
      onClick: () => this.applyCurrentSource(),
    });
    applyButton.dataset.action = 'apply';

    // Back to the preset as shipped (or as saved, for one you made). This
    // used to reset to the *active* source, which with edits applied as you
    // type was the edit itself — so it did nothing, and an edited preset had
    // no way back. Undoable like any other edit.
    const revertButton = this.createButton('Revert', {
      title: 'Revert to the original preset (Cmd/Ctrl+Z undoes it)',
      ariaLabel: 'Revert to the original preset',
      onClick: () => void this.revertToOriginal(),
    });
    revertButton.dataset.action = 'editor-revert-original';

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
    const visibleMenuItems = (): HTMLButtonElement[] =>
      Array.from(
        menu.querySelectorAll<HTMLButtonElement>('.stims-editor__menu-item'),
      ).filter((item) => !item.hidden);
    const menuButton = this.createButton('⋯', {
      variant: 'icon',
      title: 'Preset actions',
      ariaLabel: 'Preset actions',
      onClick: () => {
        menu.hidden = !menu.hidden;
        menuButton.setAttribute('aria-expanded', String(!menu.hidden));
        // Standard menu-button contract: opening the menu moves focus to
        // its first item so arrow keys work immediately.
        if (!menu.hidden) visibleMenuItems()[0]?.focus();
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
      // Menu items are reached with arrow keys, not Tab — the trigger is
      // the single tab stop for the whole widget.
      item.tabIndex = -1;
      item.textContent = label;
      if (tone) item.dataset.tone = tone;
      item.addEventListener('click', () => {
        closeMenu();
        onClick();
      });
      return item;
    };
    // ArrowUp/ArrowDown/Home/End roving focus inside the open menu; the
    // handled keys are consumed so nothing upstream scrolls or navigates.
    menu.addEventListener('keydown', (event) => {
      const items = visibleMenuItems();
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      switch (event.key) {
        case 'ArrowDown':
          next = index < 0 ? 0 : (index + 1) % items.length;
          break;
        case 'ArrowUp':
          next =
            index < 0
              ? items.length - 1
              : (index - 1 + items.length) % items.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = items.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      items[next].focus();
    });
    const menuSeparator = document.createElement('div');
    menuSeparator.className = 'stims-editor__menu-sep';
    this.deleteButton = menuItem(
      'Delete preset',
      () => this.callbacks.onDeletePreset(),
      'danger',
    );
    this.deleteButton.hidden = true;
    // Sits with Export because they answer the same question — "how do I get
    // this out of here" — and a link is the answer people reach for first.
    this.shareLinkItem = menuItem('Copy link to this preset', () =>
      this.callbacks.onCopyShareLink(),
    );
    this.shareLinkItem.dataset.action = 'editor-copy-share-link';
    menu.append(
      menuItem('Remix', () => this.callbacks.onDuplicatePreset()),
      menuItem('Snapshot as Slot A', () => this.snapshotSlotA()),
      menuItem('Snapshot as Slot B', () => this.snapshotSlotB()),
      menuItem('Clear snapshots', () => this.clearSnapshots()),
      menuItem('Import…', () => this.callbacks.onRequestImport()),
      menuItem('Export', () => this.callbacks.onExport()),
      this.shareLinkItem,
      menuSeparator,
      this.deleteButton,
    );
    menuWrap.append(menuButton, menu);

    // A menu that only closes by re-clicking its own trigger reads as stuck.
    const dismissMenu = (event: MouseEvent) => {
      if (!menuWrap.contains(event.target as Node)) closeMenu();
    };
    // Registered in the capture phase so an Escape aimed at the open menu is
    // consumed before the document-level bubble handler that closes the whole
    // editor panel — one press closes the menu, a second closes the panel.
    // With the menu closed the key is left alone entirely.
    const dismissMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || menu.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      menuButton.focus();
    };
    document.addEventListener('pointerdown', dismissMenu);
    document.addEventListener('keydown', dismissMenuOnEscape, true);
    this.disposeMenuDismiss = () => {
      document.removeEventListener('pointerdown', dismissMenu);
      document.removeEventListener('keydown', dismissMenuOnEscape, true);
    };

    this.abButton = this.createButton('A/B', {
      title: 'Compare with the original (Cmd/Ctrl+Shift+B)',
      ariaLabel: 'Compare with the original (Cmd/Ctrl+Shift+B)',
      onClick: () => void this.toggleAbSnapshot(),
    });
    this.abButton.dataset.action = 'ab-toggle';

    const jumpButton = this.createButton('Jump', {
      ariaLabel: 'Jump to variable (Cmd/Ctrl+J)',
      onClick: () => this.openVariableJump(),
    });
    jumpButton.dataset.action = 'editor-jump-variable';

    toolbar.append(
      applyButton,
      revertButton,
      this.abButton,
      undoRedo,
      jumpButton,
      spacer,
      menuWrap,
    );

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
      onUserCodeEditApplied: () => this.callbacks.onUserCodeEditApplied?.(),
      onBufferedEdit: () => {
        // The flag must flip synchronously (commit logic reads it), but the
        // diagnostics + control re-render below cost a full preset parse and
        // dozens of whole-document scans — far too much to run undebounced on
        // every keystroke. 80ms trailing keeps feedback near-instant at
        // typing pauses without paying per character.
        this.hasBufferedEdits = true;
        if (this.bufferedEditDebounceId !== null) {
          window.clearTimeout(this.bufferedEditDebounceId);
        }
        this.bufferedEditDebounceId = window.setTimeout(() => {
          this.bufferedEditDebounceId = null;
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
        }, 80);
      },
      isChangeSuppressed: () => this.suppressEditorChange,
      onQuickFixDiagnostic: (diagnostic) =>
        this.applyQuickFixForDiagnostic(diagnostic),
      // Escape out of the code lands on the primary action rather than
      // dropping focus on <body>.
      onEscapeBlur: () => applyButton.focus(),
      onJumpToVariable: () => this.openVariableJump(),
      onToggleAbSnapshot: () => void this.toggleAbSnapshot(),
    });
    this.editor = editorViewState.view;
    this.resetEditorHistory = editorViewState.resetHistory;
    this.showReadOnlySource = editorViewState.showReadOnly;
    this.restoreEditorState = editorViewState.restoreState;
    this.endReadOnly = editorViewState.endReadOnly;
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
    this.problemsBody = document.createElement('div');
    this.problemsBody.className = 'stims-editor__problems-body';
    this.diagnosticsList = document.createElement('div');
    this.diagnosticsList.className = 'stims-editor__problems-list';
    this.problemsBody.appendChild(this.diagnosticsList);
    this.problems.append(problemsHead, this.problemsBody);

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

    const host = { editor: this.editor };
    this.referencePane = new ReferencePane(host);
    this.insertPane = new InsertPane(host);
    this.compatPane = new CompatPane(host);
    this.texturesPane = new TexturesPane(host, {
      getActiveBackend: callbacks.getActiveBackend,
    });
    this.outlinePane = new OutlinePane(host, {
      onTuneSlot: (slot) => this.showSlotInTune(slot),
    });
    this.inspectPane = new InspectPane(host, {
      onSetStageFrozen: callbacks.onSetStageFrozen,
      onStepFrame: callbacks.onStepFrame,
      // Pins are the stage HUD's watch set (watcher-hud.ts), which keeps
      // plotting after the editor closes, so the names leave the pane.
      onPinsChanged: (names) => setWatchedVariables(names),
    });
    this.shaderPane = new ShaderPane(host);

    const panes: Array<{ id: string; label: string; content: HTMLElement }> = [
      { id: 'tune', label: 'Tune', content: this.renderSliders() },
      { id: 'outline', label: 'Outline', content: this.outlinePane.element },
      { id: 'insert', label: 'Insert', content: this.insertPane.element },
      {
        id: 'reference',
        label: 'Reference',
        content: this.referencePane.element,
      },
      { id: 'assist', label: 'Assist', content: this.renderAssistPane() },
      { id: 'inspect', label: 'Inspect', content: this.inspectPane.element },
      { id: 'shader', label: 'Shader', content: this.shaderPane.element },
      { id: 'compat', label: 'Compat', content: this.compatPane.element },
      {
        id: 'textures',
        label: 'Textures',
        content: this.texturesPane.element,
      },
      { id: 'history', label: 'History', content: this.renderHistoryPane() },
    ];
    const tabButtons: HTMLButtonElement[] = [];
    // Selection and roving tabindex move together: the selected tab is the
    // tablist's single Tab stop, arrows move both focus and selection.
    const selectTab = (tab: HTMLButtonElement) => {
      // Selecting a tab in a collapsed dock should show it, not silently
      // change a hidden selection.
      dock.dataset.open = 'true';
      dockToggle.textContent = '▾';
      tabButtons.forEach((other, otherIndex) => {
        const selected = other === tab;
        other.setAttribute('aria-selected', String(selected));
        other.tabIndex = selected ? 0 : -1;
        panes[otherIndex].content.hidden = !selected;
        if (panes[otherIndex].id === 'inspect') {
          this.inspectPane.setInspectActive(selected);
        }
        if (panes[otherIndex].id === 'tune') {
          this.setTuneVisible(selected);
        }
      });
    };
    panes.forEach((pane, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'stims-editor__tab';
      tab.textContent = pane.label;
      tab.id = `stims-editor-tab-${pane.id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(index === 0));
      tab.setAttribute('aria-controls', `stims-editor-pane-${pane.id}`);
      tab.tabIndex = index === 0 ? 0 : -1;
      tab.dataset.pane = pane.id;
      if (pane.id === 'compat') this.compatPane.bindTab(tab);
      if (pane.id === 'shader') this.shaderPane.bindTab(tab);
      if (pane.id === 'textures') this.texturesPane.bindTab(tab);
      pane.content.classList.add('stims-editor__pane');
      pane.content.id = `stims-editor-pane-${pane.id}`;
      pane.content.setAttribute('role', 'tabpanel');
      pane.content.setAttribute(
        'aria-labelledby',
        `stims-editor-tab-${pane.id}`,
      );
      pane.content.hidden = index !== 0;
      tab.addEventListener('click', () => selectTab(tab));
      tabButtons.push(tab);
      tabs.appendChild(tab);
      dockBody.appendChild(pane.content);
    });
    this.selectPane = (id) => {
      const tab = tabButtons[panes.findIndex((pane) => pane.id === id)];
      if (tab) selectTab(tab);
    };
    tabs.addEventListener('keydown', (event) => {
      const current = tabButtons.indexOf(event.target as HTMLButtonElement);
      // The dock toggle shares the strip but is not a tab; leave its keys
      // (and any unhandled key) alone.
      if (current === -1) return;
      let next: number;
      switch (event.key) {
        case 'ArrowRight':
          next = (current + 1) % tabButtons.length;
          break;
        case 'ArrowLeft':
          next = (current - 1 + tabButtons.length) % tabButtons.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = tabButtons.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      const tab = tabButtons[next];
      selectTab(tab);
      tab.focus();
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
      const tuneTab = tabButtons[panes.findIndex((pane) => pane.id === 'tune')];
      this.setTuneVisible(
        open && tuneTab?.getAttribute('aria-selected') === 'true',
      );
    });
    // Sibling of the tablist, not a child of it. A `role="tablist"` may only
    // contain tabs, so putting the collapse button inside made every child
    // suspect to assistive tech (axe: aria-required-children) and put a
    // non-tab in the arrow-key roving order. A flex row keeps the same
    // visual arrangement.
    const tabRow = document.createElement('div');
    tabRow.className = 'stims-editor__tabrow';
    tabRow.append(tabs, dockToggle);
    dock.append(tabRow, dockBody);

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

  /** Reflect the stage's hold state; called by the host whenever it changes. */
  setStageFrozen(frozen: boolean) {
    this.inspectPane.setStageFrozen(frozen);
  }

  setVisible(visible: boolean) {
    this.element.hidden = !visible;
  }

  setDeleteEnabled(enabled: boolean) {
    this.deleteButton.hidden = !enabled;
  }

  // ── Jump to variable (Cmd/Ctrl+J) ─────────────────────────────
  // Scrubbing a value is instant once you're on its line; finding that line
  // in a few hundred per-frame equations was the editor's dominant time
  // sink. The popover lists the doc's assignment targets (most-assigned
  // first), fuzzy-filters, and Enter jumps — repeatedly, cycling through
  // every line that assigns the chosen variable.
  private variableJumpEl: HTMLDivElement | null = null;
  private variableJumpInput: HTMLInputElement | null = null;
  private variableJumpMatches: AssignedVariable[] = [];
  private variableJumpActive = 0;

  private openVariableJump(): void {
    if (this.variableJumpEl) {
      this.variableJumpInput?.focus();
      this.variableJumpInput?.select();
      return;
    }
    const popover = document.createElement('div');
    popover.className = 'stims-editor__jump';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'stims-editor__jump-input';
    input.placeholder = 'Jump to variable…';
    input.setAttribute('aria-label', 'Jump to variable');
    const list = document.createElement('ul');
    list.className = 'stims-editor__jump-list';
    list.setAttribute('role', 'listbox');
    popover.append(input, list);
    this.stage.appendChild(popover);
    this.variableJumpEl = popover;
    this.variableJumpInput = input;

    const variables = scanAssignedVariables(this.editor.state.doc.toString());
    const render = () => {
      this.variableJumpMatches = filterVariables(variables, input.value).slice(
        0,
        10,
      );
      this.variableJumpActive = 0;
      list.replaceChildren();
      if (this.variableJumpMatches.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'stims-editor__jump-empty';
        empty.textContent = 'No assignments match';
        list.appendChild(empty);
        return;
      }
      this.variableJumpMatches.forEach((variable, index) => {
        const item = document.createElement('li');
        item.className = 'stims-editor__jump-item';
        item.setAttribute('role', 'option');
        item.setAttribute(
          'aria-selected',
          String(index === this.variableJumpActive),
        );
        item.dataset.active = String(index === this.variableJumpActive);
        const name = document.createElement('span');
        name.textContent = variable.name;
        const count = document.createElement('span');
        count.className = 'stims-editor__jump-count';
        count.textContent =
          variable.occurrences.length === 1
            ? `line ${String(variable.occurrences[0].line)}`
            : `${String(variable.occurrences.length)}×`;
        item.append(name, count);
        item.addEventListener('mousedown', (event) => {
          // mousedown, not click: keeps focus in the input so the popover
          // survives for cycling.
          event.preventDefault();
          this.variableJumpActive = index;
          this.jumpToActiveVariable();
        });
        list.appendChild(item);
      });
    };

    const setActive = (index: number) => {
      const max = this.variableJumpMatches.length;
      if (max === 0) return;
      this.variableJumpActive = ((index % max) + max) % max;
      [...list.children].forEach((child, i) => {
        const active = i === this.variableJumpActive;
        (child as HTMLElement).dataset.active = String(active);
        child.setAttribute('aria-selected', String(active));
      });
    };

    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(this.variableJumpActive + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(this.variableJumpActive - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.jumpToActiveVariable();
      } else if (event.key === 'Escape') {
        // Consume it: the document-level handler would close the panel.
        event.preventDefault();
        event.stopPropagation();
        this.closeVariableJump();
        this.editor.focus();
      }
    });
    input.addEventListener('blur', () => {
      // Deferred so a mousedown on a list item runs first.
      window.setTimeout(() => {
        if (!popover.contains(document.activeElement)) {
          this.closeVariableJump();
        }
      }, 0);
    });

    render();
    input.focus();
  }

  /** Jump the editor cursor to the active match's next occurrence (cycles),
   * keeping the popover open so repeated Enter walks every assignment. */
  private jumpToActiveVariable(): void {
    const variable = this.variableJumpMatches[this.variableJumpActive];
    if (!variable) return;
    const doc = this.editor.state.doc;
    const head = this.editor.state.selection.main.head;
    const cursorLine = doc.lineAt(head);
    const occurrence = nextOccurrence(
      variable.occurrences.filter((o) => o.line <= doc.lines),
      cursorLine.number,
      head - cursorLine.from,
    );
    if (!occurrence) return;
    const line = doc.line(occurrence.line);
    const anchor = Math.min(line.from + occurrence.column, line.to);
    this.editor.dispatch({
      selection: {
        anchor,
        head: Math.min(anchor + variable.name.length, line.to),
      },
      scrollIntoView: true,
    });
  }

  private closeVariableJump(): void {
    this.variableJumpEl?.remove();
    this.variableJumpEl = null;
    this.variableJumpInput = null;
    this.variableJumpMatches = [];
    this.variableJumpActive = 0;
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
    const mutationsHeading = document.createElement('h3');
    mutationsHeading.className = 'stims-editor__section-heading';
    mutationsHeading.textContent = 'Quick restyles';

    const mutationsGrid = document.createElement('div');
    mutationsGrid.className = 'stims-editor__assist-actions';
    mutationsGrid.style.display = 'flex';
    mutationsGrid.style.flexWrap = 'wrap';
    mutationsGrid.style.gap = '6px';
    mutationsGrid.style.marginTop = '8px';

    PRESET_MUTATION_STYLES.forEach(({ id, label }) => {
      const btn = this.createButton(label, {
        onClick: () => {
          if (this.aiPending) return;
          const currentSource = this.editor.state.doc.toString();
          const mutated = mutatePresetStyle(currentSource, id);
          this.proposeAssistedEdit(mutated, `Style: ${label}`);
        },
      });
      mutationsGrid.appendChild(btn);
    });

    blendActions.append(blendSubmit, blendCancel);
    blend.append(blendTextarea, blendActions);

    this.refineBtn = refineBtn;
    this.explainBtn = explainBtn;
    this.batchButton = variationsBtn;
    this.blendSubmitButton = blendSubmit;
    this.assistPane = pane;

    pane.append(hint, form, actions, mutationsHeading, mutationsGrid, blend);
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
      console.warn(
        `${options.label} API failed, checking local math analyzer:`,
        err,
      );
      if (options.instruction === 'explain this preset') {
        const currentSource = this.editor.state.doc.toString();
        const mathAnalysis = analyzePresetMath(currentSource);
        this.showExplanation(mathAnalysis.summary);
        options.button.textContent = options.label;
        this.setRefinePending(false);
        return;
      }
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

    // Named versions: the author's own bookmarks, kept per preset in the
    // browser. Unlike the automatic checkpoints below, they survive a reload.
    const versionsHeading = document.createElement('p');
    versionsHeading.className = 'stims-editor__hint';
    versionsHeading.textContent =
      'Save a named version to come back to, diff against, or restore. Kept in this browser.';
    const form = document.createElement('div');
    form.className = 'stims-editor__version-form';
    this.versionNameInput = document.createElement('input');
    this.versionNameInput.type = 'text';
    this.versionNameInput.className = 'stims-editor__version-name';
    this.versionNameInput.placeholder = 'Name this version';
    this.versionNameInput.maxLength = 60;
    this.versionNameInput.setAttribute('aria-label', 'Version name');
    this.versionSaveButton = document.createElement('button');
    this.versionSaveButton.type = 'button';
    this.versionSaveButton.className = 'stims-editor__btn';
    this.versionSaveButton.textContent = 'Save version';
    this.versionSaveButton.addEventListener('click', () =>
      this.saveNamedVersion(),
    );
    this.versionNameInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.saveNamedVersion();
    });
    form.append(this.versionNameInput, this.versionSaveButton);
    this.versionStatus = document.createElement('p');
    this.versionStatus.className = 'stims-editor__hint';
    this.versionStatus.setAttribute('aria-live', 'polite');
    this.versionsList = document.createElement('div');
    this.versionsList.className = 'stims-editor__versions';

    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'Automatic checkpoints: taken before each applied AI edit and before each restore. Not kept after a reload.';
    this.historyList = document.createElement('div');
    this.historyList.className = 'stims-editor__history';
    pane.append(
      versionsHeading,
      form,
      this.versionStatus,
      this.versionsList,
      hint,
      this.historyList,
    );
    this.paintVersions();
    this.renderHistorySnapshots();
    return pane;
  }

  private saveNamedVersion() {
    const presetKey = this.lastPresetId;
    if (!presetKey || !this.versionStatus) return;
    const result = this.versions.save(
      presetKey,
      this.versionNameInput?.value ?? '',
      this.editor.state.doc.toString(),
    );
    if (result.ok) {
      if (this.versionNameInput) this.versionNameInput.value = '';
      this.versionStatus.textContent = `Saved \u201c${result.version.name}\u201d.`;
    } else {
      this.versionStatus.textContent =
        result.reason === 'too-large'
          ? 'This preset is too large to keep as a version.'
          : result.reason === 'empty-source'
            ? 'There is nothing to save yet.'
            : 'Could not save: this browser is blocking or has filled its storage.';
    }
    this.paintVersions();
  }

  /** Replace the buffer with `source`, checkpointing what was there first. */
  private restoreSource(source: string) {
    const currentSource = this.editor.state.doc.toString();
    if (currentSource === source) return;
    this.pushSnapshot(currentSource, 'Before restore');
    this.editor.dispatch({
      changes: { from: 0, to: this.editor.state.doc.length, insert: source },
      annotations: isolateHistory.of('full'),
    });
    this.callbacks.onEditorSourceChange(source);
    this.editor.focus();
  }

  private paintVersions() {
    const list = this.versionsList;
    if (!list) return;
    const presetKey = this.lastPresetId;
    if (this.versionSaveButton) this.versionSaveButton.disabled = !presetKey;
    if (!presetKey) {
      const none = document.createElement('p');
      none.className = 'stims-editor__hint';
      none.textContent = 'Open a preset to save versions of it.';
      list.replaceChildren(none);
      return;
    }
    const saved = this.versions.list(presetKey);
    if (saved.length === 0) {
      const none = document.createElement('p');
      none.className = 'stims-editor__hint';
      none.textContent = 'No saved versions of this preset yet.';
      list.replaceChildren(none);
      return;
    }
    list.replaceChildren(
      ...saved.map((version) => {
        const row = document.createElement('div');
        row.className = 'stims-editor__version';
        row.dataset.versionId = version.id;
        const head = document.createElement('div');
        head.className = 'stims-editor__history-row';
        const meta = document.createElement('span');
        meta.className = 'stims-editor__history-meta';
        meta.textContent = `${version.name} \u00b7 ${formatRelativeTime(version.savedAt)}`;
        const compare = document.createElement('button');
        compare.type = 'button';
        compare.className = 'stims-editor__btn';
        compare.textContent = 'Compare';
        compare.setAttribute('aria-expanded', 'false');
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'stims-editor__btn';
        restore.textContent = 'Restore';
        restore.addEventListener('click', () =>
          this.restoreSource(version.source),
        );
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'stims-editor__btn';
        remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete version ${version.name}`);
        remove.addEventListener('click', () => {
          this.versions.remove(presetKey, version.id);
          this.paintVersions();
        });
        head.append(meta, compare, restore, remove);
        row.appendChild(head);

        // Compare opens a panel: a picker for the other side (the current
        // source, or any other saved version) above the diff from this
        // version to it.
        let panel: HTMLElement | null = null;
        compare.addEventListener('click', () => {
          if (panel) {
            panel.remove();
            panel = null;
            compare.setAttribute('aria-expanded', 'false');
            return;
          }
          panel = document.createElement('div');
          panel.className = 'stims-editor__version-compare';
          panel.dataset.versionDiff = version.id;
          const pickerLabel = document.createElement('label');
          pickerLabel.className = 'stims-editor__hint';
          pickerLabel.textContent = 'Changes from this version to ';
          const picker = document.createElement('select');
          picker.className = 'stims-editor__version-target';
          picker.setAttribute('aria-label', `Compare ${version.name} with`);
          const current = document.createElement('option');
          current.value = '';
          current.textContent = 'the current source';
          picker.appendChild(current);
          for (const other of saved) {
            if (other.id === version.id) continue;
            const option = document.createElement('option');
            option.value = other.id;
            option.textContent = `\u201c${other.name}\u201d`;
            picker.appendChild(option);
          }
          pickerLabel.appendChild(picker);
          const output = document.createElement('div');
          const paintDiff = () => {
            const target = saved.find((other) => other.id === picker.value);
            const targetSource = target
              ? target.source
              : this.editor.state.doc.toString();
            const diff = computeSourceDiff(version.source, targetSource);
            if (diff.length === 0) {
              const same = document.createElement('p');
              same.className = 'stims-editor__hint';
              same.textContent = target
                ? `Identical to \u201c${target.name}\u201d.`
                : 'Identical to the current source.';
              output.replaceChildren(same);
            } else {
              output.replaceChildren(buildDiffElement(diff));
            }
            // The audio-reach summary (version-compare-summary.ts): a
            // plain-language reading of how the preset's relationship with
            // the music changed, under the line diff it is derived from.
            const reach = summarizeAudioReach(version.source, targetSource);
            if (reach.length > 0) {
              const note = document.createElement('p');
              note.className = 'stims-editor__version-listen';
              note.title =
                'Derived from the static dataflow of both sources: which sounds each control and drawn part can reach, not what is audible right now.';
              const heading = document.createElement('strong');
              heading.textContent = 'What changed in how it listens: ';
              note.append(heading, `${formatAudioReachSummary(reach)}.`);
              output.appendChild(note);
            }
          };
          picker.addEventListener('change', paintDiff);
          paintDiff();
          panel.append(pickerLabel, output);
          row.appendChild(panel);
          compare.setAttribute('aria-expanded', 'true');
        });
        return row;
      }),
    );
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
    // The first load counts as well as a switch: before it the buffer is
    // empty, and that empty buffer must not be one Undo away.
    const presetLoaded =
      nextPresetId !== null && nextPresetId !== this.lastPresetId;
    const presetChanged = presetLoaded && this.lastPresetId !== null;
    if (presetChanged) {
      // Old preset's variables, min/max and sparklines would mislead.
      this.inspectPane.resetHistory();
      this.hasBufferedEdits = false;
      this.clearEditorDebounce();
    }
    if (presetLoaded) {
      // A/B slots hold whole buffers. Carried across a switch, toggling
      // pasted the previous preset's code into this one.
      this.clearSnapshots();
      this.lastPresetId = nextPresetId;
      if (this.versionStatus) this.versionStatus.textContent = '';
      this.paintVersions();
      this.renderHistorySnapshots();
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
    if (presetLoaded) {
      this.resetEditorHistory();
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
    // Says out loud that the draft rides along, at the one moment the claim
    // is checkable: the reader has unsaved edits in front of them.
    this.shareLinkItem.textContent = state.dirty
      ? 'Copy link to this edit'
      : 'Copy link to this preset';
    this.shareLinkItem.title = state.dirty
      ? 'Copies a link carrying your unsaved source, so it opens in their editor exactly as it is here.'
      : 'Copies a link to this preset. Edit anything and the link carries your draft too.';

    this.stateEl.dataset.state = state_;
    this.stateLabel.textContent = hasErrors
      ? 'Holding last good frame'
      : this.hasBufferedEdits
        ? 'Queued'
        : state.dirty
          ? 'Draft live'
          : 'Synced';

    this.updateControlDataflow(state.activeCompiled);
    this.compatPane.update(state);
    this.shaderPane.update(state);
    this.texturesPane.update(state);
    const dataflow = this.controlDataflow?.dataflow ?? null;
    this.outlinePane.update(
      state,
      state.activeCompiled && dataflow
        ? drawnPartAudio(state.activeCompiled.ir, dataflow)
        : null,
    );
    this.paintKnobs(state.source);
    this.paintSlots(state.latestCompiled ?? state.activeCompiled);
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

    // A clean compile is the header's "clean" and nothing else: the line
    // under it cost the code two lines of height on every first open.
    this.problemsBody.hidden = consoleMessages.length === 0;
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
        // The row acts as a button, so it must be reachable and operable
        // from the keyboard like one.
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        const jumpToLine = () => {
          if (lineNum >= 1 && lineNum <= this.editor.state.doc.lines) {
            const line = this.editor.state.doc.line(lineNum);
            this.editor.dispatch({
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            this.editor.focus();
          }
        };
        item.addEventListener('click', jumpToLine);
        item.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          jumpToLine();
        });
      }
      this.diagnosticsList.appendChild(item);
    });

    this.updateSlidersFromDoc();
    this.updateColorsFromDoc();
    this.updateTogglesFromDoc();
    this.updateEnumsFromDoc();
    this.updateRangesFromDoc();
    this.updateModulationsFromDoc();
    this.refreshMidiGutter();
    this.refreshSliderMidiState();
  }

  /** Re-reads which audio reaches each field when the equations on stage
   * change. With nothing on stage there is no answer, rather than an old one. */
  private updateControlDataflow(
    compiled: MilkdropEditorSessionState['activeCompiled'],
  ): void {
    if (!compiled) {
      this.controlDataflow = null;
      return;
    }
    const signature = dataflowSignature(compiled.ir);
    if (this.controlDataflow?.signature === signature) return;
    this.controlDataflow = {
      signature,
      dataflow: analyzePresetDataflow(compiled.ir),
    };
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
    const dataflow = this.controlDataflow?.dataflow ?? null;

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
      // What the equations feed into a driven field: the audio, by the names
      // the code uses, so the chip answers "why does this move?" too. Every
      // driving band, not a count: "eq · bass +2" hid mid and treble in a
      // tooltip while the visible chip claimed to name the sounds
      // (docs/PRODUCT_MOMENTS.md, "Open one up").
      const audio = state === 'driven' ? audioReaching(dataflow, driven) : null;
      const audioList = audio?.length ? ` · ${audio.join(', ')}` : '';

      cell.chip.dataset.state = state;
      cell.chip.textContent =
        state === 'static'
          ? 'set'
          : state === 'bound'
            ? 'midi'
            : state === 'driven'
              ? `eq${audioList}`
              : 'eq ⚠';
      // Only the equation states have somewhere to jump to.
      cell.chip.disabled = driven.length === 0;
      cell.chip.title =
        state === 'static'
          ? `${cell.label} is a literal value in this preset — the control owns it.`
          : state === 'bound'
            ? `MIDI/MCP is driving ${bound.join(', ')}.`
            : state === 'driven'
              ? `This preset recomputes ${driven.join(', ')} every frame${
                  audio?.length ? ` from ${audio.join(', ')}` : ''
                }, so the control's value is overwritten.${
                  audio?.length === 0 ? ' No audio reaches it.' : ''
                } Click to jump to the equation.`
              : `MIDI/MCP is bound to ${bound.join(', ')}, but this preset's own equations reassign ${driven.join(', ')} every frame — no visible effect. Click to jump to the equation.`;
      cell.chip.setAttribute(
        'aria-label',
        `${cell.label} value source: ${state}${
          audio?.length ? `, computed from ${audio.join(', ')}` : ''
        }`,
      );
    }

    this.sliderInputs.forEach((item, key) => {
      const armed = this.learningSliderKey === key;
      item.learnButton.dataset.armed = armed ? 'true' : 'false';
      item.learnButton.title = armed
        ? `Listening… move a knob or fader to map it to ${key}.`
        : `MIDI-learn ${key}: click, then move a knob or fader.`;
    });
    this.refreshLiveTicks(doc, dataflow);
    this.refreshLiveHintsFromDoc();
  }

  /**
   * Which faders show the value the frame used: a field the per-frame code
   * recomputes, so one number per frame is what was drawn. A field per-pixel
   * code varies across the mesh has no single number to show. The feed from
   * the running preset is subscribed only while one of those faders is on
   * screen, so a closed dock or another tab costs nothing.
   */
  private refreshLiveTicks(doc: string, dataflow: PresetDataflow | null) {
    this.liveTickNames.clear();
    this.sliderInputs.forEach((item, key) => {
      const name =
        dataflow && isFieldShadowedByEquations(doc, key)
          ? frameValueName(dataflow, key)
          : null;
      if (name) this.liveTickNames.set(key, name);
      else item.liveTick.hidden = true;
    });
    const wanted = this.tuneVisible && this.liveTickNames.size > 0;
    if (wanted && !this.disposeLiveFeed) {
      this.disposeLiveFeed = subscribeVariables((variables) =>
        this.paintLiveTicks(variables),
      );
    } else if (!wanted && this.disposeLiveFeed) {
      this.stopLiveFeed();
    }
  }

  private paintLiveTicks(variables: Readonly<Record<string, number>>) {
    this.liveTickNames.forEach((name, key) => {
      const item = this.sliderInputs.get(key);
      if (!item) return;
      const value = variables[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        item.liveTick.hidden = true;
        return;
      }
      item.liveTick.hidden = false;
      item.liveTick.style.setProperty(
        '--live-position',
        String(valueToPosition(value, item.config)),
      );
    });
  }

  private stopLiveFeed() {
    this.disposeLiveFeed?.();
    this.disposeLiveFeed = null;
    this.sliderInputs.forEach((item) => {
      item.liveTick.hidden = true;
    });
  }

  /** Tune went on or off screen: start or stop the ticks' feed. */
  private setTuneVisible(visible: boolean) {
    if (visible === this.tuneVisible) return;
    this.tuneVisible = visible;
    if (!visible) {
      this.stopLiveFeed();
      return;
    }
    this.refreshLiveTicks(
      this.editor.state.doc.toString(),
      this.controlDataflow?.dataflow ?? null,
    );
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
    this.stopLiveFeed();
    this.inspectPane.dispose();
    this.closeVariableJump();
    this.disposeDiagnosticsListener?.();
    this.disposeDiagnosticsListener = null;
    this.disposeMidiListener?.();
    this.disposeMidiListener = null;
    this.disposeMenuDismiss?.();
    this.disposeMenuDismiss = null;
    window.clearTimeout(this.abNoticeTimer);
    this.clearEditorDebounce();
    if (this.bufferedEditDebounceId !== null) {
      window.clearTimeout(this.bufferedEditDebounceId);
      this.bufferedEditDebounceId = null;
    }
    if (this.controlFlushTimer !== null) {
      window.clearTimeout(this.controlFlushTimer);
      this.controlFlushTimer = null;
    }
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

  /**
   * Flip between the two A/B slots. The first press with nothing captured
   * compares against the original preset: slot A is the source as shipped
   * (or saved), slot B the buffer as it stands. It used to seed slot A with
   * whatever the buffer happened to hold, so "A/B" compared an edit with
   * itself until you thought to snapshot something first.
   *
   * Swaps stay out of undo history: they change which version is showing,
   * not the code, and as undo steps they interleaved with real edits.
   */
  public async toggleAbSnapshot(): Promise<void> {
    if (this.abBaseline === 'original') {
      this.toggleOriginalComparison();
      return;
    }
    if (this.snapshotSourceA === null && this.snapshotSourceB === null) {
      const presetId = this.lastPresetId;
      const original = (await this.callbacks.getOriginalSource?.()) ?? null;
      // A preset switch while the original was loading owns the editor now.
      if (presetId !== this.lastPresetId) return;
      if (original !== null) {
        const currentDoc = this.editor.state.doc.toString();
        if (samePresetSource(original, currentDoc)) {
          this.paintAbButton('No edits yet');
          return;
        }
        this.snapshotSourceA = original;
        this.snapshotSourceB = currentDoc;
        this.abBaseline = 'original';
        this.toggleOriginalComparison();
        return;
      }
    }

    const currentDoc = this.editor.state.doc.toString();
    if (this.snapshotSourceA === null) {
      this.snapshotSourceA = currentDoc;
    }
    if (this.snapshotSlot === 'A') {
      this.snapshotSourceA = currentDoc;
      if (this.snapshotSourceB === null) {
        this.snapshotSlot = 'B';
        this.paintAbButton();
        this.applyCurrentSource();
        return;
      }
      this.showAbSlot('B');
    } else {
      this.snapshotSourceB = currentDoc;
      this.showAbSlot('A');
    }
  }

  /**
   * Original ⇄ your edit. The original is shown read-only; going back puts
   * the edited state back exactly as it was, cursor and undo history too.
   */
  private toggleOriginalComparison() {
    if (this.abEditState === null) {
      if (this.snapshotSourceA === null) return;
      this.abEditState = this.showReadOnlySource(this.snapshotSourceA);
      this.snapshotSlot = 'A';
    } else {
      this.restoreEditorState(this.abEditState);
      this.abEditState = null;
      this.snapshotSourceB = this.editor.state.doc.toString();
      this.snapshotSlot = 'B';
    }
    this.paintAbButton();
    this.applyCurrentSource();
  }

  /** Put one slot's source in the buffer and on the stage. */
  private showAbSlot(slot: 'A' | 'B') {
    const source = slot === 'A' ? this.snapshotSourceA : this.snapshotSourceB;
    if (source !== null) {
      this.suppressEditorChange = true;
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: source },
        annotations: isolateHistory.of('full'),
      });
      this.suppressEditorChange = false;
    }
    this.snapshotSlot = slot;
    this.paintAbButton();
    this.applyCurrentSource();
  }

  private paintAbButton(notice?: string) {
    const button = this.abButton;
    if (!button) return;
    window.clearTimeout(this.abNoticeTimer);
    if (notice) {
      button.textContent = notice;
      this.abNoticeTimer = window.setTimeout(() => this.paintAbButton(), 2400);
      return;
    }
    if (this.snapshotSourceA === null && this.snapshotSourceB === null) {
      button.dataset.slot = 'none';
      button.textContent = 'A/B';
      button.title = 'Compare with the original (Cmd/Ctrl+Shift+B)';
      return;
    }
    button.dataset.slot = this.snapshotSlot;
    const original = this.abBaseline === 'original';
    const showing =
      this.snapshotSlot === 'A'
        ? original
          ? 'Original'
          : 'Slot A'
        : original
          ? 'Your edit'
          : 'Slot B';
    const other =
      this.snapshotSlot === 'A'
        ? original
          ? 'your edit'
          : 'slot B'
        : original
          ? 'the original'
          : 'slot A';
    button.textContent = showing;
    button.title = `Showing ${showing.toLowerCase()} (Cmd/Ctrl+Shift+B shows ${other})`;
  }

  public snapshotSlotA(): void {
    this.snapshotSourceA = this.editor.state.doc.toString();
    this.snapshotSlot = 'A';
    this.abBaseline = 'snapshot';
    this.paintAbButton();
  }

  public snapshotSlotB(): void {
    this.snapshotSourceB = this.editor.state.doc.toString();
    this.snapshotSlot = 'B';
    this.abBaseline = 'snapshot';
    this.paintAbButton();
  }

  public clearSnapshots(): void {
    if (this.abEditState !== null) {
      // Dropped, not restored: whatever replaces the buffer next (a preset
      // load, a revert) is what should be there.
      this.abEditState = null;
      this.endReadOnly();
    }
    this.snapshotSourceA = null;
    this.snapshotSourceB = null;
    this.snapshotSlot = 'A';
    this.abBaseline = 'snapshot';
    this.paintAbButton();
  }

  /** Replace the buffer with the original preset, as one undoable edit. */
  private async revertToOriginal(): Promise<void> {
    const presetId = this.lastPresetId;
    const original = (await this.callbacks.getOriginalSource?.()) ?? null;
    if (original === null || presetId !== this.lastPresetId) return;
    // Mid-comparison, put the edit back first so the revert is a step its
    // undo history can take back.
    if (this.abEditState !== null) {
      this.restoreEditorState(this.abEditState);
      this.abEditState = null;
    }
    this.clearSnapshots();
    this.restoreSource(original);
  }

  public getSnapshotState(): {
    slot: 'A' | 'B';
    sourceA: string | null;
    sourceB: string | null;
  } {
    return {
      slot: this.snapshotSlot,
      sourceA: this.snapshotSourceA,
      sourceB: this.snapshotSourceB,
    };
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

    this.sliderInputs.clear();
    this.colorInputs.clear();
    this.toggleInputs.clear();
    this.enumInputs.clear();
    this.rangeInputs.clear();
    this.modulationRows.clear();
    this.fieldStateCells = [];

    // Controls lead. With the intro paragraph and the wave-or-shape picker
    // above them, Tune's first control started at the bottom edge of a
    // 1280x720 window and the sounds the chips name sat below the fold
    // (docs/PRODUCT_MOMENTS.md, "Open one up"). The picker now follows the
    // labelled controls it can wait behind, and the teaching copy folds
    // into a disclosure at the bottom.

    // The preset's own parameters: they are what its author meant to be
    // tuned. Empty (and hidden) for presets without any.
    this.knobsWrap = document.createElement('section');
    this.knobsWrap.className = 'stims-editor__section';
    this.knobsWrap.dataset.section = 'knobs';
    this.knobsWrap.setAttribute('aria-label', 'Preset parameters');
    this.knobsWrap.hidden = true;
    panel.appendChild(this.knobsWrap);

    for (const section of CONTROL_SECTIONS) {
      panel.appendChild(this.renderSection(section));
    }

    // One custom wave's or shape's own settings, picked here or from its
    // Outline row. Hidden for presets that have none.
    this.slotWrap = document.createElement('section');
    this.slotWrap.className = 'stims-editor__section stims-editor__slot';
    this.slotWrap.dataset.section = 'slot';
    this.slotWrap.setAttribute('aria-label', 'Custom wave or shape');
    this.slotWrap.hidden = true;
    const pickerRow = document.createElement('label');
    pickerRow.className = 'stims-editor__slot-picker';
    const pickerLabel = document.createElement('span');
    pickerLabel.className = 'stims-editor__slider-label';
    pickerLabel.textContent = 'Wave or shape';
    const picker = document.createElement('select');
    picker.className = 'stims-editor__mod-select';
    picker.addEventListener('change', () =>
      this.tuneSlot(picker.value || null),
    );
    this.slotPicker = picker;
    pickerRow.append(pickerLabel, picker);
    this.slotControlsWrap = document.createElement('div');
    this.slotControlsWrap.className = 'stims-editor__slot-controls';
    this.slotWrap.append(pickerRow, this.slotControlsWrap);
    panel.appendChild(this.slotWrap);

    // The pane's one explanation, folded behind a summary so it costs one
    // row instead of three: what the chips say and where a click on one
    // goes. Still present for whoever opens it; no longer in the way of
    // the controls it explains.
    const hint = document.createElement('details');
    hint.className = 'stims-editor__hint-details';
    const hintSummary = document.createElement('summary');
    hintSummary.textContent = 'How Tune works';
    const hintBody = document.createElement('p');
    hintBody.textContent =
      'Controls rewrite the matching line in the draft, so every move stays inspectable as code. The chip beside each one says whether the draft owns that value (set) or the preset recomputes it per frame (eq), and from which audio — naming every driving band (eq · bass, mid, treb). Click a chip to jump to the equation doing it.';
    hint.append(hintSummary, hintBody);
    panel.appendChild(hint);

    return panel;
  }

  /**
   * The Tune pane's wave-or-shape picker, one entry per custom wave and shape
   * the preset defines, marked when it is switched off. Rebuilt only when
   * that list changes, so typing does not close an open picker.
   */
  private paintSlots(compiled: MilkdropEditorSessionState['activeCompiled']) {
    const picker = this.slotPicker;
    if (!picker || !this.slotWrap) return;
    const slots = compiled
      ? [
          ...compiled.ir.customWaves.map((wave) => ({
            name: `wave_${wave.index - 1}`,
            on: Number(wave.fields.enabled ?? 0) > 0,
          })),
          ...compiled.ir.customShapes.map((shape) => ({
            name: `shape_${shape.index - 1}`,
            on: Number(shape.fields.enabled ?? 0) > 0,
          })),
        ]
      : [];
    const signature = slots.map((slot) => `${slot.name}:${slot.on}`).join('|');
    if (signature === this.slotSignature) return;
    this.slotSignature = signature;
    this.slotWrap.hidden = slots.length === 0;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Pick one to tune';
    picker.replaceChildren(
      none,
      ...slots.map((slot) => {
        const option = document.createElement('option');
        option.value = slot.name;
        option.textContent = slot.on ? slot.name : `${slot.name} (off)`;
        return option;
      }),
    );
    if (
      this.tunedSlot !== null &&
      !slots.some((slot) => slot.name === this.tunedSlot)
    ) {
      this.tuneSlot(null);
    } else {
      picker.value = this.tunedSlot ?? '';
    }
  }

  /**
   * Shows one custom wave's or shape's controls in Tune: the selection
   * decides what the properties show, as in Framer. The controls are the
   * pane's own faders, swatches and switches, registered in the same maps,
   * so the buffer keeps them current and each move is a line in the draft.
   */
  tuneSlot(name: string | null) {
    for (const key of this.slotKeys) {
      this.sliderInputs.delete(key);
      this.toggleInputs.delete(key);
    }
    for (const label of this.slotColorLabels) this.colorInputs.delete(label);
    const taken = new Set(this.slotKeys);
    this.fieldStateCells = this.fieldStateCells.filter(
      (cell) => !cell.keys.some((key) => taken.has(key)),
    );
    this.slotKeys = [];
    this.slotColorLabels = [];

    const parsed = name ? parseSlotName(name) : null;
    this.tunedSlot = parsed ? name : null;
    if (this.slotPicker) this.slotPicker.value = this.tunedSlot ?? '';
    const wrap = this.slotControlsWrap;
    if (!wrap) return;
    if (!parsed) {
      wrap.replaceChildren();
      return;
    }

    const controls = slotControls(parsed.kind, parsed.slot);
    const toggles = document.createElement('div');
    toggles.className = 'stims-editor__toggle-bank';
    for (const config of controls.toggles) {
      toggles.appendChild(this.renderToggleControl(config));
    }
    const colors = document.createElement('div');
    colors.className = 'stims-editor__colors';
    for (const group of controls.colors) {
      colors.appendChild(this.renderColorGroup(group));
    }
    const sliders = document.createElement('div');
    sliders.className = 'stims-editor__sliders';
    for (const config of controls.scalars) {
      sliders.appendChild(
        this.renderScalarControl(config, { perFrameField: false }),
      );
    }
    wrap.replaceChildren(toggles, colors, sliders);
    this.slotKeys = [
      ...controls.toggles.map((config) => config.key),
      ...controls.scalars.map((config) => config.key),
      ...controls.colors.flatMap((group) => [
        ...group.rgb,
        ...(group.alpha ? [group.alpha.key] : []),
      ]),
    ];
    this.slotColorLabels = controls.colors.map((group) => group.label);
    this.updateSlidersFromDoc();
    this.updateColorsFromDoc();
    this.updateTogglesFromDoc();
    this.refreshSliderMidiState();
  }

  /** From an Outline row: tune that wave or shape and bring Tune forward. */
  private showSlotInTune(name: string) {
    this.tuneSlot(name);
    this.selectPane?.('tune');
    this.slotWrap?.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Sliders for the preset's own parameters: constants set once in
   * per_frame_init and only read afterwards (see preset-knobs.ts). Rebuilt
   * only when the set of parameters changes, so a drag is never torn down
   * by the recompile it causes.
   */
  private paintKnobs(source: string) {
    const wrap = this.knobsWrap;
    if (!wrap) return;
    const knobs = findPresetKnobs(source);
    const signature = knobs.map((k) => `${k.name}@${k.line}`).join('|');
    if (signature === this.knobsSignature) {
      for (const knob of knobs) {
        const entry = this.knobInputs.get(knob.name);
        if (!entry || entry.input === document.activeElement) continue;
        entry.input.value = String(knob.value);
        entry.display.textContent = formatKnobValue(knob.value);
      }
      return;
    }
    this.knobsSignature = signature;
    this.knobInputs.clear();
    wrap.replaceChildren();
    wrap.hidden = knobs.length === 0;
    if (knobs.length === 0) return;

    const heading = this.createSubhead('Preset parameters');
    heading.title =
      'Values this preset sets once in per_frame_init and only reads afterwards. Moving one rewrites that line.';
    wrap.appendChild(heading);
    for (const knob of knobs) wrap.appendChild(this.renderKnob(knob));
  }

  private renderKnob(knob: PresetKnob): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__slider';
    row.dataset.knob = knob.name;
    const label = document.createElement('label');
    label.className = 'stims-editor__slider-label';
    label.textContent = knob.name;
    label.title = `per_frame_init, line ${knob.line}`;
    const display = document.createElement('span');
    display.className = 'stims-editor__slider-value';
    display.textContent = formatKnobValue(knob.value);
    const controls = document.createElement('div');
    controls.className = 'stims-editor__slider-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'stims-editor__slider-input';
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.step = String((knob.max - knob.min) / 500);
    input.value = String(knob.value);
    input.setAttribute('aria-label', `Preset parameter ${knob.name}`);
    input.addEventListener('input', () => {
      const value = Number(formatKnobValue(Number.parseFloat(input.value)));
      display.textContent = formatKnobValue(value);
      input.setAttribute('aria-valuetext', formatKnobValue(value));
      this.callbacks.onLiveFieldChange?.(knob.name, value);
      this.writeKnobToEditor(knob.name, value);
    });
    controls.appendChild(input);
    // Same shape as every other Tune row: label and value on one line, the
    // fader under them.
    const head = document.createElement('div');
    head.className = 'stims-editor__control-head';
    head.append(label, display);
    row.append(head, controls);
    this.knobInputs.set(knob.name, { input, display });
    return row;
  }

  /** Rewrite one parameter's literal, found fresh in the current buffer. */
  private writeKnobToEditor(name: string, value: number) {
    const doc = this.editor.state.doc;
    const knob = findPresetKnobs(doc.toString()).find((k) => k.name === name);
    if (!knob || knob.line > doc.lines) return;
    const line = doc.line(knob.line);
    this.editor.dispatch({
      changes: {
        from: line.from + knob.from,
        to: line.from + knob.to,
        insert: formatKnobValue(value),
      },
      scrollIntoView: false,
    });
    // Same commit path as every other Tune control: mark the draft queued,
    // repaint, and flush to the engine at the control rate rather than the
    // typing debounce, so a drag recompiles steadily instead of in bursts.
    this.hasBufferedEdits = true;
    this.callbacks.onTuneControlCommit?.();
    if (this.lastSessionState) {
      this.renderSessionState(this.lastSessionState);
    }
    this.scheduleControlFlush();
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
  private renderScalarControl(
    s: ScalarControlConfig,
    {
      perFrameField = true,
    }: {
      /** MIDI-learn and modulation drive a per-frame value, which only a
       * built-in field has; a custom wave or shape field has neither. */
      perFrameField?: boolean;
    } = {},
  ): HTMLElement {
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
    // The label's title hint is hover-only; fold it into the fader's name.
    input.setAttribute(
      'aria-label',
      s.hint ? `${s.label}. ${s.hint}` : s.label,
    );

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

    // Where the preset's own equations put the field on the last frame, on
    // the fader's track. The fader holds the base value; on a field the
    // per-frame code recomputes, that is what the equation starts from or
    // throws away, and this tick is what was drawn.
    const track = document.createElement('div');
    track.className = 'stims-editor__slider-track';
    const liveTick = document.createElement('span');
    liveTick.className = 'stims-editor__live-tick';
    liveTick.hidden = true;
    liveTick.setAttribute('aria-hidden', 'true');
    track.append(input, liveTick);

    controls.append(
      track,
      ...(perFrameField ? [learnButton] : []),
      resetButton,
    );

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
      liveTick,
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

    row.append(
      head,
      controls,
      liveHint,
      ...(perFrameField ? [this.renderModulationRow(s)] : []),
    );
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
      // Option titles never show in most pickers; keep the hint in the
      // accessible name instead.
      option.setAttribute('aria-label', `${source.label}. ${source.hint}`);
      sourceSelect.appendChild(option);
    }

    const modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.className = 'stims-editor__mod-mode';
    // The glyph ('+' / '×') means nothing on its own; updateModulationsFromDoc
    // keeps this name in sync with the current mode.
    modeButton.setAttribute('aria-label', `${s.label} modulation mode`);

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
      const modeHint =
        modulation.mode === 'add'
          ? 'Added to the base value. Click for multiply.'
          : 'Scales the base value. Click for add.';
      item.modeButton.title = modeHint;
      item.modeButton.setAttribute(
        'aria-label',
        `${item.config.label} modulation mode: ${
          modulation.mode === 'add' ? 'add' : 'multiply'
        }. ${modeHint}`,
      );
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
    this.callbacks.onTuneControlCommit?.();
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
    // The hint is part of the accessible name, not just a hover tooltip.
    button.setAttribute('aria-label', `${toggle.label}. ${toggle.hint}`);
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
    // The hint used to live only in the label's title, i.e. hover-only;
    // folding it into the group name gives everyone the same information.
    bank.setAttribute(
      'aria-label',
      config.hint ? `${config.label}. ${config.hint}` : config.label,
    );

    const defaultValue = Math.round(config.defaultValue);
    const buttons: HTMLButtonElement[] = [];
    for (const option of config.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stims-editor__segment';
      button.textContent = option.label;
      if (option.hint) {
        button.title = option.hint;
        // Per-option hints were hover-only too.
        button.setAttribute('aria-label', `${option.label}. ${option.hint}`);
      } else {
        button.title = `${config.label}: ${option.label}`;
      }
      button.setAttribute('role', 'radio');
      button.setAttribute(
        'aria-checked',
        String(option.value === defaultValue),
      );
      button.addEventListener('click', () => {
        this.writeVariableToEditor(config.key, option.value);
        this.updateEnumsFromDoc();
      });
      buttons.push(button);
      bank.appendChild(button);
    }
    // Roving tabindex: the checked radio (or the first, when the default
    // matches no option) is the group's single Tab stop; updateEnumsFromDoc
    // keeps this in sync with the doc afterwards.
    const checkedIndex = config.options.findIndex(
      (option) => option.value === defaultValue,
    );
    buttons.forEach((button, index) => {
      button.tabIndex = index === Math.max(checkedIndex, 0) ? 0 : -1;
    });

    // Radio-group arrow keys: moving focus also selects, per the ARIA
    // pattern (and matching how native radios behave).
    bank.addEventListener('keydown', (event) => {
      const current = buttons.indexOf(event.target as HTMLButtonElement);
      if (current === -1) return;
      let next: number;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (current + 1) % buttons.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (current - 1 + buttons.length) % buttons.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = buttons.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.writeVariableToEditor(config.key, config.options[next].value);
      this.updateEnumsFromDoc();
      buttons[next].focus();
    });

    this.enumInputs.set(config.key, { buttons, config });
    row.append(head, bank);
    return row;
  }

  private updateEnumsFromDoc(): void {
    this.enumInputs.forEach((item, key) => {
      const value = Math.round(
        this.readVariableFromEditor(key) ?? item.config.defaultValue,
      );
      const selectedIndex = item.config.options.findIndex(
        (option) => option.value === value,
      );
      item.config.options.forEach((option, index) => {
        const selected = option.value === value;
        item.buttons[index].dataset.on = selected ? 'true' : 'false';
        item.buttons[index].setAttribute(
          'aria-checked',
          selected ? 'true' : 'false',
        );
        // Keep the roving tab stop on the checked radio; if the doc holds a
        // value outside the enum, fall back to the first option so the
        // group stays Tab-reachable.
        item.buttons[index].tabIndex =
          index === Math.max(selectedIndex, 0) ? 0 : -1;
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
      const boundName = `${config.label} ${which === 'min' ? 'lower' : 'upper'} bound`;
      // The pair's hint otherwise lives only in the label's hover title.
      input.setAttribute(
        'aria-label',
        config.hint ? `${boundName}. ${config.hint}` : boundName,
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
    swatch.setAttribute('aria-label', `${group.label} color`);
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
    resetButton.setAttribute('aria-label', `Reset ${group.label} color`);
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
      this.callbacks.onTuneControlCommit?.();
      if (this.lastSessionState) {
        this.renderSessionState(this.lastSessionState);
      }
      this.scheduleControlFlush();
    }
  }

  /**
   * Throttled flush for continuous control input (slider/swatch drags).
   * Flushing on every `input` event recompiled the preset per pointermove;
   * leading + ~90ms trailing keeps the visual response immediate while
   * bounding recompiles to ~11Hz for the duration of a drag.
   */
  private lastControlFlushAt = 0;
  private controlFlushTimer: number | null = null;
  private scheduleControlFlush(): void {
    const now = performance.now();
    const elapsed = now - this.lastControlFlushAt;
    if (elapsed >= 90) {
      this.lastControlFlushAt = now;
      this.flushEditorDocChange();
      return;
    }
    if (this.controlFlushTimer !== null) return;
    this.controlFlushTimer = window.setTimeout(() => {
      this.controlFlushTimer = null;
      this.lastControlFlushAt = performance.now();
      this.flushEditorDocChange();
    }, 90 - elapsed);
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
    const lines = buildDiffElement(
      computeSourceDiff(currentSource, nextSource),
    );

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
        } else {
          const blended = blendPresetSources(source, sourceB);
          this.proposeAssistedEdit(blended, 'Blend');
        }
        this.setRefinePending(false);
      })
      .catch(() => {
        const blended = blendPresetSources(source, sourceB);
        this.proposeAssistedEdit(blended, 'Blend');
        this.setRefinePending(false);
      });
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
    this.snapshots.push({
      presetId: this.lastPresetId,
      source,
      timestamp: Date.now(),
      label,
    });
    // Cap history so a long editing session doesn't grow this unbounded;
    // only the most recent checkpoints are ever useful to restore. Eight per
    // preset, across the last few presets touched.
    if (this.snapshots.length > 32) {
      this.snapshots.splice(0, this.snapshots.length - 32);
    }
    const mine = this.snapshots.filter(
      (snapshot) => snapshot.presetId === this.lastPresetId,
    );
    if (mine.length > 8) {
      const drop = new Set(mine.slice(0, mine.length - 8));
      this.snapshots = this.snapshots.filter((snapshot) => !drop.has(snapshot));
    }
    this.renderHistorySnapshots();
  }

  private renderHistorySnapshots() {
    if (!this.historyList) return;
    this.historyList.replaceChildren();
    const snapshots = this.snapshots.filter(
      (snapshot) => snapshot.presetId === this.lastPresetId,
    );
    if (snapshots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stims-editor__history-empty';
      empty.textContent = 'No checkpoints yet.';
      this.historyList.appendChild(empty);
      return;
    }
    [...snapshots].reverse().forEach((snapshot) => {
      const row = document.createElement('div');
      row.className = 'stims-editor__history-row';

      const meta = document.createElement('span');
      meta.className = 'stims-editor__history-meta';
      meta.textContent = `${snapshot.label} · ${formatRelativeTime(snapshot.timestamp)}`;

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'stims-editor__btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () =>
        this.restoreSource(snapshot.source),
      );

      row.append(meta, restoreBtn);
      this.historyList?.appendChild(row);
    });
  }
}

/** A `<pre>` of diff lines: `+` added, `-` removed, `\u22ef` a skipped run. */
function buildDiffElement(diff: SourceDiffLine[]): HTMLElement {
  const lines = document.createElement('pre');
  lines.className = 'stims-editor__proposal-lines';
  for (const line of diff) {
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
  return lines;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
