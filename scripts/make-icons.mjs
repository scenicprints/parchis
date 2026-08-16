// Draws the home-screen icons: three fanned cards carrying a red token and a
// blue one. Two people, a handful of games, which is the whole app. It used
// to be a miniature of the Parchís board, from when Parchís was all there
// was. No image library, just pixels and zlib.
//
//   node scripts/make-icons.mjs
//
// The icon on a phone only changes when the app is added to the home screen
// again, so this landing does not move the tile on a phone that already has
// one. That is expected and is not worth chasing.

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
const INK   = hex('#080B0F');
const CARD  = hex('#F7F2E6');
const SHADE = hex('#D8D2C2');
const RED   = hex('#E4443A');
const BLUE  = hex('#3D8BFD');

// Distance outside a rounded rectangle, for anti-aliased edges.
function outside(px, py, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - px, 0, px - (x1 - r));
  const dy = Math.max(y0 + r - py, 0, py - (y1 - r));
  return Math.hypot(dx, dy) - r;
}

// The same thing for a shape that has been turned on the spot. The sample
// point is spun backwards about the shape's own centre and then measured
// against the upright rectangle, which is far less work than turning the
// rectangle. A circle is just one of these with its corner radius set to
// half its side.
function distance(px, py, b, u) {
  const x0 = b.x0 * u, y0 = b.y0 * u, x1 = b.x1 * u, y1 = b.y1 * u;
  if (!b.rot) return outside(px, py, x0, y0, x1, y1, b.r * u);

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const t = -b.rot * Math.PI / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  const qx = (px - cx) * cos - (py - cy) * sin;
  const qy = (px - cx) * sin + (py - cy) * cos;
  return outside(qx + cx, qy + cy, x0, y0, x1, y1, b.r * u);
}

function blend(out, i, rgb, a) {
  out[i]     = Math.round(out[i]     * (1 - a) + rgb[0] * a);
  out[i + 1] = Math.round(out[i + 1] * (1 - a) + rgb[1] * a);
  out[i + 2] = Math.round(out[i + 2] * (1 - a) + rgb[2] * a);
  out[i + 3] = Math.max(out[i + 3], Math.round(255 * a));
}

// One card: a dark plate a little larger than the card, then the card on
// top of it. That plate is what separates each card from the one behind,
// since there is no stroke to draw with, only fills.
const CARD_W = 6.8;
const CARD_H = 9.6;
const EDGE = 0.42;

function card(cx, cy, rot, fill) {
  const box = (grow, c) => ({
    x0: cx - CARD_W / 2 - grow, x1: cx + CARD_W / 2 + grow,
    y0: cy - CARD_H / 2 - grow, y1: cy + CARD_H / 2 + grow,
    r: 0.85 + grow, rot, c,
  });
  return [box(EDGE, INK), box(0, fill)];
}

const dot = (cx, cy, r, c) =>
  ({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, r, c });

// A hand of cards is held at the bottom, so the cards turn about a point
// below all of them: the tops splay and the bottoms stay together. Turning
// each card about its own centre instead splays both ends and comes out
// looking like three cards dropped on a table.
const FAN = { x: 9.5, y: 14.2 };        // where the hand holds them
const FRONT_Y = 9.0;                    // the middle of the upright card

function fanned(rot, fill) {
  const t = rot * Math.PI / 180;
  const reach = FRONT_Y - FAN.y;        // up from the hand to the card's middle
  return card(FAN.x - reach * Math.sin(t), FAN.y + reach * Math.cos(t), rot, fill);
}

// Android crops a maskable icon to whatever shape it feels like, and only
// promises to keep the middle 80% across. Anything outside a circle of that
// diameter can be cut off, so the mark is measured and shrunk to sit inside
// it rather than being drawn to the edges and hoping. The old board icon
// ran corner to corner and had its corners quietly taken off.
const SAFE = 19 * 0.4;                             // radius, in grid units

function fit(boxes) {
  const c = 9.5;
  let far = 0;
  for (const b of boxes) {
    const hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
    const bx = (b.x0 + b.x1) / 2 - c, by = (b.y0 + b.y1) / 2 - c;
    const t = (b.rot || 0) * Math.PI / 180;
    const cos = Math.cos(t), sin = Math.sin(t);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = bx + sx * hw * cos - sy * hh * sin;
      const y = by + sx * hw * sin + sy * hh * cos;
      far = Math.max(far, Math.hypot(x, y));
    }
  }
  if (far <= SAFE) return boxes;
  const k = SAFE / far;
  return boxes.map((b) => ({
    ...b,
    x0: c + (b.x0 - c) * k, x1: c + (b.x1 - c) * k,
    y0: c + (b.y0 - c) * k, y1: c + (b.y1 - c) * k,
    r: b.r * k,
  }));
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);       // transparent to start
  const u = size / 19;                             // the grid the mark is laid out on
  const soft = size / 190;                         // edge feather

  // The rounded tile itself.
  const tile = { x0: 0, y0: 0, x1: size, y1: size, r: size * 0.22 };

  // Three cards fanned out, the two behind knocked back a shade so they
  // read as being underneath, and two tokens on the front one: one red,
  // one blue, which is the two of them.
  const boxes = fit([
    ...fanned(-22, SHADE),
    ...fanned(22, SHADE),
    ...fanned(0, CARD),
    dot(8.1, FRONT_Y, 1.1, RED),
    dot(10.9, FRONT_Y, 1.1, BLUE),
  ]);

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
        const d = distance(px, py, b, u);
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
