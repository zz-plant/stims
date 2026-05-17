const ESC = '\x1b';
const CLEAR_SCREEN = `${ESC}[2J`;
const HOME = `${ESC}[H`;
const CLEAR_BELOW = `${ESC}[0J`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1: number, g1: number, b1: number;
  if (h < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (h < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function ansiFg(r: number, g: number, b: number): string {
  return `${ESC}[38;2;${r};${g};${b}m`;
}

function ansiBg(r: number, g: number, b: number): string {
  return `${ESC}[48;2;${r};${g};${b}m`;
}

const RESET = `${ESC}[0m`;

export interface TerminalFrame {
  width: number;
  height: number;
  rows: number;
  cols: number;
}

export interface RenderOptions {
  tmux: boolean;
  hideCursor: boolean;
}

let options: RenderOptions = { tmux: false, hideCursor: true };

export function setRenderOptions(opts: Partial<RenderOptions>) {
  options = { ...options, ...opts };
}

function isTmux(): boolean {
  const term = process.env.TERM ?? '';
  return term.includes('screen') || term.includes('tmux');
}

export function autoDetectTmux() {
  options.tmux = isTmux();
}

export function initTerminal(): TerminalFrame {
  if (options.hideCursor) process.stdout.write(HIDE_CURSOR);
  if (!options.tmux) process.stdout.write(CLEAR_SCREEN);
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const compactCols = options.tmux ? Math.min(cols, 60) : cols;
  return { width: compactCols, height: rows * 2, rows, cols: compactCols };
}

export function restoreTerminal() {
  if (options.hideCursor) process.stdout.write(SHOW_CURSOR);
  if (options.tmux) {
    process.stdout.write(`${HOME}${CLEAR_BELOW}`);
  } else {
    process.stdout.write(`${CLEAR_SCREEN}${HOME}`);
  }
}

export class Canvas {
  frame: TerminalFrame;
  private bg: Uint8Array;
  private bgColor: Uint32Array;
  private overlayLines: Array<{
    row: number;
    col: number;
    text: string;
    r: number;
    g: number;
    b: number;
  }> = [];

  constructor(frame: TerminalFrame) {
    this.frame = frame;
    const len = frame.width * frame.height;
    this.bg = new Uint8Array(len);
    this.bgColor = new Uint32Array(len);
  }

  setSize(frame: TerminalFrame) {
    this.frame = frame;
    const len = frame.width * frame.height;
    this.bg = new Uint8Array(len);
    this.bgColor = new Uint32Array(len);
  }

  fill(r: number, g: number, b: number) {
    const packed = (r << 16) | (g << 8) | b;
    this.bg.fill(1);
    this.bgColor.fill(packed);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= this.frame.width || y < 0 || y >= this.frame.height)
      return;
    const idx = y * this.frame.width + x;
    const packed = (r << 16) | (g << 8) | b;
    if (a >= 1) {
      this.bg[idx] = 1;
      this.bgColor[idx] = packed;
    } else {
      this.bg[idx] = 1;
      const exist = this.bgColor[idx]!;
      const er = (exist >> 16) & 0xff;
      const eg = (exist >> 8) & 0xff;
      const eb = exist & 0xff;
      this.bgColor[idx] =
        (Math.round(er + (r - er) * a) << 16) |
        (Math.round(eg + (g - eg) * a) << 8) |
        Math.round(eb + (b - eb) * a);
    }
  }

  text(row: number, col: number, str: string, r: number, g: number, b: number) {
    if (row < 0 || row >= this.frame.rows) return;
    this.overlayLines.push({ row, col: Math.max(0, col), text: str, r, g, b });
  }

  render() {
    const { width, rows, cols } = this.frame;
    const lines: string[] = [];
    if (!options.tmux) lines.push(CLEAR_SCREEN);
    lines.push(HOME);

    for (let row = 0; row < rows; row++) {
      let line = '';
      let lastFg = -1;
      let lastBg = -1;

      for (let col = 0; col < cols; col++) {
        const top = row * 2 * width + col;
        const bot = (row * 2 + 1) * width + col;
        const topSet = this.bg[top]! === 1;
        const botSet = this.bg[bot]! === 1;

        if (!topSet && !botSet) {
          line += ' ';
          continue;
        }

        const tc = topSet ? this.bgColor[top]! : 0;
        const bc = botSet ? this.bgColor[bot]! : 0;

        if (!topSet) {
          const r = (bc >> 16) & 0xff,
            g = (bc >> 8) & 0xff,
            b = bc & 0xff;
          if (lastFg !== bc) {
            line += ansiFg(r, g, b);
            lastFg = bc;
          }
          line += '▄';
        } else if (!botSet) {
          const r = (tc >> 16) & 0xff,
            g = (tc >> 8) & 0xff,
            b = tc & 0xff;
          if (lastFg !== tc) {
            line += ansiFg(r, g, b);
            lastFg = tc;
          }
          line += '▀';
        } else {
          const tr = (tc >> 16) & 0xff,
            tg = (tc >> 8) & 0xff,
            tb = tc & 0xff;
          const br = (bc >> 16) & 0xff,
            bg2 = (bc >> 8) & 0xff,
            bb = bc & 0xff;
          if (lastFg !== tc) {
            line += ansiFg(tr, tg, tb);
          }
          if (lastBg !== bc) {
            line += ansiBg(br, bg2, bb);
          }
          lastFg = tc;
          lastBg = bc;
          line += '▀';
        }
      }
      if (lastFg !== -1 || lastBg !== -1) line += RESET;
      lastFg = -1;
      lastBg = -1;

      for (const ov of this.overlayLines) {
        if (ov.row === row && ov.col < line.length) {
          const prefix = line.slice(0, ov.col);
          const suffix = line.slice(ov.col + ov.text.length);
          line = prefix + ansiFg(ov.r, ov.g, ov.b) + ov.text + RESET + suffix;
        }
      }

      lines.push(line);
    }

    this.overlayLines.length = 0;

    if (options.tmux) {
      lines.push(`${ESC}[0m${CLEAR_BELOW}`);
    }

    process.stdout.write(lines.join('\n'));
  }
}
