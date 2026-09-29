/**
 * The Outline pane: the buffer's editable parts with line ranges, the GLSL
 * each shader becomes, and solo/mute for each custom wave and shape.
 */
import { buildPresetOutline } from '../preset-outline.ts';
import {
  getRenderIsolation,
  type IsolatedElement,
  type IsolationKind,
  toggleMute,
  toggleSolo,
} from '../render-isolation.ts';
import {
  describeExecutionMode,
  describeShaderTranslations,
  type ShaderStage,
} from '../shader-translation.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
} from '../types';
import type { EditorPaneHost } from './editor-pane-host.ts';

export class OutlinePane {
  readonly element: HTMLElement;
  private outlineList: HTMLElement | null = null;
  /** Shader stages whose translation is expanded; kept across repaints so
   * typing does not collapse it. */
  private readonly expandedShaderStages = new Set<ShaderStage>();
  /** The preset the solo/mute toggles act on. */
  private outlinePresetId: string | null = null;

  constructor(private readonly host: EditorPaneHost) {
    this.element = this.renderOutlinePane();
  }

  /** Outline pane: the buffer's editable parts (settings, equations, each
   * custom wave and shape, both shaders) with line ranges. Real presets run
   * to hundreds of lines; this is the way to move around one. */
  private renderOutlinePane(): HTMLElement {
    const pane = document.createElement('div');
    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'The parts of this preset. Click one to jump to it; solo or mute a wave or shape to see what it draws.';
    this.outlineList = document.createElement('div');
    this.outlineList.className = 'stims-editor__outline';
    this.outlineList.setAttribute('role', 'list');
    pane.append(hint, this.outlineList);
    return pane;
  }
  private paintOutline(
    source: string,
    compiled: MilkdropCompiledPreset | null = null,
  ) {
    const list = this.outlineList;
    if (!list) return;
    const entries = buildPresetOutline(source);
    const translations = compiled ? describeShaderTranslations(compiled) : [];
    const isolatedSlots = new Set<string>();
    this.outlinePresetId = compiled?.source.id ?? null;
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'stims-editor__hint';
      empty.textContent = 'Nothing to outline yet.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...entries.map((entry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'stims-editor__outline-row';
        row.setAttribute('role', 'listitem');
        row.dataset.kind = entry.kind;
        row.dataset.firstLine = String(entry.firstLine);
        const label = document.createElement('code');
        label.textContent = entry.label;
        const range = document.createElement('span');
        range.className = 'stims-editor__outline-range';
        range.textContent =
          entry.firstLine === entry.lastLine
            ? `line ${entry.firstLine}`
            : `lines ${entry.firstLine}\u2013${entry.lastLine}`;
        row.append(label, range);
        row.addEventListener('click', () => {
          if (entry.firstLine > this.host.editor.state.doc.lines) return;
          const target = this.host.editor.state.doc.line(entry.firstLine);
          this.host.editor.dispatch({
            selection: { anchor: target.from },
            scrollIntoView: true,
          });
          this.host.editor.focus();
        });
        const stage: ShaderStage | null =
          entry.kind === 'warp-shader'
            ? 'warp'
            : entry.kind === 'comp-shader'
              ? 'comp'
              : null;
        const translation = stage
          ? translations.find((t) => t.stage === stage)
          : undefined;
        if (stage && translation) {
          return this.renderShaderOutlineEntry(row, translation);
        }
        const slot = /^(wave|shape)_(\d+)\b/u.exec(entry.label);
        const presetId = compiled?.source.id;
        if (!slot || !presetId) return row;
        // One set of toggles per slot, on its first part (settings or code).
        const slotKey = `${slot[1]}_${slot[2]}`;
        if (isolatedSlots.has(slotKey)) return row;
        isolatedSlots.add(slotKey);
        return this.renderIsolationEntry(row, presetId, {
          kind: slot[1] as IsolationKind,
          // The file counts slots from 0; the renderer from 1.
          index: Number(slot[2]) + 1,
        });
      }),
    );
    this.syncIsolationToggles();
  }
  /** A wave or shape Outline row plus Solo and Mute toggles. */
  private renderIsolationEntry(
    row: HTMLElement,
    presetId: string,
    element: IsolatedElement,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'stims-editor__outline-slot';
    const makeToggle = (label: string, action: 'solo' | 'mute') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stims-editor__btn stims-editor__outline-isolate';
      button.textContent = label;
      button.dataset.isolate = action;
      button.dataset.isolateKind = element.kind;
      button.dataset.isolateIndex = String(element.index);
      button.setAttribute(
        'aria-label',
        `${label} ${element.kind}_${element.index - 1}`,
      );
      button.addEventListener('click', () => {
        if (action === 'solo') toggleSolo(presetId, element);
        else toggleMute(presetId, element);
        this.syncIsolationToggles();
      });
      return button;
    };
    wrap.append(row, makeToggle('Solo', 'solo'), makeToggle('Mute', 'mute'));
    return wrap;
  }
  /** Reflect the current solo/mute state on every Outline toggle. */
  private syncIsolationToggles() {
    const isolation = getRenderIsolation();
    const presetId = this.outlinePresetId;
    this.outlineList
      ?.querySelectorAll<HTMLButtonElement>('[data-isolate]')
      .forEach((button) => {
        const kind = button.dataset.isolateKind;
        const index = Number(button.dataset.isolateIndex);
        const active =
          isolation !== null && isolation.presetId === presetId
            ? button.dataset.isolate === 'solo'
              ? isolation.solo?.kind === kind && isolation.solo?.index === index
              : isolation.muted.some(
                  (entry) => entry.kind === kind && entry.index === index,
                )
            : false;
        button.setAttribute('aria-pressed', String(active));
      });
  }
  /** A shader's Outline row plus a toggle showing what the GPU compiles. */
  private renderShaderOutlineEntry(
    row: HTMLElement,
    translation: ReturnType<typeof describeShaderTranslations>[number],
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
        ? 'Your shader body, converted from HLSL to GLSL as a whole.'
        : translation.path === 'statements'
          ? 'Rebuilt in GLSL from your shader\u2019s parsed statements.'
          : 'No GLSL was produced for this stage.'
    } WebGL ${describeExecutionMode(translation.execution.webgl)}; WebGPU ${describeExecutionMode(translation.execution.webgpu)}.`;
    detail.appendChild(note);
    if (translation.glsl) {
      const code = document.createElement('pre');
      code.className = 'stims-editor__proposal-lines';
      code.textContent = translation.glsl;
      detail.appendChild(code);
    }
    let isOpen = false;
    const setOpen = (open: boolean) => {
      isOpen = open;
      detail.hidden = !open;
      toggle.textContent = open ? 'Hide GLSL' : 'Show GLSL';
      toggle.setAttribute('aria-expanded', String(open));
      if (open) this.expandedShaderStages.add(translation.stage);
      else this.expandedShaderStages.delete(translation.stage);
    };
    toggle.addEventListener('click', () => setOpen(!isOpen));
    setOpen(this.expandedShaderStages.has(translation.stage));
    wrap.append(row, toggle, detail);
    return wrap;
  }

  update(state: MilkdropEditorSessionState) {
    this.paintOutline(state.source, state.latestCompiled);
  }
}
