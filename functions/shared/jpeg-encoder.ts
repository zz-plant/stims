// Baseline JPEG encoder for the edge social card.
//
// resvg only writes PNG, and a truecolor PNG of a card that is mostly a
// full-bleed preset frame comes out at 0.5–1.8MB. jpeg-js would do this job
// but returns a Node Buffer once bundled, and the site Worker runs without
// nodejs_compat; this is the same baseline sequential encoder written against
// typed arrays. Chroma is kept at full resolution (4:4:4) so the small coral
// brand lockup does not bleed into the scrim behind it.

// Annex K example tables, in natural (row-major) order.
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56,
  99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99,
];

// ZIGZAG[k] is the natural-order index of the k-th coefficient in scan order.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

// Annex K.3 Huffman tables: code counts per length 1..16, then symbols.
type HuffmanSpec = { counts: number[]; symbols: number[] };
const DC_LUMA: HuffmanSpec = {
  counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const DC_CHROMA: HuffmanSpec = {
  counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const AC_LUMA: HuffmanSpec = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  symbols: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};
const AC_CHROMA: HuffmanSpec = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  symbols: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41,
    0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
    0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1,
    0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44,
    0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
    0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74,
    0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a,
    0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7,
    0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

type HuffmanTable = { codes: Uint16Array; lengths: Uint8Array };

// Canonical Huffman codes (Annex C) indexed by symbol.
function buildHuffman({ counts, symbols }: HuffmanSpec): HuffmanTable {
  const codes = new Uint16Array(256);
  const lengths = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]; i++) {
      codes[symbols[k]] = code;
      lengths[symbols[k]] = length;
      code++;
      k++;
    }
    code <<= 1;
  }
  return { codes, lengths };
}

const HUFFMAN = {
  dcLuma: buildHuffman(DC_LUMA),
  acLuma: buildHuffman(AC_LUMA),
  dcChroma: buildHuffman(DC_CHROMA),
  acChroma: buildHuffman(AC_CHROMA),
};

// IJG quality scaling: 50 is the Annex K table, 100 is all ones.
function scaleQuant(base: number[], quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  return Uint8Array.from(base, (v) =>
    Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))),
  );
}

// The AAN float DCT leaves each coefficient scaled by these factors (and 8);
// folding them into the quantizer divisors keeps the transform multiply-free
// of them.
const AAN_SCALE = [
  1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961,
  0.275899379,
];

function divisors(quant: Uint8Array): Float32Array {
  const out = new Float32Array(64);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 8 + col;
      out[i] = 1 / (quant[i] * AAN_SCALE[row] * AAN_SCALE[col] * 8);
    }
  }
  return out;
}

// In-place forward DCT of one 8x8 block (Arai–Agui–Nakajima, as in IJG's
// jfdctflt.c), rows then columns.
function forwardDct(block: Float32Array): void {
  for (let pass = 0; pass < 2; pass++) {
    const stride = pass === 0 ? 1 : 8;
    const step = pass === 0 ? 8 : 1;
    for (let line = 0; line < 8; line++) {
      const o = line * step;
      const d0 = block[o];
      const d1 = block[o + stride];
      const d2 = block[o + 2 * stride];
      const d3 = block[o + 3 * stride];
      const d4 = block[o + 4 * stride];
      const d5 = block[o + 5 * stride];
      const d6 = block[o + 6 * stride];
      const d7 = block[o + 7 * stride];
      const tmp0 = d0 + d7;
      const tmp7 = d0 - d7;
      const tmp1 = d1 + d6;
      const tmp6 = d1 - d6;
      const tmp2 = d2 + d5;
      const tmp5 = d2 - d5;
      const tmp3 = d3 + d4;
      const tmp4 = d3 - d4;
      // Even part.
      let tmp10 = tmp0 + tmp3;
      const tmp13 = tmp0 - tmp3;
      let tmp11 = tmp1 + tmp2;
      let tmp12 = tmp1 - tmp2;
      block[o] = tmp10 + tmp11;
      block[o + 4 * stride] = tmp10 - tmp11;
      const z1 = (tmp12 + tmp13) * 0.707106781;
      block[o + 2 * stride] = tmp13 + z1;
      block[o + 6 * stride] = tmp13 - z1;
      // Odd part.
      tmp10 = tmp4 + tmp5;
      tmp11 = tmp5 + tmp6;
      tmp12 = tmp6 + tmp7;
      const z5 = (tmp10 - tmp12) * 0.382683433;
      const z2 = 0.5411961 * tmp10 + z5;
      const z4 = 1.306562965 * tmp12 + z5;
      const z3 = tmp11 * 0.707106781;
      const z11 = tmp7 + z3;
      const z13 = tmp7 - z3;
      block[o + 5 * stride] = z13 + z2;
      block[o + 3 * stride] = z13 - z2;
      block[o + stride] = z11 + z4;
      block[o + 7 * stride] = z11 - z4;
    }
  }
}

