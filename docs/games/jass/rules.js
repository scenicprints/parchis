// ═══════════════════════════════════════════════════════════════════════
//  SCHIEBER JASS — the rules, with no screen and no network attached.
//
//  Four players, two partnerships, sitting so that your partner is across
//  the table. Play runs anticlockwise, which is to say to the right.
//
//  Every function here is pure: hand it a state and an action, get a new
//  state back. Nothing in this file knows that Firestore or the DOM exist.
//
//  The shape of a hand:
//    · nine cards each, dealt in threes
//    · forehand names the contract, or shoves it across to their partner
//    · nine tricks, with the Swiss trumping rules, which are not whist's
//    · Weis is announced into the first trick, best set takes the lot
//    · Stöck is the König and Ober of trumps in one hand, and stands alone
//    · everything on the hand is multiplied by what the contract is worth
//    · first partnership to the target, checked Stöck, then Weis, then Stich
// ═══════════════════════════════════════════════════════════════════════

import {
  SUITS, DECK, suitOf, rankOf, cardOf, SUIT_NAME, RANK_LABEL,
  ASS, KONIG, OBER, UNDER, BANNER, NELL, SIEBEN_ROSEN,
} from './cards.js';

// Bumped whenever the state changes shape. A game left running under an
// older one is spotted by the hub and dealt again rather than reappearing
// with its cards meaning something else.
export const BOARD_REV = 1;

// ── The table ─────────────────────────────────────────────────────────
// Seats in the order play passes, which is anticlockwise. Red and blue are
// the two a person can take, and they sit next to each other so they are
// always opponents. Each one's partner is two seats along.
export const ORDER = ['red', 'blue', 'green', 'yellow'];

// A partnership is named for the human seat in it, so a winner is already
// the 'red' or 'blue' the hub records a point against.
export const TEAM = { red: 'red', green: 'red', blue: 'blue', yellow: 'blue' };
export const TEAMS = ['red', 'blue'];
export const SIDES = ['red', 'blue'];          // the seats a person may hold

export const NAMES = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow' };

export const partnerOf = (seat) => ORDER[(ORDER.indexOf(seat) + 2) % 4];
export const nextSeat = (seat) => ORDER[(ORDER.indexOf(seat) + 1) % 4];
export const otherTeam = (t) => (t === 'red' ? 'blue' : 'red');

// ═══════════════════════════════════════════════════════════════════════
//  Contracts
// ═══════════════════════════════════════════════════════════════════════

// Six of them, and what each is worth. The vegetables are cheap, the metals
// cost double, and playing without a trump at all is where the money is.
export const CONTRACTS = [
  { id: 'eicheln',  kind: 'suit', suit: 2, factor: 1, label: 'Acorns'   },
  { id: 'rosen',    kind: 'suit', suit: 3, factor: 1, label: 'Roses'    },
  { id: 'schilten', kind: 'suit', suit: 1, factor: 2, label: 'Shields'  },
  { id: 'schellen', kind: 'suit', suit: 0, factor: 2, label: 'Bells'    },
  { id: 'obenabe',  kind: 'top',  suit: null, factor: 3, label: 'Obenabe'  },
  { id: 'undenufe', kind: 'bottom', suit: null, factor: 4, label: 'Undenufe' },
];

export const contractById = (id) => CONTRACTS.find((c) => c.id === id) || null;

export const contractLabel = (c) =>
  !c ? '—' : c.kind === 'suit' ? SUIT_NAME[SUITS[c.suit]] : contractById(c.id).label;

// ── What a card is worth, and what it beats ──────────────────────────
//
// Indexed by rank: A K O U B 9 8 7 6.
//
// In a suit contract the trump suit runs on its own scale, which is where
// the Puur's twenty and the Näll's fourteen come from. With no trump at all
// those two are worth nothing, so the eights are lifted to eight apiece and
// the pack still adds up to 152, plus five for the last trick.
const VAL_PLAIN  = [11, 4, 3,  2, 10,  0, 0, 0,  0];   // 30 a suit
const VAL_TRUMP  = [11, 4, 3, 20, 10, 14, 0, 0,  0];   // 62
const VAL_TOP    = [11, 4, 3,  2, 10,  0, 8, 0,  0];   // 38 a suit, obenabe
const VAL_BOTTOM = [ 0, 4, 3,  2, 10,  0, 8, 0, 11];   // 38 a suit, undenufe

