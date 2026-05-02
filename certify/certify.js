// certify — Stims certification tool
// Runs presets under WebGPU and WebGL and diffs the captures.
// Usage: open certify/index.html in a browser.
//
// Bundled preset list (must match the Stims catalog).
const BUNDLED_PRESETS = [
  {
    id: 'eos-glowsticks-v2-03-music',
    title: 'Eo.S. - Glowsticks (v2) 03 (Music Reactive)',
  },
  { id: 'rovastar-parallel-universe', title: 'Rovastar - Parallel Universe' },
  { id: 'eos-phat-cubetrace-v2', title: 'Eo.S. + Phat - Cubetrace v2' },
  {
    id: 'krash-rovastar-cerebral-demons-stars',
    title: 'Krash & Rovastar - Cerebral Demons (Stars Remix)',
  },
];

const WARMUP_MS = 5000;
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FAIL_THRESHOLD = 0.04;

// ---- utility functions ----

/**
 * Polls a container for a <canvas> element with a specific className
 * or fallback to the first canvas, resolving with the found
 * canvas or rejects after timeout.
 */
function waitForVisualizerCanvas(
  container,
  { timeoutMs = 15000, minWidth = 100 } = {},
) {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function check() {
      const canvas =
        container.querySelector('.stims-shell__canvas') ||
        container.querySelector('canvas');
      if (canvas && canvas.width >= minWidth) {
        resolve(canvas);
        return;
      }
      if (performance.now() >= deadline) {
        reject(
          new Error(`No visualizer canvas appeared within ${timeoutMs}ms`),
        );
        return;
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

/**
 * Builds the preset URL for the certify iframe.
 */
function buildPresetUrl(presetId, backend) {
  const params = new URLSearchParams();
  params.set('preset', presetId);
  params.set('backend', backend);
  params.set('certify', '1');
  return `/milkdrop/?${params.toString()}`;
}

/**
 * Captures a single frame from a preset rendered with the given backend.
 */
async function capturePresetFrame(presetId, backend) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1280px;height:720px;border:0;';
  iframe.src = buildPresetUrl(presetId, backend);
  document.body.appendChild(iframe);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Iframe load timed out for ${presetId} ${backend}`));
    }, 30000);
    iframe.addEventListener(
      'load',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    iframe.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error(`Iframe failed to load for ${presetId} ${backend}`));
      },
      { once: true },
    );
  });

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

  // Wait for the visualizer canvas to appear
  const canvas = await waitForVisualizerCanvas(iframeDoc.body, {
    timeoutMs: 20000,
  });
  console.log(
    `[certify] ${presetId} ${backend} canvas found (${canvas.width}x${canvas.height})`,
  );

  // Wait for warmup
  await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));

  // Capture the frame
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = CANVAS_WIDTH;
  captureCanvas.height = CANVAS_HEIGHT;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const dataUrl = captureCanvas.toDataURL('image/png');

  // Clean up iframe
  document.body.removeChild(iframe);

  return dataUrl;
}

/**
 * Captures frames for both backends, diffs them, and returns results.
 */
async function certifyPreset(preset) {
  const gpuTarget = document.getElementById('webgpu-canvas-target');
  const glTarget = document.getElementById('webgl-canvas-target');

  console.log(`[certify] Starting capture for ${preset.id}`);

  // Capture WebGPU frame
  console.log(`[certify] Capturing WebGPU for ${preset.id}...`);
  const gpuStart = performance.now();
  let gpuDataUrl;
  try {
    gpuDataUrl = await capturePresetFrame(preset.id, 'webgpu');
    console.log(
      `[certify] WebGPU capture done for ${preset.id} in ${(performance.now() - gpuStart).toFixed(0)}ms`,
    );
  } catch (error) {
    console.error(`[certify] WebGPU capture failed for ${preset.id}:`, error);
  }

  // Capture WebGL frame
  console.log(`[certify] Capturing WebGL for ${preset.id}...`);
  const glStart = performance.now();
  let glDataUrl;
  try {
    glDataUrl = await capturePresetFrame(preset.id, 'webgl');
    console.log(
      `[certify] WebGL capture done for ${preset.id} in ${(performance.now() - glStart).toFixed(0)}ms`,
    );
  } catch (error) {
    console.error(`[certify] WebGL capture failed for ${preset.id}:`, error);
  }

  if (!gpuDataUrl || !glDataUrl) {
    return {
      presetId: preset.id,
      presetTitle: preset.title,
      status: 'capture-failed',
      mismatchPixels: -1,
      totalPixels: -1,
      mismatchRatio: -1,
      gpuCaptured: !!gpuDataUrl,
      glCaptured: !!glDataUrl,
    };
  }

  // Diff the two captures
  const diffResult = await diffImages(gpuDataUrl, glDataUrl);
  console.log(
    `[certify] Diff complete for ${preset.id}: ${(diffResult.mismatchRatio * 100).toFixed(2)}% mismatch`,
  );

  const result = {
    presetId: preset.id,
    presetTitle: preset.title,
    status: diffResult.mismatchRatio <= FAIL_THRESHOLD ? 'pass' : 'fail',
    mismatchPixels: diffResult.mismatchedPixels,
    totalPixels: diffResult.totalPixels,
    mismatchRatio: diffResult.mismatchRatio,
    gpuDataUrl,
    glDataUrl,
    diffDataUrl: diffResult.diffDataUrl,
    gpuCaptured: true,
    glCaptured: true,
  };

  // Show results
  showResults(result);

  return result;
}

/**
 * Compares two image data URLs pixel-by-pixel and returns mismatch stats.
 */
async function diffImages(imageAUrl, imageBUrl) {
  const loadImage = (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image`));
      img.src = url;
    });

  const [imgA, imgB] = await Promise.all([
    loadImage(imageAUrl),
    loadImage(imageBUrl),
  ]);

  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  const canvasA = document.createElement('canvas');
  canvasA.width = width;
  canvasA.height = height;
  const ctxA = canvasA.getContext('2d');
  ctxA.drawImage(imgA, 0, 0, width, height);
  const dataA = ctxA.getImageData(0, 0, width, height).data;

  const canvasB = document.createElement('canvas');
  canvasB.width = width;
  canvasB.height = height;
  const ctxB = canvasB.getContext('2d');
  ctxB.drawImage(imgB, 0, 0, width, height);
  const dataB = ctxB.getImageData(0, 0, width, height).data;

  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext('2d');
  const diffImageData = diffCtx.createImageData(width, height);
  const diffData = diffImageData.data;

  let mismatchedPixels = 0;
  const TOTAL_PIXELS = width * height;
  const PIXEL_TOLERANCE = 3; // per-channel tolerance

  for (let i = 0; i < dataA.length; i += 4) {
    const rDiff = Math.abs(dataA[i] - dataB[i]);
    const gDiff = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const bDiff = Math.abs(dataA[i + 2] - dataB[i + 2]);

    if (
      rDiff > PIXEL_TOLERANCE ||
      gDiff > PIXEL_TOLERANCE ||
      bDiff > PIXEL_TOLERANCE
    ) {
      // Highlight mismatched pixels in red
      diffData[i] = 255;
      diffData[i + 1] = 0;
      diffData[i + 2] = 0;
      diffData[i + 3] = 255;
      mismatchedPixels++;
    } else {
      // Show original pixel, dimmed
      diffData[i] = dataA[i] * 0.5;
      diffData[i + 1] = dataA[i + 1] * 0.5;
      diffData[i + 2] = dataA[i + 2] * 0.5;
      diffData[i + 3] = 255;
    }
  }

  diffCtx.putImageData(diffImageData, 0, 0);

  return {
    width,
    height,
    totalPixels: TOTAL_PIXELS,
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / TOTAL_PIXELS,
    diffDataUrl: diffCanvas.toDataURL('image/png'),
  };
}

