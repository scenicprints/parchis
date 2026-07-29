// ═══════════════════════════════════════════════════════════════════════
//  PARCHÍS — the rules, with no screen and no network attached.
//
//  Every function here is pure: hand it a state and an action, get a new
//  state back. Nothing in this file knows that Firestore or the DOM exist,
//  which is the whole reason the rules can be tested on their own.
//
//  The board, in numbers:
//    · 68 squares in the outer ring, numbered 0–67 clockwise
//    · the four entry squares sit 17 apart
//    · 7 squares in each colour's home column, then the centre
//    · a full lap for one pawn is 68 + 7 + 1 = 76 steps
// ═══════════════════════════════════════════════════════════════════════

export const RING_LEN = 68;
export const COL_LEN  = 7;
export const ROUTE_LEN = RING_LEN + COL_LEN + 1;   // 76

// ── How a pawn's position is stored ───────────────────────────────────
// A single integer, so the whole game state stays flat enough for Firestore.
export const NEST     = -1;          // still in the starting corner
export const COL_BASE = 100;         // 100…106 = home column squares 0…6
export const HOME     = 200;         // finished, in the centre

export const inCol = (p) => p >= COL_BASE && p < COL_BASE + COL_LEN;
export const onRing = (p) => p >= 0 && p < RING_LEN;

// ── Where each colour joins the ring ──────────────────────────────────
// Entries are 17 apart. A pawn leaves its nest onto ENTRY, travels 67
// squares clockwise, lands on TURN_IN, and the next step takes it off the
// ring and into its own column.
export const ENTRY = { blue: 9, green: 26, red: 43, yellow: 60 };

export const TURN_IN = {};
for (const c of Object.keys(ENTRY)) {
  TURN_IN[c] = (ENTRY[c] + RING_LEN - 1) % RING_LEN;
}

// ── The twelve safe squares ───────────────────────────────────────────
// Each colour's entry, plus the squares 7 and 12 beyond it. Nothing can be
// captured while standing on one.
export const SAFE = new Set();
for (const e of Object.values(ENTRY)) {
  SAFE.add(e);
  SAFE.add((e + 7) % RING_LEN);
  SAFE.add((e + 12) % RING_LEN);
}

// The two seats actually used. Red starts bottom-left, blue top-right, so
// they sit diagonally opposite each other.
export const SIDES = ['red', 'blue'];
export const other = (c) => (c === 'red' ? 'blue' : 'red');

export const PAWNS_PER_SIDE = 4;
export const CAPTURE_BONUS = 20;
export const HOME_BONUS    = 10;
export const NEST_ROLLS    = 3;   // tries to find a 5 when all four are in
export const MAX_DOUBLES   = 3;   // the third one costs you your lead pawn

// ═══════════════════════════════════════════════════════════════════════
//  Reading a position
// ═══════════════════════════════════════════════════════════════════════

// How far along its own 76-step route a pawn has travelled. Used to decide
// which pawn is "most advanced" and to sort pawns for display.
export function progress(color, pos) {
  if (pos === NEST) return 0;
  if (pos === HOME) return ROUTE_LEN;
  if (inCol(pos)) return RING_LEN + 1 + (pos - COL_BASE);
  return 1 + ((pos - ENTRY[color] + RING_LEN) % RING_LEN);
}

// Everything standing on a given ring square, as {color, index} pairs.
export function occupants(state, ringIndex) {
  const out = [];
  for (const color of SIDES) {
    const pawns = state.pawns[color];
    for (let i = 0; i < pawns.length; i++) {
      if (pawns[i] === ringIndex) out.push({ color, index: i });
    }
  }
  return out;
}

// Two pawns on one square block the road for everybody, including the
// player who built it. Colour does not matter: a red pawn and a blue pawn
// sharing a safe square form just as solid a wall as two reds.
export function isBarrier(state, ringIndex) {
  return occupants(state, ringIndex).length >= 2;
}

