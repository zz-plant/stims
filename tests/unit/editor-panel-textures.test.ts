import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  getTextureSlotOverride,
  loadCustomImageFromFile,
  normalizeSamplerSlotKey,
  resetAllTextureSlotOverrides,
  resetTextureSlotOverride,
  resolveEffectiveTexture,
  setBundledSlotOverride,
  setCustomImageSlotOverride,
  subscribeTextureOverrides,
} from '../../src/js/milkdrop/custom-texture-manager.ts';
import { EditorPanel } from '../../src/js/milkdrop/overlay/editor-panel.ts';
import { collectMilkdropTextureBindings } from '../../src/js/milkdrop/texture-bindings.ts';

/**
 * The Textures tab reports the preset's texture-sampling surface: external
 * samplers with the bundled file the engine binds (and a preview of it),
 * built-ins folded away, and an empty state when nothing external is
 * sampled. Both the analysis and the pane's DOM are covered — the DOM
 * tests through the real panel, per the editor-pane house style.
 */
describe('texture bindings analysis', () => {
  const compile = (source: string) =>
    compileMilkdropPresetSource(source, { id: 'texture-bindings' });

  const TEXTURED = [
    'title=T',
    'zoom=1.01',
    '[warp_shader]',
    'shader_body {',
    '  ret = texture(sampler_main, uv).xyz * 0.98;',
    '}',
    '[comp_shader]',
    'shader_body {',
    '  vec3 n = texture(sampler_perlin, uv).xyz;',
    '  vec3 c = texture(sampler_fw_clouds, uv).xyz;',
    '  vec3 v = tex3D(sampler_voronoi, vec3(uv, q1)).xyz;',
    '  ret = (n + c + v) * 0.33;',
    '}',
  ].join('\n');

  test('external samplers resolve to the bundled files the engine binds', () => {
    const bindings = collectMilkdropTextureBindings(compile(TEXTURED).ir);
    const byName = new Map(
      bindings.external.map((binding) => [binding.name, binding]),
    );
    expect(byName.get('sampler_perlin')?.textureFile).toBe(
      'seamless_perlin_noise.png',
    );
    expect(byName.get('sampler_perlin')?.canonical).toBe('perlin');
    // fw_clouds only resolves through the shared alias table.
    const clouds = byName.get('sampler_fw_clouds');
    expect(clouds?.textureFile).toBe('seamless_perlin_noise.png');
    expect(clouds?.canonical).toBe('perlin');
    expect(clouds?.aliased).toBe(true);
    // Sampled through tex3D, so the backends differ on how it is read.
    expect(byName.get('sampler_voronoi')?.volume).toBe(true);
    expect(byName.get('sampler_perlin')?.volume).toBe(false);
  });

  test('built-in samplers group as internal targets, not external files', () => {
    const bindings = collectMilkdropTextureBindings(compile(TEXTURED).ir);
    const byName = new Map(
      bindings.internal.map((binding) => [binding.name, binding]),
    );
    expect(byName.get('sampler_main')?.target).toBe('the current frame');
    expect(byName.get('sampler_main')?.textureFile).toBeNull();
    expect(bindings.external.map((b) => b.name)).not.toContain('sampler_main');
    expect(byName.size).toBe(1);
  });

  test('a preset without shader blocks samples nothing', () => {
    const bindings = collectMilkdropTextureBindings(
      compile('title=T\nzoom=1.01\nper_frame_1=wave_r = bass;').ir,
    );
    expect(bindings.external).toHaveLength(0);
    expect(bindings.internal).toHaveLength(0);
  });

  test('unknown and rand sampler names resolve the way the engine does', () => {
    const source = [
      'title=T',
      'zoom=1.01',
      '[comp_shader]',
      'shader_body {',
      '  ret = (texture(sampler_zzgh, uv).xyz + texture(sampler_rand00, uv).xyz) * 0.5;',
      '}',
    ].join('\n');
    const bindings = collectMilkdropTextureBindings(compile(source).ir);
    const zzgh = bindings.external.find((b) => b.name === 'sampler_zzgh');
    const rand00 = bindings.external.find((b) => b.name === 'sampler_rand00');
    // No bundled match: the engine's deterministic stand-in, flagged.
    expect(zzgh?.substitute).toBe(true);
    expect(zzgh?.textureFile).toBeTruthy();
    // randNN re-picks from the bundled pool at every preset load.
    expect(rand00?.random).toBe(true);
    expect(rand00?.canonical).toBe('noise');
    expect(rand00?.aliased).toBe(true);
  });

  test('built-in samplers group as internal targets, not external files', () => {
    const source = [
      'title=T',
      'zoom=1.01',
      '[comp_shader]',
      'shader_body {',
      '  vec3 n = texture(sampler_noise_lq, uv).xyz;',
      '  ret = n * 0.5;',
      '}',
    ].join('\n');
    const bindings = collectMilkdropTextureBindings(compile(source).ir);
    const noise = bindings.internal.find(
      (binding) => binding.name === 'sampler_noise_lq',
    );
    // The whole noise family rewrites to `noiseTex`, bound to the bundled
    // noise PNG — internal, so it cannot dominate the external rows.
    expect(noise?.target).toBe('the bundled noise texture');
    expect(noise?.textureFile).toBe('seamless_perlin_noise.png');
    expect(bindings.external).toHaveLength(0);
  });

  test('the noise volume family is marked as a backend-divergent volume', () => {
    const source = [
      'title=T',
      'zoom=1.01',
      '[comp_shader]',
      'shader_body {',
      '  ret = tex3D(sampler_noisevol_lq, vec3(uv, q1)).xyz;',
      '}',
    ].join('\n');
    const bindings = collectMilkdropTextureBindings(compile(source).ir);
    const noisevol = bindings.internal.find((b) => b.name.includes('noisevol'));
    expect(noisevol?.volume).toBe(true);
    expect(noisevol?.canonical).toBe('noisevol');
  });
});