// Strength, high number wins. Plain suits and obenabe run Ass down to six;
// undenufe runs six down to Ass; the trump suit puts the Under on top.
const STR_HIGH  = [8, 7, 6, 5, 4, 3, 2, 1, 0];
const STR_TRUMP = [6, 5, 4, 8, 3, 7, 2, 1, 0];
const STR_LOW   = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export const LAST_TRICK = 5;
export const MATCH_BONUS = 100;
export const STOECK = 20;
export const HAND_TOTAL = 157;      // 152 in the pack, and five for the last

export const trumpSuit = (c) => (c && c.kind === 'suit' ? c.suit : null);
export const isTrump = (c, card) => trumpSuit(c) !== null && suitOf(card) === c.suit;

export function cardValue(contract, card) {
  const r = rankOf(card);
  if (!contract) return 0;
  if (contract.kind === 'top') return VAL_TOP[r];
  if (contract.kind === 'bottom') return VAL_BOTTOM[r];
  return isTrump(contract, card) ? VAL_TRUMP[r] : VAL_PLAIN[r];
}

export function cardStrength(contract, card) {
  const r = rankOf(card);
  if (!contract) return STR_HIGH[r];
  if (contract.kind === 'bottom') return STR_LOW[r];
  if (contract.kind === 'top') return STR_HIGH[r];
  return isTrump(contract, card) ? STR_TRUMP[r] : STR_HIGH[r];
}

export const pointsOf = (contract, cards) =>
  cards.reduce((sum, c) => sum + cardValue(contract, c), 0);

// ═══════════════════════════════════════════════════════════════════════
//  Tricks
// ═══════════════════════════════════════════════════════════════════════

// Which play in a completed or part-played trick is winning it. A trump
// beats anything that is not one; failing that the led suit decides, and
// anything discarded off suit never wins whatever it is worth.
export function trickLeader(contract, trick) {
  if (!trick.length) return null;
  const led = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    const a = trick[best].card;
    const b = trick[i].card;
    const at = isTrump(contract, a);
    const bt = isTrump(contract, b);
    if (bt && !at) { best = i; continue; }
    if (at && !bt) continue;
    if (!at && suitOf(b) !== led) continue;          // a discard never wins
    if (!at && suitOf(a) !== led) { best = i; continue; }
    if (cardStrength(contract, b) > cardStrength(contract, a)) best = i;
  }
  return trick[best];
}

// The highest trump anybody has put on this trick so far, or null.
function topTrump(contract, trick) {
  let best = null;
  for (const p of trick) {
    if (!isTrump(contract, p.card)) continue;
    if (best === null || cardStrength(contract, p.card) > cardStrength(contract, best)) {
      best = p.card;
    }
  }
  return best;
}

