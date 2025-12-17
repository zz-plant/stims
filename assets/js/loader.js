import toysData from './toys-data.js';

let manifestPromise;
let moduleImporter = (path) => import(path);

async function fetchManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('./manifest.json')
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

async function resolveModulePath(entry) {
  const manifest = await fetchManifest();
  const manifestEntry = manifest?.[entry];

  if (manifestEntry) {
    const compiledFile = manifestEntry.file || manifestEntry.url;
    if (compiledFile) {
      return new URL(compiledFile, window.location.origin).pathname;
    }
  }

  return entry.startsWith('/') || entry.startsWith('.') ? entry : `/${entry}`;
}

function ensureAudioPrompt(message) {
  let prompt = document.getElementById('audio-permission-prompt');
  if (!prompt) {
    prompt = document.createElement('div');
    prompt.id = 'audio-permission-prompt';
    prompt.setAttribute('role', 'status');
    prompt.style.margin = '1rem 0';
    document.body.appendChild(prompt);
  }

  prompt.textContent = message;
  prompt.style.display = message ? 'block' : 'none';
}

function ensureStartAudioButton() {
  let button = document.getElementById('start-audio-btn');
  if (!button) {
    button = document.createElement('button');
    button.id = 'start-audio-btn';
    button.type = 'button';
    button.textContent = 'Enable microphone';
    button.dataset.createdByLoader = 'true';
    button.style.display = 'block';
    document.body.appendChild(button);
  } else {
    button.style.display = '';
  }

  return button;
}

function bindStartAudioClick(button) {
  if (button.dataset.createdByLoader !== 'true' || button.dataset.loaderBound) {
    return;
  }

  button.dataset.loaderBound = 'true';
  button.addEventListener('click', async () => {
    await startAudioIfReady();
  });
}

async function startAudioIfReady() {
  const button = ensureStartAudioButton();
  bindStartAudioClick(button);

  if (typeof window.startAudio !== 'function') {
    ensureAudioPrompt('Enable microphone access to start audio.');
    return;
  }

  button.disabled = true;
  try {
    await window.startAudio();
    button.style.display = 'none';
    ensureAudioPrompt('');
  } catch (error) {
    console.error('Unable to start audio:', error);
    button.disabled = false;
    button.style.display = 'block';
    ensureAudioPrompt(
      'Microphone access is required. Please allow it and try again.'
    );
  }
}

export async function loadToy(slug) {
  const toys = toysData;
  const toy = toys.find((t) => t.slug === slug);
  if (!toy) {
    console.error(`Toy not found: ${slug}`);
    return;
  }

  if (toy.type === 'page') {
    window.location.href = `./${slug}.html`;
  } else if (toy.type === 'module') {
    document.getElementById('toy-list')?.remove();
    const moduleUrl = await resolveModulePath(toy.module);
    try {
      await moduleImporter(moduleUrl);
      await startAudioIfReady();
    } catch (error) {
      console.error(`Unable to load module ${moduleUrl}:`, error);
      ensureAudioPrompt(
        'Unable to start audio automatically. Please enable your microphone.'
      );
      ensureStartAudioButton();
    }
  } else {
    window.location.href = toy.module;
  }
}

export async function loadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('toy');
  if (slug) {
    await loadToy(slug);
  }
}

export function setModuleImporter(fn) {
  moduleImporter = fn;
}

export function resetModuleImporter() {
  moduleImporter = (path) => import(path);
}
