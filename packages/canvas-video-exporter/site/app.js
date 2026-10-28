// The canvas-video-exporter site: a 2D animation recorded by the real
// library bundle built by scripts/build-site.ts, played back in the page.
import {
  CanvasVideoExporter,
  EXPORT_PRESETS,
} from './lib/canvas-video-exporter.js';

const $ = (id) => document.getElementById(id);

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

// ---------------------------------------------------------------- the canvas

const stage = $('stage');
const ctx = stage.getContext('2d');
let t = 0;
const draw = () => {
  t += 1 / 60;
  const { width, height } = stage;
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 12; i += 1) {
    const phase = t * 0.8 + i * 0.5;
    const x = width / 2 + Math.cos(phase) * width * 0.3;
    const y = height / 2 + Math.sin(phase * 1.3) * height * 0.3;
    const r = 24 + 16 * Math.sin(t * 2 + i);
    ctx.fillStyle = `hsl(${(i * 30 + t * 40) % 360} 70% 60%)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.fillText(`${t.toFixed(1)} s`, 24, height - 28);
  requestAnimationFrame(draw);
};
requestAnimationFrame(draw);

// ---------------------------------------------------------------- presets

const nativeOnly = new Set(['4k-landscape']);
for (const [id, preset] of Object.entries(EXPORT_PRESETS)) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = `${preset.label} ${preset.width}x${preset.height}`;
  if (nativeOnly.has(id)) option.textContent += ' (needs a runtime)';
  if (id === 'hd-landscape') option.selected = true;
  $('preset').append(option);

  const row = document.createElement('tr');
  const capture = nativeOnly.has(id)
    ? 'native only'
    : preset.aspectRatio === '9:16' || preset.aspectRatio === '1:1'
      ? 'native with a runtime, otherwise a cropped copy'
      : 'cropped copy';
  row.innerHTML = `<td><code>${id}</code></td><td>${preset.width}x${preset.height}</td><td>${preset.aspectRatio}</td><td>${capture}</td>`;
  $('preset-table').append(row);
}

$('seconds').addEventListener('input', () => {
  $('secondsOut').textContent = $('seconds').value;
});

// ---------------------------------------------------------------- recording

const exporter = new CanvasVideoExporter(stage);
const support = exporter.getSupport();
$('support').textContent = support.supported
  ? support.mimeType
  : support.reason;
$('start').disabled = !support.supported;

let objectUrl = null;
$('start').addEventListener('click', async () => {
  const preset = $('preset').value;
  const seconds = Number($('seconds').value);
  const result = exporter.startRecording({ preset, fps: 30 });
  if (!result.ok) {
    $('status').textContent = result.reason;
    return;
  }
  $('start').disabled = true;
  $('status').innerHTML =
    `<span class="rec">● recording</span> ${preset} for ${seconds} s`;
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const blob = await exporter.stopRecording();
  $('start').disabled = false;
  if (!blob) {
    $('status').textContent = 'The recorder produced no data.';
    return;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  const video = $('playback');
  video.hidden = false;
  video.src = objectUrl;
  video.onloadedmetadata = () => {
    $('size').textContent = `${video.videoWidth}x${video.videoHeight}`;
  };
  $('file').textContent = `${(blob.size / 1024).toFixed(0)} kB, ${blob.type}`;
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const download = $('download');
  download.hidden = false;
  download.href = objectUrl;
  download.download = `canvas-${preset}.${extension}`;
  $('status').textContent = `Recorded ${preset}.`;
});
