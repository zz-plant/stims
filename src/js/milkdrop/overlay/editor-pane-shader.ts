/**
 * The Shader pane: a preset's warp and comp shader blocks as first-class
 * editor citizens.
 *
 * Three instruments over the same two blocks:
 * - the authored segments (the block-aware source model from Phase A),
 *   one row each, jumping to its `[warp_shader]` / `[comp_shader]`
 *   header line in the document;
 * - the engine's structured shader compile diagnostics — which program
 *   failed, at which stage, with the driver's message — each mapped back
 *   to the authored block it belongs to. Before this pane a program that
 *   failed to build was visible only as the stage silently going dark;
 * - a collapsible read-only view of the GLSL the WebGL path compiles for
 *   each block (describeShaderTranslations — the same text the renderer
 *   compiles) beside each backend's execution mode. An instrument, not a
 *   second buffer: the CodeMirror document stays the only editable
 *   surface.
 *
 * WGSL is not shown. The WebGPU path lowers a MilkDrop shader through
 * three's TSL node graphs at render time (feedback-manager-webgpu-tsl.ts),
 * so the WGSL text only exists inside a live GPUDevice's pipeline; the
 * toolchain's wgsl-generator.ts emits EEL compute programs, not shader
 * blocks. The pane reports WebGPU's execution mode instead.
 *
 * Diagnostics are pulled from the module registry the renderer adapter's
 * `getShaderCompileDiagnostics()` reads — the recording points are the
 * same. Each row is labelled by its record's own `backend`, because the
 * dock pane has no path to the live adapter to ask which backend is
 * running; only one backend records at a time, so the label is the whole
 * story. The registry is a bounded ring, so the list is bounded by
 * construction.
 */
import {
  findMilkdropShaderSegment,
  type MilkdropPresetSegment,
  splitMilkdropPresetSegments,
} from 'milkdrop-toolchain/src/preset-segments.ts';
import {
  describeExecutionMode,
  describeShaderTranslations,
  type ShaderStage,
  type ShaderTranslation,
} from 'milkdrop-toolchain/src/shader-translation.ts';
import {
  getMilkdropShaderCompileDiagnostics,
  type MilkdropShaderCompileDiagnostic,
} from '../shader-compile-diagnostics.ts';
import type { MilkdropEditorSessionState } from '../types';
import type { EditorPaneHost } from './editor-pane-host.ts';

/** The Shader pane's pointer for presets with no shader blocks. Kept to
 * one sentence: the authoring guide is the documentation, not the pane. */
const NO_SHADER_BLOCKS_HINT =
  'No shader blocks in this preset — its look comes from equations alone. docs/authoring/06-shaders.md shows how to add a warp or comp shader.';

const NO_COMPILE_FAILURES_HINT =
  'No shader compile failures recorded on any backend.';

/** Bounded by construction: a stage set can hold at most 'warp' and
 * 'comp', one entry each. */
const SHADER_STAGES: readonly ShaderStage[] = ['warp', 'comp'];

function shaderSegmentLabel(stage: ShaderStage): string {
  return `[${stage}_shader]`;
}

export class ShaderPane {
  readonly element: HTMLElement;
  private segmentList: HTMLElement | null = null;
  private diagnosticsList: HTMLElement | null = null;
  private shaderTab: HTMLButtonElement | null = null;
  /** Stages whose lowered GLSL is expanded; kept across repaints so
   * typing does not collapse it. Bounded to SHADER_STAGES' two entries. */
  private readonly expandedStages = new Set<ShaderStage>();

  constructor(private readonly host: EditorPaneHost) {
    this.element = this.renderShaderPane();
  }

