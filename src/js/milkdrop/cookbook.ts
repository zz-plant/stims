/**
 * Technique cookbook for the editor's Insert tab: the moves MilkDrop authors
 * reach for, each with what it does and why it works, added to the right
 * block of the preset.
 *
 * Where a line goes decides whether it does anything. A bare `zoom=1 +
 * bass*0.1` at the top of a preset is a base value: evaluated once, with the
 * audio silent, so it is a constant. The same text as `per_frame_N=` runs
 * every frame. The old Insert tab pasted bare lines at the cursor and every
 * one of them silently did nothing; a recipe here names its block and is
 * appended there with the next free line number.
 *
 * Every recipe uses only what MilkDrop 2 provides (its functions and
 * signals), so what an author learns here carries to every engine; the test
 * holds each one to that and to visibly moving the picture.
 */

export type RecipeBlock = 'init' | 'perFrame' | 'perPixel';

export type Recipe = {
  id: string;
  title: string;
  /** One line: what it does to the picture. */
  summary: string;
  /** Why it works — the technique, not just the code. */
  how: string;
  code: Partial<Record<RecipeBlock, readonly string[]>>;
};

export const COOKBOOK: readonly Recipe[] = [
  {
    id: 'bass-zoom',
    title: 'Zoom on the bass',
    summary: 'The picture pushes in when the bass hits.',
    how: 'bass_att hovers around 1 and rises on a hit, so (bass_att - 1) is roughly zero in quiet passages and positive on a kick. Adding a small multiple to zoom makes each hit push the feedback inward.',
    code: { perFrame: ['zoom = zoom + 0.06*(bass_att - 1);'] },
  },
  {
    id: 'smooth-signal',
    title: 'Smooth a jumpy signal',
    summary: 'A calmer bass value in q1 for anything that twitches.',
    how: 'Each frame keeps 90% of the old value and takes 10% of the new one — a one-pole low-pass filter. Raise 0.9 for slower, smoother motion. q1 carries the result to waves, shapes, and shaders.',
    code: {
      perFrame: ['q1 = 0.9*q1 + 0.1*bass;', 'zoom = zoom + 0.05*(q1 - 1);'],
    },
  },
  {
    id: 'beat-trigger',
    title: 'Trigger on a beat, once',
    summary: 'A flash on each strong kick, never twice in a row.',
    how: 'above(bass, 1.4) is 1 on a loud kick, and above(time, q2) is 1 only once the cooldown has passed, so both together fire at most every 0.3 s. q3 jumps to 1 on a hit and decays, which drives the border.',
    code: {
      init: ['q2 = 0; q3 = 0;'],
      perFrame: [
        'hit = above(bass, 1.4)*above(time, q2);',
        'q2 = if(hit, time + 0.3, q2);',
        'q3 = if(hit, 1, q3*0.9);',
        'ob_size = 0.02; ob_r = 1; ob_g = 0.6; ob_b = 0.2;',
        'ob_a = q3;',
      ],
    },
  },
  {
    id: 'steady-clock',
    title: 'A clock that ignores frame rate',
    summary: 'Motion at the same speed on a slow laptop and a 144 Hz screen.',
    how: 'Adding a fixed amount every frame runs faster on faster machines. Adding speed/fps instead advances the same amount per second at any frame rate. Use q4 wherever you would have used time, and change its speed freely.',
    code: {
      init: ['q4 = 0;'],
      perFrame: ['q4 = q4 + 0.4/fps;', 'rot = rot + 0.01*sin(q4);'],
    },
  },
  {
    id: 'hue-cycle',
    title: 'Cycle the waveform color',
    summary: 'The wave drifts through the spectrum.',
    how: 'Three sines at different speeds never line up, so red, green, and blue wander independently and the color never repeats exactly. Keeping each between 0.2 and 1 stops the wave from going dark.',
    code: {
      perFrame: [
        'wave_r = 0.6 + 0.4*sin(time*0.61);',
        'wave_g = 0.6 + 0.4*sin(time*0.83 + 2);',
        'wave_b = 0.6 + 0.4*sin(time*1.07 + 4);',
      ],
    },
  },
  {
    id: 'tunnel',
    title: 'Tunnel',
    summary: 'The edges rush toward you faster than the middle.',
    how: 'Per-pixel code runs for each point of the warp mesh, and rad is that point’s distance from the center. Zooming more where rad is large pulls the edges in faster, which reads as depth.',
    code: { perPixel: ['zoom = zoom + 0.06*rad;'] },
  },
  {
    id: 'swirl',
    title: 'Swirl',
    summary: 'The middle turns while the edges hold still.',
    how: 'Rotating by (1 - rad) turns points near the center most and the rim hardly at all; the feedback smears that difference into a spiral. The sine makes it turn back and forth.',
    code: { perPixel: ['rot = rot + 0.04*(1 - rad)*sin(time*0.7);'] },
  },
  {
    id: 'drifting-centre',
    title: 'Drifting center',
    summary: 'The zoom and spin wander around the screen.',
    how: 'cx and cy are where zoom and rotation are centered. Moving them on slow, unrelated sines keeps the motion from feeling pinned to the middle.',
    code: {
      perFrame: [
        'cx = 0.5 + 0.15*sin(time*0.27);',
        'cy = 0.5 + 0.15*cos(time*0.19);',
      ],
    },
  },
  {
    id: 'treble-shimmer',
    title: 'Treble shimmer',
    summary: 'The warp gets busier with the hi-hats.',
    how: 'warp is the amount of built-in turbulence. Driving it from treb_att adds texture on cymbals without moving the whole frame the way bass does.',
    code: { perFrame: ['warp = 0.2 + 0.8*max(treb_att - 0.8, 0);'] },
  },
  {
    id: 'breathing-decay',
    title: 'Longer trails on the loud parts',
    summary: 'Trails stretch out when the music swells.',
    how: 'decay is how much of the last frame survives. Below 1 the image fades; nudging it toward 1 with the volume leaves long trails in loud passages and a clean frame in quiet ones.',
    code: {
      perFrame: [
        'decay = 0.94 + 0.05*min(max((bass_att + mid_att)/2 - 0.7, 0), 1);',
      ],
    },
  },
];

