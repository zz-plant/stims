// Playground: runs the library bundle (built by scripts/build-site.ts from the
// same dist/ the package ships) against the preset in the textarea and renders
// each output panel. Every panel catches its own errors so a failure in one
// (or a preset the compiler rejects) never blanks the page.

const pg = document.getElementById('pg');
const sourceEl = document.getElementById('source');
const statusEl = document.getElementById('status');
const compileBtn = document.getElementById('compile');
const panels = {
  diagnostics: document.getElementById('diagnostics'),
  ir: document.getElementById('ir'),
  dataflow: document.getElementById('dataflow'),
  wgsl: document.getElementById('wgsl'),
  formatted: document.getElementById('tab-formatted'),
  md2: document.getElementById('tab-md2'),
  glsl: document.getElementById('tab-glsl'),
};
const exprEl = document.getElementById('expr');
const envEl = document.getElementById('env');
const exprValueEl = document.getElementById('expr-value');
const exprDiagEl = document.getElementById('expr-diag');

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'copied';
      setTimeout(() => {
        button.textContent = 'copy';
      }, 1200);
    } catch {
      button.textContent = 'select it';
    }
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function errorHtml(error) {
  const text = error instanceof Error ? error.message : String(error);
  return `<p class="err">${escapeHtml(text)}</p>`;
}

/** Render into a panel, turning a thrown error into visible text. */
function fill(el, render) {
  try {
    el.innerHTML = render();
  } catch (error) {
    el.innerHTML = errorHtml(error);
  }
}