// ── What you are allowed to put down ─────────────────────────────────
//
// This is the part of Jass that is unlike every other trick game, so it is
// written out rather than reasoned about at the call site.
//
//   · Anything may be led.
//   · With no trump, follow suit if you can. That is the whole rule.
//   · With a trump suit, holding the led suit you may follow it *or* trump
//     it, which is the freedom that makes the game.
//   · Trumps led: you must follow with a trump, unless the only one you
//     hold is the Puur, which is never compelled out of your hand.
//   · Undertrumping: once somebody has trumped a plain suit, a smaller
//     trump is out of bounds. Holding nothing but trumps lifts that.
export function legalPlays(state, seat) {
  const hand = state.hands[seat] || [];
  const contract = state.contract;
  const trick = state.trick || [];
  if (!hand.length) return [];
  if (!trick.length) return [...hand];

  const led = suitOf(trick[0].card);
  const trump = trumpSuit(contract);

  if (trump === null) {
    const follow = hand.filter((c) => suitOf(c) === led);
    return follow.length ? follow : [...hand];
  }

  const trumps = hand.filter((c) => suitOf(c) === trump);
  const onlyTrumps = trumps.length === hand.length;

  if (led === trump) {
    if (!trumps.length) return [...hand];
    // The Puur standing alone is the one card the rules never drag out.
    if (trumps.length === 1 && rankOf(trumps[0]) === UNDER) return [...hand];
    return trumps;
  }

  const hasLed = hand.some((c) => suitOf(c) === led);
  const top = topTrump(contract, trick);

  return hand.filter((card) => {
    if (suitOf(card) === led) return true;                 // following suit is always open
    if (suitOf(card) === trump) {
      if (onlyTrumps) return true;                         // nothing else to play
      if (top === null) return true;                       // first one in, any trump
      return cardStrength(contract, card) > cardStrength(contract, top);
    }
    return !hasLed;                                        // a discard, only if void
  });
}

export const canPlay = (state, seat, card) => legalPlays(state, seat).includes(card);

// ═══════════════════════════════════════════════════════════════════════
//  Weis
// ═══════════════════════════════════════════════════════════════════════

// Sets held at the start of play, announced into the first trick. The best
// single set at the table decides which partnership scores, and that side
// then takes everything it holds while the other takes nothing, however
// good some of theirs may have been.
//
// Sequences are always counted down the pack's own order, A K O U B 9 8 7 6,
// whatever the contract is doing to the ranking today.

const SEQ_VALUE = { 3: 20, 4: 50, 5: 100, 6: 150, 7: 200, 8: 250, 9: 300 };

// Four of a kind, by rank. The Unders are worth double, the nines sit in
// between, and the low cards do not count at all.
const FOUR_VALUE = { [UNDER]: 200, [NELL]: 150, [ASS]: 100, [KONIG]: 100, [OBER]: 100, [BANNER]: 100 };

// Every set in a hand. A card may serve in a four of a kind and in a
// sequence at once, but never in two sequences, so the runs are cut at
// their longest and left there.
export function weisIn(hand) {
  const out = [];

  for (const rank of Object.keys(FOUR_VALUE)) {
    const r = Number(rank);
    const four = hand.filter((c) => rankOf(c) === r);
    if (four.length === 4) {
      out.push({ kind: 'four', rank: r, len: 4, value: FOUR_VALUE[r], top: r, suit: null });
    }
  }

  for (let s = 0; s < 4; s++) {
    const ranks = hand.filter((c) => suitOf(c) === s).map(rankOf).sort((a, b) => a - b);
    let i = 0;
    while (i < ranks.length) {
      let j = i;
      while (j + 1 < ranks.length && ranks[j + 1] === ranks[j] + 1) j++;
      const len = j - i + 1;
      if (len >= 3) {
        out.push({ kind: 'seq', len, value: SEQ_VALUE[Math.min(len, 9)], top: ranks[i], suit: s });
      }
      i = j + 1;
    }
  }

  return out;
}

// Which of two sets is better. Points first; then length, so a run of five
// beats four aces though both score a hundred; then the top card, read the
// way this contract reads cards; then trumps; then who plays first.
export function betterWeis(contract, a, b) {
  if (a.value !== b.value) return a.value > b.value ? a : b;
  if (a.len !== b.len) return a.len > b.len ? a : b;

  const rank = (w) => (contract && contract.kind === 'bottom' ? STR_LOW : STR_HIGH)[w.top];
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;

  const tr = trumpSuit(contract);
  const aT = tr !== null && a.suit === tr;
  const bT = tr !== null && b.suit === tr;
  if (aT !== bT) return aT ? a : b;

  return a.order <= b.order ? a : b;      // whoever plays to the first trick sooner
}

