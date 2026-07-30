// Run with:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RING_LEN, COL_LEN, LAP_LEN, ROUTE_LEN, NEST, COL_BASE, HOME,
  ENTRY, TURN_IN, SAFE, newGame, walk, progress,
  legalActions, applyAction, applyRoll, isBarrier, mostAdvanced,
} from '../docs/rules.js';

import { RING, COLUMN, verifyGeometry, TIPS } from '../docs/board.js';

// ── A helper that puts the board exactly where a test needs it ────────
function board({ red = [NEST, NEST, NEST, NEST], blue = [NEST, NEST, NEST, NEST],
                 turn = 'red', pending = [], dice = null, phase = 'move' } = {}) {
  return {
    rev: 0, phase, turn, dice,
    pending: pending.map((v) => (typeof v === 'number' ? { v, kind: 'die' } : v)),
    pawns: { red: [...red], blue: [...blue] },
    doubles: 0, nestTries: 0, rolledAt: 0, winner: null, log: [],
  };
}

const find = (acts, pawn) => acts.find((a) => a.pawn === pawn);

// ═══════════════════════════════════════════════════════════════════
test('the board is the shape Parchís says it is', () => {
  assert.deepEqual(verifyGeometry(), []);
  assert.equal(RING.length, 68);
  for (const color of Object.keys(COLUMN)) {
    assert.equal(COLUMN[color].length, COL_LEN, `${color} column`);
  }
});

test('entries sit 17 apart and there are twelve safe squares', () => {
  const entries = Object.values(ENTRY).sort((a, b) => a - b);
  assert.equal(entries.length, 4);
  for (let i = 1; i < entries.length; i++) {
    assert.equal(entries[i] - entries[i - 1], 17);
  }
  assert.equal(SAFE.size, 12);
  for (const e of entries) assert.ok(SAFE.has(e), `entry ${e} must be safe`);
});

test('every turn-in is an arm tip, a full crossing from its own entry', () => {
  for (const color of Object.keys(ENTRY)) {
    assert.ok(TIPS.includes(TURN_IN[color]), `${color} turns in at a tip`);
    assert.equal((ENTRY[color] + LAP_LEN) % RING_LEN, TURN_IN[color]);
  }
});

// ═══════════════════════════════════════════════════════════════════
// The entry sits against the colour's own corner and the ramp is the tip of
// its own arm, so the crossing is 63 squares rather than a full 68.
test('a crossing is 63 squares, then 7 column squares, then the centre', () => {
  const e = ENTRY.red;
  assert.equal(walk('red', e, LAP_LEN).to, TURN_IN.red);           // 63, the ramp
  assert.equal(walk('red', e, LAP_LEN + 1).to, COL_BASE);          // first column square
  assert.equal(walk('red', e, LAP_LEN + COL_LEN).to, COL_BASE + 6); // last column square
  assert.equal(walk('red', e, LAP_LEN + COL_LEN + 1).to, HOME);    // the centre, exactly
  assert.equal(walk('red', e, LAP_LEN + COL_LEN + 2), null);       // one too many
});

test('you need the exact count to get in', () => {
  assert.equal(walk('red', COL_BASE + 5, 2).to, HOME);
  assert.equal(walk('red', COL_BASE + 5, 1).to, COL_BASE + 6);
  assert.equal(walk('red', COL_BASE + 5, 3), null);
  assert.equal(walk('red', HOME, 1), null);
  assert.equal(walk('red', NEST, 1), null);
});

test('progress runs 0 in the nest to 72 in the centre', () => {
  assert.equal(ROUTE_LEN, 72);
  assert.equal(progress('red', NEST), 0);
  assert.equal(progress('red', ENTRY.red), 1);
  assert.equal(progress('red', TURN_IN.red), LAP_LEN + 1);       // 64
  assert.equal(progress('red', COL_BASE), LAP_LEN + 2);          // 65
  assert.equal(progress('red', HOME), ROUTE_LEN);                // 72
});

// ═══════════════════════════════════════════════════════════════════
test('leaving the nest costs a 5, on one die or across both', () => {
  let s = board({ pending: [5, 3] });
  assert.ok(find(legalActions(s), 0), 'a single 5 opens the gate');

  s = board({ pending: [2, 3] });
  const both = legalActions(s).find((a) => a.type === 'exit');
  assert.ok(both, '2 and 3 add up to 5');
  assert.deepEqual(both.use, [0, 1], 'and it costs both dice');

  s = board({ pending: [4, 3] });
  assert.equal(legalActions(s).find((a) => a.type === 'exit'), undefined);
});