// Squares where this colour has stacked two of its own pawns.
export function ownBarriers(state, color) {
  const counts = new Map();
  for (const p of state.pawns[color]) {
    if (onRing(p)) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const out = [];
  for (const [square, n] of counts) if (n >= 2) out.push(square);
  return out;
}

export const allInNest = (state, color) =>
  state.pawns[color].every((p) => p === NEST);

// The pawn furthest along that is neither finished nor still in the nest.
export function mostAdvanced(state, color) {
  let best = -1;
  let bestProgress = 0;
  state.pawns[color].forEach((p, i) => {
    if (p === NEST || p === HOME) return;
    const prog = progress(color, p);
    if (prog > bestProgress) { bestProgress = prog; best = i; }
  });
  return best;
}

// ═══════════════════════════════════════════════════════════════════════
//  Walking a pawn forward
// ═══════════════════════════════════════════════════════════════════════

// Where a pawn ends up after n steps, and every ring square it crosses on
// the way. Returns null if the move runs past the centre, which is not
// allowed: you need the exact count to finish.
export function walk(color, pos, n) {
  if (n <= 0) return null;
  if (pos === NEST || pos === HOME) return null;

  if (inCol(pos)) {
    const c = pos - COL_BASE + n;
    if (c < COL_LEN) return { to: COL_BASE + c, crossed: [] };
    if (c === COL_LEN) return { to: HOME, crossed: [] };
    return null;                                  // overshot the centre
  }

  const turnIn = TURN_IN[color];
  const toTurn = (turnIn - pos + RING_LEN) % RING_LEN;   // steps to the ramp

  if (n <= toTurn) {
    const crossed = [];
    for (let k = 1; k <= n; k++) crossed.push((pos + k) % RING_LEN);
    return { to: (pos + n) % RING_LEN, crossed };
  }

  // The pawn leaves the ring. It crosses every square up to and including
  // the turn-in, then walks up its own column where nothing can stop it.
  const crossed = [];
  for (let k = 1; k <= toTurn; k++) crossed.push((pos + k) % RING_LEN);

  const intoCol = n - toTurn;                     // 1 = first column square
  if (intoCol <= COL_LEN) return { to: COL_BASE + (intoCol - 1), crossed };
  if (intoCol === COL_LEN + 1) return { to: HOME, crossed };
  return null;                                    // overshot the centre
}

// ═══════════════════════════════════════════════════════════════════════
//  Which moves are legal right now
// ═══════════════════════════════════════════════════════════════════════

// Can this colour drop a pawn onto this ring square, and does doing so
// capture anything? `fromNest` carries the one exception to the safe-square
// rule: a pawn coming out of its corner throws an enemy off its own entry.
function landing(state, color, square, fromNest) {
  const here = occupants(state, square);
  if (here.length >= 2) return { ok: false };            // barrier
  if (here.length === 0) return { ok: true, capture: null };

  const sitting = here[0];
  if (sitting.color === color) return { ok: true, capture: null };  // stack up

  if (SAFE.has(square) && !fromNest) {
    return { ok: true, capture: null };   // share the square, no capture
  }
  return { ok: true, capture: sitting };
}

// Every action the player to move could take, given what is left of the
// roll. Each action names the pending entries it would spend.
export function legalActions(state) {
  if (state.phase !== 'move' || state.winner) return [];

  const color = state.turn;
  const pawns = state.pawns[color];
  const pending = state.pending || [];
  const actions = [];

  // ── Leaving the nest, which costs a 5 ──────────────────────────────
  // Either one die showing 5, or both dice adding up to 5. A bonus move
  // won by capturing cannot be spent on this.
  const nestSpends = [];
  const fiveAt = pending.findIndex((p) => p.kind === 'die' && p.v === 5);
  if (fiveAt >= 0) nestSpends.push([fiveAt]);
  else if (pending.length === 2 &&
           pending.every((p) => p.kind === 'die') &&
           pending[0].v + pending[1].v === 5) {
    nestSpends.push([0, 1]);
  }

  if (nestSpends.length) {
    const entry = ENTRY[color];
    const land = landing(state, color, entry, true);
    if (land.ok) {
      for (let i = 0; i < pawns.length; i++) {
        if (pawns[i] !== NEST) continue;
        actions.push({
          type: 'exit', pawn: i, use: nestSpends[0],
          to: entry, capture: land.capture, home: false,
        });
        break;   // the four pawns in the nest are interchangeable
      }
    }
  }

  // ── Moving a pawn already on the road ──────────────────────────────
  for (let s = 0; s < pending.length; s++) {
    const spend = pending[s];
    for (let i = 0; i < pawns.length; i++) {
      const from = pawns[i];
      if (from === NEST || from === HOME) continue;

      const step = walk(color, from, spend.v);
      if (!step) continue;

      // A barrier anywhere on the way stops the pawn dead.
      if (step.crossed.some((sq) => isBarrier(state, sq))) continue;

      let capture = null;
      if (onRing(step.to)) {
        const land = landing(state, color, step.to, false);
        if (!land.ok) continue;
        capture = land.capture;
      }

      actions.push({
        type: 'move', pawn: i, use: [s],
        to: step.to, capture, home: step.to === HOME,
      });
    }
  }

  return applySixRule(state, actions);
}

// A 6 has to be spent breaking your own barrier, if it legally can be.
function applySixRule(state, actions) {
  const barriers = ownBarriers(state, state.turn);
  if (!barriers.length) return actions;

  const pending = state.pending || [];
  let filtered = actions;

  for (let s = 0; s < pending.length; s++) {
    if (pending[s].kind !== 'die' || pending[s].v !== 6) continue;

    const usingSix = filtered.filter((a) => a.use.includes(s));
    const breaking = usingSix.filter(
      (a) => a.type === 'move' && barriers.includes(state.pawns[state.turn][a.pawn])
    );
    if (!breaking.length) continue;   // cannot break one, so the 6 is free

    // Keep the barrier-breaking moves, drop the other uses of that 6.
    const keep = new Set(breaking);
    filtered = filtered.filter((a) => !a.use.includes(s) || keep.has(a));
  }
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════
//  Playing a move
// ═══════════════════════════════════════════════════════════════════════

export const NAMES = { red: 'Red', blue: 'Blue' };

function note(state, text) {
  state.log = [...(state.log || []), { t: text, c: state.turn }].slice(-40);
}

export function applyAction(state, action) {
  const s = clone(state);
  const color = s.turn;

  // Spend the dice or bonus this move used. Remove from the back so the
  // earlier indices stay valid.
  const spent = [...action.use].sort((a, b) => b - a);
  const spentLabels = action.use.map((i) => s.pending[i].v);
  for (const i of spent) s.pending.splice(i, 1);

  if (action.type === 'exit') {
    s.pawns[color][action.pawn] = ENTRY[color];
    note(s, `${NAMES[color]} brought a pawn out.`);
  } else {
    s.pawns[color][action.pawn] = action.to;
    note(s, `${NAMES[color]} moved ${spentLabels.join(' + ')}.`);
  }

  if (action.capture) {
    s.pawns[action.capture.color][action.capture.index] = NEST;
    note(s, `${NAMES[color]} sent ${NAMES[action.capture.color]} home. Bonus 20.`);
    s.pending.push({ v: CAPTURE_BONUS, kind: 'b20' });
  }

  if (action.home) {
    note(s, `${NAMES[color]} got a pawn in. Bonus 10.`);
    s.pending.push({ v: HOME_BONUS, kind: 'b10' });
  }

  if (s.pawns[color].every((p) => p === HOME)) {
    s.winner = color;
    s.phase = 'over';
    s.pending = [];
    note(s, `${NAMES[color]} wins.`);
    return bump(s);
  }

  return bump(settle(s));
}

// ═══════════════════════════════════════════════════════════════════════
//  The turn machine
// ═══════════════════════════════════════════════════════════════════════

export function rollDice(rand = defaultRandom) {
  return [1 + rand(6), 1 + rand(6)];
}

function defaultRandom(n) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // Rejection sampling, so 6 is exactly as likely as 1.
    const limit = Math.floor(256 / n) * n;
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }
  return Math.floor(Math.random() * n);
}

