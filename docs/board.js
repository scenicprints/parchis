// ═══════════════════════════════════════════════════════════════════════
//  Where every square sits.
//
//  A 19×19 grid. Four arms, each 3 squares wide and 8 long, around a 3×3
//  centre. The ring runs clockwise: 8 squares up one side of an arm, one
//  square across the tip, 8 back down the other side, then it turns the
//  corner past the centre into the next arm.
//
//      8 lanes × 8 squares  +  4 tips  =  68
//
//  The middle lane of each arm is a home column: its outermost square is
//  the tip, which belongs to the ring, and the 7 behind it are the column.
// ═══════════════════════════════════════════════════════════════════════

import { ENTRY, TURN_IN, COL_LEN, SIDES } from './rules.js';

export const GRID = 19;

function buildRing() {
  const cells = [];
  const at = (x, y) => cells.push({ x, y });

  for (let y = 7; y >= 0; y--) at(8, y);        //  0–7   top arm, left lane, going up
  at(9, 0);                                     //  8     top tip
  for (let y = 0; y <= 7; y++) at(10, y);       //  9–16  top arm, right lane, going down
  for (let x = 11; x <= 18; x++) at(x, 8);      // 17–24  right arm, upper lane
  at(18, 9);                                    // 25     right tip
  for (let x = 18; x >= 11; x--) at(x, 10);     // 26–33  right arm, lower lane
  for (let y = 11; y <= 18; y++) at(10, y);     // 34–41  bottom arm, right lane
  at(9, 18);                                    // 42     bottom tip
  for (let y = 18; y >= 11; y--) at(8, y);      // 43–50  bottom arm, left lane
  for (let x = 7; x >= 0; x--) at(x, 10);       // 51–58  left arm, lower lane
  at(0, 9);                                     // 59     left tip
  for (let x = 0; x <= 7; x++) at(x, 8);        // 60–67  left arm, upper lane

  return cells;
}

export const RING = buildRing();

// Each colour's column runs from just behind its tip in towards the centre.
export const COLUMN = {
  blue:   Array.from({ length: COL_LEN }, (_, i) => ({ x: 9,          y: 1 + i })),
  green:  Array.from({ length: COL_LEN }, (_, i) => ({ x: 17 - i,     y: 9 })),
  red:    Array.from({ length: COL_LEN }, (_, i) => ({ x: 9,          y: 17 - i })),
  yellow: Array.from({ length: COL_LEN }, (_, i) => ({ x: 1 + i,      y: 9 })),
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
// Red arrives from below, blue from above, so they pile away from each other.
export function homeSlot(color, n) {
  const towards = color === 'red' ? 1 : -1;
  return { x: 9, y: 9 + towards * (0.45 + n * 0.27) };
}

// The centre triangles, one per colour, pointing inwards.
export const CENTRE = { x: 8, y: 8, size: 3 };

// A sanity check the tests lean on: the ring really is 68 squares, every
// entry is 17 from the next, and each turn-in really is an arm tip.
export const TIPS = [8, 25, 42, 59];

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
    const tip = RING[TURN_IN[color]];
    if (!TIPS.includes(TURN_IN[color])) {
      problems.push(`${color} turns in at ${TURN_IN[color]}, which is not a tip`);
    }
    const first = COLUMN[color][0];
    if (Math.abs(tip.x - first.x) + Math.abs(tip.y - first.y) !== 1) {
      problems.push(`${color}'s column does not start beside its tip`);
    }
  }

  for (const color of SIDES) {
    const entry = RING[ENTRY[color]];
    const box = NEST_BOX[color];
    const near = entry.x >= box.x - 1 && entry.x <= box.x + 8 &&
                 entry.y >= box.y - 1 && entry.y <= box.y + 8;
    if (!near) problems.push(`${color} enters the ring nowhere near its corner`);
  }

  return problems;
}