function pre(text) {
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

function badge(text, cls = '') {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

const SEVERITY_CLASS = { error: 'bad', warning: 'warn', info: '' };

function renderDiagnostics(diagnostics) {
  if (diagnostics.length === 0) {
    return '<p class="empty">No diagnostics. The preset compiled clean.</p>';
  }
  const items = diagnostics.map((d) => {
    const where = [
      d.line !== undefined ? `line ${d.line}` : null,
      d.field ? `field ${d.field}` : null,
      d.category ?? null,
    ]
      .filter(Boolean)
      .join(' · ');
    return `<li>${badge(d.severity, SEVERITY_CLASS[d.severity] ?? '')}<span><code>${escapeHtml(
      d.code,
    )}</code> ${escapeHtml(d.message)}</span>${
      where ? `<span class="where">${escapeHtml(where)}</span>` : ''
    }</li>`;
  });
  return `<ul class="diag">${items.join('')}</ul>`;
}

const FIDELITY_CLASS = {
  exact: 'ok',
  'near-exact': 'ok',
  partial: 'warn',
  fallback: 'bad',
};
const FIELDS_OF_INTEREST = [
  'decay',
  'wave_mode',
  'wave_a',
  'wave_scale',
  'zoom',
  'rot',
  'warp',
  'gammaadj',
];

function renderIr(T, compiled) {
  const { ir } = compiled;
  const parity = ir.compatibility.parity;
  const translations = T.describeShaderTranslations(compiled);
  const stageRow = (stage, ast) => {
    const t = translations.find((x) => x.stage === stage);
    if (!t)
      return `<tr><td><code>${stage}</code></td><td colspan="2" class="muted">absent</td></tr>`;
    return `<tr><td><code>${stage}</code></td><td class="stat">${ast.length} statement${
      ast.length === 1 ? '' : 's'
    }</td><td>WebGL ${escapeHtml(T.describeExecutionMode(t.execution.webgl))}; WebGPU ${escapeHtml(
      T.describeExecutionMode(t.execution.webgpu),
    )}</td></tr>`;
  };
  const enabled = (slot) => Number(slot.fields.enabled) > 0;
  const fieldRows = FIELDS_OF_INTEREST.map(
    (key) =>
      `<tr><td><code>${key}</code></td><td class="stat">${
        ir.numericFields[key] === undefined
          ? '<span class="muted">unset</span>'
          : escapeHtml(ir.numericFields[key])
      }</td></tr>`,
  ).join('');
  return `
    <dl class="kv">
      <dt>fidelity</dt><dd id="fidelity">${badge(parity.fidelityClass, FIDELITY_CLASS[parity.fidelityClass] ?? '')}</dd>
      <dt>title</dt><dd>${escapeHtml(ir.title)}${ir.author ? ` <span class="muted">by ${escapeHtml(ir.author)}</span>` : ''}</dd>
      <dt>init</dt><dd class="stat">${ir.programs.init.statements.length} statements</dd>
      <dt>per_frame</dt><dd class="stat">${ir.programs.perFrame.statements.length} statements</dd>
      <dt>per_pixel</dt><dd class="stat">${ir.programs.perPixel.statements.length} statements</dd>
      <dt>custom waves</dt><dd class="stat">${ir.customWaves.filter(enabled).length} enabled of ${ir.customWaves.length}</dd>
      <dt>custom shapes</dt><dd class="stat">${ir.customShapes.filter(enabled).length} enabled of ${ir.customShapes.length}</dd>
      <dt>registers</dt><dd class="stat">q: ${ir.compatibility.featureAnalysis.registerUsage.q}, t: ${ir.compatibility.featureAnalysis.registerUsage.t}</dd>
      <dt>features</dt><dd>${ir.compatibility.featureAnalysis.featuresUsed.map((f) => `<code>${escapeHtml(f)}</code>`).join(' ') || '<span class="muted">none</span>'}</dd>
      <dt>backends</dt><dd>WebGL ${escapeHtml(ir.compatibility.backends.webgl.status)}, WebGPU ${escapeHtml(ir.compatibility.backends.webgpu.status)}</dd>
    </dl>
    <h3 style="margin-top:12px">Fields <code>ir.numericFields · ${Object.keys(ir.numericFields).length} normalized names</code></h3>
    <table>${fieldRows}</table>
    <h3 style="margin-top:12px">Shader stages <code>ir.shaderText</code></h3>
    <table>${stageRow('warp', ir.shaderText.warpAst)}${stageRow('comp', ir.shaderText.compAst)}</table>
    ${
      ir.shaderText.unsupportedLines.length
        ? `<p class="empty" style="margin-top:8px">${ir.shaderText.unsupportedLines.length} shader line(s) outside the supported subset.</p>`
        : ''
    }`;
}

function renderWgsl(T, compiled) {
  const block = compiled.ir.programs.perFrame;
  if (block.statements.length === 0) {
    return '<p class="empty">No per-frame statements, so nothing to lower. Add a <code>per_frame_N=</code> line.</p>';
  }
  const result = T.compileProgramToWgsl(block);
  const code = result.wgslCode;
  const start = code.indexOf('@compute');
  const main = start >= 0 ? code.slice(start) : code;
  const lines = code.split('\n').length;
  return `<pre class="wgsl-main"><code>${escapeHtml(main)}</code></pre>
    <p class="empty" style="margin-top:8px">registers: ${
      result.registerKeys.length
        ? result.registerKeys
            .map((k) => `<code>${escapeHtml(k)}</code>`)
            .join(' ')
        : 'none'
    } · ${result.fieldKeys.length} <code>VmState</code> fields${result.usesRandom ? ' · uses rand()' : ''}${
      result.usesMegabuf || result.usesGmegabuf ? ' · uses guest memory' : ''
    }</p>
    <details class="more"><summary>Full WGSL (${lines} lines: structs, EEL helper functions, main)</summary>${pre(code)}</details>`;
}

const KIND_CLASS = {
  audio: 'kind-audio',
  clockwork: 'kind-clockwork',
  pointer: 'warn',
  constant: '',
};

function renderDataflow(T, compiled) {
  const { ir } = compiled;
  const flow = T.analyzePresetDataflow(ir);
  const variables = [...flow.variables.entries()];
  const drawn = T.drawnPartAudio(ir, flow);
  if (variables.length === 0 && drawn.size === 0) {
    return '<p class="empty">Nothing is written per frame, so nothing depends on the audio.</p>';
  }
  const list = (items) =>
    items.length
      ? items.map((s) => `<code>${escapeHtml(s)}</code>`).join(' ')
      : '<span class="muted">none</span>';
  const varRows = variables
    .map(([name, v]) => {
      const audio = T.controlAudio(flow, name) ?? v.audio;
      const notes = [
        ...v.clock,
        v.accumulates ? 'accumulates' : null,
        v.random ? 'rand' : null,
        v.memory ? 'memory' : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `<tr><td><code>${escapeHtml(name)}</code></td><td>${badge(v.kind, KIND_CLASS[v.kind] ?? '')}</td><td>${list(
        audio,
      )}</td><td class="muted">${escapeHtml(notes)}</td></tr>`;
    })
    .join('');
  const drawnRows = [...drawn.entries()]
    .map(
      ([part, audio]) =>
        `<tr><td><code>${escapeHtml(part)}</code></td><td>${list(audio)}</td></tr>`,
    )
    .join('');
  return `
    ${
      variables.length
        ? `<table><tr><th>control / variable</th><th>kind</th><th>audio that reaches it</th><th>also</th></tr>${varRows}</table>`
        : ''
    }
    ${
      drawn.size
        ? `<h3 style="margin-top:12px">Drawn parts <code>drawnPartAudio</code></h3><table><tr><th>part</th><th>audio that reaches what it draws</th></tr>${drawnRows}</table>`
        : ''
    }
    ${flow.randomStreamFollowsAudio ? '<p class="empty" style="margin-top:8px">A <code>rand()</code> call runs only under an audio-dependent condition, so the random stream itself follows the audio.</p>' : ''}`;
}

function renderGlsl(T, compiled) {
  const translations = T.describeShaderTranslations(compiled);
  if (translations.length === 0) {
    return '<p class="empty">No warp or comp shader in this preset. Add <code>warp_1=`shader_body {</code> lines.</p>';
  }
  return translations
    .map(
      (t) =>
        `<h3 style="margin-top:0">${escapeHtml(t.stage)} <code>${
          t.path === 'body'
            ? 'native shader_body converted as a whole'
            : t.path === 'statements'
              ? 'rebuilt from parsed statements'
              : 'nothing produced'
        }</code></h3>${t.glsl ? pre(t.glsl) : '<p class="empty">No GLSL produced for this stage.</p>'}`,
    )
    .join('');
}

let T = null;
let compiles = 0;

function compile() {
  if (!T) return;
  const raw = sourceEl.value;
  const started = performance.now();
  let compiled;
  try {
    compiled = T.compileMilkdropPresetSource(raw, { id: 'playground' });
  } catch (error) {
    for (const el of Object.values(panels)) el.innerHTML = errorHtml(error);
    statusEl.textContent = 'The compiler threw; see the panels.';
    pg.dataset.state = 'error';
    return;
  }
  fill(panels.diagnostics, () => renderDiagnostics(compiled.diagnostics));
  fill(panels.ir, () => renderIr(T, compiled));
  fill(panels.dataflow, () => renderDataflow(T, compiled));
  fill(panels.wgsl, () => renderWgsl(T, compiled));
  fill(panels.formatted, () => pre(T.formatMilkdropPreset(compiled)));
  fill(panels.md2, () => pre(T.exportMilkdrop2Preset(compiled)));
  fill(panels.glsl, () => renderGlsl(T, compiled));
  const ms = performance.now() - started;
  const errors = compiled.diagnostics.filter(
    (d) => d.severity === 'error',
  ).length;
  const warnings = compiled.diagnostics.filter(
    (d) => d.severity === 'warning',
  ).length;
  compiles += 1;
  statusEl.textContent = `Compiled in ${ms < 1 ? '<1' : ms.toFixed(0)} ms: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${
    warnings === 1 ? '' : 's'
  }.`;
  pg.dataset.state = 'ready';
  pg.dataset.compiles = String(compiles);
}

function readEnv() {
  const env = {};
  for (const input of envEl.querySelectorAll('input[name]')) {
    const value = Number.parseFloat(input.value);
    env[input.name] = Number.isFinite(value) ? value : 0;
  }
  return env;
}

function evaluateScratchpad() {
  if (!T) return;
  try {
    const parsed = T.parseMilkdropExpression(exprEl.value, 1);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    if (!parsed.value || errors.length) {
      exprValueEl.textContent = 'no value';
      exprValueEl.classList.add('bad');
    } else {
      const value = T.evaluateMilkdropExpression(parsed.value, readEnv());
      exprValueEl.textContent = String(value);
      exprValueEl.classList.remove('bad');
    }
    exprDiagEl.innerHTML = parsed.diagnostics.length
      ? renderDiagnostics(parsed.diagnostics)
      : '';
  } catch (error) {
    exprValueEl.textContent = 'threw';
    exprValueEl.classList.add('bad');
    exprDiagEl.innerHTML = errorHtml(error);
  }
}

function debounce(fn, ms) {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

for (const tab of document.querySelectorAll('.tabs .tab')) {
  tab.addEventListener('click', () => {
    for (const other of tab.parentElement.querySelectorAll('.tab')) {
      other.setAttribute('aria-selected', String(other === tab));
    }
    for (const name of ['formatted', 'md2', 'glsl']) {
      panels[name].hidden = name !== tab.dataset.tab;
    }
  });
}

compileBtn.addEventListener('click', compile);
sourceEl.addEventListener('input', debounce(compile, 300));
exprEl.addEventListener('input', debounce(evaluateScratchpad, 150));
envEl.addEventListener('input', debounce(evaluateScratchpad, 150));

async function boot() {
  try {
    T = await import('./lib/milkdrop-toolchain.js');
  } catch (error) {
    statusEl.textContent = 'Could not load the library bundle.';
    for (const el of Object.values(panels)) el.innerHTML = errorHtml(error);
    exprValueEl.textContent = 'library not loaded';
    exprValueEl.classList.add('bad');
    pg.dataset.state = 'error';
    return;
  }
  compile();
  evaluateScratchpad();
}

boot();