// The best set anybody holds, and therefore which partnership scores. Sets
// are stamped with how soon their holder plays to the first trick, so two
// identical runs in plain suits are settled the way a real table settles
// them.
export function resolveWeis(state) {
  const contract = state.contract;
  let best = null;
  const bySeat = {};

  let seat = state.lead;
  for (let i = 0; i < 4; i++) {
    const sets = weisIn(state.dealt[seat]).map((w) => ({ ...w, seat, order: i }));
    bySeat[seat] = sets;
    for (const w of sets) best = best === null ? w : betterWeis(contract, best, w);
    seat = nextSeat(seat);
  }

  if (!best) return { best: null, team: null, points: { red: 0, blue: 0 }, bySeat };

  const team = TEAM[best.seat];
  let points = 0;
  for (const s of ORDER) {
    if (TEAM[s] !== team) continue;
    for (const w of bySeat[s]) points += w.value;
  }
  return { best, team, points: { [team]: points, [otherTeam(team)]: 0 }, bySeat };
}

export function weisLabel(w) {
  if (w.kind === 'four') return `Four ${RANK_LABEL[w.rank]}s`;
  return `${w.len} in a row`;
}

// ── Stöck ────────────────────────────────────────────────────────────
// König and Ober of trumps in one hand. Twenty points, its own thing, and
// no Weis can take it away. There is no trump in obenabe or undenufe, so
// there is no Stöck either.
export function stoeckHolder(contract, dealt) {
  const t = trumpSuit(contract);
  if (t === null) return null;
  for (const seat of ORDER) {
    const h = dealt[seat] || [];
    if (h.includes(cardOf(t, KONIG)) && h.includes(cardOf(t, OBER))) return seat;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Dealing
// ═══════════════════════════════════════════════════════════════════════

export function shuffled(rand = defaultRandom) {
  const d = [...DECK];
  for (let i = d.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function defaultRandom(n) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // Rejection sampling, so every card is as likely as every other.
    const limit = Math.floor(256 / n) * n;
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }
  return Math.floor(Math.random() * n);
}

// Nine each, in threes, starting to the dealer's right, the way it is done.
function dealOut(deck, dealer) {
  const hands = { red: [], blue: [], green: [], yellow: [] };
  let seat = nextSeat(dealer);
  let at = 0;
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < 4; p++) {
      hands[seat].push(deck[at], deck[at + 1], deck[at + 2]);
      at += 3;
      seat = nextSeat(seat);
    }
  }
  for (const s of ORDER) hands[s].sort((a, b) => a - b);
  return hands;
}

// ═══════════════════════════════════════════════════════════════════════
//  A hand of nine tricks
// ═══════════════════════════════════════════════════════════════════════

function note(s, text) {
  s.log = [...(s.log || []), { t: text, c: s.turn }].slice(-40);
}

// Deal the next hand into an existing match, keeping the score. The very
// first hand of a session has no dealer yet, and the seven of roses says
// who is forehand, which is how a Swiss table starts without drawing.
export function dealHand(state, deck = shuffled()) {
  const s = clone(state);
  const first = !s.dealer;
  const dealer = first ? 'yellow' : nextSeat(s.dealer);

  const hands = dealOut(deck, dealer);

  // Forehand is the dealer's right hand neighbour, except on the very first
  // hand of a session, where the seven of roses picks somebody instead.
  let forehand = nextSeat(dealer);
  if (first) forehand = ORDER.find((seat) => hands[seat].includes(SIEBEN_ROSEN)) || forehand;

  s.hand = (s.hand || 0) + 1;
  s.dealer = dealer;
  s.forehand = forehand;
  s.hands = hands;
  s.dealt = clone(hands);        // kept as dealt, because Weis is about the start
  s.phase = 'bid';
  s.turn = forehand;
  s.shoved = false;
  s.contract = null;
  s.trick = [];
  s.lead = forehand;
  s.taken = { red: [], blue: [] };
  s.wins = { red: 0, blue: 0 };
  s.weis = null;
  s.stoeck = null;
  s.result = null;
  s.log = [];
  note(s, `Hand ${s.hand}. ${NAMES[forehand]} chooses.`);
  return bump(s);
}

