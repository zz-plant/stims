// Corpus browser: reads cases/index.json (written by scripts/build-site.ts)
// and the case files themselves, so the page shows exactly what the package
// ships. No build step and no dependencies.

const casesEl = document.getElementById('cases');
const searchEl = document.getElementById('search');
const sectionEl = document.getElementById('section');
const provisionalEl = document.getElementById('provisional-only');
const countEl = document.getElementById('count');

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
    .replace(/>/g, '&gt;');
}

function mapTable(label, map) {
  if (!map || Object.keys(map).length === 0) return '';
  const rows = Object.entries(map)
    .map(
      ([k, v]) =>
        `<tr><td><code>${escapeHtml(k)}</code></td><td class="stat">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return `<details><summary class="muted">${label} (${Object.keys(map).length})</summary><table>${rows}</table></details>`;
}

function renderCase(c) {
  const status =
    c.status === 'provisional'
      ? '<span class="badge warn">provisional</span>'
      : '';
  const expected = Object.entries(c.expected ?? {})
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n');
  return `<article class="card case" id="${escapeHtml(c.section)}-${escapeHtml(c.id)}">
    <header><span class="id">${escapeHtml(c.section)}/${escapeHtml(c.id)}</span>${status}</header>
    <p class="name">${escapeHtml(c.name)}</p>
    <pre><code>${escapeHtml(c.program.join('\n'))}</code></pre>
    <div class="muted" style="font-size:13px">expected</div>
    <pre><code>${escapeHtml(expected || '(buffers only)')}</code></pre>
    ${mapTable('env', c.env)}${mapTable('megabuf in', c.megabuf)}${mapTable('gmegabuf in', c.gmegabuf)}
    ${mapTable('expected megabuf', c.expectedMegabuf)}${mapTable('expected gmegabuf', c.expectedGmegabuf)}
    ${c.note ? `<p class="note">${escapeHtml(c.note)}</p>` : ''}
  </article>`;
}

let groups = [];

function render() {
  const query = searchEl.value.trim().toLowerCase();
  const section = sectionEl.value;
  const provisionalOnly = provisionalEl.checked;
  let shown = 0;
  let total = 0;
  const html = [];
  for (const group of groups) {
    if (section && group.section !== section) continue;
    const matching = group.cases.filter((c) => {
      total += 1;
      if (provisionalOnly && c.status !== 'provisional') return false;
      if (!query) return true;
      const haystack = [c.id, c.name, c.note ?? '', ...c.program]
        .join('\n')
        .toLowerCase();
      return haystack.includes(query);
    });
    if (matching.length === 0) continue;
    shown += matching.length;
    html.push(
      `<div class="section-head"><h3>${escapeHtml(group.section)}</h3><p>${escapeHtml(group.description)}</p></div>`,
      `<div class="grid">${matching.map(renderCase).join('')}</div>`,
    );
  }
  casesEl.innerHTML = html.join('') || '<p class="muted">No cases match.</p>';
  countEl.textContent = `${shown} of ${total} cases`;
}

async function load() {
  const index = await (await fetch('./cases/index.json')).json();
  groups = await Promise.all(
    index.files.map(async (file) => {
      const raw = await (await fetch(`./cases/${file}`)).json();
      return {
        section: raw.section,
        description: raw.description,
        cases: raw.cases.map((c) => ({ ...c, section: raw.section })),
      };
    }),
  );
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.section;
    option.textContent = `${group.section} (${group.cases.length})`;
    sectionEl.append(option);
  }
  render();
  if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
}

searchEl.addEventListener('input', render);
sectionEl.addEventListener('change', render);
provisionalEl.addEventListener('change', render);
load().catch((error) => {
  casesEl.innerHTML = `<p class="notice">Could not load the corpus: ${escapeHtml(error.message)}</p>`;
});
