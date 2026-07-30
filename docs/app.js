// ═══════════════════════════════════════════════════════════════════════
//  PARCHÍS — the screen and the wire.
//
//  The rules live in rules.js and know nothing about any of this. Here we
//  draw the board, take taps, and keep one document in Firestore in step
//  between two phones. Only the player whose turn it is ever writes.
//
//  Add ?local=1 to the address to play both sides on one device, with no
//  network at all. That is how the board gets tested.
// ═══════════════════════════════════════════════════════════════════════

import {
  NEST, HOME, COL_BASE, SIDES, ENTRY, SAFE, NAMES, other,
  newGame, rollDice, applyRoll, applyAction, legalActions,
  onRing, inCol, progress, BOARD_REV,
} from './rules.js';

import { RING, COLUMN, NEST_BOX, nestSlots, homeSlot, GRID } from './board.js';

const LOCAL = new URLSearchParams(location.search).has('local');

// ═══════════════════════════════════════════════════════════════════════
//  What the screen is currently showing
// ═══════════════════════════════════════════════════════════════════════

let uid = null;
let table = null;      // seats and the lifetime score
let game = null;       // the live board
let myColor = null;
let sel = null;        // the pawn the player has tapped
let lastRoll = 0;      // so the dice only tumble on a fresh roll
let thinking = false;  // the computer is mid-turn; keep hands off the board

// Playing the computer is a local-only affair: it takes blue, you take red.
// Kept in this device's own storage, so it never travels to the other phone.
const BOT_LEVELS = ['off', 'easy', 'hard'];
const BOT_LABEL = { off: 'Off', easy: 'Easy', hard: 'Hard' };
let bot = BOT_LEVELS.includes(localStorage.getItem('parchis-bot'))
  ? localStorage.getItem('parchis-bot')
  : 'off';

const botPlays = (color) => LOCAL && bot !== 'off' && color === 'blue';

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════
//  Drawing the board
// ═══════════════════════════════════════════════════════════════════════

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

const TINT = { red: '#E4443A', blue: '#3D8BFD', green: '#2E3A47', yellow: '#2E3A47' };
const PLAYED = new Set(SIDES);          // red and blue; the other two arms are scenery

let gRoot, gMarks, gPawns;
const pawnNodes = {};

