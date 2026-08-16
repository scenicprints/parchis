// ═══════════════════════════════════════════════════════════════════════
//  Schieber Jass — the engine on its own.
//
//  The rules are pure, so they can be played through here with no browser
//  and no network. The last test is the one that matters: whole sessions
//  played out by the computer, checking after every hand that the pack
//  still adds up to a hundred and fifty-seven and that the turn machine
//  never stops with nobody able to move.
// ═══════════════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDER, TEAM, TEAMS, CONTRACTS, contractById, contractLabel, nextSeat, partnerOf,
  cardValue, cardStrength, pointsOf, trickLeader, legalPlays, canPlay,
  weisIn, betterWeis, resolveWeis, weisLabel, stoeckHolder,
  newGame, dealHand, chooseContract, shove, playCard, gather, apply, actionsFor,
  shuffled, isTrump, trumpSuit, HAND_TOTAL, LAST_TRICK, MATCH_BONUS, STOECK, BOARD_REV,
} from '../docs/games/jass/rules.js';

import { actFor } from '../docs/games/jass/bot.js';

import {
  DECK, SUITS, cardOf, suitOf, rankOf, cardName,
  ASS, KONIG, OBER, UNDER, BANNER, NELL, ACHT, SIEBEN, SECHS, SIEBEN_ROSEN,
} from '../docs/games/jass/cards.js';

const BELLS = 0, SHIELDS = 1, ACORNS = 2, ROSES = 3;
const suitC = (s) => contractById(['schellen', 'schilten', 'eicheln', 'rosen'][s]);
const TOP = contractById('obenabe');
const BOTTOM = contractById('undenufe');

// ═══════════════════════════════════════════════════════════════════════
//  The pack
// ═══════════════════════════════════════════════════════════════════════

test('every contract puts a hundred and fifty-seven on the table', () => {
  for (const def of CONTRACTS) {
    const total = pointsOf(def, DECK) + LAST_TRICK;
    assert.equal(total, HAND_TOTAL, `${def.id} came to ${total}`);
  }
});

test('the trump suit runs on its own scale', () => {
  const c = suitC(ACORNS);
  assert.equal(cardValue(c, cardOf(ACORNS, UNDER)), 20);      // the Puur
  assert.equal(cardValue(c, cardOf(ACORNS, NELL)), 14);       // the Näll
  assert.equal(cardValue(c, cardOf(ROSES, UNDER)), 2);        // and nothing elsewhere
  assert.equal(cardValue(c, cardOf(ROSES, NELL)), 0);
});

test('with no trump the eights make up the difference', () => {
  assert.equal(cardValue(TOP, cardOf(BELLS, ACHT)), 8);
  assert.equal(cardValue(BOTTOM, cardOf(BELLS, ACHT)), 8);
  assert.equal(cardValue(TOP, cardOf(BELLS, ASS)), 11);
  assert.equal(cardValue(BOTTOM, cardOf(BELLS, ASS)), 0);
  assert.equal(cardValue(BOTTOM, cardOf(BELLS, SECHS)), 11);
});

test('the Puur is the top trump and the six is top in undenufe', () => {
  const c = suitC(BELLS);
  const rank = [UNDER, NELL, ASS, KONIG, OBER, BANNER, ACHT, SIEBEN, SECHS];
  for (let i = 1; i < rank.length; i++) {
    assert.ok(
      cardStrength(c, cardOf(BELLS, rank[i - 1])) > cardStrength(c, cardOf(BELLS, rank[i])),
      `trump ${rank[i - 1]} should beat ${rank[i]}`
    );
  }
  assert.ok(cardStrength(BOTTOM, cardOf(BELLS, SECHS)) > cardStrength(BOTTOM, cardOf(BELLS, SIEBEN)));
  assert.ok(cardStrength(BOTTOM, cardOf(BELLS, SIEBEN)) > cardStrength(BOTTOM, cardOf(BELLS, ASS)));
});

// ═══════════════════════════════════════════════════════════════════════
//  Tricks
// ═══════════════════════════════════════════════════════════════════════