class ByteWriter {
  bytes = new Uint8Array(1 << 18);
  length = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  byte(value: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = value;
  }

  word(value: number): void {
    this.byte((value >> 8) & 0xff);
    this.byte(value & 0xff);
  }

  // Entropy-coded bits, MSB first; a 0xFF data byte is followed by a stuffed
  // zero so a decoder does not read it as a marker.
  bits(code: number, length: number): void {
    this.bitBuffer = (this.bitBuffer << length) | code;
    this.bitCount += length;
    while (this.bitCount >= 8) {
      this.bitCount -= 8;
      const out = (this.bitBuffer >> this.bitCount) & 0xff;
      this.byte(out);
      if (out === 0xff) this.byte(0);
    }
    this.bitBuffer &= (1 << this.bitCount) - 1;
  }

  // Pads the last partial byte with ones, as the spec requires before a marker.
  flushBits(): void {
    if (this.bitCount > 0)
      this.bits((1 << (8 - this.bitCount)) - 1, 8 - this.bitCount);
  }
}

function writeHeaders(
  out: ByteWriter,
  width: number,
  height: number,
  lumaQuant: Uint8Array,
  chromaQuant: Uint8Array,
): void {
  out.word(0xffd8); // SOI
  // APP0 JFIF 1.01, no density, no thumbnail.
  out.word(0xffe0);
  out.word(16);
  for (const c of [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0]) out.byte(c);
  out.word(1);
  out.word(1);
  out.byte(0);
  out.byte(0);
  // DQT: both tables, 8-bit precision, in zigzag order.
  out.word(0xffdb);
  out.word(2 + 2 * 65);
  for (const [id, table] of [lumaQuant, chromaQuant].entries()) {
    out.byte(id);
    for (const natural of ZIGZAG) out.byte(table[natural]);
  }
  // SOF0: baseline, 8-bit, three components each sampled 1x1.
  out.word(0xffc0);
  out.word(8 + 3 * 3);
  out.byte(8);
  out.word(height);
  out.word(width);
  out.byte(3);
  for (const [id, quant] of [
    [1, 0],
    [2, 1],
    [3, 1],
  ]) {
    out.byte(id);
    out.byte(0x11);
    out.byte(quant);
  }
  // DHT: the four Annex K tables.
  const specs: Array<[number, HuffmanSpec]> = [
    [0x00, DC_LUMA],
    [0x10, AC_LUMA],
    [0x01, DC_CHROMA],
    [0x11, AC_CHROMA],
  ];
  out.word(0xffc4);
  out.word(
    2 + specs.reduce((sum, [, spec]) => sum + 17 + spec.symbols.length, 0),
  );
  for (const [classAndId, spec] of specs) {
    out.byte(classAndId);
    for (const count of spec.counts) out.byte(count);
    for (const symbol of spec.symbols) out.byte(symbol);
  }
  // SOS: all three components interleaved, full spectral range.
  out.word(0xffda);
  out.word(6 + 2 * 3);
  out.byte(3);
  for (const [id, tables] of [
    [1, 0x00],
    [2, 0x11],
    [3, 0x11],
  ]) {
    out.byte(id);
    out.byte(tables);
  }
  out.byte(0);
  out.byte(63);
  out.byte(0);
}

// Magnitude category (bit length) of a coefficient and its JPEG bit pattern:
// negative values are sent as one's complement in that many bits.
function category(value: number): number {
  let magnitude = value < 0 ? -value : value;
  let bits = 0;
  while (magnitude) {
    bits++;
    magnitude >>= 1;
  }
  return bits;
}

