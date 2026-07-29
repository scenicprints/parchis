// Draws the home-screen icons: a miniature of the board itself, so the tile
// reads as Parchís at a glance. No image library, just pixels and zlib.
//
//   node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');

// ── A minimal PNG writer ─────────────────────────────────────────────
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha

  // Every scanline gets a leading filter byte, which we leave at 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── The picture ──────────────────────────────────────────────────────
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const BG    = hex('#0E1116');
const LANE  = hex('#1B222C');
const IDLE  = hex('#182029');
const RED   = hex('#E4443A');
const BLUE  = hex('#3D8BFD');
const GOLD  = hex('#D6A93B');

// Distance outside a rounded rectangle, for anti-aliased edges.
function outside(px, py, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - px, 0, px - (x1 - r));
  const dy = Math.max(y0 + r - py, 0, py - (y1 - r));
  return Math.hypot(dx, dy) - r;
}

function blend(out, i, rgb, a) {
  out[i]     = Math.round(out[i]     * (1 - a) + rgb[0] * a);
  out[i + 1] = Math.round(out[i + 1] * (1 - a) + rgb[1] * a);
  out[i + 2] = Math.round(out[i + 2] * (1 - a) + rgb[2] * a);
  out[i + 3] = Math.max(out[i + 3], Math.round(255 * a));
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);       // transparent to start
  const u = size / 19;                             // one board square
  const soft = size / 190;                         // edge feather

  // The rounded tile itself.
  const tile = { x0: 0, y0: 0, x1: size, y1: size, r: size * 0.22 };

  // Four corners and the centre, in board squares.
  const boxes = [
    { x0: 0.4,  y0: 0.4,  x1: 7.6,  y1: 7.6,  c: IDLE, r: 1.2 },   // top left
    { x0: 11.4, y0: 0.4,  x1: 18.6, y1: 7.6,  c: BLUE, r: 1.2 },   // top right
    { x0: 0.4,  y0: 11.4, x1: 7.6,  y1: 18.6, c: RED,  r: 1.2 },   // bottom left
    { x0: 11.4, y0: 11.4, x1: 18.6, y1: 18.6, c: IDLE, r: 1.2 },   // bottom right
    { x0: 8.15, y0: 0.4,  x1: 10.85, y1: 18.6, c: LANE, r: 0.8 },  // vertical arm
    { x0: 0.4,  y0: 8.15, x1: 18.6, y1: 10.85, c: LANE, r: 0.8 },  // horizontal arm
    { x0: 8.4,  y0: 8.4,  x1: 10.6, y1: 10.6, c: GOLD, r: 0.5 },   // the middle
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      const cut = outside(px, py, tile.x0, tile.y0, tile.x1, tile.y1, tile.r);
      const a = Math.min(Math.max(0.5 - cut / soft, 0), 1);
      if (a <= 0) continue;
      blend(buf, i, BG, a);

      for (const b of boxes) {
        const d = outside(px, py, b.x0 * u, b.y0 * u, b.x1 * u, b.y1 * u, b.r * u);
        const ba = Math.min(Math.max(0.5 - d / soft, 0), 1) * a;
        if (ba > 0) blend(buf, i, b.c, ba);
      }
    }
  }
  return png(size, buf);
}

for (const size of [180, 192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, draw(size));
  console.log(`wrote icon-${size}.png`);
}
