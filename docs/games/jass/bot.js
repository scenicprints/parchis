// ═══════════════════════════════════════════════════════════════════════
//  THE COMPUTER SEATS — a partner you can live with.
//
//  Two of the four chairs are always played for. That makes the computer's
//  card sense the difference between a good evening and a bad one, so this
//  is a little more than "play something legal": it counts what is still
//  out, it knows when its partner is safe, and it feeds points to them when
//  they are.
//
//  Pure, like the rules. State in, one action out, and no randomness at all
//  on the hard setting so two phones watching the same board could never
//  arrive at different moves.
// ═══════════════════════════════════════════════════════════════════════

import {
  TEAM, CONTRACTS, legalPlays, trickLeader, cardValue,
  cardStrength, isTrump, trumpSuit, weisIn, HAND_TOTAL,
} from './rules.js';

import { DECK, suitOf, rankOf, ASS, KONIG, OBER, UNDER, BANNER, NELL, ACHT, SIEBEN, SECHS }
  from './cards.js';

// ═══════════════════════════════════════════════════════════════════════
//  What is left in the room
// ═══════════════════════════════════════════════════════════════════════

// Everything this seat has not seen: the pack, less its own hand, less
// every card already swept up, less whatever is on the table right now.
// Nothing here is hidden knowledge; it is all cards that were played face
// up, plus its own hand.
function stillOut(state, seat) {
  const seen = new Set(state.hands[seat] || []);
  for (const t of ['red', 'blue']) for (const c of state.taken[t] || []) seen.add(c);
  for (const p of state.trick || []) seen.add(p.card);
  return DECK.filter((c) => !seen.has(c));
}

// Would that card beat this one, on a trick led in `led`?
function outranks(contract, led, challenger, held) {
  const ct = isTrump(contract, challenger);
  const ht = isTrump(contract, held);
  if (ct && !ht) return true;
  if (!ct && ht) return false;
  if (ct && ht) return cardStrength(contract, challenger) > cardStrength(contract, held);
  if (suitOf(challenger) !== led) return false;
  if (suitOf(held) !== led) return true;
  return cardStrength(contract, challenger) > cardStrength(contract, held);
}

// ═══════════════════════════════════════════════════════════════════════
//  Naming the contract
// ═══════════════════════════════════════════════════════════════════════

// How good this hand looks if that contract is played. Roughly a guess at
// the card points it would take out of the hundred and fifty-two.
function strengthFor(hand, def) {
  const bySuit = [[], [], [], []];
  for (const c of hand) bySuit[suitOf(c)].push(rankOf(c));

  if (def.kind === 'suit') {
    const t = def.suit;
    const TRUMP_WORTH = { [UNDER]: 22, [NELL]: 18, [ASS]: 12, [KONIG]: 8, [OBER]: 6, [BANNER]: 4 };
    let s = 0;
    for (const r of bySuit[t]) s += TRUMP_WORTH[r] ?? 3;
    if (bySuit[t].length > 3) s += (bySuit[t].length - 3) * 5;

    for (let u = 0; u < 4; u++) {
      if (u === t) continue;
      const n = bySuit[u].length;
      if (n === 0) s += 6;                                  // a void to trump into
      else if (n === 1) s += 2;
      if (bySuit[u].includes(ASS)) s += 7;
      if (bySuit[u].includes(KONIG) && n >= 2) s += 3;
    }
    return s;
  }

  // No trump, so it is all about holding the top of a suit, or the bottom.
  const WORTH = def.kind === 'top'
    ? { [ASS]: 13, [KONIG]: 8, [OBER]: 4, [BANNER]: 3, [ACHT]: 3 }
    : { [SECHS]: 13, [SIEBEN]: 8, [ACHT]: 7, [NELL]: 4, [BANNER]: 3 };
  let s = 0;
  for (let u = 0; u < 4; u++) {
    for (const r of bySuit[u]) s += WORTH[r] ?? 0;
    if (bySuit[u].length >= 4) s += 4;                      // length runs the suit out
  }
  return s;
}

const weisWorth = (hand) => weisIn(hand).reduce((n, w) => n + w.value, 0);

// What the hand is worth on the slate. The multiplier cuts both ways: it
// magnifies whatever the opponents take as well, so a contract is only
// worth choosing to the extent this hand beats an even split of the pack.
export function rateContracts(hand) {
  const weis = weisWorth(hand);
  return CONTRACTS.map((def) => {
    const raw = strengthFor(hand, def);
    const est = Math.max(20, Math.min(140, 32 + raw * 0.95));
    const edge = (2 * est - HAND_TOTAL) + weis * 0.6;
    return { id: def.id, factor: def.factor, est, expected: def.factor * edge };
  }).sort((a, b) => b.expected - a.expected);
}