function encodeBlock(
  out: ByteWriter,
  block: Float32Array,
  scaled: Float32Array,
  divisor: Float32Array,
  previousDc: number,
  dc: HuffmanTable,
  ac: HuffmanTable,
): number {
  forwardDct(block);
  for (let i = 0; i < 64; i++) {
    scaled[i] = Math.round(block[ZIGZAG[i]] * divisor[ZIGZAG[i]]);
  }
  const value = scaled[0];
  const diff = value - previousDc;
  const dcBits = category(diff);
  out.bits(dc.codes[dcBits], dc.lengths[dcBits]);
  if (dcBits) out.bits(diff < 0 ? diff + (1 << dcBits) - 1 : diff, dcBits);
  let run = 0;
  for (let i = 1; i < 64; i++) {
    const coefficient = scaled[i];
    if (coefficient === 0) {
      run++;
      continue;
    }
    while (run > 15) {
      out.bits(ac.codes[0xf0], ac.lengths[0xf0]); // ZRL: sixteen zeros
      run -= 16;
    }
    const bits = category(coefficient);
    const symbol = (run << 4) | bits;
    out.bits(ac.codes[symbol], ac.lengths[symbol]);
    out.bits(
      coefficient < 0 ? coefficient + (1 << bits) - 1 : coefficient,
      bits,
    );
    run = 0;
  }
  if (run > 0) out.bits(ac.codes[0x00], ac.lengths[0x00]); // EOB
  return value;
}

/** Encodes opaque RGBA pixels (alpha ignored) as a baseline 4:4:4 JPEG. */
export function encodeJpeg(
  rgba: Uint8Array,
  width: number,
  height: number,
  quality: number,
): Uint8Array {
  const lumaQuant = scaleQuant(LUMA_QUANT, quality);
  const chromaQuant = scaleQuant(CHROMA_QUANT, quality);
  const lumaDivisor = divisors(lumaQuant);
  const chromaDivisor = divisors(chromaQuant);
  const out = new ByteWriter();
  writeHeaders(out, width, height, lumaQuant, chromaQuant);

  const y = new Float32Array(64);
  const cb = new Float32Array(64);
  const cr = new Float32Array(64);
  const scaled = new Float32Array(64);
  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;
  for (let top = 0; top < height; top += 8) {
    for (let left = 0; left < width; left += 8) {
      for (let row = 0; row < 8; row++) {
        // Edge blocks repeat the last row and column of the image.
        const sy = Math.min(top + row, height - 1);
        for (let col = 0; col < 8; col++) {
          const sx = Math.min(left + col, width - 1);
          const p = (sy * width + sx) * 4;
          const r = rgba[p];
          const g = rgba[p + 1];
          const b = rgba[p + 2];
          const i = row * 8 + col;
          // JFIF YCbCr, level-shifted to centre on zero.
          y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      dcY = encodeBlock(
        out,
        y,
        scaled,
        lumaDivisor,
        dcY,
        HUFFMAN.dcLuma,
        HUFFMAN.acLuma,
      );
      dcCb = encodeBlock(
        out,
        cb,
        scaled,
        chromaDivisor,
        dcCb,
        HUFFMAN.dcChroma,
        HUFFMAN.acChroma,
      );
      dcCr = encodeBlock(
        out,
        cr,
        scaled,
        chromaDivisor,
        dcCr,
        HUFFMAN.dcChroma,
        HUFFMAN.acChroma,
      );
    }
  }
  out.flushBits();
  out.word(0xffd9); // EOI
  return out.bytes.slice(0, out.length);
}

export type BudgetedJpegOptions = {
  /** Largest acceptable file, in bytes. */
  maxBytes: number;
  /** Qualities to try, best first. */
  qualities: readonly number[];
};

/**
 * Encodes at the first quality whose file fits in `maxBytes`. If none does,
 * the smallest attempt is returned: an oversized card still beats none for
 * every unfurler that is not counting bytes.
 */
export function encodeJpegWithin(
  rgba: Uint8Array,
  width: number,
  height: number,
  { maxBytes, qualities }: BudgetedJpegOptions,
): Uint8Array {
  let smallest: Uint8Array | null = null;
  for (const quality of qualities) {
    const jpeg = encodeJpeg(rgba, width, height, quality);
    if (jpeg.length <= maxBytes) return jpeg;
    if (!smallest || jpeg.length < smallest.length) smallest = jpeg;
  }
  if (!smallest) throw new Error('encodeJpegWithin needs at least one quality');
  return smallest;
}
