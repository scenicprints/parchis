// ═══════════════════════════════════════════════════════════════════════
//  SCHIEBER JASS — the screen.
//
//  The rules live in rules.js and the computer's card sense in bot.js, and
//  neither knows any of this exists. This file draws the table and takes
//  the taps, and knows nothing about Firestore either: the hub mounts it,
//  hands it a board to show and one way to hand a new board back.
//
//  Four chairs, two of them played for. You are always at the bottom, your
//  partner across from you, and play runs to the right the way it does in
//  Switzerland.
// ═══════════════════════════════════════════════════════════════════════

import {
  ORDER, TEAM, NAMES, CONTRACTS, SIDES, BOARD_REV,
  nextSeat, partnerOf, otherTeam, contractLabel,
  legalPlays, canPlay, trickLeader, cardStrength, trumpSuit, isTrump, pointsOf,
  newGame, dealHand, gather, apply, STOECK, MATCH_BONUS,
} from './rules.js';

import { actFor } from './bot.js';
import { SUITS, suitOf, cardFace, cardBack, suitMark, SUIT_NAME, cardName } from './cards.js';
import { sheet, addRow as add } from '../../ui.js';

// ═══════════════════════════════════════════════════════════════════════
//  What the screen is currently showing
// ═══════════════════════════════════════════════════════════════════════

let api = null;        // the hub's side of the conversation
let LOCAL = false;     // every side on this device, with no network
let uid = null;
let table = null;      // seats and the record
let game = null;       // the live board
let myColor = null;
let shown = 'red';     // whose cards the panel is showing, which only moves in LOCAL
let refused = null;    // a card that was tapped and is not legal, for one flash
let pending = null;    // the timer for the next step nobody has to choose
let pendingFor = null; // the board revision that step belongs to

const TRICK_HOLD = 1150;   // long enough to see what took the trick
const BOT_PAUSE = 520;

const DEFAULTS = { people: 2, skill: 'hard', target: 3000 };
const SKILLS = ['easy', 'hard'];
const SKILL_LABEL = { easy: 'Easy', hard: 'Hard' };
const TARGETS = [1000, 1500, 3000];

const house = () => ({ ...DEFAULTS, ...(api?.settings() || {}) });

const isBot = (c) => (game?.bots || []).includes(c);

// May this device act for that seat? Never for the computer, and online
// never for anybody but yourself.
const iPlay = (c) => !isBot(c) && (LOCAL || c === myColor);

// Exactly one device drives the computer, or two phones write the same turn
// and fight over it. The seat earliest in turn order does it.
function iDrive() {
  if (LOCAL) return true;
  const seats = table?.seats || {};
  const held = ORDER.filter((c) => seats[c]?.uid);
  return held.length > 0 && seats[held[0]].uid === uid;
}

// Whether this device is the one that moves that seat on. Everything the
// game does automatically goes through here, so a step is only ever taken
// by one phone however many are watching.
const iAct = (seat) => (isBot(seat) ? iDrive() : iPlay(seat));

const $ = (id) => document.getElementById(id);

// The seat whose cards are in the panel. Online that is always your own.
// On one device it follows whoever is to play, so the phone gets passed
// round the table the way the cards would be.
function handSeat() {
  if (!LOCAL) return myColor;
  if (game && iPlay(game.turn)) shown = game.turn;
  return shown;
}

// What to call a seat. The two computers are named for their colour, since
// the chips are coloured and "Computer" twice over says nothing.
function nameOf(seat) {
  if (isBot(seat)) return NAMES[seat];
  return table?.seats?.[seat]?.name || (LOCAL ? NAMES[seat] : NAMES[seat]);
}

// A partnership is one person and the computer across from them, so it goes
// by that person's name.
const teamName = (t) => nameOf(t);

// ═══════════════════════════════════════════════════════════════════════
//  Drawing
// ═══════════════════════════════════════════════════════════════════════

