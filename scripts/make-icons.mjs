// Generates square PNG app icons without external dependencies.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size * 0.42;
  const cy = size * 0.4;
  const dot = size * 0.075;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const i = rowStart + 1 + x * 4;
      // base colour #0c0c11 with a soft radial accent
      let r = 12;
      let g = 12;
      let b = 17;
      const glow = Math.max(0, 1 - Math.hypot(x - size * 0.85, y - size * 0.1) / (size * 0.7));
      r += Math.round(70 * glow * 0.9);
      g += Math.round(40 * glow * 0.9);
      b += Math.round(140 * glow * 0.9);

      const t = y / size;
      const ar = Math.round(139 + (59 - 139) * t);
      const ag = Math.round(92 + (130 - 92) * t);
      const ab = Math.round(246 + (246 - 246) * t);

      // "L" glyph drawn as two thick bars
      const barW = size * 0.09;
      const vx = size * 0.3;
      const vyTop = size * 0.26;
      const vyBottom = size * 0.74;
      const hxEnd = size * 0.68;
      const inVertical = x >= vx && x <= vx + barW && y >= vyTop && y <= vyBottom;
      const inHorizontal = y >= vyBottom - barW && y <= vyBottom && x >= vx && x <= hxEnd;
      if (inVertical || inHorizontal) {
        r = ar; g = ag; b = ab;
      }

      // accent dot
      if (Math.hypot(x - cx - size * 0.17, y - cy) < dot) {
        r = ar; g = ag; b = ab;
      }

      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size));
  console.log(`wrote public/icon-${size}.png`);
}