test('a bonus 20 cannot be spent letting a pawn out', () => {
  const s = board({ pending: [{ v: 20, kind: 'b20' }] });
  assert.equal(legalActions(s).find((a) => a.type === 'exit'), undefined);
});

test('all four in the nest gets three rolls to find a 5', () => {
  let s = board({ phase: 'roll' });
  s = applyRoll(s, [1, 2]);
  assert.equal(s.turn, 'red', 'still red');
  assert.equal(s.phase, 'roll', 'and red rolls again');

  s = applyRoll(s, [1, 2]);
  s = applyRoll(s, [1, 2]);
  assert.equal(s.turn, 'blue', 'three misses and the turn passes');
});

// ═══════════════════════════════════════════════════════════════════
test('landing on a lone enemy sends it home and pays 20', () => {
  const target = (ENTRY.red + 3) % RING_LEN;
  assert.ok(!SAFE.has(target), 'test needs an unsafe square');

  const s = board({ red: [ENTRY.red, NEST, NEST, NEST], blue: [target, NEST, NEST, NEST],
                    pending: [3, 1] });
  const hit = legalActions(s).find((a) => a.capture);
  assert.ok(hit, 'the capture is on offer');

  const after = applyAction(s, hit);
  assert.equal(after.pawns.blue[0], NEST, 'blue goes back to its corner');
  assert.equal(after.pawns.red[0], target, 'red takes the square');
  assert.ok(after.pending.some((p) => p.kind === 'b20'), 'and collects the 20');
});

test('nobody is captured on a safe square', () => {
  const from = ENTRY.red;
  const safeSquare = (ENTRY.red + 7) % RING_LEN;
  assert.ok(SAFE.has(safeSquare));

  const s = board({ red: [from, NEST, NEST, NEST], blue: [safeSquare, NEST, NEST, NEST],
                    pending: [7] });
  const move = legalActions(s).find((a) => a.to === safeSquare);
  assert.ok(move, 'red may still share the square');
  assert.equal(move.capture, null, 'but takes nothing');

  const after = applyAction(s, move);
  assert.equal(after.pawns.blue[0], safeSquare, 'blue stands its ground');
});

test('coming out of the nest clears an enemy off your own entry', () => {
  const s = board({ red: [NEST, NEST, NEST, NEST], blue: [ENTRY.red, NEST, NEST, NEST],
                    pending: [5, 1] });
  const exit = legalActions(s).find((a) => a.type === 'exit');
  assert.ok(exit.capture, 'the entry square is the one exception');

  const after = applyAction(s, exit);
  assert.equal(after.pawns.blue[0], NEST);
});

// ═══════════════════════════════════════════════════════════════════
test('two pawns on a square block the road for everyone', () => {
  const wall = (ENTRY.red + 4) % RING_LEN;
  const s = board({ red: [ENTRY.red, NEST, NEST, NEST],
                    blue: [wall, wall, NEST, NEST], pending: [6, 2] });

  assert.ok(isBarrier(s, wall));
  const past = legalActions(s).filter((a) => a.pawn === 0 && a.use[0] === 0);
  assert.equal(past.length, 0, 'red cannot jump the wall with a 6');

  const short = legalActions(s).find((a) => a.pawn === 0 && a.use[0] === 1);
  assert.ok(short, 'but a 2 stops in front of it');
});

test('your own wall blocks you too', () => {
  const wall = (ENTRY.red + 2) % RING_LEN;
  const s = board({ red: [ENTRY.red, wall, wall, NEST], pending: [4, 4] });
  assert.equal(legalActions(s).filter((a) => a.pawn === 0).length, 0);
});

test('a 6 has to break your own wall when it can', () => {
  const wall = (ENTRY.red + 10) % RING_LEN;
  const loose = (ENTRY.red + 1) % RING_LEN;
  const s = board({ red: [loose, wall, wall, NEST], pending: [6] });

  const acts = legalActions(s);
  assert.ok(acts.length > 0);
  assert.ok(acts.every((a) => a.pawn === 1 || a.pawn === 2),
    'the loose pawn has to wait; the 6 belongs to the wall');
});

