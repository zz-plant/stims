import { existsSync, unlinkSync } from 'node:fs';

export interface YoutubeResult {
  wavPath: string;
  title: string;
}

function hasCommand(cmd: string): boolean {
  try {
    Bun.spawnSync(['which', cmd], { stdout: 'null', stderr: 'null' });
    return true;
  } catch {
    return false;
  }
}

export async function downloadYoutube(
  url: string,
  onProgress?: (pct: number) => void,
): Promise<YoutubeResult> {
  if (!hasCommand('yt-dlp')) {
    throw new Error(
      'yt-dlp not found.\n' +
        '  macOS:  brew install yt-dlp\n' +
        '  Linux:  pip install yt-dlp\n' +
        '  Other:  https://github.com/yt-dlp/yt-dlp',
    );
  }
  if (!hasCommand('ffmpeg')) {
    throw new Error(
      'ffmpeg not found.\n' +
        '  macOS:  brew install ffmpeg\n' +
        '  Linux:  apt install ffmpeg / dnf install ffmpeg',
    );
  }

  const wavPath = `/tmp/stims-yt-${Date.now()}.wav`;

  let title = url;
  try {
    const infoProc = Bun.spawnSync(
      ['yt-dlp', '--print', 'title', '--no-playlist', url],
      {
        stdout: 'pipe',
        stderr: 'null',
      },
    );
    const infoOut = new TextDecoder().decode(infoProc.stdout);
    title = infoOut.trim().slice(0, 80) || url;
  } catch {
    /* keep URL as title */
  }

  process.stdout.write(`  Downloading: ${title}\n`);

  const proc = Bun.spawn(
    [
      'yt-dlp',
      '-x',
      '--audio-format',
      'wav',
      '-o',
      wavPath,
      '--no-playlist',
      '--no-progress',
      url,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );

  const decoder = new TextDecoder();
  let lastPct = 0;

  const stderrReader = proc.stderr.getReader();
  (async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const text = decoder.decode(value);
      const match = text.match(/(\d+)\.?\d*%/);
      if (match) {
        const pct = parseInt(match[1]!, 10);
        if (pct !== lastPct && pct % 20 === 0 && pct > 0) {
          onProgress?.(pct);
          lastPct = pct;
        }
      }
    }
  })();

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    if (existsSync(wavPath)) unlinkSync(wavPath);
    const stderr = new TextDecoder().decode(
      await new Response(proc.stderr).arrayBuffer(),
    );
    throw new Error(
      `yt-dlp exited with code ${exitCode}: ${stderr.slice(0, 200)}`,
    );
  }

  if (!existsSync(wavPath)) {
    throw new Error('yt-dlp completed but no file was produced');
  }

  return { wavPath, title };
}

export function cleanupYoutube(path: string) {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ok */
    }
  }
}