// Where each seat sits on screen, from the point of view of whoever is
// holding the phone. Play runs to the right, so the seat after yours is
// the one on your right and your partner is opposite.
function places() {
  const me = handSeat() || 'red';
  return {
    bottom: me,
    right: nextSeat(me),
    top: partnerOf(me),
    left: nextSeat(partnerOf(me)),
  };
}

function render() {
  if (!game || !api) return;
  renderHeader();
  renderSlate();
  renderSeats();
  renderTrick();
  renderPanel();
}

// ── The bar the hub owns ─────────────────────────────────────────────
function renderHeader() {
  const bar = $('seatbar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const c of ORDER) {
    const el = document.createElement('div');
    el.className = `seat${game.turn === c && !game.winner && game.phase !== 'hand' ? ' active' : ''}`;
    el.innerHTML = '<i class="chip"></i><span class="nm"></span>';
    el.firstChild.className = `chip ${c}`;
    el.lastChild.textContent = nameOf(c);
    bar.appendChild(el);
  }
  bar.classList.add('four');
  // Four names and the hub's record will not share one bar on a phone. The
  // slate below carries the numbers that matter during a game anyway.
  $('score')?.classList.add('hidden');
}

// ── The slate ────────────────────────────────────────────────────────
// Two totals and the target. This is the thing you glance at, so it is the
// thing at the top of the table.
function renderSlate() {
  const el = $('j-slate');
  if (!el) return;
  const mine = TEAM[handSeat() || 'red'];
  const theirs = otherTeam(mine);
  el.innerHTML = `
    <div class="jteam ${mine}"><span class="jt-n"></span><span class="jt-s"></span></div>
    <div class="jgoal"></div>
    <div class="jteam ${theirs} right"><span class="jt-s"></span><span class="jt-n"></span></div>`;
  const [a, b] = el.querySelectorAll('.jteam');
  a.querySelector('.jt-n').textContent = teamName(mine);
  a.querySelector('.jt-s').textContent = game.score[mine];
  b.querySelector('.jt-n').textContent = teamName(theirs);
  b.querySelector('.jt-s').textContent = game.score[theirs];
  el.querySelector('.jgoal').textContent = `to ${game.target}`;
}

// ── The three seats you cannot see the cards of ──────────────────────
function renderSeats() {
  const p = places();
  for (const [where, seat] of Object.entries(p)) {
    if (where === 'bottom') continue;
    const box = $(`j-${where}`);
    if (!box) continue;

    const n = (game.hands[seat] || []).length;
    const active = game.turn === seat && !game.winner && game.phase !== 'hand';
    box.className = `jseat ${where}${active ? ' active' : ''}`;

    const fan = Array.from({ length: n }, () =>
      `<span class="jb">${cardBack({ w: where === 'top' ? 30 : 26 })}</span>`).join('');

    box.innerHTML = `
      <div class="jwho"><i class="chip ${seat}"></i><span></span></div>
      <div class="jfan">${fan}</div>`;
    box.querySelector('.jwho span').textContent = nameOf(seat);
  }
}

// ── The trick on the table ───────────────────────────────────────────
function renderTrick() {
  const el = $('j-trick');
  if (!el) return;
  el.innerHTML = '';

  const p = places();
  const at = {};
  for (const [where, seat] of Object.entries(p)) at[seat] = where;

  // Once the hand is over there is nothing left to play, so the table keeps
  // the trick that finished it rather than sitting there empty behind the
  // scoreboard.
  const over = game.phase === 'hand' || game.phase === 'over';
  const held = over ? (game.last?.plays || []) : game.trick;
  const lead = held.length ? trickLeader(game.contract, held) : null;

  for (const play of held) {
    const slot = document.createElement('div');
    slot.className = `jplay ${at[play.by]}${lead && lead.by === play.by ? ' winning' : ''}`;
    slot.innerHTML = cardFace(play.card, { w: 54 });
    el.appendChild(slot);
  }

  const badge = $('j-contract');
  if (!badge) return;
  if (!game.contract) {
    badge.className = 'jcontract hidden';
    badge.innerHTML = '';
  } else {
    const c = game.contract;
    const t = trumpSuit(c);
    badge.className = 'jcontract';
    badge.innerHTML = `${t === null ? `<span class="jarrow">${c.kind === 'top' ? '↑' : '↓'}</span>`
      : suitMark(SUITS[t], 22)}<span class="jc-l"></span><span class="jc-x">×${c.factor}</span>`;
    badge.querySelector('.jc-l').textContent = contractLabel(c);
  }

  renderTally();
}