const T = (...pairs) => pairs.map(([by, card]) => ({ by, card }));

test('a trump takes a trick it had no business being in', () => {
  const c = suitC(BELLS);
  const won = trickLeader(c, T(
    ['red', cardOf(ROSES, ASS)],
    ['blue', cardOf(ROSES, KONIG)],
    ['green', cardOf(BELLS, SECHS)],
    ['yellow', cardOf(ROSES, BANNER)],
  ));
  assert.equal(won.by, 'green');
});

test('a card thrown off suit never wins, whatever it is worth', () => {
  const won = trickLeader(TOP, T(
    ['red', cardOf(ROSES, OBER)],
    ['blue', cardOf(BELLS, ASS)],
    ['green', cardOf(ACORNS, ASS)],
    ['yellow', cardOf(ROSES, SIEBEN)],
  ));
  assert.equal(won.by, 'red');
});

test('undenufe turns the trick upside down', () => {
  const won = trickLeader(BOTTOM, T(
    ['red', cardOf(ROSES, ASS)],
    ['blue', cardOf(ROSES, SECHS)],
    ['green', cardOf(ROSES, KONIG)],
    ['yellow', cardOf(ROSES, SIEBEN)],
  ));
  assert.equal(won.by, 'blue');
});

// ═══════════════════════════════════════════════════════════════════════
//  What you are allowed to put down
// ═══════════════════════════════════════════════════════════════════════

function table(contract, trick, hand, seat = 'yellow') {
  return {
    contract, trick: T(...trick), hands: { [seat]: hand },
    lead: trick.length ? trick[0][0] : seat, turn: seat,
  };
}

test('with no trump you simply follow suit', () => {
  const s = table(TOP, [['red', cardOf(ROSES, KONIG)]],
    [cardOf(ROSES, SECHS), cardOf(BELLS, ASS), cardOf(ACORNS, ASS)]);
  assert.deepEqual(legalPlays(s, 'yellow'), [cardOf(ROSES, SECHS)]);
});

test('holding the suit led you may still trump it instead', () => {
  const c = suitC(BELLS);
  const s = table(c, [['red', cardOf(ROSES, KONIG)]],
    [cardOf(ROSES, SECHS), cardOf(BELLS, SECHS), cardOf(ACORNS, ASS)]);
  const legal = legalPlays(s, 'yellow');
  assert.ok(legal.includes(cardOf(ROSES, SECHS)), 'may follow');
  assert.ok(legal.includes(cardOf(BELLS, SECHS)), 'may trump');
  assert.ok(!legal.includes(cardOf(ACORNS, ASS)), 'may not throw it away');
});

test('you may not undertrump once somebody has trumped', () => {
  const c = suitC(BELLS);
  const s = table(c, [['red', cardOf(ROSES, KONIG)], ['blue', cardOf(BELLS, OBER)]],
    [cardOf(BELLS, SECHS), cardOf(BELLS, NELL), cardOf(ACORNS, ASS)]);
  const legal = legalPlays(s, 'yellow');
  assert.ok(legal.includes(cardOf(BELLS, NELL)), 'a bigger trump is fine');
  assert.ok(!legal.includes(cardOf(BELLS, SECHS)), 'a smaller one is not');
  assert.ok(legal.includes(cardOf(ACORNS, ASS)), 'and being void, anything else is');
});

test('holding nothing but trumps lifts the undertrumping rule', () => {
  const c = suitC(BELLS);
  const s = table(c, [['red', cardOf(ROSES, KONIG)], ['blue', cardOf(BELLS, OBER)]],
    [cardOf(BELLS, SECHS), cardOf(BELLS, SIEBEN)]);
  assert.deepEqual(legalPlays(s, 'yellow'), [cardOf(BELLS, SECHS), cardOf(BELLS, SIEBEN)]);
});