  private renderShaderPane(): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'stims-editor__shader-pane';
    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'The shader blocks this preset runs: where they are, whether they built, and what the GPU compiles.';
    const segments = document.createElement('div');
    segments.className = 'stims-editor__shader-list';
    segments.setAttribute('role', 'list');
    const failures = document.createElement('h3');
    failures.className = 'stims-editor__compat-section';
    failures.textContent = 'Compile failures';
    const diagnostics = document.createElement('div');
    diagnostics.className = 'stims-editor__shader-list';
    diagnostics.setAttribute('role', 'list');
    pane.append(hint, segments, failures, diagnostics);
    this.segmentList = segments;
    this.diagnosticsList = diagnostics;
    return pane;
  }

  private paintSegments(state: MilkdropEditorSessionState): void {
    const list = this.segmentList;
    if (!list) return;
    const segments = splitMilkdropPresetSegments(state.source).filter(
      (
        segment,
      ): segment is MilkdropPresetSegment & {
        kind: 'shader';
        stage: ShaderStage;
      } => segment.kind === 'shader',
    );
    if (segments.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'stims-editor__hint';
      empty.textContent = NO_SHADER_BLOCKS_HINT;
      list.replaceChildren(empty);
      return;
    }
    const translations = state.latestCompiled
      ? describeShaderTranslations(state.latestCompiled)
      : [];
    list.replaceChildren(
      ...segments.map((segment) =>
        this.renderSegmentEntry(segment, translations),
      ),
    );
  }

  /** One shader segment: a row jumping to the block's header line, plus
   * a collapsible read-only view of the GLSL the WebGL path compiles. */
  private renderSegmentEntry(
    segment: MilkdropPresetSegment & { kind: 'shader'; stage: ShaderStage },
    translations: ShaderTranslation[],
  ): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'stims-editor__shader-row';
    row.setAttribute('role', 'listitem');
    row.dataset.stage = segment.stage;
    row.dataset.firstLine = String(segment.startLine);
    const label = document.createElement('code');
    label.textContent = shaderSegmentLabel(segment.stage);
    const range = document.createElement('span');
    range.className = 'stims-editor__outline-range';
    range.textContent =
      segment.startLine === segment.endLine
        ? `line ${segment.startLine}`
        : `lines ${segment.startLine}\u2013${segment.endLine}`;
    row.append(label, range);
    row.addEventListener('click', () => {
      if (segment.startLine > this.host.editor.state.doc.lines) return;
      const target = this.host.editor.state.doc.line(segment.startLine);
      this.host.editor.dispatch({
        selection: { anchor: target.from, head: target.to },
        scrollIntoView: true,
      });
      this.host.editor.focus();
    });
    const translation = translations.find(
      (candidate) => candidate.stage === segment.stage,
    );
    return translation ? this.renderLoweredEntry(row, translation) : row;
  }

  /** The segment row plus its read-only lowered view. Never editable: a
   * `<pre>` is not a buffer, and edits belong in the document. */
  private renderLoweredEntry(
    row: HTMLElement,
    translation: ShaderTranslation,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'stims-editor__outline-shader';
    wrap.dataset.shaderStage = translation.stage;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'stims-editor__btn stims-editor__outline-glsl';
    toggle.textContent = 'Show GLSL';
    const detail = document.createElement('div');
    detail.className = 'stims-editor__shader-translation';
    const note = document.createElement('p');
    note.className = 'stims-editor__hint';
    note.textContent = `${
      translation.path === 'body'
        ? 'The shader body, converted from HLSL to GLSL as a whole.'
        : translation.path === 'statements'
          ? 'Rebuilt in GLSL from the shader\u2019s parsed statements.'
          : 'No GLSL was produced for this stage.'
    } WebGL ${describeExecutionMode(translation.execution.webgl)}; WebGPU ${describeExecutionMode(translation.execution.webgpu)}.`;
    detail.appendChild(note);
    if (translation.glsl) {
      const code = document.createElement('pre');
      code.className = 'stims-editor__proposal-lines';
      code.textContent = translation.glsl;
      detail.appendChild(code);
    }
    const setOpen = (open: boolean) => {
      detail.hidden = !open;
      toggle.textContent = open ? 'Hide GLSL' : 'Show GLSL';
      toggle.setAttribute('aria-expanded', String(open));
      if (open) this.expandedStages.add(translation.stage);
      else this.expandedStages.delete(translation.stage);
    };
    toggle.addEventListener('click', () =>
      setOpen(!this.expandedStages.has(translation.stage)),
    );
    setOpen(this.expandedStages.has(translation.stage));
    wrap.append(row, toggle, detail);
    return wrap;
  }

  private paintDiagnostics(state: MilkdropEditorSessionState): void {
    const list = this.diagnosticsList;
    if (!list) return;
    const records = getMilkdropShaderCompileDiagnostics();
    if (this.shaderTab) {
      this.shaderTab.textContent =
        records.length > 0 ? `Shader \u00b7 ${records.length}` : 'Shader';
      this.shaderTab.dataset.tone = records.length > 0 ? 'danger' : 'muted';
    }
    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'stims-editor__hint';
      empty.textContent = NO_COMPILE_FAILURES_HINT;
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...records.map((record) => this.renderDiagnosticRow(record, state)),
    );
  }

  /** One compile failure. Jumps to the authored block's header line when
   * the record's program maps to one in the live source; driver messages
   * number lines in the *emitted* GLSL, not the authored source, so the
   * block header is the honest jump target. */
  private renderDiagnosticRow(
    record: MilkdropShaderCompileDiagnostic,
    state: MilkdropEditorSessionState,
  ): HTMLElement {
    const stage: ShaderStage | null =
      SHADER_STAGES.find((candidate) => candidate === record.program) ?? null;
    const segment =
      stage !== null ? findMilkdropShaderSegment(state.source, stage) : null;
    const row = document.createElement(segment ? 'button' : 'div');
    if (row instanceof HTMLButtonElement) row.type = 'button';
    row.className = 'stims-editor__shader-diag';
    row.setAttribute('role', 'listitem');
    row.dataset.program = record.program;
    const head = document.createElement('span');
    head.className = 'stims-editor__shader-diag-head';
    const badge = document.createElement('span');
    badge.className = 'stims-editor__compat-badge';
    badge.textContent = `${record.backend} \u00b7 ${record.stage}`;
    const title = document.createElement('strong');
    title.textContent =
      record.program === 'unknown'
        ? 'A shader outside the feedback chain'
        : `${record.program} shader failed to build`;
    head.append(badge, title);
    if (segment) {
      const where = document.createElement('span');
      where.className = 'stims-editor__compat-line';
      where.textContent = `line ${segment.startLine}`;
      head.appendChild(where);
    }
    const message = document.createElement('span');
    message.className = 'stims-editor__shader-diag-message';
    message.textContent = record.message;
    row.append(head, message);
    if (segment && row instanceof HTMLButtonElement) {
      row.addEventListener('click', () => {
        if (segment.startLine > this.host.editor.state.doc.lines) return;
        const target = this.host.editor.state.doc.line(segment.startLine);
        this.host.editor.dispatch({
          selection: { anchor: target.from, head: target.to },
          scrollIntoView: true,
        });
        this.host.editor.focus();
      });
    }
    return row;
  }

  /** The dock tab, which counts recorded failures until they are read. */
  bindTab(tab: HTMLButtonElement) {
    this.shaderTab = tab;
  }

  update(state: MilkdropEditorSessionState) {
    this.paintSegments(state);
    this.paintDiagnostics(state);
  }
}