export function applyRoll(state, dice) {
  const s = clone(state);
  if (s.phase !== 'roll' || s.winner) return state;

  const color = s.turn;
  s.dice = dice;
  s.rolledAt = (s.rolledAt || 0) + 1;
  s.pending = [
    { v: dice[0], kind: 'die' },
    { v: dice[1], kind: 'die' },
  ];
  note(s, `${NAMES[color]} rolled ${dice[0]} and ${dice[1]}.`);

  // Three doubles in a row and your lead pawn walks back to the corner.
  if (dice[0] === dice[1]) {
    s.doubles = (s.doubles || 0) + 1;
    if (s.doubles >= MAX_DOUBLES) {
      const lead = mostAdvanced(s, color);
      if (lead >= 0) {
        s.pawns[color][lead] = NEST;
        note(s, `Three doubles. ${NAMES[color]}'s lead pawn goes back.`);
      } else {
        note(s, `Three doubles. ${NAMES[color]} loses the turn.`);
      }
      s.pending = [];
      return bump(nextTurn(s));
    }
  }

  s.phase = 'move';

  // All four still in the corner: up to three rolls to find a 5.
  if (allInNest(s, color)) {
    s.nestTries = (s.nestTries || 0) + 1;
    if (!legalActions(s).length) {
      s.pending = [];
      if (s.nestTries < NEST_ROLLS) {
        s.phase = 'roll';
        note(s, `No 5. ${NAMES[color]} rolls again.`);
        return bump(s);
      }
      note(s, `No 5 in three rolls.`);
      return bump(nextTurn(s));
    }
  }

  return bump(settle(s));
}

// Clear out dice nobody can use, then work out whether the turn is over.
function settle(s) {
  if (s.pending.length && !legalActions(s).length) {
    const stuck = s.pending.map((p) => p.v).join(', ');
    note(s, `${NAMES[s.turn]} had nothing to play for ${stuck}.`);
    s.pending = [];
  }

  if (s.pending.length) return s;          // still mid-turn
  if (s.winner) { s.phase = 'over'; return s; }

  // Doubles buy another roll, up to the third.
  if (s.dice && s.dice[0] === s.dice[1] && (s.doubles || 0) < MAX_DOUBLES) {
    s.phase = 'roll';
    return s;
  }
  return nextTurn(s);
}

function nextTurn(s) {
  s.turn = other(s.turn);
  s.phase = 'roll';
  s.dice = null;
  s.pending = [];
  s.doubles = 0;
  s.nestTries = 0;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
//  Setting up
// ═══════════════════════════════════════════════════════════════════════

export function newGame(first = 'red') {
  return {
    rev: 0,
    phase: 'roll',
    turn: first,
    dice: null,
    pending: [],
    pawns: {
      red:  Array(PAWNS_PER_SIDE).fill(NEST),
      blue: Array(PAWNS_PER_SIDE).fill(NEST),
    },
    doubles: 0,
    nestTries: 0,
    rolledAt: 0,
    winner: null,
    log: [{ t: `${NAMES[first]} starts.`, c: first }],
  };
}

const clone = (s) => JSON.parse(JSON.stringify(s));
const bump = (s) => { s.rev = (s.rev || 0) + 1; return s; };
