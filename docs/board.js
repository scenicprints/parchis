// ═══════════════════════════════════════════════════════════════════════
//  Where every square sits.
//
//  A 19×19 grid. Four arms, each 3 squares wide and 8 long, around a 3×3
//  centre. The ring runs anticlockwise: down one lane of an arm, round the
//  next corner, and so on, arriving at each arm tip from the far side.
//
//      8 lanes × 8 squares  +  4 tips  =  68
//
//  The middle lane of each arm is a home column: its outermost square is
//  the tip, which belongs to the ring, and the 7 behind it are the column.
//
//  Each colour's nest sits in the corner *before* its own arm, so a pawn
//  leaves the nest onto the square beside its own corner and then has the
//  whole board to cross — 63 squares — before it reaches its ramp.
// ═══════════════════════════════════════════════════════════════════════

import { ENTRY, TURN_IN, COL_LEN, LAP_LEN, SIDES } from './rules.js';

export const GRID = 19;

// The lanes, laid out clockwise, exactly as they sit on the grid. The ring
// itself runs the other way, so a pawn reaches its own tip last rather than
// first — which is what puts each colour's entry beside its own corner.
function buildRing() {
  const cells = [];
  const at = (x, y) => cells.push({ x, y });

  for (let y = 7; y >= 0; y--) at(8, y);        // top arm, left lane
  at(9, 0);                                     // top tip
  for (let y = 0; y <= 7; y++) at(10, y);       // top arm, right lane
  for (let x = 11; x <= 18; x++) at(x, 8);      // right arm, upper lane
  at(18, 9);                                    // right tip
  for (let x = 18; x >= 11; x--) at(x, 10);     // right arm, lower lane
  for (let y = 11; y <= 18; y++) at(10, y);     // bottom arm, right lane
  at(9, 18);                                    // bottom tip
  for (let y = 18; y >= 11; y--) at(8, y);      // bottom arm, left lane
  for (let x = 7; x >= 0; x--) at(x, 10);       // left arm, lower lane
  at(0, 9);                                     // left tip
  for (let x = 0; x <= 7; x++) at(x, 8);        // left arm, upper lane

  // Reverse everything but the first square, so square 0 stays put and the
  // ring runs anticlockwise from there.
  return [cells[0], ...cells.slice(1).reverse()];
}

export const RING = buildRing();

// Each colour's column runs from just behind its tip in towards the centre.
// A colour's arm is the one clockwise of its corner: yellow sits top-left
// and owns the top arm, blue sits top-right and owns the right arm, and so
// on around the board.
export const COLUMN = {
  yellow: Array.from({ length: COL_LEN }, (_, i) => ({ x: 9,      y: 1 + i })),
  blue:   Array.from({ length: COL_LEN }, (_, i) => ({ x: 17 - i, y: 9      })),
  green:  Array.from({ length: COL_LEN }, (_, i) => ({ x: 9,      y: 17 - i })),
  red:    Array.from({ length: COL_LEN }, (_, i) => ({ x: 1 + i,  y: 9      })),
};

// The starting corners. Red bottom-left, blue top-right, so the two of you
// sit diagonally opposite.
export const NEST_BOX = {
  yellow: { x: 0,  y: 0  },
  blue:   { x: 11, y: 0  },
  red:    { x: 0,  y: 11 },
  green:  { x: 11, y: 11 },
};

// Everything below is in the same units as RING: whole numbers are square
// corners, so the middle of a square is its coordinates plus a half.

// Four resting spots inside an 8×8 corner, laid out as a square.
export function nestSlots(color) {
  const b = NEST_BOX[color];
  return [
    { x: b.x + 2, y: b.y + 2 },
    { x: b.x + 5, y: b.y + 2 },
    { x: b.x + 2, y: b.y + 5 },
    { x: b.x + 5, y: b.y + 5 },
  ];
}

// Finished pawns stack in the centre, offset a little so you can count them.
// Red arrives from the left, blue from the right, so they pile away from
// each other along the line their two columns share.
export function homeSlot(color, n) {
  const towards = color === 'red' ? -1 : 1;
  return { x: 9 + towards * (0.45 + n * 0.27), y: 9 };
}

// The centre triangles, one per colour, pointing inwards.
export const CENTRE = { x: 8, y: 8, size: 3 };

// A sanity check the tests lean on: the ring really is 68 squares, every
// entry is 17 from the next, each turn-in really is an arm tip, and the
// crossing from any entry to its own ramp is a full 63 squares.
export const TIPS = [9, 26, 43, 60];

export function verifyGeometry() {
  const problems = [];
  if (RING.length !== 68) problems.push(`ring is ${RING.length}, not 68`);

  const seen = new Set(RING.map((c) => `${c.x},${c.y}`));
  if (seen.size !== RING.length) problems.push('ring visits a square twice');

  // Consecutive squares must touch, either edge to edge along a lane or
  // corner to corner where the track rounds the centre.
  for (let i = 0; i < RING.length; i++) {
    const a = RING[i];
    const b = RING[(i + 1) % RING.length];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
      problems.push(`square ${i} does not touch ${(i + 1) % RING.length}`);
    }
  }

  for (const color of Object.keys(ENTRY)) {
    if (!TIPS.includes(TURN_IN[color])) {
      problems.push(`${color} turns in at ${TURN_IN[color]}, which is not a tip`);
    }

    const tip = RING[TURN_IN[color]];
    const first = COLUMN[color][0];
    if (Math.abs(tip.x - first.x) + Math.abs(tip.y - first.y) !== 1) {
      problems.push(`${color}'s column does not start beside its tip`);
    }

    const last = COLUMN[color][COL_LEN - 1];
    if (Math.abs(last.x - 9) + Math.abs(last.y - 9) !== 2) {
      problems.push(`${color}'s column does not end beside the centre`);
    }

    const lap = (TURN_IN[color] - ENTRY[color] + RING.length) % RING.length;
    if (lap !== LAP_LEN) {
      problems.push(`${color} crosses ${lap} squares, not ${LAP_LEN}`);
    }
  }

  // Every entry must sit against its own corner, on the side the pawn
  // steps out onto.
  for (const color of Object.keys(ENTRY)) {
    const e = RING[ENTRY[color]];
    const b = NEST_BOX[color];
    const alongY = e.y >= b.y && e.y <= b.y + 7 && (e.x === b.x - 1 || e.x === b.x + 8);
    const alongX = e.x >= b.x && e.x <= b.x + 7 && (e.y === b.y - 1 || e.y === b.y + 8);
    if (!alongY && !alongX) problems.push(`${color} does not enter beside its own corner`);
  }

  const spaced = Object.values(ENTRY).sort((a, b) => a - b);
  for (let i = 1; i < spaced.length; i++) {
    if (spaced[i] - spaced[i - 1] !== 17) problems.push('entries are not 17 apart');
  }

  return problems;
}