// How the hand is going so far: tricks taken and what they were worth.
// Both of those are public. The cards went down face up, and a Swiss table
// expects you to have been counting them, so this only saves the addition.
function renderTally() {
  const el = $('j-tally');
  if (!el) return;
  if (!game.contract || game.phase === 'bid') {
    el.className = 'jtally hidden';
    return;
  }
  const mine = TEAM[handSeat() || 'red'];
  const theirs = otherTeam(mine);
  el.className = 'jtally';
  el.innerHTML = `<span class="jw ${mine}"></span><span class="jsep">–</span>
    <span class="jw ${theirs}"></span><span class="jp"></span>`;
  const [a, b] = el.querySelectorAll('.jw');
  a.textContent = game.wins[mine];
  b.textContent = game.wins[theirs];
  el.querySelector('.jp').textContent =
    `${pointsOf(game.contract, game.taken[mine])} · ${pointsOf(game.contract, game.taken[theirs])}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  The panel: what you say and what you hold
// ═══════════════════════════════════════════════════════════════════════

function renderPanel() {
  const seat = handSeat();
  const status = $('j-status');
  const bid = $('j-bid');
  const result = $('j-result');

  bid.className = 'jbid hidden';
  result.className = 'jresult hidden';
  status.className = 'jstatus';

  if (game.phase === 'over') {
    status.classList.add('over');
    const won = game.winner;
    status.textContent = !LOCAL && won === TEAM[myColor]
      ? 'You win' : `${teamName(won)} wins`;
    renderResult(true);
  } else if (game.phase === 'hand') {
    status.textContent = 'Hand over';
    renderResult(false);
  } else if (game.phase === 'bid') {
    if (game.turn === seat && iPlay(seat)) {
      status.classList.add('you');
      status.textContent = game.shoved
        ? 'Shoved to you. Name it.'
        : 'Name the trump, or shove it across.';
      renderBid();
    } else {
      status.textContent = `${nameOf(game.turn)} is choosing`;
    }
  } else if (game.phase === 'gather') {
    const won = trickLeader(game.contract, game.trick);
    status.textContent = won ? `${nameOf(won.by)} takes it` : '';
  } else if (pending && isBot(game.turn)) {
    status.textContent = `${nameOf(game.turn)} is playing`;
  } else if (game.turn === seat && iPlay(seat)) {
    status.classList.add('you');
    status.textContent = LOCAL ? `${nameOf(seat)} to play` : 'Your card';
  } else {
    status.textContent = `${nameOf(game.turn)} to play`;
  }

  renderTrump();
  renderHand();
  const last = game.log?.[game.log.length - 1];
  $('j-last').textContent = game.phase === 'hand' || game.phase === 'over' ? '' : (last?.t || '');
}

// ── What is trumps ───────────────────────────────────────────────────
//
// Sat right on top of your own cards, because that is where you are
// looking when you have to choose one. It was a small badge in the corner
// of the table naming a suit, which is no use at all until you already
// know which drawing "bells" means. So this shows the sign at a size you
// can read, and the trumps in your hand are marked underneath as well.
//
// With no trump the same bar has more work to do, not less: obenabe and
// undenufe differ only in which end of the pack wins, and reading that
// backwards loses the hand.
function renderTrump() {
  const el = $('j-trump');
  if (!el) return;
  const c = game.contract;
  if (!c || game.phase === 'hand' || game.phase === 'over') {
    el.className = 'jtrump hidden';
    el.innerHTML = '';
    return;
  }

  const t = trumpSuit(c);
  el.className = 'jtrump';
  el.innerHTML = `${t === null
    ? `<span class="jarrow big">${c.kind === 'top' ? '↑' : '↓'}</span>`
    : suitMark(SUITS[t], 30)}
    <span class="jt-lab"><b></b><i></i></span>
    <span class="jt-x">×${c.factor}</span>`;
  el.querySelector('b').textContent = t === null
    ? (c.kind === 'top' ? 'Obenabe' : 'Undenufe')
    : SUIT_NAME[SUITS[t]];
  el.querySelector('i').textContent = t === null
    ? (c.kind === 'top' ? 'no trump, Ass high' : 'no trump, six high')
    : 'are trumps';
}

// ── Your hand ────────────────────────────────────────────────────────

// Cards sorted the way you would hold them: suit by suit, and inside a suit
// strongest first under whatever contract is being played, so the trumps
// come out in the order they will actually win.
function sortedHand(seat) {
  const cards = [...(game.hands[seat] || [])];
  const c = game.contract;
  const t = trumpSuit(c);
  const suitRank = (card) => (t !== null && suitOf(card) === t ? -1 : suitOf(card));
  return cards.sort((a, b) =>
    suitRank(a) - suitRank(b) || cardStrength(c, b) - cardStrength(c, a));
}

function renderHand() {
  const box = $('j-hand');
  if (!box) return;
  const seat = handSeat();
  const cards = seat ? sortedHand(seat) : [];
  box.innerHTML = '';
  if (!cards.length) return;

  // Nine cards have to fit whatever phone this is, so the width and the
  // overlap are worked out from the room there actually is rather than
  // guessed at and left to run off the side.
  const room = Math.max(240, box.clientWidth || 340) - 12;
  const n = cards.length;
  const w = Math.max(38, Math.min(60, Math.floor(room / (0.62 * (n - 1) + 1))));
  const step = n > 1 ? Math.min(w, Math.floor((room - w) / (n - 1))) : 0;

  const playable = game.phase === 'play' && game.turn === seat && iPlay(seat);
  const legal = playable ? new Set(legalPlays(game, seat)) : null;

  cards.forEach((card, i) => {
    const b = document.createElement('button');
    b.className = 'jcard';
    // Gold along the bottom edge, which is the one part of a card in a fan
    // that is never covered by the next one.
    if (isTrump(game.contract, card)) b.classList.add('trump');
    if (legal && !legal.has(card)) b.classList.add('dud');
    if (playable && legal.has(card)) b.classList.add('live');
    if (refused === card) b.classList.add('refused');
    b.style.marginLeft = i ? `${step - w}px` : '0';
    b.style.zIndex = String(i + 1);
    b.innerHTML = cardFace(card, { w });
    b.setAttribute('aria-label', cardName(card));
    b.addEventListener('click', () => tapCard(card));
    box.appendChild(b);
  });
}

// ── Naming the contract ──────────────────────────────────────────────
function renderBid() {
  const bid = $('j-bid');
  bid.className = 'jbid';
  bid.innerHTML = '';

  for (const def of CONTRACTS) {
    const b = document.createElement('button');
    b.className = 'jbidb';
    const face = def.kind === 'suit'
      ? suitMark(SUITS[def.suit], 26)
      : `<span class="jarrow big">${def.kind === 'top' ? '↑' : '↓'}</span>`;
    b.innerHTML = `${face}<span class="jb-l"></span><span class="jb-x">×${def.factor}</span>`;
    b.querySelector('.jb-l').textContent = def.kind === 'suit'
      ? SUIT_NAME[SUITS[def.suit]] : def.label;
    b.addEventListener('click', () => act({ type: 'choose', id: def.id }));
    bid.appendChild(b);
  }

  if (!game.shoved) {
    const s = document.createElement('button');
    s.className = 'jshove';
    s.textContent = `Shove it to ${nameOf(partnerOf(game.turn))}`;
    s.addEventListener('click', () => act({ type: 'shove' }));
    bid.appendChild(s);
  }
}

// ── What the hand came to ────────────────────────────────────────────
function renderResult(final) {
  const box = $('j-result');
  const r = game.result;
  if (!r) return;
  box.className = 'jresult';
  box.innerHTML = '';

  const mine = TEAM[handSeat() || 'red'];
  const theirs = otherTeam(mine);

  const line = (label, a, b, strong) => {
    const d = document.createElement('div');
    d.className = `jrow${strong ? ' strong' : ''}`;
    d.innerHTML = '<span class="jr-l"></span><span class="jr-a"></span><span class="jr-b"></span>';
    d.children[0].textContent = label;
    d.children[1].textContent = a;
    d.children[2].textContent = b;
    box.appendChild(d);
  };

  const head = document.createElement('div');
  head.className = 'jrhead';
  head.innerHTML = '<span class="jr-l"></span><span class="jr-a"></span><span class="jr-b"></span>';
  head.children[0].textContent = `${contractLabel(r.contract)} ×${r.factor}`;
  head.children[1].textContent = teamName(mine);
  head.children[2].textContent = teamName(theirs);
  box.appendChild(head);

  const side = (t, v) => (v ? String(v) : '—');
  if (r.stoeck) line('Stöck', side(mine, r.stoeck === mine ? STOECK : 0),
    side(theirs, r.stoeck === theirs ? STOECK : 0));
  if (r.weis) {
    line(`Weis${r.weis.best ? `, ${r.weis.best.toLowerCase()}` : ''}`,
      side(mine, r.weis.team === mine ? r.weis.points : 0),
      side(theirs, r.weis.team === theirs ? r.weis.points : 0));
  }
  line('Tricks', r.trick[mine] - (r.match === mine ? MATCH_BONUS : 0),
    r.trick[theirs] - (r.match === theirs ? MATCH_BONUS : 0));
  if (r.match) line('Match', side(mine, r.match === mine ? MATCH_BONUS : 0),
    side(theirs, r.match === theirs ? MATCH_BONUS : 0));
  line('On the slate', `+${r.gained[mine]}`, `+${r.gained[theirs]}`);
  line('', r.after[mine], r.after[theirs], true);

  const btn = document.createElement('button');
  btn.className = 'jnext';
  if (final) {
    btn.textContent = 'New game';
    btn.addEventListener('click', () => api.deal());
    if (game.schneider) {
      const n = document.createElement('div');
      n.className = 'jschneider';
      n.textContent = `${teamName(otherTeam(game.winner))} did not reach `
        + `${game.target / 2}, so that is Schneider.`;
      box.appendChild(n);
    }
  } else {
    btn.textContent = 'Next hand';
    btn.addEventListener('click', nextHand);
  }
  box.appendChild(btn);
}

// ═══════════════════════════════════════════════════════════════════════
//  Taps
// ═══════════════════════════════════════════════════════════════════════

function tapCard(card) {
  if (!game || game.phase !== 'play') return;
  // No flag guards this. Playing a card moves `game.turn` on the spot,
  // before anything is awaited, so a second tap simply finds it is not this
  // seat's turn any more.
  const seat = handSeat();
  if (game.turn !== seat || !iPlay(seat)) return;

  if (!canPlay(game, seat, card)) {
    // Say why rather than doing nothing, because "nothing happened" is the
    // one response that reads as the app being broken.
    refused = card;
    $('j-last').textContent = whyNot(seat, card);
    render();
    setTimeout(() => { refused = null; render(); }, 700);
    return;
  }
  act({ type: 'play', card });
}

// The rule that card fell foul of, in the words the rule is actually in.
function whyNot(seat, card) {
  const c = game.contract;
  const trick = game.trick;
  if (!trick.length) return '';
  const led = suitOf(trick[0].card);
  const t = trumpSuit(c);
  const hand = game.hands[seat];

  if (t !== null && led === t && suitOf(card) !== t) {
    return 'Trumps were led, and you have to follow them.';
  }
  if (t !== null && suitOf(card) === t) {
    return 'Somebody has already trumped that, so a smaller trump is out.';
  }
  if (hand.some((x) => suitOf(x) === led)) {
    return `You still hold ${SUIT_NAME[SUITS[led]].toLowerCase()}, so you have to follow.`;
  }
  return 'Not that one.';
}

function act(action) {
  if (!game) return;
  const base = game;
  const next = apply(base, action);
  if (next === base) return;                     // the rules refused it
  commit(next);
}

function nextHand() {
  if (!game || game.phase !== 'hand') return;
  // Both phones may press this. Whichever write lands last is the hand
  // everybody plays; the worst case is one extra shuffle, never a mess.
  commit(dealHand(game));
}

// ═══════════════════════════════════════════════════════════════════════
//  Playing on by itself
// ═══════════════════════════════════════════════════════════════════════

// ── The steps nobody has to choose ──────────────────────────────────
//
// Sweeping up a finished trick, and the computer's turns. Exactly one
// device takes each step, picked by iAct, or two phones write the same move
// and one lands on top of a turn that has already moved past it.
//
// This used to be a loop held open by a `busy` flag for as long as the
// computer had things to do, sleeping between moves. `busy` also blocked
// every tap. That is fine until the timers stop arriving on time, and a
// phone whose screen has gone off gets its timers clamped to once a minute:
// pick it up mid-hand and the cards are dead until the sleep it was sitting
// in finally comes back.
//
// So there is no such flag. One step is scheduled at a time, stamped with
// the board it belongs to. However late it turns up, it either applies to
// that same board or finds the board has moved and looks again, and taps
// are gated on whose turn it is rather than on anything being held open.
function schedule() {
  if (pending || !game || game.winner || !api) return;

  const seat = game.turn;
  const delay = game.phase === 'gather' && iAct(seat) ? TRICK_HOLD
    : (game.phase === 'bid' || game.phase === 'play') && isBot(seat) && iDrive() ? BOT_PAUSE
      : null;
  if (delay === null) return;                    // it is somebody's move to make

  pendingFor = game.rev;
  pending = setTimeout(step, delay);
  render();
}

function step() {
  pending = null;
  if (!game || !api || game.winner) { render(); return; }

  // The board moved on while this step was waiting, so it belongs to a
  // position that no longer exists. Drop it and look at what is there now.
  if (game.rev !== pendingFor) { render(); schedule(); return; }

  const next = game.phase === 'gather'
    ? gather(game)
    : apply(game, actFor(game, game.turn, house().skill));

  if (next && next !== game) { commit(next); return; }

  // The step ran against the board it was meant for and the board did not
  // move, so running it again would do the same nothing. Deliberately not
  // rescheduled: that would be a spin. The next board to arrive will look
  // again on its own, and this is worth saying out loud, because it means
  // the computer was handed a position it could not answer.
  console.warn('jass: the computer had no move in', game.phase, 'for', game.turn);
  render();
}

function unschedule() {
  if (pending) clearTimeout(pending);
  pending = null;
  pendingFor = null;
}

// Draw the new board at once, then hand it to the hub to put on the wire.
//
// The write is fired and not waited on. Firestore has already taken it into
// its own cache and echoes it straight back, and waiting for the server to
// acknowledge it would put the whole turn machine behind a round trip on
// whatever signal the phone happens to have.
function commit(next) {
  game = next;
  render();
  Promise.resolve(api.commit(next)).catch(() => {});
  schedule();
}

// ═══════════════════════════════════════════════════════════════════════
//  The menu
// ═══════════════════════════════════════════════════════════════════════

function openMenu() {
  sheet((inner, close) => {
    api.hubRows(inner, close);

    add(inner, 'How it plays', '', () => { close(); openRules(); });
    add(inner, 'This hand', '', () => { close(); openLog(); });

    const h = house();
    add(inner, 'Players', PEOPLE_LABEL[people(h)], () => { close(); openPlayers(); });
    add(inner, 'Computer skill', SKILL_LABEL[h.skill], () => { close(); openSkill(); });
    add(inner, 'Game to', `${h.target} points`, () => { close(); openTarget(); });

    add(inner, 'New game', '', async () => {
      close();
      if (game && !game.winner && !confirm('Abandon the game in progress?')) return;
      await api.deal();
    });
  });
}

// Each of these was a row that silently flipped to the other setting when
// you pressed it, so there was no way to see what the choices were, or what
// you were about to change to, before it had already changed. They are
// lists now, with the one you are on marked.

const blurb = (inner, text) => {
  const d = document.createElement('div');
  d.className = 'row note';
  d.textContent = text;
  inner.appendChild(d);
};

// Four at the table whatever happens: Jass is a four hand game. What
// changes is whether the seat opposite the computer partner is a person.
const PEOPLE_LABEL = {
  2: 'Two of you, a computer each',
  1: 'You and three computers',
};

const people = (h = house()) => (Number(h.people) === 1 ? 1 : 2);

function openPlayers() {
  sheet((inner, close) => {
    const now = people();
    blurb(inner, 'Four at the table either way, in two partnerships. Your partner '
      + 'sits opposite you and is always the computer.');
    for (const n of [2, 1]) {
      add(inner, PEOPLE_LABEL[n], now === n ? 'Playing' : '', async () => {
        close();
        if (n === now) return;
        if (game && !game.winner && !confirm('Start a new game with these players?')) return;
        await api.setSettings({ people: n });
        await api.deal();
      });
    }
  });
}

function openSkill() {
  sheet((inner, close) => {
    const now = house().skill;
    blurb(inner, 'Hard counts what has been played and feeds points to its partner. '
      + 'Easy plays anything it is allowed to. This takes effect on the next card.');
    for (const s of SKILLS) {
      add(inner, SKILL_LABEL[s], now === s ? 'On' : '', async () => {
        close();
        if (s === now) return;
        await api.setSettings({ skill: s });
      });
    }
  });
}

const TARGET_NOTE = { 1000: 'about four hands', 1500: 'about six', 3000: 'the full game, about twelve' };

function openTarget() {
  sheet((inner, close) => {
    const now = Number(house().target);
    blurb(inner, 'How many points wins it. Fall short of half that and you are Schneider.');
    for (const t of TARGETS) {
      add(inner, `${t} points`, now === t ? 'Playing' : TARGET_NOTE[t], async () => {
        close();
        if (t === now) return;
        if (game && !game.winner && !confirm(`Start a new game, playing to ${t}?`)) return;
        await api.setSettings({ target: t });
        await api.deal();
      });
    }
  });
}

// What has happened this hand, which is the thing you want back when you
// looked away and the trick had already gone.
function openLog() {
  sheet((inner) => {
    const box = document.createElement('div');
    box.className = 'jlog';
    for (const l of [...(game.log || [])].reverse()) {
      const d = document.createElement('div');
      d.className = `jlogline ${l.c || ''}`;
      d.textContent = l.t;
      box.appendChild(d);
    }
    if (!game.log?.length) box.textContent = 'Nothing yet.';
    inner.appendChild(box);
  });
}

function openRules() {
  sheet((inner) => {
    inner.insertAdjacentHTML('beforeend', `
      <div class="rules"><ol>
        <li>Thirty-six cards, nine each, four players. You and the seat
            opposite are partners, and play runs <b>to your right</b>.</li>
        <li>Forehand names the contract or <b>shoves</b> it across to their
            partner, who then has to name something. One of the four suits
            for trumps, <b>Obenabe</b> with no trump and the Ass high, or
            <b>Undenufe</b> with no trump and the six high.</li>
        <li>Everything the hand scores is multiplied: acorns and roses
            <b>×1</b>, shields and bells <b>×2</b>, obenabe <b>×3</b>,
            undenufe <b>×4</b>. It multiplies what the other side takes too.</li>
        <li>In the trump suit the <b>Under is 20</b> and the <b>nine is 14</b>,
            and the Under beats everything. Elsewhere it is Ass 11, König 4,
            Ober 3, Under 2, Banner 10. With no trump at all the
            <b>eights are worth 8</b>, so the pack always comes to 157.</li>
        <li>Holding the suit that was led you may <b>follow it or trump it</b>,
            as you like. Void, you may play anything.</li>
        <li>Once somebody has trumped, a <b>smaller trump is not allowed</b>
            unless trumps are all you have left.</li>
        <li>If trumps are led you must follow with one. The one exception is
            the <b>Under of trumps</b>, which is never dragged out of a hand
            that holds no other trump.</li>
        <li><b>Weis</b> is announced into the first trick: three in a row is
            20, four is 50, five 100, and up to 300 for all nine. Four Unders
            are 200, four nines 150, four of anything else down to the Banner
            100. The <b>best single set at the table</b> decides which side
            scores, and that side then takes all of theirs while the other
            takes nothing.</li>
        <li><b>Stöck</b> is the König and Ober of trumps in one hand, 20
            points, and no Weis can take it off you.</li>
        <li>Five for the last trick, and <b>100 for taking all nine</b>.
            First partnership to the target wins, and if the other side is
            not halfway there it is Schneider.</li>
      </ol></div>`);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  The hub's handle on this game
// ═══════════════════════════════════════════════════════════════════════

// A fresh match. The hub calls this; it never builds a game state itself,
// because only the game knows what one is.
function deal(prev) {
  const h = { ...DEFAULTS, ...(api?.settings() || {}) };
  const bots = ['green', 'yellow'];
  // On your own, the other person's chair is played for as well. Which
  // chair that is depends on which one you are sitting in.
  if (people(h) === 1) bots.push(myColor === 'blue' ? 'red' : 'blue');
  return newGame({ target: Number(h.target) || 3000, bots });
}

const STAGE = `
  <div class="jass">
    <div class="jslate" id="j-slate"></div>
    <div class="jboard">
      <div class="jseat top" id="j-top"></div>
      <div class="jmid">
        <div class="jseat left" id="j-left"></div>
        <div class="jtable">
          <div class="jcontract hidden" id="j-contract"></div>
          <div class="jtally hidden" id="j-tally"></div>
          <div class="jtrick" id="j-trick"></div>
        </div>
        <div class="jseat right" id="j-right"></div>
      </div>
    </div>
  </div>`;

const PANEL = `
  <div class="jstatus" id="j-status">Connecting</div>
  <div class="jbid hidden" id="j-bid"></div>
  <div class="jresult hidden" id="j-result"></div>
  <div class="jtrump hidden" id="j-trump"></div>
  <div class="jhand" id="j-hand"></div>
  <div class="jlast" id="j-last"></div>`;

function mount(handle) {
  api = handle;
  LOCAL = handle.local;
  uid = handle.uid;
  refused = null;
  shown = 'red';
  unschedule();

  $('game-stage').innerHTML = STAGE;
  $('game-panel').innerHTML = PANEL;
  $('btn-menu').addEventListener('click', openMenu);

  return {
    // Called with every board that arrives, this game's own writes and the
    // other phone's alike.
    update(state, ctx) {
      table = ctx.table;
      myColor = ctx.me;
      game = state;
      // A board this device has not seen before, so whatever step was
      // waiting on the old one is stale. schedule() will look again.
      if (pending && state.rev !== pendingFor) unschedule();
      render();
      schedule();
    },
    // Whose move it is, in words the lobby can show without knowing the
    // first thing about Jass. A computer's turn is nobody's move.
    waitingOn(state) {
      if (!state || state.winner) return null;
      if (state.phase === 'hand') return null;
      return SIDES.includes(state.turn) ? state.turn : null;
    },
    destroy() {
      unschedule();
      api = null;
      game = null;
    },
  };
}

export default {
  id: 'jass',
  title: 'Schieber Jass',
  blurb: 'Thirty-six Swiss cards, a trump you name yourself, and the Under on top.',
  colours: ['red', 'blue'],
  boardRev: BOARD_REV,
  deal,
  mount,
};
