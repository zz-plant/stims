/** Convert once at publication; crawler requests only read the stored MP4. */
import {
  MAX_FLIPBOOK_BYTES,
  type PreviewFlipbook,
} from '../../src/js/utils/media/preview-flipbook.ts';

/** Narrow adapter for the Media binding, verified with wrangler types and live output. */
export interface PreviewMedia {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; height: number; fit: 'contain' }): {
      output(options: { mode: 'video'; duration: string; audio: false }): {
        response(): Promise<Response>;
      };
    };
  };
}

export async function encodeFlipbookVideo(
  media: PreviewMedia,
  gif: Uint8Array,
  clip: PreviewFlipbook,
): Promise<Uint8Array> {
  const response = await media
    .input(new Blob([Uint8Array.from(gif).buffer]).stream())
    .transform({ width: clip.width, height: clip.height, fit: 'contain' })
    .output({
      mode: 'video',
      duration: `${(clip.frames.length * clip.delayMs) / 1000}s`,
      audio: false,
    })
    .response();
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('video/mp4') ||
    !response.body
  )
    throw new Error('Video conversion failed.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FLIPBOOK_BYTES)
        throw new Error('Converted video is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (size < 12 || new TextDecoder().decode(bytes.subarray(4, 8)) !== 'ftyp')
    throw new Error('Video conversion returned an invalid MP4.');
  return bytes;
}