// The whole board is one square rounded-off drawing. It is built once and
// then only the pawns move.
function buildBoard() {
  const board = $('board');
  board.innerHTML = '';

  gRoot = svg('g', {}, board);

  const cells = svg('g', {}, gRoot);

  // ── The four starting corners ────────────────────────────────────
  for (const color of Object.keys(NEST_BOX)) {
    const b = NEST_BOX[color];
    const live = PLAYED.has(color);
    svg('rect', {
      x: b.x + 0.35, y: b.y + 0.35, width: 7.3, height: 7.3, rx: 1.1,
      fill: live ? TINT[color] : '#141A22',
      'fill-opacity': live ? 0.16 : 1,
      stroke: live ? TINT[color] : '#1D2530',
      'stroke-opacity': live ? 0.55 : 1,
      'stroke-width': 0.09,
    }, cells);

    if (!live) continue;
    for (const s of nestSlots(color)) {
      svg('circle', {
        cx: s.x + 0.5, cy: s.y + 0.5, r: 0.44,
        fill: '#0D1219', stroke: TINT[color], 'stroke-opacity': 0.4,
        'stroke-width': 0.07,
      }, cells);
    }
  }

  // ── The ring ─────────────────────────────────────────────────────
  const entryOwner = {};
  for (const [color, idx] of Object.entries(ENTRY)) entryOwner[idx] = color;

  RING.forEach((c, i) => {
    const owner = entryOwner[i];
    const live = owner && PLAYED.has(owner);
    const safe = SAFE.has(i);

    svg('rect', {
      x: c.x + 0.06, y: c.y + 0.06, width: 0.88, height: 0.88, rx: 0.2,
      fill: live ? TINT[owner] : '#1B222C',
      'fill-opacity': live ? 0.5 : 1,
      stroke: safe ? '#E8C05A' : '#232B36',
      'stroke-opacity': safe ? 0.9 : 1,
      'stroke-width': safe ? 0.09 : 0.05,
    }, cells);

    // Safe squares carry a ring you can pick out at arm's length, the way
    // they are marked on a printed board. A hairline outline was not enough.
    if (safe) {
      svg('circle', {
        cx: c.x + 0.5, cy: c.y + 0.5, r: 0.3,
        fill: 'none', stroke: '#E8C05A',
        'stroke-opacity': live ? 0.95 : 0.72,
        'stroke-width': 0.11,
      }, cells);
    }
  });

  // ── The four home columns ────────────────────────────────────────
  for (const color of Object.keys(COLUMN)) {
    const live = PLAYED.has(color);
    COLUMN[color].forEach((c, i) => {
      svg('rect', {
        x: c.x + 0.06, y: c.y + 0.06, width: 0.88, height: 0.88, rx: 0.2,
        fill: live ? TINT[color] : '#182029',
        // The ramp brightens as it approaches the middle.
        'fill-opacity': live ? 0.3 + (i / (COLUMN[color].length - 1)) * 0.45 : 1,
        stroke: '#232B36', 'stroke-width': 0.05,
      }, cells);
    });
  }

  // ── The centre ───────────────────────────────────────────────────
  svg('rect', {
    x: 8.1, y: 8.1, width: 2.8, height: 2.8, rx: 0.5,
    fill: '#0D1219', stroke: '#2A3441', 'stroke-width': 0.08,
  }, cells);
  // Blue comes down from the top, red comes up from the bottom.
  svg('path', { d: 'M8.35 8.35 H10.65 L9.5 9.5 Z', fill: TINT.blue, 'fill-opacity': 0.75 }, cells);
  svg('path', { d: 'M8.35 10.65 H10.65 L9.5 9.5 Z', fill: TINT.red, 'fill-opacity': 0.75 }, cells);

  gMarks = svg('g', {}, gRoot);
  gPawns = svg('g', {}, gRoot);

  // One circle per pawn, created once so CSS can animate it between squares.
  for (const color of SIDES) {
    for (let i = 0; i < 4; i++) {
      const g = svg('g', { class: 'pawn', 'data-color': color, 'data-i': i }, gPawns);
      // An invisible disc wider than the pawn itself, so a thumb aimed
      // roughly at a piece still lands on it. It never changes size.
      svg('circle', { class: 'hit', r: 0.78, fill: 'transparent' }, g);
      svg('circle', { r: 0.34, fill: 'rgba(0,0,0,.45)', cy: 0.07 }, g);
      svg('circle', {
        r: 0.34, fill: TINT[color],
        stroke: color === 'red' ? '#8E241D' : '#1B4C96', 'stroke-width': 0.09,
      }, g);
      svg('circle', { r: 0.13, cx: -0.1, cy: -0.11, fill: '#fff', 'fill-opacity': 0.32 }, g);
      pawnNodes[`${color}${i}`] = g;
      g.addEventListener('click', (e) => { e.stopPropagation(); tapPawn(color, i); });
    }
  }

  board.addEventListener('click', () => { sel = null; render(); });
}

// ── Where each pawn should be sitting right now ─────────────────────

function cellOf(color, pos) {
  if (onRing(pos)) return RING[pos];
  if (inCol(pos)) return COLUMN[color][pos - COL_BASE];
  return { x: 9, y: 9 };
}