// ═══════════════════════════════════════════════════════════════════
test('getting a pawn in pays 10, and the fourth one wins it', () => {
  const s = board({ red: [COL_BASE + 6, HOME, HOME, HOME], pending: [1, 4] });
  const inIt = legalActions(s).find((a) => a.home);
  assert.ok(inIt);

  const after = applyAction(s, inIt);
  assert.equal(after.winner, 'red');
  assert.equal(after.phase, 'over');
});

test('getting a pawn in pays 10 when the game is still going', () => {
  // A second pawn out on the ring, otherwise the bonus has nothing to move
  // and gets discarded the moment it is awarded.
  const s = board({ red: [COL_BASE + 6, ENTRY.red, NEST, NEST], pending: [1, 4] });
  const after = applyAction(s, legalActions(s).find((a) => a.home));
  assert.equal(after.winner, null);
  assert.ok(after.pending.some((p) => p.kind === 'b10'));
});

test('a bonus with nothing to spend it on is simply dropped', () => {
  const s = board({ red: [COL_BASE + 6, NEST, NEST, NEST], pending: [1, 4] });
  const after = applyAction(s, legalActions(s).find((a) => a.home));
  assert.equal(after.pending.length, 0);
  assert.equal(after.turn, 'blue');
});

test('three doubles sends the lead pawn back to the corner', () => {
  let s = board({ red: [ENTRY.red, NEST, NEST, NEST], phase: 'roll' });
  s.pawns.red[0] = (ENTRY.red + 30) % RING_LEN;

  s = applyRoll(s, [3, 3]);
  while (s.pending.length) s = applyAction(s, legalActions(s)[0]);
  s = applyRoll(s, [4, 4]);
  while (s.pending.length) s = applyAction(s, legalActions(s)[0]);

  assert.equal(s.turn, 'red', 'doubles keep the dice');
  const lead = mostAdvanced(s, 'red');
  s = applyRoll(s, [2, 2]);

  assert.equal(s.pawns.red[lead], NEST, 'the third double costs the lead pawn');
  assert.equal(s.turn, 'blue', 'and the turn');
});

test('doubles buy another roll', () => {
  let s = board({ red: [ENTRY.red, NEST, NEST, NEST], phase: 'roll' });
  s = applyRoll(s, [2, 2]);
  while (s.pending.length) s = applyAction(s, legalActions(s)[0]);
  assert.equal(s.turn, 'red');
  assert.equal(s.phase, 'roll');
});

test('a turn with nothing playable passes instead of jamming', () => {
  // Red is one square from the centre and needs an exact 1. Nothing else
  // is on the board, so a 6 and a 4 are both unusable.
  let s = board({ red: [COL_BASE + 6, HOME, HOME, HOME], phase: 'roll' });
  s = applyRoll(s, [6, 4]);
  assert.equal(s.turn, 'blue');
  assert.equal(s.pending.length, 0);
});

// ═══════════════════════════════════════════════════════════════════
test('two thousand games play to a finish without jamming', () => {
  let seed = 12345;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };

  let wins = { red: 0, blue: 0 };
  let longest = 0;

  for (let game = 0; game < 2000; game++) {
    let s = newGame(game % 2 ? 'blue' : 'red');
    let steps = 0;

    while (!s.winner && steps < 20000) {
      steps++;
      if (s.phase === 'roll') {
        s = applyRoll(s, [1 + rand(6), 1 + rand(6)]);
        continue;
      }
      const acts = legalActions(s);
      assert.ok(acts.length > 0,
        `stuck in phase ${s.phase} holding ${JSON.stringify(s.pending)}`);
      s = applyAction(s, acts[rand(acts.length)]);
    }

    assert.ok(s.winner, `game ${game} never finished`);
    assert.equal(s.pawns[s.winner].filter((p) => p === HOME).length, 4);
    wins[s.winner]++;
    longest = Math.max(longest, steps);
  }

  // Neither seat should be running away with it.
  const share = wins.red / (wins.red + wins.blue);
  assert.ok(share > 0.4 && share < 0.6, `red won ${(share * 100).toFixed(1)}%`);
  console.log(`      red ${wins.red} · blue ${wins.blue} · longest ${longest} steps`);
});