const BLOCK_KEY: Record<RecipeBlock, { write: string; read: RegExp }> = {
  // `init_N` is an older spelling some drafts still carry.
  init: {
    write: 'per_frame_init_',
    read: /^\s*(?:per_frame_)?init_(\d+)\s*=/iu,
  },
  perFrame: { write: 'per_frame_', read: /^\s*per_frame_(\d+)\s*=/iu },
  perPixel: { write: 'per_pixel_', read: /^\s*per_pixel_(\d+)\s*=/iu },
};

const shaderHeader = /^\s*\[\s*(?:warp_shader|comp_shader)\s*\]\s*$/iu;

/**
 * The source with the recipe's lines added, each after the last line of its
 * block with the next free number (a new block goes before any shader
 * section, where the parser would swallow it). `firstLine` is the 1-based
 * line of the first added line, to move the cursor to.
 */
export function applyRecipe(
  source: string,
  recipe: Recipe,
): { source: string; firstLine: number } {
  const lines = source.replace(/\n$/u, '').split('\n');
  let firstLine = Number.MAX_SAFE_INTEGER;
  const insertedAt: number[] = [];

  for (const block of ['init', 'perFrame', 'perPixel'] as const) {
    const code = recipe.code[block];
    if (!code || code.length === 0) continue;
    const { write, read } = BLOCK_KEY[block];
    let last = -1;
    let highest = 0;
    lines.forEach((line, index) => {
      const match = read.exec(line);
      if (!match) return;
      last = index;
      highest = Math.max(highest, Number(match[1]));
    });
    const added = code.map(
      (text, offset) => `${write}${highest + offset + 1}=${text}`,
    );
    let at = last + 1;
    if (last < 0) {
      const shader = lines.findIndex((line) => shaderHeader.test(line));
      at = shader < 0 ? lines.length : shader;
    }
    lines.splice(at, 0, ...added);
    // Earlier insertions below this point moved down.
    for (let i = 0; i < insertedAt.length; i += 1) {
      if ((insertedAt[i] as number) >= at) {
        insertedAt[i] = (insertedAt[i] as number) + added.length;
      }
    }
    insertedAt.push(at);
  }
  for (const at of insertedAt) firstLine = Math.min(firstLine, at + 1);
  return {
    source: `${lines.join('\n')}\n`,
    firstLine: firstLine === Number.MAX_SAFE_INTEGER ? 1 : firstLine,
  };
}