test('trumps led have to be followed', () => {
  const c = suitC(BELLS);
  const s = table(c, [['red', cardOf(BELLS, ASS)]],
    [cardOf(BELLS, SECHS), cardOf(BELLS, OBER), cardOf(ACORNS, ASS)]);
  assert.deepEqual(legalPlays(s, 'yellow'), [cardOf(BELLS, SECHS), cardOf(BELLS, OBER)]);
});

test('the Puur is never dragged out of your hand', () => {
  const c = suitC(BELLS);
  const s = table(c, [['red', cardOf(BELLS, ASS)]],
    [cardOf(BELLS, UNDER), cardOf(ACORNS, ASS), cardOf(ROSES, SECHS)]);
  const legal = legalPlays(s, 'yellow');
  assert.equal(legal.length, 3, 'the whole hand is open');
  assert.ok(legal.includes(cardOf(BELLS, UNDER)), 'though it may still be played');
});

test('the Puur alongside another trump is not exempt', () => {
  const c = suitC(BELLS);
  const s = table(c, [['red', cardOf(BELLS, ASS)]],
    [cardOf(BELLS, UNDER), cardOf(BELLS, SECHS), cardOf(ACORNS, ASS)]);
  assert.deepEqual(legalPlays(s, 'yellow'), [cardOf(BELLS, UNDER), cardOf(BELLS, SECHS)]);
});

test('a seat to act always has something it may legally play', () => {
  // Every shape of hand against every shape of trick, in a trump contract,
  // has to leave at least one card playable or the game stops dead.
  const c = suitC(BELLS);
  let checked = 0;
  for (let i = 0; i < 4000; i++) {
    const d = shuffled();
    const hand = d.slice(0, 1 + (i % 9));
    const trick = d.slice(20, 20 + (i % 4));
    if (!trick.length) continue;
    const s = table(c, trick.map((card, k) => [ORDER[k], card]), hand);
    assert.ok(legalPlays(s, 'yellow').length > 0, 'nothing playable');
    checked++;
  }
  assert.ok(checked > 2000);
});

// ═══════════════════════════════════════════════════════════════════════
//  Weis and Stöck
// ═══════════════════════════════════════════════════════════════════════

test('a run of three is twenty and a run of four is fifty', () => {
  const three = weisIn([cardOf(ROSES, ASS), cardOf(ROSES, KONIG), cardOf(ROSES, OBER)]);
  assert.equal(three.length, 1);
  assert.equal(three[0].value, 20);

  const four = weisIn([cardOf(ROSES, ASS), cardOf(ROSES, KONIG), cardOf(ROSES, OBER),
    cardOf(ROSES, UNDER)]);
  assert.equal(four[0].value, 50);
  assert.equal(four[0].len, 4);
});

test('a run counts down the pack order, not the contract order', () => {
  // Banner sits between the Under and the nine, so U B 9 is a run of three
  // even though the Under is the top trump when roses are trumps.
  const w = weisIn([cardOf(ROSES, UNDER), cardOf(ROSES, BANNER), cardOf(ROSES, NELL)]);
  assert.equal(w.length, 1);
  assert.equal(w[0].value, 20);
});

test('a run of nine is three hundred, and is not cut into shorter ones', () => {
  const w = weisIn(Array.from({ length: 9 }, (_, r) => cardOf(BELLS, r)));
  assert.equal(w.length, 1);
  assert.equal(w[0].value, 300);
  assert.equal(w[0].len, 9);
});

test('four Unders are two hundred, four nines a hundred and fifty', () => {
  const unders = weisIn([0, 1, 2, 3].map((s) => cardOf(s, UNDER)));
  assert.equal(unders[0].value, 200);
  const nells = weisIn([0, 1, 2, 3].map((s) => cardOf(s, NELL)));
  assert.equal(nells[0].value, 150);
  const asses = weisIn([0, 1, 2, 3].map((s) => cardOf(s, ASS)));
  assert.equal(asses[0].value, 100);
});

test('four low cards are nothing at all', () => {
  assert.equal(weisIn([0, 1, 2, 3].map((s) => cardOf(s, SECHS))).length, 0);
  assert.equal(weisIn([0, 1, 2, 3].map((s) => cardOf(s, ACHT))).length, 0);
});

