/**
 * The Textures pane: the texture-sampling surface of the compiled preset.
 * Every external sampler gets a row with the bundled texture file the
 * engine will bind and a preview of that file; the built-in samplers (frame
 * buffers, blur passes, noise) fold into a collapsed group below, so the
 * external bindings stay the picture instead of the noise.
 *
 * Previews are plain `<img>` tags at the same `/textures/<file>` URLs the
 * engine loads its three.js textures from (`resolveTextureUrl`) — no new
 * asset pipeline, and the browser cache the renderer already primed serves
 * the swatches.
 */
import { resolveTextureUrl } from '../feedback-texture-utils.ts';
import {
  collectMilkdropTextureBindings,
  type MilkdropTextureBinding,
  type MilkdropTextureBindings,
} from '../texture-bindings.ts';
import type { MilkdropEditorSessionState } from '../types';
import type { EditorPaneHost } from './editor-pane-host.ts';

export type TexturesPaneOptions = {
  /**
   * The backend the stage is rendering with right now, or null when the
   * panel's caller cannot tell. Volume samples differ between backends —
   * WebGL slices a bundled 2D atlas, WebGPU reads native 3D volumes — so
   * the pane says which view it is showing rather than guessing.
   */
  getActiveBackend?: () => 'webgl' | 'webgpu' | null;
};

export class TexturesPane {
  readonly element: HTMLElement;
  private headline: HTMLElement;
  private hint: HTMLElement;
  private list: HTMLElement;
  private internal: HTMLDetailsElement;
  private internalLabel: HTMLElement;
  private internalList: HTMLElement;
  private tab: HTMLButtonElement | null = null;

  constructor(
    _host: EditorPaneHost,
    private readonly options: TexturesPaneOptions = {},
  ) {
    this.element = document.createElement('div');
    this.headline = document.createElement('p');
    this.headline.className = 'stims-editor__texture-headline';
    this.hint = document.createElement('p');
    this.hint.className = 'stims-editor__hint';
    this.list = document.createElement('div');
    this.list.className = 'stims-editor__textures';
    this.list.setAttribute('role', 'list');
    this.internal = document.createElement('details');
    this.internal.className = 'stims-editor__texture-internal';
    this.internalLabel = document.createElement('summary');
    this.internalList = document.createElement('div');
    this.internalList.className = 'stims-editor__texture-internal-list';
    this.internalList.setAttribute('role', 'list');
    this.internal.append(this.internalLabel, this.internalList);
    this.element.append(this.headline, this.hint, this.list, this.internal);
  }

  /** The dock tab, which counts the external bindings. */
  bindTab(tab: HTMLButtonElement) {
    this.tab = tab;
  }

  update(state: MilkdropEditorSessionState) {
    const compiled = state.latestCompiled;
    if (!compiled) {
      this.paint(null);
      return;
    }
    this.paint(collectMilkdropTextureBindings(compiled.ir));
  }

  private paint(bindings: MilkdropTextureBindings | null) {
    const external = bindings?.external ?? [];
    const internal = bindings?.internal ?? [];
    this.headline.textContent =
      external.length === 0
        ? 'No external textures.'
        : external.length === 1
          ? '1 external texture.'
          : `${external.length} external textures.`;
    this.paintHint();
    this.list.replaceChildren(
      ...external.map((binding) => this.buildExternalRow(binding)),
    );
    this.internal.hidden = internal.length === 0;
    this.internalLabel.textContent = `Built-in samplers · ${internal.length}`;
    this.internalList.replaceChildren(
      ...internal.map((binding) => this.buildInternalRow(binding)),
    );
    if (this.tab) {
      this.tab.textContent =
        external.length > 0 ? `Textures · ${external.length}` : 'Textures';
    }
  }

  private paintHint() {
    const backend = this.options.getActiveBackend?.() ?? null;

    // The external rows name real files both backends bind identically;
    // only the volume reads differ, so the hint qualifies just those.
    const backendSentence =
      backend === 'webgpu'
        ? 'WebGPU is active; volume samples read native 3D textures.'
        : backend === 'webgl'
          ? 'WebGL is active; volume samples slice the bundled 2D atlas.'
          : 'Resolutions are the WebGL baseline; on WebGPU, volume samples read native 3D textures instead of atlas slices.';
    this.hint.textContent = `Each sampler resolves through the bundled texture table — the exact file the engine binds. ${backendSentence}`;
  }

  /** One external binding: preview, name, resolved file, sample mode. */
  private buildExternalRow(binding: MilkdropTextureBinding): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__texture-row';
    row.setAttribute('role', 'listitem');
    const file = binding.textureFile;
    const swatch = document.createElement('img');
    swatch.className = 'stims-editor__texture-swatch';
    if (file) {
      swatch.src = resolveTextureUrl(file);
      swatch.alt = file;
    } else {
      swatch.hidden = true;
    }
    const main = document.createElement('div');
    main.className = 'stims-editor__texture-main';
    const nameLine = document.createElement('p');
    nameLine.className = 'stims-editor__texture-name';
    const name = document.createElement('code');
    name.textContent = binding.name;
    nameLine.append(name);
    if (file) {
      const arrow = document.createElement('span');
      arrow.className = 'stims-editor__texture-file';
      arrow.textContent = file;
      nameLine.appendChild(arrow);
    }
    const notes = document.createElement('p');
    notes.className = 'stims-editor__texture-notes';
    notes.textContent = this.describeExternal(binding);
    main.append(nameLine, notes);
    row.append(swatch, main);
    return row;
  }

  private describeExternal(binding: MilkdropTextureBinding): string {
    const notes: string[] = [];
    if (binding.aliased && binding.canonical) {
      notes.push(`alias of sampler_${binding.canonical}`);
    }
    if (binding.substitute) {
      notes.push('no bundled match; closest substitute');
    }
    if (binding.random) {
      notes.push('re-picked from the bundled pool at every preset load');
    }
    if (binding.volume) {
      notes.push('3D volume sample');
    }
    if (binding.filter) notes.push(binding.filter);
    if (binding.wrap) notes.push(binding.wrap);
    return notes.join(' · ');
  }

  /** One built-in sampler: name and what it reads, no preview. */
  private buildInternalRow(binding: MilkdropTextureBinding): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stims-editor__texture-builtin-row';
    row.setAttribute('role', 'listitem');
    const name = document.createElement('code');
    name.textContent = binding.name;
    const label = document.createElement('span');
    const detail = binding.textureFile
      ? `${binding.target} (${binding.textureFile})`
      : (binding.target ?? '');
    label.textContent = ` ${detail}`;
    if (binding.volume) {
      label.dataset.volume = 'true';
    }
    row.append(name, label);
    return row;
  }
}