function layout(state) {
  const groups = new Map();
  const out = {};

  for (const color of SIDES) {
    state.pawns[color].forEach((pos, i) => {
      const id = `${color}${i}`;
      if (pos === NEST) {
        const s = nestSlots(color)[i];
        out[id] = { x: s.x + 0.5, y: s.y + 0.5, r: 0.34 };
        return;
      }
      const key = pos === HOME ? `home-${color}` : `sq${pos}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id, color, pos });
    });
  }

  // Pawns sharing a square shuffle apart so both stay countable.
  for (const list of groups.values()) {
    list.forEach((p, n) => {
      if (p.pos === HOME) {
        const s = homeSlot(p.color, n);
        out[p.id] = { x: s.x + 0.5, y: s.y + 0.5, r: 0.22 };
        return;
      }
      // Pawns sharing a square lean apart rather than shrink. A wall is
      // exactly when you most need to see what is standing there.
      const cell = cellOf(p.color, p.pos);
      const many = list.length > 1;
      const off = many ? -0.19 + (n * 0.38) / (list.length - 1) : 0;
      out[p.id] = {
        x: cell.x + 0.5 + off,
        y: cell.y + 0.5 + off,
        r: list.length > 2 ? 0.27 : many ? 0.3 : 0.36,
      };
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
//  Turning the state into a picture
// ═══════════════════════════════════════════════════════════════════════

// Every action open to the player, and which pawns they belong to.
function openActions() {
  if (!game || !myColor) return [];
  if (game.phase !== 'move' || game.winner) return [];
  if (!LOCAL && game.turn !== myColor) return [];
  return legalActions(game);
}

// The actions available to one particular pawn. Any pawn still in the
// corner can take an exit, so those get remapped onto whichever was tapped.
function actionsFor(pawn) {
  const color = seatColor();
  return openActions()
    .filter((a) => (a.type === 'exit' ? game.pawns[color][pawn] === NEST : a.pawn === pawn))
    .map((a) => (a.type === 'exit' ? { ...a, pawn } : a));
}

// In local mode whoever is to move is "you".
const seatColor = () => (LOCAL ? game.turn : myColor);

// Which way up the board is drawn. On a phone of your own it turns so your
// colour is nearest you. Sharing one screen it must not turn at all: a board
// that spins through 180° every turn is impossible to keep track of.
const viewColor = () => (LOCAL ? 'red' : myColor);

// Two actions that start on the same square, spend the same dice and finish
// on the same square are the same move wearing different pawns. Collapsing
// them keeps the list honest and stops a forced move looking like a choice.
function distinctActions(acts) {
  const seen = new Map();
  for (const a of acts) {
    const from = game.pawns[game.turn][a.pawn];
    const spent = a.use.map((i) => game.pending[i].v).sort((x, y) => x - y).join('+');
    const key = `${a.type}:${from}>${a.to}:${spent}`;
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

function render() {
  // The board arrives over the wire before a seat has been picked, and
  // there is nothing to draw until we know which side we are.
  if (!game || (!LOCAL && !myColor)) return;
  const color = seatColor();
  const mine = LOCAL || game.turn === myColor;
  const acts = openActions();

  // ── Which pawns can do anything ──────────────────────────────────
  const movable = new Set();
  for (const a of acts) {
    if (a.type === 'exit') {
      game.pawns[color].forEach((p, i) => { if (p === NEST) movable.add(i); });
    } else movable.add(a.pawn);
  }

  // If there is only one pawn worth tapping, tap it for them.
  const distinct = new Set(acts.map((a) => (a.type === 'exit' ? 'exit' : a.pawn)));
  if (sel === null && distinct.size === 1 && acts.length) {
    sel = acts[0].type === 'exit'
      ? game.pawns[color].findIndex((p) => p === NEST)
      : acts[0].pawn;
  }
  if (sel !== null && !movable.has(sel)) sel = null;

  // ── Pawns ────────────────────────────────────────────────────────
  gRoot.setAttribute('transform', viewColor() === 'blue' ? 'rotate(180 9.5 9.5)' : '');

  const spots = layout(game);
  for (const [id, node] of Object.entries(pawnNodes)) {
    const s = spots[id];
    node.setAttribute('transform', `translate(${s.x.toFixed(3)} ${s.y.toFixed(3)})`);
    for (const c of node.querySelectorAll('circle')) {
      if (c.classList.contains('hit')) continue;      // the tap disc stays put
      if (!c.hasAttribute('data-base')) c.setAttribute('data-base', c.getAttribute('r'));
      const base = Number(c.getAttribute('data-base'));
      c.setAttribute('r', (base * (s.r / 0.34)).toFixed(3));
    }
    const isMine = id.startsWith(color);
    const i = Number(id.slice(-1));
    node.classList.toggle('mine', isMine);
    node.classList.toggle('live', isMine && movable.has(i));
    node.classList.toggle('pick', isMine && sel === i);
  }

  // ── Where the selected pawn could go ─────────────────────────────
  gMarks.innerHTML = '';
  if (sel !== null) {
    const seen = new Set();
    for (const a of actionsFor(sel)) {
      const cell = a.to === HOME ? { x: 9, y: 9 } : cellOf(color, a.to);
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const steps = a.use.reduce((n, i) => n + game.pending[i].v, 0);
      const cx = cell.x + 0.5;
      const cy = cell.y + 0.5;

      const g = svg('g', { class: `marker${a.capture ? ' eat' : ''}` }, gMarks);
      svg('circle', { cx, cy, r: 0.42 }, g);
      const t = svg('text', { x: cx, y: cy }, g);
      t.textContent = steps;
      if (viewColor() === 'blue') t.setAttribute('transform', `rotate(180 ${cx} ${cy})`);

      g.addEventListener('click', (e) => { e.stopPropagation(); play(a); });
    }
  }

  renderHeader();
  renderMoves(mine);
  renderPanel(mine);
}

// What a move is called, in words rather than co-ordinates.
function moveLabel(a) {
  const steps = a.use.reduce((n, i) => n + game.pending[i].v, 0);
  let what;
  if (a.type === 'exit') what = 'Bring a pawn out';
  else if (a.to === HOME) what = `Pawn ${a.pawn + 1} all the way in`;
  else if (inCol(a.to)) what = `Pawn ${a.pawn + 1} up your own column`;
  else what = `Pawn ${a.pawn + 1} forward ${steps}`;
  if (a.capture) what += `, sending ${NAMES[a.capture.color]} home`;
  return what;
}

// Every real choice, as a button the width of the screen. A forced move is
// never listed — by the time this runs, autoPlay has already made it.
function renderMoves(mine) {
  const box = $('moves');
  box.innerHTML = '';
  if (thinking || !mine || game.winner || game.phase !== 'move') return;

  const acts = distinctActions(legalActions(game));
  if (acts.length < 2) return;

  for (const a of acts) {
    const b = document.createElement('button');
    b.className = `move${a.capture ? ' eat' : ''}${a.home ? ' in' : ''}`;
    b.innerHTML = '<span class="what"></span><span class="tag"></span>';
    b.children[0].textContent = moveLabel(a);
    b.children[1].textContent = a.capture ? '+20' : a.home ? '+10' : '';
    b.addEventListener('click', () => play(a));
    box.appendChild(b);
  }
}

function renderHeader() {
  const color = seatColor();
  const seats = table?.seats || {};
  const foe = other(color);

  $('chip-mine').className = `chip ${color}`;
  $('chip-theirs').className = `chip ${foe}`;
  $('name-mine').textContent = LOCAL ? NAMES[color] : (seats[color]?.name || NAMES[color]);
  $('name-theirs').textContent = seats[foe]?.name || 'Open';

  $('seat-mine').classList.toggle('active', game.turn === color && !game.winner);
  $('seat-theirs').classList.toggle('active', game.turn === foe && !game.winner);

  const sc = table?.score || { red: 0, blue: 0 };
  $('score').textContent = `${sc[color] || 0} – ${sc[foe] || 0}`;
}

function renderPanel(mine) {
  const color = seatColor();
  const seats = table?.seats || {};
  const status = $('status');
  const rollBtn = $('btn-roll');

  // ── Dice and bonuses ─────────────────────────────────────────────
  const bar = $('dicebar');
  bar.innerHTML = '';
  if (game.dice) {
    const left = game.pending.filter((p) => p.kind === 'die').map((p) => p.v);
    const fresh = game.rolledAt !== lastRoll;
    game.dice.forEach((v) => {
      const at = left.indexOf(v);
      if (at >= 0) left.splice(at, 1);
      bar.appendChild(dieFace(v, at < 0, fresh));
    });
    lastRoll = game.rolledAt;
  }
  for (const p of game.pending) {
    if (p.kind === 'die') continue;
    const chip = document.createElement('div');
    chip.className = 'bonus';
    chip.textContent = `+${p.v}`;
    bar.appendChild(chip);
  }

  // ── What to say ──────────────────────────────────────────────────
  const foeName = seats[other(color)]?.name || NAMES[other(color)];
  status.className = 'status';

  if (game.winner) {
    status.classList.add('over');
    status.textContent = LOCAL
      ? `${NAMES[game.winner]} wins`
      : game.winner === color ? 'You win' : `${foeName} wins`;
    rollBtn.textContent = 'New game';
    rollBtn.disabled = false;
  } else if (thinking) {
    status.textContent = `${NAMES[other('red')]} is thinking`;
    rollBtn.textContent = 'Roll';
    rollBtn.disabled = true;
  } else if (!LOCAL && !seats[other(color)]) {
    status.textContent = 'Waiting for the other side to be taken';
    rollBtn.textContent = 'Roll';
    rollBtn.disabled = true;
  } else if (!mine) {
    status.textContent = `${foeName} is playing`;
    rollBtn.textContent = 'Roll';
    rollBtn.disabled = true;
  } else if (game.phase === 'roll') {
    status.classList.add('you');
    status.textContent = LOCAL && bot === 'off' ? `${NAMES[color]} to roll` : 'Your turn';
    rollBtn.textContent = 'Roll';
    rollBtn.disabled = false;
  } else {
    status.classList.add('you');
    status.textContent = 'Choose your move';
    rollBtn.textContent = 'Roll';
    rollBtn.disabled = true;
  }

  const last = game.log?.[game.log.length - 1];
  $('lastline').textContent = last ? last.t : '';
}

const PIPS = {
  1: [[.5, .5]],
  2: [[.28, .28], [.72, .72]],
  3: [[.26, .26], [.5, .5], [.74, .74]],
  4: [[.29, .29], [.71, .29], [.29, .71], [.71, .71]],
  5: [[.28, .28], [.72, .28], [.5, .5], [.28, .72], [.72, .72]],
  6: [[.29, .25], [.71, .25], [.29, .5], [.71, .5], [.29, .75], [.71, .75]],
};

function dieFace(v, spent, fresh) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 1 1');
  s.setAttribute('class', `die${spent ? ' spent' : ''}${fresh && !spent ? ' rolling' : ''}`);
  for (const [x, y] of PIPS[v] || []) {
    svg('circle', { cx: x, cy: y, r: 0.085, fill: '#22262E' }, s);
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
//  Taps
// ═══════════════════════════════════════════════════════════════════════

function tapPawn(color, i) {
  if (color !== seatColor()) return;
  const acts = actionsFor(i);
  if (!acts.length) { sel = null; render(); return; }
  sel = sel === i ? null : i;
  render();
}

async function play(action) {
  sel = null;
  await commit(applyAction(game, action));
  await settleTurn();
}

async function doRoll() {
  if (game.winner) return startGame();
  if (thinking) return;
  sel = null;
  await commit(applyRoll(game, rollDice()));
  await settleTurn();
}

// After anything happens: play out whatever was never a decision, then hand
// over to the computer if it is sitting opposite.
async function settleTurn() {
  await autoPlay();
  await botTurn();
}

// A move with only one answer is not a question. When the dice leave exactly
// one thing to do, do it — rather than disabling the dice and waiting for the
// player to find the one square that lets the game continue.
async function autoPlay() {
  let guard = 0;
  while (guard++ < 60) {
    if (!game || game.winner || game.phase !== 'move') return;
    if (!LOCAL && game.turn !== myColor) return;
    const acts = distinctActions(legalActions(game));
    if (acts.length !== 1) return;
    sel = null;
    await commit(applyAction(game, acts[0]));
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// The computer's turn, played out slowly enough to watch.
async function botTurn() {
  if (thinking || !game || game.winner || !botPlays(game.turn)) return;
  thinking = true;
  render();
  try {
    let guard = 0;
    while (!game.winner && botPlays(game.turn) && guard++ < 300) {
      await sleep(560);
      if (game.phase === 'roll') { await commit(applyRoll(game, rollDice())); continue; }
      const acts = distinctActions(legalActions(game));
      if (!acts.length) break;
      const pick = bot === 'hard'
        ? bestAction(acts)
        : acts[Math.floor(Math.random() * acts.length)];
      await commit(applyAction(game, pick));
    }
  } finally {
    thinking = false;
    render();
  }
}

// A rough sense of a good move. Nothing clever: take the capture, get a pawn
// in, get out of the corner, prefer a safe square to a bare one, and failing
// all that push the pawn that is furthest along.
function bestAction(acts) {
  const color = game.turn;
  let best = acts[0];
  let bestScore = -Infinity;
  for (const a of acts) {
    const from = game.pawns[color][a.pawn];
    let s = progress(color, a.to) * 0.35;
    if (a.capture) s += 70;
    if (a.home) s += 90;
    if (a.type === 'exit') s += 35;
    if (inCol(a.to)) s += 25;
    if (onRing(a.to) && SAFE.has(a.to)) s += 14;
    if (onRing(from) && SAFE.has(from) && onRing(a.to) && !SAFE.has(a.to)) s -= 10;
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

// Push a new state everywhere. Firestore's local cache echoes the write
// back immediately, so the board moves before the network answers.
async function commit(next) {
  game = next;
  render();
  if (LOCAL) return;
  try {
    await save(next);
  } catch (err) {
    fatal(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  The menu
// ═══════════════════════════════════════════════════════════════════════

function sheet(build) {
  const root = $('sheet-root');
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'sheet';
  const inner = document.createElement('div');
  inner.className = 'inner';
  inner.innerHTML = '<div class="grab"></div>';
  wrap.appendChild(inner);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) root.innerHTML = ''; });
  build(inner, () => { root.innerHTML = ''; });
  root.appendChild(wrap);
}

function openMenu() {
  sheet((inner, close) => {
    const sc = table?.score || { red: 0, blue: 0 };
    inner.insertAdjacentHTML('beforeend', `
      <div class="row"><span>Games won</span>
        <span class="val">Red ${sc.red || 0} · Blue ${sc.blue || 0}</span></div>`);

    add(inner, 'How it plays', '', () => { close(); openRules(); });

    // Playing the computer means playing on this device alone, so away from
    // the shared board rather than on top of it.
    if (LOCAL) {
      add(inner, 'Play the computer', BOT_LABEL[bot], () => {
        bot = BOT_LEVELS[(BOT_LEVELS.indexOf(bot) + 1) % BOT_LEVELS.length];
        localStorage.setItem('parchis-bot', bot);
        close();
        render();
        botTurn();
      });
      add(inner, 'Back to the real game', '', () => { location.href = location.pathname; });
    } else {
      add(inner, 'Play the computer', '', () => {
        if (bot === 'off') { bot = 'hard'; localStorage.setItem('parchis-bot', 'hard'); }
        location.href = `${location.pathname}?local=1`;
      });
    }

    add(inner, 'New game', '', async () => {
      close();
      if (game && !game.winner && !confirm('Abandon the game in progress?')) return;
      await startGame();
    });

    if (!LOCAL) {
      add(inner, 'Change my name', table?.seats?.[myColor]?.name || '', async () => {
        const name = prompt('Your name', table?.seats?.[myColor]?.name || '');
        if (name && name.trim()) { await claimSeat(myColor, name.trim()); close(); }
      });
      add(inner, 'Give up this seat', '', async () => {
        if (!confirm('Free up your side so it can be taken again?')) return;
        await releaseSeat();
        close();
        location.reload();
      }, true);
    }
  });
}

function add(parent, label, val, fn, danger) {
  const b = document.createElement('button');
  b.className = `row${danger ? ' danger' : ''}`;
  b.innerHTML = `<span></span><span class="val"></span>`;
  b.children[0].textContent = label;
  b.children[1].textContent = val;
  b.addEventListener('click', fn);
  parent.appendChild(b);
  return b;
}

function openRules() {
  sheet((inner) => {
    inner.insertAdjacentHTML('beforeend', `
      <div class="rules"><ol>
        <li>Four pawns each. Roll <b>two dice</b> and play each one as its own
            move, on any of your pawns, in whichever order you like. Both dice
            may go to the same pawn.</li>
        <li>A pawn leaves its corner on a <b>5</b> — either a die showing 5, or
            two dice adding up to 5, so <b>1+4</b> and <b>2+3</b> open the door
            just the same. Nothing else does. With all four still in, you get
            three rolls to find one, then the turn passes.</li>
        <li>You come out onto the square against your own corner, and from
            there you have <b>63 squares</b> to cross before your ramp.</li>
        <li><b>Ringed squares are safe.</b> Nobody is captured there, and you and
            your opponent can stand on one together. Landing on a lone enemy
            anywhere else sends it home and pays you a <b>bonus 20</b>.</li>
        <li>Coming out of your corner is the one exception: it clears an enemy
            off your own entry square.</li>
        <li>Two pawns on one square make a <b>wall</b>. Nothing passes it or lands
            on it, including your own pawns. A <b>6</b> has to break your wall
            if it legally can.</li>
        <li>Getting a pawn into the middle pays a <b>bonus 10</b>. Bonuses are
            extra moves and have to be played if anything can move.</li>
        <li>Doubles buy another roll. <b>Three in a row</b> and your leading pawn
            walks back to its corner.</li>
        <li>The last stretch is your own column, where nothing can touch you.
            You need the <b>exact count</b> to reach the middle.</li>
        <li>First to bring all four pawns in wins.</li>
      </ol></div>`);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Firestore
// ═══════════════════════════════════════════════════════════════════════

let db, TABLE, GAME, save, claimSeat, releaseSeat, recordWin;
let gameLoaded = false;

// The loser opens the next one. The very first game goes to red.
async function startGame() {
  const first = game?.winner ? other(game.winner) : 'red';
  const fresh = newGame(first);
  fresh.id = `${Date.now()}`;
  sel = null;
  if (LOCAL) { game = fresh; render(); await botTurn(); return; }
  await save(fresh);
}

async function connect() {
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  // The same project the foos league already runs in. Parchís just adds
  // its own two documents alongside it.
  const app = initializeApp({
    apiKey: 'AIzaSyC2bOtXmNLzwJy3QsDkk1tQRBD_wMdhzcM',
    authDomain: 'foos-6ecf3.firebaseapp.com',
    projectId: 'foos-6ecf3',
    storageBucket: 'foos-6ecf3.firebasestorage.app',
    messagingSenderId: '730132593509',
    appId: '1:730132593509:web:6379dde4e6a92be09d7f8c',
  });

  const auth = authMod.getAuth(app);
  db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentSingleTabManager() }),
  });

  TABLE = fs.doc(db, 'parchis', 'table');
  GAME = fs.doc(db, 'parchis', 'game');

  save = (state) => fs.setDoc(GAME, state);

  claimSeat = (color, name) => fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(TABLE);
    const t = snap.exists() ? snap.data() : { seats: {}, score: { red: 0, blue: 0 } };
    const seats = { ...(t.seats || {}) };
    const held = seats[color];
    if (held?.uid && held.uid !== uid) throw new Error('That side is already taken.');
    // One person cannot hold both sides. Null rather than delete, because a
    // merged write leaves a removed key exactly where it was.
    const foe = other(color);
    if (seats[foe]?.uid === uid) seats[foe] = null;
    seats[color] = { uid, name };
    tx.set(TABLE, { ...t, seats }, { merge: true });
  });

  releaseSeat = () => fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(TABLE);
    if (!snap.exists()) return;
    const t = snap.data();
    if (t.seats?.[myColor]?.uid !== uid) return;
    tx.set(TABLE, { ...t, seats: { ...t.seats, [myColor]: null } });
  });

  recordWin = (id, winner) => fs.runTransaction(db, async (tx) => {
    const snap = await tx.get(TABLE);
    const t = snap.exists() ? snap.data() : {};
    if (t.lastScored === id) return;            // the other phone got here first
    const score = { red: 0, blue: 0, ...(t.score || {}) };
    score[winner] = (score[winner] || 0) + 1;
    tx.set(TABLE, { lastScored: id, score }, { merge: true });
  });

  await authMod.signInAnonymously(auth);
  uid = auth.currentUser.uid;

  fs.onSnapshot(TABLE, (snap) => {
    table = snap.exists() ? snap.data() : { seats: {}, score: { red: 0, blue: 0 } };
    settleSeat();
  }, fatal);

  fs.onSnapshot(GAME, (snap) => {
    gameLoaded = true;
    if (!snap.exists()) {
      if (myColor) startGame();
      return;
    }
    game = snap.data();
    sel = null;

    // The board changed shape under this game. Its pawn positions now point
    // at different squares, so there is nothing to salvage — deal again.
    if (game.board !== BOARD_REV) {
      booted();
      if (myColor) { startGame(); return; }
    }

    booted();
    render();
    // A forced move should not wait on a tap here either. Only the player
    // whose turn it is gets past the guard inside, so both phones stay put.
    autoPlay();
    if (game.winner && game.id) recordWin(game.id, game.winner).catch(() => {});
  }, fatal);
}

// Work out which side this device owns, and ask if it owns neither.
function settleSeat() {
  const seats = table?.seats || {};
  const found = SIDES.find((c) => seats[c]?.uid === uid);

  if (found) {
    myColor = found;
    $('seatpick').classList.add('hidden');
    // Claiming a seat on a fresh table is what opens the first game.
    if (!game && gameLoaded) { startGame(); return; }
    if (game) { booted(); render(); }
    return;
  }

  myColor = null;
  for (const c of SIDES) {
    const held = seats[c];
    $(`who-${c}`).textContent = held?.name ? held.name : 'Open';
    document.querySelector(`.seatbtn.${c}`).disabled = Boolean(held?.uid);
  }
  $('seatpick').classList.remove('hidden');
  booted();
}

// ═══════════════════════════════════════════════════════════════════════
//  Start up
// ═══════════════════════════════════════════════════════════════════════

function booted() {
  const b = $('boot');
  if (b.classList.contains('gone')) return;
  b.classList.add('gone');
  $('app').classList.remove('hidden');
  setTimeout(() => b.remove(), 400);
}

function fatal(err) {
  const denied = String(err?.code || err?.message || '').includes('permission-denied');
  const box = $('fatal');
  box.classList.remove('hidden');
  box.innerHTML = denied
    ? `<h2>Firestore is turning us away</h2>
       <p>The database rules do not allow the <b>parchis</b> documents yet.
       Paste the block below into the Firebase console under
       Firestore Database → Rules, publish it, then reopen this page.</p>
       <code>match /parchis/{doc} {
  allow read, write: if request.auth != null;
}</code>`
    : `<h2>Something went wrong</h2><code>${String(err?.message || err)}</code>`;
}

function wire() {
  $('btn-roll').addEventListener('click', doRoll);
  $('btn-menu').addEventListener('click', openMenu);

  for (const btn of document.querySelectorAll('.seatbtn')) {
    btn.addEventListener('click', async () => {
      const name = $('seat-name').value.trim();
      if (!name) { $('seat-err').textContent = 'Put your name in first.'; return; }
      try {
        await claimSeat(btn.dataset.color, name);
      } catch (err) {
        $('seat-err').textContent = err.message;
      }
    });
  }
}

async function main() {
  buildBoard();
  wire();

  if (LOCAL) {
    myColor = 'red';
    table = { seats: { red: { name: 'Red' }, blue: { name: 'Blue' } }, score: { red: 0, blue: 0 } };
    game = newGame('red');
    game.id = 'local';
    booted();
    render();
    return;
  }

  try {
    await connect();
  } catch (err) {
    fatal(err);
  }
}

main();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