// ---- UI helpers ----

function showResults(result) {
  const panel = document.getElementById('results-panel');
  const statusEl = document.getElementById('results-status');
  const metricsEl = document.getElementById('results-metrics');
  const diffCanvas = document.getElementById('diff-canvas');
  const actionsEl = document.getElementById('results-actions');
  const presetNameEl = document.getElementById('results-preset-name');

  panel.hidden = false;
  actionsEl.hidden = false;
  presetNameEl.textContent = result.presetTitle;

  const passed = result.status === 'pass';
  statusEl.textContent = passed ? 'Pass' : 'Fail';
  statusEl.className = `cert-status ${
    passed ? 'cert-status--pass' : 'cert-status--fail'
  }`;

  const mismatchPercent = (result.mismatchRatio * 100).toFixed(2);
  metricsEl.innerHTML = [
    { label: 'Mismatch ratio', value: `${mismatchPercent}%` },
    {
      label: 'Mismatched pixels',
      value: `${result.mismatchedPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()}`,
    },
    { label: 'Threshold', value: `${(FAIL_THRESHOLD * 100).toFixed(0)}%` },
    { label: 'Status', value: passed ? 'Pass' : 'Fail' },
    { label: 'Backend', value: 'WebGPU vs WebGL' },
    { label: 'Preset', value: result.presetTitle },
  ]
    .map(
      (m) => `
      <div class="cert-metric">
        <span>${m.label}</span>
        <span>${m.value}</span>
      </div>
  `,
    )
    .join('');

  if (result.diffDataUrl) {
    diffCanvas.hidden = false;
    const img = new Image();
    img.onload = () => {
      diffCanvas.width = img.width;
      diffCanvas.height = img.height;
      const ctx = diffCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
    img.src = result.diffDataUrl;
  }
}

async function loadPresetList() {
  try {
    const response = await fetch('/milkdrop-presets/catalog.json');
    if (response.ok) {
      const catalog = await response.json();
      const featured = catalog.filter(
        (entry) => entry.lifecycleStage === 'featured',
      );
      if (featured.length > 0) {
        return featured.map((entry) => ({
          id: entry.id,
          title: entry.title,
        }));
      }
    }
  } catch (error) {
    console.warn(
      '[certify] Could not fetch catalog, using hardcoded list:',
      error,
    );
  }

  // Use hardcoded fallback
  const select = document.getElementById('preset-select');
  select.innerHTML = BUNDLED_PRESETS.map(
    (p) => `<option value="${p.id}">${p.title}</option>`,
  ).join('');
  return BUNDLED_PRESETS;
}

async function submitResults(results) {
  const submitBtn = document.getElementById('submit-results-btn');
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const payload = {
      presets: results.map((result) => ({
        presetId: result.presetId,
        presetTitle: result.presetTitle,
        status: result.status,
        mismatchRatio: result.mismatchRatio,
        mismatchPixels: result.mismatchedPixels,
        totalPixels: result.totalPixels,
        timestamp: new Date().toISOString(),
      })),
    };

    const response = await fetch('/api/certify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const responseData = await response.json();
    alert(
      `Submitted ${responseData.count ?? payload.presets.length} results successfully.`,
    );
  } catch (error) {
    alert(
      `Submission failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submit results';
    }
  }
}

// ---- entry point ----

(async function main() {
  const presets = BUNDLED_PRESETS;
  let results = [];

  // Populate preset selector
  async function refreshPresetDropdown() {
    const loadedPresets = await loadPresetList();
    const select = document.getElementById('preset-select');
    select.innerHTML = loadedPresets
      .map((p) => `<option value="${p.id}">${p.title}</option>`)
      .join('');
    return loadedPresets;
  }

  const loadedPresets = await refreshPresetDropdown();

  // Certify all button
  document
    .getElementById('certify-all-btn')
    .addEventListener('click', async () => {
      const btn = document.getElementById('certify-all-btn');
      btn.disabled = true;
      results = [];
      for (const preset of loadedPresets) {
        btn.textContent = `Certifying ${preset.title}…`;
        try {
          const result = await certifyPreset(preset);
          results.push(result);
        } catch (error) {
          console.error(`[certify] Failed to certify ${preset.id}:`, error);
          results.push({
            presetId: preset.id,
            presetTitle: preset.title,
            status: 'error',
            mismatchPixels: -1,
            totalPixels: -1,
            mismatchRatio: -1,
            gpuCaptured: false,
            glCaptured: false,
          });
        }
      }
      btn.disabled = false;
      btn.textContent = 'Certify all (4 presets)';
      document.getElementById('submit-results-btn').disabled = false;
    });

  // Certify one button
  document
    .getElementById('certify-one-btn')
    .addEventListener('click', async () => {
      const select = document.getElementById('preset-select');
      const presetId = select.value;
      const preset = loadedPresets.find((p) => p.id === presetId) || {
        id: presetId,
        title: presetId,
      };
      const btn = document.getElementById('certify-one-btn');
      btn.disabled = true;
      btn.textContent = 'Capturing…';
      try {
        const result = await certifyPreset(preset);
        results = [result];
        document.getElementById('submit-results-btn').disabled = false;
      } catch (error) {
        alert(
          `Certification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      btn.disabled = false;
      btn.textContent = 'Certify selected';
    });

  // Submit results button
  document
    .getElementById('submit-results-btn')
    .addEventListener('click', async () => {
      await submitResults(results);
    });

  // Submit single result button
  document
    .getElementById('submit-single-btn')
    .addEventListener('click', async () => {
      await submitResults(results);
    });

  await loadPresetList();
})();