// A hand with nothing in it is worth shoving, once, in the hope the other
// side of the table has something. Being shoved to leaves no such choice.
const SHOVE_BELOW = 10;

export function chooseFor(state, seat, skill = 'hard') {
  const hand = state.hands[seat] || [];

  if (skill === 'easy') {
    const pick = CONTRACTS[rankOf(hand[0] ?? 0) % 4];       // one of the four suits
    return { type: 'choose', id: pick.id };
  }

  const rated = rateContracts(hand);
  if (!state.shoved && rated[0].expected < SHOVE_BELOW) return { type: 'shove' };
  return { type: 'choose', id: rated[0].id };
}

// ═══════════════════════════════════════════════════════════════════════
//  Playing a card
// ═══════════════════════════════════════════════════════════════════════

// How reluctant this seat should be to let go of a card: what it is worth
// on the table, plus how much winning power goes with it.
const cost = (contract, card) =>
  cardValue(contract, card) * 2 + cardStrength(contract, card);

const cheapest = (contract, cards) =>
  cards.reduce((a, b) => (cost(contract, a) <= cost(contract, b) ? a : b));

const fattest = (contract, cards) =>
  cards.reduce((a, b) => (cardValue(contract, a) >= cardValue(contract, b) ? a : b));

export function playFor(state, seat, skill = 'hard') {
  const legal = legalPlays(state, seat);
  if (legal.length <= 1) return legal[0];
  if (skill === 'easy') return legal[(state.rev + seat.length) % legal.length];

  const c = state.contract;
  const trick = state.trick || [];
  const out = stillOut(state, seat);
  const played = state.wins.red + state.wins.blue;

  if (!trick.length) return leadWith(state, seat, legal, out, played);

  const led = suitOf(trick[0].card);
  const winning = trickLeader(c, trick);
  const mine = TEAM[winning.by] === TEAM[seat];
  const lastToPlay = trick.length === 3;
  const pot = trick.reduce((n, p) => n + cardValue(c, p.card), 0);

  // ── The partner is holding it ────────────────────────────────────
  // Points thrown onto a trick your own side is taking are points banked.
  // Only worth doing when nobody left can take it off them.
  if (mine) {
    const safe = lastToPlay || !out.some((u) => outranks(c, led, u, winning.card));
    if (safe) {
      // Keep trumps back even so; they are worth more later than the ten
      // they would add now.
      const spare = legal.filter((x) => !isTrump(c, x));
      return fattest(c, spare.length ? spare : legal);
    }
    return cheapest(c, legal);
  }

  // ── An opponent is holding it ────────────────────────────────────
  const beats = legal.filter((x) => outranks(c, led, x, winning.card));
  if (beats.length) {
    const win = cheapest(c, beats);
    // Take it when there is something in it, when the hand is running out,
    // or when taking it costs almost nothing.
    if (pot >= 10 || lastToPlay || played >= 6 || cost(c, win) <= 8) return win;
  }
  return cheapest(c, legal);
}

// ── Leading ──────────────────────────────────────────────────────────
function leadWith(state, seat, legal, out, played) {
  const c = state.contract;
  const t = trumpSuit(c);
  const hand = state.hands[seat];

  if (t !== null) {
    const trumps = hand.filter((x) => suitOf(x) === t);
    const outTrumps = out.filter((x) => suitOf(x) === t);
    const declaring = TEAM[c.by] === TEAM[seat];
    // Whoever named the trump wants them out of the other side's hands
    // early, and the Puur drags two of them down with it.
    if (declaring && trumps.length >= 3 && outTrumps.length >= 2 && played < 4) {
      return trumps.reduce((a, b) =>
        (cardStrength(c, a) >= cardStrength(c, b) ? a : b));
    }
  }

  // A card nothing left in the room can beat, in the fattest such suit.
  const plain = legal.filter((x) => t === null || suitOf(x) !== t);
  const boss = plain.filter((x) => {
    const led = suitOf(x);
    if (out.some((u) => suitOf(u) === led && outranks(c, led, u, x))) return false;
    if (t === null) return true;
    // It can still be trumped, so only lead one while trumps are thin on
    // the ground or it is early enough that they have to follow suit.
    return out.filter((u) => suitOf(u) === t).length <= 2 || played < 2;
  });
  if (boss.length) return fattest(c, boss);

  return cheapest(c, plain.length ? plain : legal);
}

// Everything the computer would do, so a test can run a whole session
// without a screen.
export const actFor = (state, seat, skill = 'hard') =>
  state.phase === 'bid' ? chooseFor(state, seat, skill)
    : state.phase === 'play' ? { type: 'play', card: playFor(state, seat, skill) }
      : null;

export { stillOut, outranks };