describe('editor panel Textures tab', () => {
  let OriginalMutationObserver: typeof globalThis.MutationObserver;
  beforeAll(() => {
    OriginalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;
  });
  afterAll(() => {
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  const TEXTURED = [
    'title=T',
    'zoom=1.01',
    '[warp_shader]',
    'shader_body {',
    '  ret = texture(sampler_main, uv).xyz * 0.98;',
    '}',
    '[comp_shader]',
    'shader_body {',
    '  vec3 n = texture(sampler_perlin, uv).xyz;',
    '  ret = n * 0.5;',
    '}',
  ].join('\n');
  const PLAIN = 'title=T\nzoom=1.01\n';

  const mount = (
    source: string,
    callbacks: { getActiveBackend?: () => 'webgl' | 'webgpu' | null } = {},
  ) => {
    const panel = new EditorPanel({
      onEditorSourceChange: mock(() => {}),
      onDuplicatePreset: mock(() => {}),
      onExport: mock(() => {}),
      onDeletePreset: mock(() => {}),
      onRequestImport: mock(() => {}),
      onCopyShareLink: mock(() => {}),
      getActiveBackend: callbacks.getActiveBackend,
    });
    document.body.appendChild(panel.element);
    const compiled = compileMilkdropPresetSource(source, {
      id: 'textures-ui',
    });
    panel.setSessionState({
      source,
      diagnostics: compiled.diagnostics,
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: false,
    });
    return panel;
  };

  const pane = (panel: EditorPanel) =>
    panel.element.querySelector<HTMLElement>('#stims-editor-pane-textures');
  const rows = (panel: EditorPanel) =>
    Array.from(
      pane(panel)?.querySelectorAll<HTMLElement>(
        '.stims-editor__texture-row',
      ) ?? [],
    );

  test('renders external rows with the resolved file and a preview of it', () => {
    const panel = mount(TEXTURED);
    expect(
      rows(panel).map((row) => row.querySelector('code')?.textContent),
    ).toEqual(['sampler_perlin']);
    const swatch = rows(panel)[0]?.querySelector('img');
    expect(swatch?.getAttribute('src')).toContain(
      '/textures/seamless_perlin_noise.png',
    );
    // Built-ins fold into the collapsed group, not the headline rows.
    const internal = pane(panel)?.querySelector('details');
    expect(internal?.textContent).toContain('sampler_main');
    expect(internal?.textContent).toContain('the current frame');
    expect(
      pane(panel)?.querySelector('.stims-editor__texture-headline')
        ?.textContent,
    ).toBe('1 external texture.');
    panel.dispose();
  });

  test('a preset with no external textures says so plainly', () => {
    const panel = mount(PLAIN);
    expect(rows(panel)).toHaveLength(0);
    expect(
      pane(panel)?.querySelector('.stims-editor__texture-headline')
        ?.textContent,
    ).toBe('No external textures.');
    panel.dispose();
  });

  test('the tab counts external bindings and the hint names the active backend', () => {
    const panel = mount(TEXTURED, { getActiveBackend: () => 'webgpu' });
    expect(
      panel.element.querySelector<HTMLElement>('[data-pane="textures"]')
        ?.textContent,
    ).toBe('Textures · 1');
    expect(
      pane(panel)?.querySelector('.stims-editor__hint')?.textContent,
    ).toContain('WebGPU is active');
    panel.dispose();
  });

  test('without a backend the pane labels its resolution as the WebGL baseline', () => {
    const panel = mount(TEXTURED);
    expect(
      pane(panel)?.querySelector('.stims-editor__hint')?.textContent,
    ).toContain('WebGL baseline');
    panel.dispose();
  });

  beforeEach(() => {
    resetAllTextureSlotOverrides();
  });
  afterEach(() => {
    resetAllTextureSlotOverrides();
  });

  test('updates when the source changes', () => {
    const panel = mount(TEXTURED);
    const compiled = compileMilkdropPresetSource(PLAIN, {
      id: 'textures-ui2',
    });
    panel.setSessionState({
      source: PLAIN,
      diagnostics: [],
      latestCompiled: compiled,
      activeCompiled: compiled,
      dirty: true,
    });
    expect(rows(panel)).toHaveLength(0);
    expect(
      panel.element.querySelector<HTMLElement>('[data-pane="textures"]')
        ?.textContent,
    ).toBe('Textures');
    panel.dispose();
  });

  test('remapping a slot via select dropdown updates the swatch, label, and registers an override', () => {
    const panel = mount(TEXTURED);
    const row = rows(panel)[0];
    expect(row).toBeDefined();
    if (!row) return;
    const select = row.querySelector<HTMLSelectElement>(
      '.stims-editor__texture-select',
    );
    expect(select).toBeTruthy();
    if (!select) return;

    select.value = 'voronoi_cellular.png';
    select.dispatchEvent(new Event('change'));

    const override = getTextureSlotOverride('sampler_perlin');
    expect(override).toBeTruthy();
    expect(override?.source).toBe('bundled');
    expect(override?.fileName).toBe('voronoi_cellular.png');

    // Row re-renders with new file name and reset button
    const updatedRow = rows(panel)[0];
    expect(updatedRow).toBeDefined();
    if (!updatedRow) return;
    expect(
      updatedRow.querySelector('.stims-editor__texture-file')?.textContent,
    ).toBe('voronoi_cellular.png');
    const swatch = updatedRow.querySelector<HTMLImageElement>(
      '.stims-editor__texture-swatch',
    );
    expect(swatch?.getAttribute('src')).toContain('voronoi_cellular.png');

    const resetBtn = Array.from(
      updatedRow.querySelectorAll<HTMLButtonElement>(
        '.stims-editor__texture-btn',
      ),
    ).find((btn) => btn.textContent === 'Remove image');
    expect(resetBtn).toBeTruthy();

    panel.dispose();
  });

  test('reset button clears the override and restores original texture binding', () => {
    const panel = mount(TEXTURED);
    setBundledSlotOverride('sampler_perlin', 'voronoi_cellular.png');

    let row = rows(panel)[0];
    expect(row).toBeDefined();
    if (!row) return;
    let resetBtn = Array.from(
      row.querySelectorAll<HTMLButtonElement>('.stims-editor__texture-btn'),
    ).find((btn) => btn.textContent === 'Remove image');
    expect(resetBtn).toBeTruthy();

    resetBtn?.click();

    expect(getTextureSlotOverride('sampler_perlin')).toBeNull();
    row = rows(panel)[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.querySelector('.stims-editor__texture-file')?.textContent).toBe(
      'seamless_perlin_noise.png',
    );
    resetBtn = Array.from(
      row.querySelectorAll<HTMLButtonElement>('.stims-editor__texture-btn'),
    ).find((btn) => btn.textContent === 'Remove image');
    expect(resetBtn).toBeUndefined();

    panel.dispose();
  });

  test('custom image override displays thumbnail, dimensions, and format badge', () => {
    const panel = mount(TEXTURED);
    const fakeImg = document.createElement('img');
    fakeImg.width = 640;
    fakeImg.height = 480;
    fakeImg.src = 'data:image/png;base64,custom-preview';

    setCustomImageSlotOverride(
      'sampler_perlin',
      fakeImg,
      'my-nebula.png',
      'PNG (RGBA8)',
      'data:image/png;base64,custom-preview',
    );

    const row = rows(panel)[0];
    expect(row).toBeDefined();
    if (!row) return;
    const swatch = row.querySelector<HTMLImageElement>(
      '.stims-editor__texture-swatch',
    );
    expect(swatch?.src).toBe('data:image/png;base64,custom-preview');
    expect(swatch?.alt).toBe('my-nebula.png');

    const badge = row.querySelector('.stims-editor__texture-override-badge');
    expect(badge?.textContent).toBe('640×480 · PNG (RGBA8)');

    panel.dispose();
  });

  test('drag-and-drop handles dragover, dragleave, and drop events', async () => {
    const panel = mount(TEXTURED);
    const row = rows(panel)[0];
    expect(row).toBeDefined();
    if (!row) return;

    const dragOverEvent = new Event('dragover', {
      bubbles: true,
      cancelable: true,
    });
    row.dispatchEvent(dragOverEvent);
    expect(row.dataset.dragOver).toBe('true');

    const dragLeaveEvent = new Event('dragleave', { bubbles: true });
    row.dispatchEvent(dragLeaveEvent);
    expect(row.dataset.dragOver).toBeUndefined();

    // Drop an image file
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const file = new File([pngBytes], 'dropped.png', { type: 'image/png' });

    const dropEvent = new Event('drop', {
      bubbles: true,
      cancelable: true,
    }) as Event & { dataTransfer?: { files: File[] } };
    dropEvent.dataTransfer = { files: [file] };

    row.dispatchEvent(dropEvent);
    // Allow async load to complete
    await new Promise((r) => setTimeout(r, 60));

    const override = getTextureSlotOverride('sampler_perlin');
    expect(override).toBeTruthy();
    expect(override?.fileName).toBe('dropped.png');

    panel.dispose();
  });
});

describe('custom texture manager', () => {
  beforeEach(() => {
    resetAllTextureSlotOverrides();
  });
  afterEach(() => {
    resetAllTextureSlotOverrides();
  });

  test('normalizeSamplerSlotKey strips sampler_ prefix and normalizes casing', () => {
    expect(normalizeSamplerSlotKey('sampler_main')).toBe('main');
    expect(normalizeSamplerSlotKey('SAMPLER_FW_CLOUDS')).toBe('fw_clouds');
    expect(normalizeSamplerSlotKey('sampler_perlin')).toBe('perlin');
    expect(normalizeSamplerSlotKey('noise')).toBe('noise');
  });

  test('bundled override registration, listener dispatch, and resolution', () => {
    let notified = 0;
    const unsub = subscribeTextureOverrides(() => {
      notified += 1;
    });

    const override = setBundledSlotOverride(
      'sampler_perlin',
      'water_caustics.png',
    );
    expect(notified).toBe(1);
    expect(override.source).toBe('bundled');
    expect(override.fileName).toBe('water_caustics.png');

    const retrieved = getTextureSlotOverride('sampler_perlin');
    expect(retrieved).toBe(override);

    const effective = resolveEffectiveTexture(
      'sampler_perlin',
      'seamless_perlin_noise.png',
    );
    expect(effective).toBe(override.texture);

    const resetResult = resetTextureSlotOverride('sampler_perlin');
    expect(resetResult).toBe(true);
    expect(notified).toBe(2);
    expect(getTextureSlotOverride('sampler_perlin')).toBeNull();

    unsub();
  });

  test('resolveEffectiveTexture falls back to default texture or null', () => {
    expect(getTextureSlotOverride('sampler_clouds')).toBeNull();
    const fallback = resolveEffectiveTexture(
      'sampler_clouds',
      'seamless_perlin_noise.png',
    );
    expect(fallback).toBeTruthy();

    const empty = resolveEffectiveTexture('sampler_missing', null);
    expect(empty).toBeNull();
  });

  test('loadCustomImageFromFile parses image and returns dimensions and data URL', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const file = new File([pngBytes], 'sample.png', { type: 'image/png' });

    const result = await loadCustomImageFromFile(file);
    expect(result.format).toBe('PNG (RGBA8)');
    expect(result.previewUrl).toContain('data:image/png;base64');
    expect(result.image).toBeTruthy();
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
