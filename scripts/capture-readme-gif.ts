/**
 * Capture a 5-second video of the visualizer for README GIF generation.
 *
 * This script uses the browser's MediaRecorder API to record the visualizer
 * canvas, then provides the ffmpeg command to convert the WebM to a GIF.
 *
 * Prerequisites:
 *  - The visualizer is running (open http://localhost:5188 in a browser)
 *  - An audio source is active (mic, tab, demo, or youtube)
 *  - Browser supports MediaRecorder and canvas.captureStream
 *
 * Usage:
 *   bun run scripts/capture-readme-gif.ts
 *
 * The script will:
 *  1. Find the visualizer canvas on the page at http://localhost:5188
 *  2. Record 5 seconds of video using the hd-landscape preset (1920x1080)
 *  3. Save the WebM blob with a timestamped filename
 *  4. Output the ffmpeg command to convert to GIF for the README
 */

export {};

// Hardcoded preset dimensions for hd-landscape (no module imports needed)
const PRESET = 'hd-landscape';
const CAPTURE_DURATION_MS = 5_000; // 5 seconds

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // Wait for the page to load and visualizer to be ready
  console.log('Waiting for visualizer to be ready...');

  let canvas: HTMLCanvasElement | null = null;
  let attempts = 0;

  // Wait for canvas to appear in the DOM
  while (attempts < 100) {
    if (typeof document === 'undefined') {
      await sleep(200);
      attempts++;
      continue;
    }

    canvas = document.querySelector('canvas');
    if (canvas && canvas instanceof HTMLCanvasElement && canvas.width > 0) {
      break;
    }

    await sleep(200);
    attempts++;
  }

  if (!canvas || !(canvas instanceof HTMLCanvasElement) || canvas.width === 0) {
    console.error(
      'Could not find canvas. Make sure the visualizer is running at http://localhost:5188',
    );
    process.exit(1);
  }

  console.log(`Found canvas: ${canvas.width}x${canvas.height}`);

  // Check MediaRecorder support
  if (typeof MediaRecorder === 'undefined') {
    console.error('MediaRecorder is not supported in this browser.');
    process.exit(1);
  }

  // Capture video stream from canvas
  const videoStream = canvas.captureStream(60); // 60fps

  const mimeType = 'video/webm;codecs=vp9';
  const recorder = new MediaRecorder(videoStream, {
    mimeType,
    videoBitsPerSecond: 12_000_000,
  });

  const chunks: Blob[] = [];

  recorder.ondataavailable = (event: BlobEvent) => {
    const data = event.data;
    if (data && data.size > 0) {
      chunks.push(data);
    }
  };

  // Record for exactly 5 seconds
  console.log('Starting 5-second recording...');
  recorder.start(100); // 100ms granularity

  const startTime = Date.now();

  // Wait for recording to finish (5 seconds or recorder stops)
  await new Promise<void>((resolve) => {
    const check = () => {
      const now = Date.now();
      if (
        recorder.state === 'inactive' ||
        now - startTime >= CAPTURE_DURATION_MS
      ) {
        recorder.stop();
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });

  // Stop and get the blob
  console.log('Stopping recording...');
  let blob: Blob | null = null;
  await new Promise<void>((resolve) => {
    recorder.onstop = () => {
      blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
      resolve();
    };
    recorder.stop();
  });

  if (!blob) {
    console.error('No video chunks were recorded.');
    process.exit(1);
  }

  // Generate filename
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `stims-readme-${PRESET}-${timestamp}.webm`;
  console.log(`Saved to: ${filename}`);

  // Build ffmpeg command lines
  const baseName = filename.replace('.webm', '');
  const cmd1 = `ffmpeg -i ${filename} -vf "fps=10,scale=320:-1:flags=lanczos,palettegen" palette.png -i palette.png -filter_complex "fps=10,scale=320:-1:flags=lanczos[x];[x][1]paletteuse" ${baseName}.gif`;
  const cmd2 = `ffmpeg -i ${filename} -vf "fps=8,scale=300:-1:flags=lanczos,palettegen" palette.png -i palette.png -filter_complex "fps=8,scale=300:-1:flags=lanczos[x];[x][1]paletteuse" ${baseName}-small.gif`;
  const cmd3 = `gifsicle --optimize=3 --colors 64 --lossy 90 ${baseName}.gif -o output.gif`;

  console.log(
    `\n================================================================================`,
  );
  console.log(`Captured WebM video: ${filename}`);
  console.log(
    '================================================================================',
  );
  console.log(
    'Use the following ffmpeg commands to convert to GIF for your README:',
  );
  console.log('');
  console.log(cmd1);
  console.log('');
  console.log(cmd2);
  console.log('');
  console.log('Optional: optimize GIF colors:');
  console.log(cmd3);
  console.log(
    `================================================================================`,
  );
  console.log(
    '\nNotes:' +
      '\n  - The WebM video is ~5 seconds at 60fps, ~1080p (hd-landscape preset)' +
      '\n  - First ffmpeg command produces a 320px-wide GIF (~3-5MB)' +
      '\n  - Second ffmpeg command produces a 300px-wide smaller GIF (~2-3MB)' +
      '\n  - Third command reduces the GIF color palette for smaller size' +
      "\n  - Place the resulting .gif file in your repo's docs/ or README assets/" +
      '\n  - GitHub renders GIFs inline in the README' +
      '\n================================================================================\n',
  );
}

// Run
main().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