// Forehand names it, or shoves it across the table. A shove can only be
// made once, and the partner it lands on has to choose something.
export function chooseContract(state, id) {
  const s = clone(state);
  if (s.phase !== 'bid' || s.winner) return state;
  const def = contractById(id);
  if (!def) return state;

  s.contract = { id: def.id, kind: def.kind, suit: def.suit, factor: def.factor, by: s.turn };
  s.phase = 'play';
  s.turn = s.forehand;
  s.lead = s.forehand;
  s.stoeck = stoeckHolder(s.contract, s.dealt);
  note(s, `${NAMES[s.contract.by]} plays ${contractLabel(s.contract)}, ×${def.factor}.`);
  return bump(s);
}

export function shove(state) {
  const s = clone(state);
  if (s.phase !== 'bid' || s.shoved || s.winner) return state;
  const from = s.turn;
  s.shoved = true;
  s.turn = partnerOf(from);
  note(s, `${NAMES[from]} shoves it across to ${NAMES[s.turn]}.`);
  return bump(s);
}

// Put a card down. The trick is left standing when the fourth one lands, so
// both phones get to see it before anybody sweeps it up.
export function playCard(state, card) {
  const s = clone(state);
  if (s.phase !== 'play' || s.winner) return state;
  const seat = s.turn;
  if (!canPlay(s, seat, card)) return state;

  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick = [...s.trick, { by: seat, card }];
  s.plays = (s.plays || 0) + 1;

  if (s.trick.length < 4) {
    s.turn = nextSeat(seat);
    return bump(s);
  }

  // Weis is announced into the first trick and settled once it is complete.
  if (s.wins.red + s.wins.blue === 0 && !s.weis) {
    const w = resolveWeis(s);
    s.weis = { team: w.team, points: w.points, best: w.best ? { ...w.best } : null,
      bySeat: w.bySeat };
    if (w.best) {
      note(s, `${NAMES[w.best.seat]} shows ${weisLabel(w.best)}. `
        + `${NAMES[w.team]} takes ${w.points[w.team]} for Weis.`);
    }
  }

  s.phase = 'gather';
  s.turn = trickLeader(s.contract, s.trick).by;
  return bump(s);
}

// Sweep the finished trick to whoever won it, and start the next one. Fully
// decided by what is already on the table, so any device may do it.
export function gather(state) {
  const s = clone(state);
  if (s.phase !== 'gather' || s.winner) return state;

  const won = trickLeader(s.contract, s.trick);
  const team = TEAM[won.by];
  const cards = s.trick.map((p) => p.card);
  const last = s.wins.red + s.wins.blue === 8;

  s.taken[team] = [...s.taken[team], ...cards];
  s.wins[team] += 1;
  // Kept whole rather than as a list of cards, so the screen can lay the
  // finished trick back out in front of the people who played it.
  s.last = { by: won.by, lead: s.trick[0].by, plays: s.trick.map((p) => ({ ...p })) };
  s.trick = [];
  s.lead = won.by;
  s.turn = won.by;

  const pts = pointsOf(s.contract, cards) + (last ? LAST_TRICK : 0);
  note(s, `${NAMES[won.by]} takes the trick, ${pts}.`);

  if (!last) { s.phase = 'play'; return bump(s); }
  return bump(scoreHand(s));
}

// ═══════════════════════════════════════════════════════════════════════
//  Scoring a hand
// ═══════════════════════════════════════════════════════════════════════