test('a card may serve a four and a run at once', () => {
  const hand = [0, 1, 2, 3].map((s) => cardOf(s, KONIG))
    .concat([cardOf(ROSES, ASS), cardOf(ROSES, OBER)]);
  const w = weisIn(hand);
  assert.ok(w.some((x) => x.kind === 'four' && x.value === 100));
  assert.ok(w.some((x) => x.kind === 'seq' && x.len === 3), 'A K O of roses is still a run');
});

test('at equal points the longer set wins', () => {
  const four = { kind: 'four', rank: ASS, len: 4, value: 100, top: ASS, suit: null, order: 0 };
  const five = { kind: 'seq', len: 5, value: 100, top: KONIG, suit: 1, order: 3 };
  assert.equal(betterWeis(TOP, four, five), five);
});

test('at equal length the higher card wins, and then the trump suit', () => {
  const a = { kind: 'seq', len: 3, value: 20, top: ASS, suit: ROSES, order: 1 };
  const b = { kind: 'seq', len: 3, value: 20, top: KONIG, suit: BELLS, order: 0 };
  assert.equal(betterWeis(TOP, a, b), a, 'the higher run');

  const c = { kind: 'seq', len: 3, value: 20, top: ASS, suit: BELLS, order: 3 };
  assert.equal(betterWeis(suitC(BELLS), a, c), c, 'the one in trumps');

  const d = { kind: 'seq', len: 3, value: 20, top: ASS, suit: ACORNS, order: 3 };
  assert.equal(betterWeis(TOP, a, d), a, 'and failing that, whoever plays sooner');
});

test('the best set takes everything on its own side and nothing on the other', () => {
  const dealt = {
    red:    [cardOf(ROSES, ASS), cardOf(ROSES, KONIG), cardOf(ROSES, OBER), cardOf(ROSES, UNDER)],
    green:  [cardOf(BELLS, ASS), cardOf(BELLS, KONIG), cardOf(BELLS, OBER)],
    blue:   [cardOf(ACORNS, ASS), cardOf(ACORNS, KONIG), cardOf(ACORNS, OBER)],
    yellow: [],
  };
  const w = resolveWeis({ contract: TOP, dealt, lead: 'red' });
  assert.equal(w.team, 'red');
  assert.equal(w.points.red, 70, 'fifty for the four, twenty for the partner');
  assert.equal(w.points.blue, 0, 'and the other side gets nothing for a good one');
});

test('Stöck is the König and Ober of trumps, and only in a trump contract', () => {
  const dealt = {
    red: [cardOf(BELLS, KONIG), cardOf(BELLS, OBER)], blue: [], green: [], yellow: [],
  };
  assert.equal(stoeckHolder(suitC(BELLS), dealt), 'red');
  assert.equal(stoeckHolder(suitC(ROSES), dealt), null);
  assert.equal(stoeckHolder(TOP, dealt), null);
});

// ═══════════════════════════════════════════════════════════════════════
//  A hand, start to finish
// ═══════════════════════════════════════════════════════════════════════

test('forehand may shove exactly once, and the partner has to choose', () => {
  let s = newGame();
  const fore = s.forehand;
  assert.equal(s.phase, 'bid');
  assert.equal(s.turn, fore);

  s = shove(s);
  assert.equal(s.turn, partnerOf(fore));
  assert.ok(s.shoved);

  const again = shove(s);
  assert.equal(again, s, 'a second shove does nothing');

  s = chooseContract(s, 'obenabe');
  assert.equal(s.phase, 'play');
  assert.equal(s.contract.factor, 3);
  assert.equal(s.turn, fore, 'forehand still leads');
});

