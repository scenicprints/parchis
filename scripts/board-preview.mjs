// Renders a still of the board to preview.svg, using the real geometry from
// board.js so the picture cannot drift away from the game.
//
//   node scripts/board-preview.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RING, COLUMN, NEST_BOX, nestSlots } from '../docs/board.js';
import { SAFE, ENTRY, COL_BASE, NEST, HOME } from '../docs/rules.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'preview.svg');

const TINT = { red: '#E4443A', blue: '#3D8BFD' };
const PLAYED = new Set(['red', 'blue']);
const out = [];
const add = (s) => out.push(s);

// A believable middle of a game: red running for home with a wall out on the
// left arm, blue coming down its own column.
const PAWNS = {
  red:  [49, 49, 53, ENTRY.red],
  blue: [COL_BASE + 3, HOME, 33, NEST],
};
const SELECTED = { color: 'red', pos: 49, moves: [[51, 2], [55, 6]] };

add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 20 20" width="640" height="640">`);
add(`<rect x="-0.5" y="-0.5" width="20" height="20" rx="0.6" fill="#10151C"/>`);

// ── corners ──────────────────────────────────────────────────────────
for (const [color, b] of Object.entries(NEST_BOX)) {
  const live = PLAYED.has(color);
  add(`<rect x="${b.x + 0.35}" y="${b.y + 0.35}" width="7.3" height="7.3" rx="1.1" fill="${
    live ? TINT[color] : '#141A22'}" fill-opacity="${live ? 0.16 : 1}" stroke="${
    live ? TINT[color] : '#1D2530'}" stroke-opacity="${live ? 0.55 : 1}" stroke-width="0.09"/>`);
  if (!live) continue;
  for (const s of nestSlots(color)) {
    add(`<circle cx="${s.x + 0.5}" cy="${s.y + 0.5}" r="0.44" fill="#0D1219" stroke="${
      TINT[color]}" stroke-opacity="0.4" stroke-width="0.07"/>`);
  }
}

// ── the ring ─────────────────────────────────────────────────────────
const owner = {};
for (const [c, i] of Object.entries(ENTRY)) owner[i] = c;

RING.forEach((c, i) => {
  const own = owner[i];
  const live = own && PLAYED.has(own);
  const safe = SAFE.has(i);
  add(`<rect x="${c.x + 0.06}" y="${c.y + 0.06}" width="0.88" height="0.88" rx="0.2" fill="${
    live ? TINT[own] : '#1B222C'}" fill-opacity="${live ? 0.5 : 1}" stroke="${
    safe ? '#D6A93B' : '#232B36'}" stroke-opacity="${safe ? 0.75 : 1}" stroke-width="${
    safe ? 0.075 : 0.05}"/>`);
  if (safe && !live) {
    const pts = [];
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 0.105 : 0.24;
      const a = (Math.PI / 5) * k - Math.PI / 2;
      pts.push(`${(c.x + 0.5 + Math.cos(a) * r).toFixed(3)},${(c.y + 0.5 + Math.sin(a) * r).toFixed(3)}`);
    }
    add(`<polygon points="${pts.join(' ')}" fill="#D6A93B" fill-opacity="0.5"/>`);
  }
});

// ── home columns ─────────────────────────────────────────────────────
for (const [color, cells] of Object.entries(COLUMN)) {
  const live = PLAYED.has(color);
  cells.forEach((c, i) => {
    add(`<rect x="${c.x + 0.06}" y="${c.y + 0.06}" width="0.88" height="0.88" rx="0.2" fill="${
      live ? TINT[color] : '#182029'}" fill-opacity="${
      live ? (0.3 + (i / (cells.length - 1)) * 0.45).toFixed(3) : 1
    }" stroke="#232B36" stroke-width="0.05"/>`);
  });
}

// ── the centre ───────────────────────────────────────────────────────
add(`<rect x="8.1" y="8.1" width="2.8" height="2.8" rx="0.5" fill="#0D1219" stroke="#2A3441" stroke-width="0.08"/>`);
add(`<path d="M8.35 8.35 H10.65 L9.5 9.5 Z" fill="${TINT.blue}" fill-opacity="0.75"/>`);
add(`<path d="M8.35 10.65 H10.65 L9.5 9.5 Z" fill="${TINT.red}" fill-opacity="0.75"/>`);

// ── where the selected pawn could go ─────────────────────────────────
for (const [square, steps] of SELECTED.moves) {
  const c = RING[square];
  add(`<g><circle cx="${c.x + 0.5}" cy="${c.y + 0.5}" r="0.42" fill="rgba(242,193,78,.20)" stroke="#F2C14E" stroke-width="0.07"/>`);
  add(`<text x="${c.x + 0.5}" y="${c.y + 0.5}" fill="#F2C14E" font-family="sans-serif" font-size="0.46" font-weight="800" text-anchor="middle" dominant-baseline="central">${steps}</text></g>`);
}

// ── pawns ────────────────────────────────────────────────────────────
const cellOf = (color, pos) => {
  if (pos >= 0 && pos < 68) return RING[pos];
  if (pos >= COL_BASE && pos < COL_BASE + 7) return COLUMN[color][pos - COL_BASE];
  return { x: 9, y: 9 };
};

const groups = new Map();
const spots = [];
for (const [color, list] of Object.entries(PAWNS)) {
  list.forEach((pos, i) => {
    if (pos === NEST) {
      const s = nestSlots(color)[i];
      spots.push({ color, x: s.x + 0.5, y: s.y + 0.5, r: 0.34, sel: false });
      return;
    }
    const key = pos === HOME ? `h${color}` : `s${pos}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ color, pos });
  });
}
for (const list of groups.values()) {
  list.forEach((p, n) => {
    if (p.pos === HOME) {
      const dir = p.color === 'red' ? 1 : -1;
      spots.push({ color: p.color, x: 9.5, y: 9.5 + dir * (0.45 + n * 0.27), r: 0.19, sel: false });
      return;
    }
    const c = cellOf(p.color, p.pos);
    const many = list.length > 1;
    const off = many ? -0.15 + (n * 0.3) / (list.length - 1) : 0;
    spots.push({
      color: p.color, x: c.x + 0.5 + off, y: c.y + 0.5 + off,
      r: many ? 0.26 : 0.34,
      sel: p.color === SELECTED.color && p.pos === SELECTED.pos && n === 0,
    });
  });
}

for (const s of spots) {
  const rim = s.color === 'red' ? '#8E241D' : '#1B4C96';
  const glow = s.sel ? ' filter="drop-shadow(0 0 0.18px #F2C14E)"' : '';
  add(`<g${glow}>`);
  add(`<circle cx="${s.x}" cy="${s.y + 0.07}" r="${s.r}" fill="rgba(0,0,0,.45)"/>`);
  add(`<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${TINT[s.color]}" stroke="${rim}" stroke-width="0.09"/>`);
  if (s.sel) add(`<circle cx="${s.x}" cy="${s.y}" r="${s.r + 0.13}" fill="none" stroke="#F2C14E" stroke-width="0.08"/>`);
  add(`<circle cx="${s.x - 0.1 * (s.r / 0.34)}" cy="${s.y - 0.11 * (s.r / 0.34)}" r="${0.13 * (s.r / 0.34)}" fill="#fff" fill-opacity="0.32"/>`);
  add(`</g>`);
}

add(`</svg>`);
writeFileSync(OUT, out.join('\n'));
console.log(`wrote ${OUT}`);