// Stöck, then Weis, then Stich. The order only shows when both partnerships
// would pass the target on the same hand, and then it is the order that
// decides the game, so it is the order the points go on in.
function scoreHand(s) {
  const f = s.contract.factor;
  const won = { red: 0, blue: 0 };

  const stoeckTeam = s.stoeck ? TEAM[s.stoeck] : null;
  const weisTeam = s.weis?.team || null;

  const trick = { red: 0, blue: 0 };
  for (const t of TEAMS) trick[t] = pointsOf(s.contract, s.taken[t]);
  // The five for the last trick went to whoever swept it up.
  const lastTeam = TEAM[s.last.by];
  trick[lastTeam] += LAST_TRICK;
  const matchTeam = TEAMS.find((t) => s.wins[t] === 9) || null;
  if (matchTeam) trick[matchTeam] += MATCH_BONUS;

  const before = { ...s.score };

  // Three stages, in this order. Only one partnership scores Stöck or Weis;
  // both usually score tricks. The target is tested at the end of each
  // stage rather than after every entry, so that a hand which carries both
  // sides past it is settled by which stage did it and then by who is
  // further ahead, and never by which colour happens to be listed first.
  const stages = [
    stoeckTeam ? { [stoeckTeam]: STOECK * f } : null,
    weisTeam && s.weis.points[weisTeam] ? { [weisTeam]: s.weis.points[weisTeam] * f } : null,
    { red: trick.red * f, blue: trick.blue * f },
  ];

  let winner = null;
  for (const stage of stages) {
    if (!stage) continue;
    for (const t of TEAMS) {
      const pts = stage[t] || 0;
      s.score[t] += pts;
      won[t] += pts;
    }
    if (winner) continue;                        // already decided, but the hand still pays out
    const past = TEAMS.filter((t) => s.score[t] >= s.target);
    if (past.length === 1) winner = past[0];
    else if (past.length === 2) {
      winner = s.score.red === s.score.blue
        ? TEAM[s.forehand]                       // dead level, and forehand had the say
        : s.score.red > s.score.blue ? 'red' : 'blue';
    }
  }

  s.result = {
    factor: f,
    contract: s.contract,
    stoeck: stoeckTeam,
    weis: weisTeam ? { team: weisTeam, points: s.weis.points[weisTeam],
      best: s.weis.best ? weisLabel(s.weis.best) : null } : null,
    match: matchTeam,
    trick,
    gained: won,
    before,
    after: { ...s.score },
  };

  s.phase = 'hand';
  s.trick = [];

  if (winner) {
    s.winner = winner;
    s.schneider = s.score[otherTeam(winner)] < s.target / 2;
    s.phase = 'over';
    note(s, `${NAMES[winner]} wins${s.schneider ? ', and the other side is Schneider' : ''}.`);
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
//  Setting up
// ═══════════════════════════════════════════════════════════════════════

// A fresh match: nobody has scored, nobody has dealt, and the first hand is
// already on the table because there is nothing to look at until it is.
export function newGame({ target = 3000, bots = ['green', 'yellow'], deck = shuffled() } = {}) {
  const base = {
    board: BOARD_REV,
    rev: 0,
    order: ORDER,
    bots: ORDER.filter((s) => bots.includes(s)),
    target,
    score: { red: 0, blue: 0 },
    hand: 0,
    dealer: null,
    winner: null,
    schneider: false,
    last: null,
    log: [],
  };
  return dealHand(base, deck);
}

// Every legal thing the seat to act could do right now, as plain objects
// the screen can put on a button and hand straight back.
export function actionsFor(state, seat) {
  if (!state || state.winner || state.turn !== seat) return [];
  if (state.phase === 'bid') {
    const out = CONTRACTS.map((c) => ({ type: 'choose', id: c.id }));
    if (!state.shoved) out.push({ type: 'shove' });
    return out;
  }
  if (state.phase === 'play') return legalPlays(state, seat).map((card) => ({ type: 'play', card }));
  return [];
}

export function apply(state, action) {
  if (!action) return state;
  if (action.type === 'choose') return chooseContract(state, action.id);
  if (action.type === 'shove') return shove(state);
  if (action.type === 'play') return playCard(state, action.card);
  return state;
}

const clone = (s) => JSON.parse(JSON.stringify(s));
const bump = (s) => { s.rev = (s.rev || 0) + 1; return s; };

export { clone };