test('play runs to the right, and the trick stands until it is swept up', () => {
  let s = chooseContract(newGame(), 'eicheln');
  const lead = s.turn;
  for (let i = 0; i < 4; i++) {
    assert.equal(s.phase, 'play');
    s = playCard(s, legalPlays(s, s.turn)[0]);
  }
  assert.equal(s.phase, 'gather');
  assert.equal(s.trick.length, 4, 'still on the table for both phones to see');
  assert.deepEqual(s.trick.map((p) => p.by),
    [lead, nextSeat(lead), nextSeat(nextSeat(lead)), partnerOf(nextSeat(lead))]);

  const won = trickLeader(s.contract, s.trick).by;
  s = gather(s);
  assert.equal(s.trick.length, 0);
  assert.equal(s.turn, won, 'and the winner leads the next one');
  assert.equal(s.wins[TEAM[won]], 1);
});

test('an illegal card is simply refused', () => {
  let s = chooseContract(newGame(), 'schilten');
  const seat = s.turn;
  const holding = s.hands[seat][0];
  s = playCard(s, holding);
  const next = s.turn;
  const illegal = s.hands[next].find((c) => !canPlay(s, next, c));
  if (illegal !== undefined) assert.equal(playCard(s, illegal), s);
  assert.equal(playCard(s, 999), s, 'and so is a card nobody holds');
});

// ═══════════════════════════════════════════════════════════════════════
//  Whole sessions, played by the computer
// ═══════════════════════════════════════════════════════════════════════

// Play one match through to its end, checking the pack after every hand.
function playMatch(target, skill) {
  let s = newGame({ target });
  let guard = 0;

  while (!s.winner) {
    if (guard++ > 8000) throw new Error(`stuck in ${s.phase}, turn ${s.turn}`);

    if (s.phase === 'gather') { s = gather(s); continue; }

    if (s.phase === 'hand') {
      checkHand(s);
      s = dealHand(s);
      continue;
    }

    const before = s.rev;
    const act = actFor(s, s.turn, skill);
    assert.ok(act, `no action offered in ${s.phase}`);
    if (act.type === 'play') {
      assert.ok(canPlay(s, s.turn, act.card),
        `the computer tried ${cardName(act.card)}, which is not legal`);
    }
    s = apply(s, act);
    assert.ok(s.rev > before, `${s.phase} did not move on`);
  }

  checkHand(s);
  return s;
}

// After a hand: the pack still adds up, and the slate moved by what the
// hand said it would.
function checkHand(s) {
  const r = s.result;
  assert.ok(r, 'a finished hand always leaves a result');
  const dealt = r.trick.red + r.trick.blue - (r.match ? MATCH_BONUS : 0);
  assert.equal(dealt, HAND_TOTAL, `the hand paid out ${dealt}`);

  assert.equal(s.wins.red + s.wins.blue, 9, 'nine tricks every time');
  if (r.match) assert.equal(s.wins[r.match], 9);

  for (const t of TEAMS) {
    assert.equal(r.after[t], r.before[t] + r.gained[t], `${t}'s slate does not add up`);
    assert.equal(s.score[t], r.after[t]);
  }

  const expect = (r.stoeck ? STOECK : 0) + (r.weis ? r.weis.points : 0)
    + r.trick.red + r.trick.blue;
  assert.equal(r.gained.red + r.gained.blue, expect * r.factor,
    'everything on the hand is multiplied by the contract');
}

test('a short session plays out and somebody wins it', () => {
  const s = playMatch(1000, 'hard');
  assert.ok(TEAMS.includes(s.winner));
  assert.ok(s.score[s.winner] >= 1000);
  assert.equal(s.phase, 'over');
  assert.equal(typeof s.schneider, 'boolean');
});

test('four hundred sessions play to a finish without jamming', () => {
  const skills = ['hard', 'easy'];
  const wins = { red: 0, blue: 0 };
  for (let i = 0; i < 400; i++) {
    const s = playMatch(i % 4 === 0 ? 3000 : 1000, skills[i % 2]);
    wins[s.winner]++;
  }
  // Both sides have to be able to win it. The seats are symmetrical apart
  // from who deals first, so a shut-out here means something is wired to
  // one colour that should not be.
  assert.ok(wins.red > 40 && wins.blue > 40, `red ${wins.red}, blue ${wins.blue}`);
});
