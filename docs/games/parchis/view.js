// ═══════════════════════════════════════════════════════════════════════
//  PARCHÍS — the screen.
//
//  The rules live in rules.js and know nothing about any of this. This file
//  draws the board and takes the taps, and knows nothing about Firestore
//  either. The hub mounts it, hands it a board to show and one way to hand
//  a new board back, and deals with the wire itself.
//
//  Everything the hub supplies arrives through `api` and is mirrored onto
//  the plain variables below, so the drawing code reads the way it always
//  did instead of reaching through an object on every line.
// ═══════════════════════════════════════════════════════════════════════

import {
  NEST, HOME, COL_BASE, SIDES, ORDER, TWO, FOUR, ENTRY, SAFE, NAMES, other,
  newGame, rollDice, applyRoll, applyAction, legalActions, compelled, pathOf,
  onRing, inCol, progress, BOARD_REV, sidesOf,
} from './rules.js';

import { RING, COLUMN, NEST_BOX, nestSlots, homeSlot, GRID } from './board.js';
import { sheet, addRow as add } from '../../ui.js';

// ═══════════════════════════════════════════════════════════════════════
//  What the screen is currently showing
// ═══════════════════════════════════════════════════════════════════════

let api = null;        // the hub's side of the conversation
let LOCAL = false;     // both sides on this device, with no network
let uid = null;
let table = null;      // seats and the record
let game = null;       // the live board
let myColor = null;
let sel = null;        // the pawn the player has tapped
let lastRoll = 0;      // so the dice only tumble on a fresh roll
let thinking = false;  // the computer is mid-turn; keep hands off the board
let walking = null;    // id of the pawn currently crossing the board

const BOT_LEVELS = ['easy', 'hard'];
const BOT_LABEL = { easy: 'Easy', hard: 'Hard' };

// The house rules for this game. The hub keeps them, so both phones agree.
// They used to sit in this device's localStorage, which meant two phones
// could hold different ideas of the table until somebody dealt again.
// A board already on the table speaks for itself: it knows how many are
// playing and how many of those are the computer. That is what the menu
// shows and what the next deal copies, until somebody says otherwise. It
// also carries the old localStorage settings across without a migration,
// because the game in progress was already dealt to them.
const DEFAULTS = { players: 2, bots: 0, skill: 'hard' };

const houseOf = (state) => ({
  ...DEFAULTS,
  ...(state ? { players: sidesOf(state).length, bots: (state.bots || []).length } : {}),
  ...(api?.settings() || {}),
});

const house = () => houseOf(game);

// How many are playing, and how many of those are the computer. A game can
// have four players but never four people: red and blue are the only seats a
// person can take, so the computer fills from the far end of the table back.
const BOT_PREFERENCE = ['yellow', 'green', 'blue'];

function rosterFor(total) { return total === 4 ? FOUR : TWO; }

function botsFor(total, count) {
  const roster = rosterFor(total);
  return BOT_PREFERENCE.filter((c) => roster.includes(c)).slice(0, count);
}

const isBot = (c) => (game?.bots || []).includes(c);

// May this device act for that colour? Never for the computer, and online
// never for anybody but yourself.
const iPlay = (c) => !isBot(c) && (LOCAL || c === myColor);

// Exactly one device drives the computer, or two phones write the same turn
// and fight over it. The seat earliest in turn order does it.
function iDriveBots() {
  if (LOCAL) return true;
  const seats = table?.seats || {};
  const held = ORDER.filter((c) => seats[c]?.uid);
  return held.length > 0 && seats[held[0]].uid === uid;
}

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

const TINT  = { red: '#E4443A', blue: '#3D8BFD', green: '#3FAE63', yellow: '#E3B23C' };
const EDGE  = { red: '#8E241D', blue: '#1B4C96', green: '#1F6B39', yellow: '#8A6614' };
const LIGHT = { red: '#FF8B7B', blue: '#8FBCFF', green: '#8BDFA6', yellow: '#F8DE8C' };
const DIM   = '#D8D5CC';                // an arm nobody is playing
const INK   = '#20272F';                // every line on the board is this

// Who is in this game. Two-handed until a roster says otherwise.
let PLAYED = new Set(TWO);
let builtFor = '';                      // the roster the board was drawn for

let gRoot, gMarks, gPawns;
let pawnNodes = {};

// The whole board is one square rounded-off drawing. It is redrawn only when
// the roster changes — going from two players to four lights up two more
// corners — and after that only the pawns move.
function buildBoard(roster = TWO) {
  PLAYED = new Set(roster);
  builtFor = [...roster].join(',');

  const board = $('board');
  board.innerHTML = '';
  pawnNodes = {};

  // Half a square of margin all round, for the rim the board now sits in.
  board.setAttribute('viewBox', '-0.6 -0.6 20.2 20.2');

  // ── Paint, mixed once ────────────────────────────────────────────
  // Every gradient the board uses, defined up front so each cell is still a
  // single element. The look comes from the paint, not from more geometry.
  const defs = svg('defs', {}, board);
  const stops = (g, list) => {
    for (const [offset, color, op] of list) {
      svg('stop', { offset, 'stop-color': color,
        ...(op !== undefined ? { 'stop-opacity': op } : {}) }, g);
    }
  };
  const lin = (id, list, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
    stops(svg('linearGradient', { id, x1, y1, x2, y2 }, defs), list);
  const rad = (id, list, attrs = {}) =>
    stops(svg('radialGradient', { id, ...attrs }, defs), list);

  lin('brd-frame', [['0', '#E7C371'], ['0.45', '#A87B33'], ['1', '#6E4D1B']]);
  // Printed white, with hard dark lines. A board is legible because of the
  // contrast between its parts, not the brightness of the whole: tinting
  // everything the same shade, light or dark, reads as one flat field
  // either way. So the paper is white, the ink is near-black, and every
  // colour on the board is laid down solid.
  rad('brd-surface', [['0', '#FFFFFF'], ['1', '#F2F0E9']],
      { cx: 0.5, cy: 0.42, r: 0.75 });
  lin('brd-cell', [['0', '#FFFFFF'], ['1', '#F4F2EB']]);
  rad('brd-centre', [['0', '#FFFFFF'], ['1', '#EDEAE1']]);
  rad('brd-jewel', [['0', '#FFEDB0'], ['1', '#C79A34']], { cx: 0.4, cy: 0.35, r: 0.8 });
  rad('brd-well', [['0', '#FFFFFF'], ['1', '#EFEDE6']]);
  for (const c of ORDER) {
    // A tile of the colour, lit from above…
    lin(`tile-${c}`, [['0', LIGHT[c]], ['0.35', TINT[c]], ['1', EDGE[c]]]);
    // …and a game piece of the colour, lit from the upper left.
    rad(`pawn-${c}`, [['0', LIGHT[c]], ['0.55', TINT[c]], ['1', EDGE[c]]],
        { cx: 0.36, cy: 0.3, r: 0.9 });
  }

  gRoot = svg('g', {}, board);

  // ── The rim and the table ────────────────────────────────────────
  svg('rect', { x: -0.56, y: -0.56, width: 20.12, height: 20.12, rx: 0.95,
    fill: 'url(#brd-frame)' }, gRoot);
  svg('rect', { x: -0.5, y: -0.5, width: 20, height: 20, rx: 0.9,
    fill: 'none', stroke: 'rgba(0,0,0,.38)', 'stroke-width': 0.05 }, gRoot);
  svg('rect', { x: -0.3, y: -0.3, width: 19.6, height: 19.6, rx: 0.75,
    fill: 'url(#brd-surface)', stroke: 'rgba(0,0,0,.55)', 'stroke-width': 0.07 }, gRoot);

  const cells = svg('g', {}, gRoot);

  // ── The four starting corners ────────────────────────────────────
  for (const color of Object.keys(NEST_BOX)) {
    const b = NEST_BOX[color];
    const live = PLAYED.has(color);
    // A yard is a solid block of its colour, ruled in ink. Half-transparent
    // washes are what made four corners of the board look like one corner.
    svg('rect', {
      x: b.x + 0.35, y: b.y + 0.35, width: 7.3, height: 7.3, rx: 1.1,
      fill: live ? `url(#tile-${color})` : DIM,
      stroke: INK, 'stroke-opacity': live ? 0.85 : 0.35,
      'stroke-width': 0.1,
    }, cells);

    if (!live) continue;

    for (const s of nestSlots(color)) {
      // White sockets, so a piece of the yard's own colour still stands out
      // against it instead of disappearing into it.
      svg('circle', {
        cx: s.x + 0.5, cy: s.y + 0.5, r: 0.46,
        fill: 'url(#brd-well)', stroke: INK,
        'stroke-opacity': 0.75, 'stroke-width': 0.07,
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

    // Every square is ruled in the same ink, so the track reads as a chain
    // of squares rather than a smear. This one line is what turns the ring
    // into a road you can follow with your eye.
    svg('rect', {
      x: c.x + 0.06, y: c.y + 0.06, width: 0.88, height: 0.88, rx: 0.18,
      fill: live ? `url(#tile-${owner})` : 'url(#brd-cell)',
      stroke: INK, 'stroke-opacity': 0.55, 'stroke-width': 0.055,
    }, cells);

    // Safe squares are marked the way a printed board marks them: a quiet
    // star stamped on the tile. Not a gold ring — rings are how the game
    // says "you can move here", and a dozen decoys taught the eye to
    // ignore the two that mattered.
    if (safe) {
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.115 : 0.26;
        const a = (Math.PI / 5) * k - Math.PI / 2;
        pts.push(`${(c.x + 0.5 + Math.cos(a) * r).toFixed(3)},${(c.y + 0.5 + Math.sin(a) * r).toFixed(3)}`);
      }
      svg('polygon', {
        points: pts.join(' '),
        // White on a coloured entry square, ink on a white one. Either way
        // it is a printed mark, not a signal.
        fill: live ? '#FFFFFF' : INK,
        'fill-opacity': live ? 0.9 : 0.4,
      }, cells);
    }
  });

  // ── The four home columns ────────────────────────────────────────
  for (const color of Object.keys(COLUMN)) {
    const live = PLAYED.has(color);
    COLUMN[color].forEach((c, i) => {
      svg('rect', {
        x: c.x + 0.06, y: c.y + 0.06, width: 0.88, height: 0.88, rx: 0.18,
        fill: live ? `url(#tile-${color})` : DIM,
        stroke: INK, 'stroke-opacity': live ? 0.55 : 0.3,
        'stroke-width': 0.055,
      }, cells);
    });
  }

  // ── The centre ───────────────────────────────────────────────────
  svg('rect', {
    x: 8.1, y: 8.1, width: 2.8, height: 2.8, rx: 0.55,
    fill: 'url(#brd-centre)', stroke: INK, 'stroke-opacity': 0.8,
    'stroke-width': 0.08,
  }, cells);
  // One wedge per arm, each pointing in from the column that feeds it.
  const WEDGE = {
    yellow: 'M8.35 8.35 H10.65 L9.5 9.5 Z',      // down from the top arm
    blue:   'M10.65 8.35 V10.65 L9.5 9.5 Z',     // in from the right arm
    green:  'M8.35 10.65 H10.65 L9.5 9.5 Z',     // up from the bottom arm
    red:    'M8.35 8.35 V10.65 L9.5 9.5 Z',      // in from the left arm
  };
  for (const [color, d] of Object.entries(WEDGE)) {
    // Held back to a tint, because finished pawns pile up on top of these
    // and a solid wedge would swallow a pawn of its own colour.
    svg('path', {
      d, fill: PLAYED.has(color) ? TINT[color] : DIM,
      'fill-opacity': PLAYED.has(color) ? 0.32 : 0.4,
      stroke: INK, 'stroke-opacity': 0.35, 'stroke-width': 0.03,
    }, cells);
  }
  // Where all four roads end: a little gold at the very middle.
  svg('circle', { cx: 9.5, cy: 9.5, r: 0.17,
    fill: 'url(#brd-jewel)', stroke: 'rgba(0,0,0,.4)', 'stroke-width': 0.03 }, cells);

  // Pawns first, then markers, so a destination always sits above whatever
  // is standing on it. Landing on an occupied square is how you build a wall
  // with your own pawn and how you take someone else's, and neither is
  // reachable if the piece underneath swallows the tap.
  gPawns = svg('g', {}, gRoot);
  gMarks = svg('g', {}, gRoot);

  // One circle per pawn, created once so CSS can animate it between squares.
  for (const color of roster) {
    for (let i = 0; i < 4; i++) {
      const g = svg('g', { class: 'pawn', 'data-color': color, 'data-i': i }, gPawns);
      // An invisible disc wider than the pawn itself, so a thumb aimed
      // roughly at a piece still lands on it. It never changes size.
      svg('circle', { class: 'hit', r: 0.78, fill: 'transparent' }, g);
      // The halo only shows on a pawn that can move right now. It is the one
      // signal on the board that means "press this".
      svg('circle', { class: 'halo', r: 0.5, fill: 'none' }, g);
      svg('circle', { r: 0.33, fill: 'rgba(0,0,0,.28)', cy: 0.08 }, g);
      // Ruled in the same ink as the board. A piece outlined in its own
      // dark shade reads as a smudge; outlined in ink it reads as a piece.
      svg('circle', {
        r: 0.35, fill: `url(#pawn-${color})`,
        stroke: INK, 'stroke-opacity': 0.9, 'stroke-width': 0.075,
      }, g);
      svg('circle', { r: 0.12, cx: -0.1, cy: -0.12, fill: '#fff', 'fill-opacity': 0.4 }, g);
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

  for (const color of sidesOf(state)) {
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
  if (!game || (!LOCAL && !myColor)) return [];
  if (game.phase !== 'move' || game.winner) return [];
  if (thinking || walking) return [];
  if (!iPlay(game.turn)) return [];
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

  // Going from two players to four lights up two more corners, so the board
  // has to be redrawn before anything is placed on it.
  const roster = sidesOf(game);
  if (roster.join(',') !== builtFor) buildBoard(roster);

  const color = seatColor();
  const mine = iPlay(game.turn);
  const acts = openActions();

  // ── Which pawns can do anything ──────────────────────────────────
  const movable = new Set();
  for (const a of acts) {
    if (a.type === 'exit') {
      game.pawns[color].forEach((p, i) => { if (p === NEST) movable.add(i); });
    } else movable.add(a.pawn);
  }
  if (sel !== null && !movable.has(sel)) sel = null;

  // ── Pawns ────────────────────────────────────────────────────────
  gRoot.setAttribute('transform', viewColor() === 'blue' ? 'rotate(180 9.5 9.5)' : '');

  const spots = layout(game);
  for (const [id, node] of Object.entries(pawnNodes)) {
    const s = spots[id];
    // A pawn mid-stride owns its own position until it arrives.
    if (id !== walking) {
      node.setAttribute('transform', `translate(${s.x.toFixed(3)} ${s.y.toFixed(3)})`);
    }
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
      // The board is the interface again, so a destination has to be worth
      // aiming at: the disc you see is 0.46, the one you hit is 0.62.
      // It stops well short of the next square on purpose. Markers sit above
      // the pawns now, and a disc any wider would start eating taps meant
      // for the piece standing beside it.
      svg('circle', { class: 'hit', cx, cy, r: 0.62, fill: 'transparent' }, g);
      svg('circle', { cx, cy, r: 0.46 }, g);
      const t = svg('text', { x: cx, y: cy }, g);
      t.textContent = steps;
      if (viewColor() === 'blue') t.setAttribute('transform', `rotate(180 ${cx} ${cy})`);

      g.addEventListener('click', (e) => { e.stopPropagation(); play(a); });
    }
  }

  renderHeader();
  renderPanel(mine);
}

// One chip per colour in the game, in turn order, with whoever is to move
// lit up. Four names will not fit beside a score, so the score steps aside
// once the table is more than two-handed.
function renderHeader() {
  const roster = sidesOf(game);
  const seats = table?.seats || {};
  const bar = $('seatbar');
  bar.innerHTML = '';

  for (const c of roster) {
    const who = isBot(c) ? 'Computer' : (seats[c]?.name || (LOCAL ? NAMES[c] : 'Open'));
    const el = document.createElement('div');
    el.className = `seat${game.turn === c && !game.winner ? ' active' : ''}`;
    el.innerHTML = '<i class="chip"></i><span class="nm"></span>';
    el.firstChild.className = `chip ${c}`;
    el.lastChild.textContent = who;
    bar.appendChild(el);
  }
  bar.classList.toggle('four', roster.length > 2);

  // The record in the corner belongs to the hub, and it is the whole
  // table's, not this game's. Four names will not fit beside it, so it
  // steps aside once the table is more than two-handed.
  $('score').classList.toggle('hidden', roster.length > 2);
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
  const turnName = isBot(game.turn)
    ? `${NAMES[game.turn]} (computer)`
    : (seats[game.turn]?.name || NAMES[game.turn]);
  const soloHuman = sidesOf(game).filter((c) => !isBot(c)).length === 1;
  status.className = 'status';
  rollBtn.textContent = 'Roll';

  if (game.winner) {
    status.classList.add('over');
    status.textContent = !LOCAL && game.winner === myColor
      ? 'You win'
      : `${NAMES[game.winner]} wins`;
    rollBtn.textContent = 'New game';
    rollBtn.disabled = false;
  } else if (thinking || walking) {
    status.textContent = `${turnName} is playing`;
    rollBtn.disabled = true;
  } else if (!LOCAL && !seats[other(myColor)] && sidesOf(game).length === 2
             && !isBot(other(myColor))) {
    status.textContent = 'Waiting for the other side to be taken';
    rollBtn.disabled = true;
  } else if (!mine) {
    status.textContent = `${turnName} is playing`;
    rollBtn.disabled = true;
  } else if (game.phase === 'roll') {
    status.classList.add('you');
    status.textContent = LOCAL && !soloHuman ? `${NAMES[color]} to roll` : 'Your turn';
    rollBtn.disabled = false;
  } else {
    status.classList.add('you');
    status.textContent = sel === null ? 'Press a pawn' : 'Press where it goes';
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
  if (walking || thinking) return;
  if (color !== seatColor() || !iPlay(game.turn)) return;

  const acts = distinctActions(actionsFor(i));
  if (!acts.length) { sel = null; render(); return; }

  // With one place to go, pressing the pawn is the whole move. Only when a
  // pawn has a real choice of squares is a second tap worth asking for.
  if (acts.length === 1) { play(acts[0]); return; }

  sel = sel === i ? null : i;
  render();
}

// A move the player chose: walk it, then see what the turn does next.
async function play(action) {
  await applyMove(action);
  await settleTurn();
}

// The move itself, with no opinion about what happens afterwards. autoPlay
// and the computer both come through here, so neither re-enters settleTurn
// and sends the three of them round in a circle.
async function applyMove(action) {
  if (walking) return;
  sel = null;

  // Everything below reads `base`, not `game`. A pawn takes about a second
  // to walk, and an update from the other phone can land in the middle of
  // it and swap `game` out underneath. Applying a move to a board it was
  // never legal on is how a turn quietly corrupts itself.
  const base = game;
  const color = base.turn;
  const id = `${color}${action.pawn}`;
  const from = base.pawns[color][action.pawn];
  const steps = action.use.reduce((n, i) => n + base.pending[i].v, 0);
  const path = action.type === 'exit' ? [action.to] : pathOf(color, from, steps);

  gMarks.innerHTML = '';                       // the markers have served
  await walkPawn(id, color, path);

  // The board moved on while the pawn was walking, so this move belongs to
  // a position that no longer exists. Drop it and let what arrived stand:
  // writing it now would put our stale copy over somebody else's turn.
  if (moved(base, game)) {
    // Worth saying out loud. If this ever appears during ordinary play it
    // means the guard is too eager and is eating real moves, which looks
    // exactly like the desync it was written to prevent.
    console.warn('parchis: board moved while a pawn walked, move dropped');
    render();
    return;
  }

  await commit(applyAction(base, action));
}

// Whether the board is somewhere different from where it was. Compared by
// value rather than by identity, because every snapshot hands back a fresh
// object, including the echo of our own last write.
function moved(before, after) {
  if (!before || !after) return before !== after;
  return before.id !== after.id
      || before.rev !== after.rev
      || before.turn !== after.turn
      || before.rolledAt !== after.rolledAt;
}

// Walk a pawn across the board a square at a time. The state has not changed
// yet, so render() would put the pawn straight back where it started — which
// is what `walking` holds off until it arrives.
async function walkPawn(id, color, path) {
  const node = pawnNodes[id];
  if (!node || !path.length) return;

  walking = id;
  node.classList.add('walking');
  node.parentNode.appendChild(node);            // step over anything in the way

  // Whatever happens in here, the flag has to come back down. applyMove
  // refuses to start while it is set and the panel reads it as somebody
  // mid-move, so a throw part way across the board would leave this device
  // unable to play again until the app was restarted.
  try {
    // Long bonus moves would crawl at a fixed pace, so the stride shortens
    // as the journey lengthens and the whole thing stays under a second.
    const ms = Math.max(38, Math.min(105, Math.round(900 / path.length)));
    for (const pos of path) {
      const cell = pos === HOME ? { x: 9, y: 9 } : cellOf(color, pos);
      node.setAttribute('transform',
        `translate(${(cell.x + 0.5).toFixed(3)} ${(cell.y + 0.5).toFixed(3)})`);
      await sleep(ms);
    }
  } finally {
    node.classList.remove('walking');
    walking = null;
  }
}

async function doRoll() {
  if (game.winner) return api.deal();
  if (thinking || walking) return;
  if (!iPlay(game.turn)) return;
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

// Only the moves the rules take out of your hands get played for you: a 5
// that has to bring a pawn out, and a 6 that has to break your own wall.
// Everything else is yours, however obvious it looks from here.
async function autoPlay() {
  let guard = 0;
  while (guard++ < 60) {
    if (!game || game.winner || game.phase !== 'move' || walking) return;
    if (!iPlay(game.turn)) return;
    const forced = distinctActions(compelled(game));
    if (forced.length !== 1) return;      // nothing forced, or you pick which
    await applyMove(forced[0]);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// The computer's turn, or several of them in a row when more than one seat
// is being played for. Slow enough to follow, and its pawns walk like yours.
async function botTurn() {
  if (thinking || !game || game.winner) return;
  if (!isBot(game.turn) || !iDriveBots()) return;

  thinking = true;
  render();
  try {
    let guard = 0;
    while (!game.winner && isBot(game.turn) && guard++ < 400) {
      await sleep(420);
      if (game.phase === 'roll') { await commit(applyRoll(game, rollDice())); continue; }
      const acts = distinctActions(legalActions(game));
      if (!acts.length) break;
      const pick = house().skill === 'hard'
        ? bestAction(acts)
        : acts[Math.floor(Math.random() * acts.length)];
      await applyMove(pick);
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

// Draw the new board at once, then hand it to the hub to put on the wire.
// Firestore's local cache echoes a write back immediately, so this staying
// optimistic is what makes a tap feel instant.
//
// The write itself is fired and not waited on. Firestore has already taken
// it and will keep trying; waiting for the server to acknowledge it puts
// the rest of the turn behind a round trip on whatever signal the phone
// has, and `botTurn` holds `thinking` set for the whole of that, which is
// the board locking up rather than merely lagging.
async function commit(next) {
  game = next;
  render();
  Promise.resolve(api.commit(next)).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════
//  The menu
// ═══════════════════════════════════════════════════════════════════════

// Only what belongs to this game. Anything true of the whole hub — who you
// are, the record, leaving for another game — is the hub's menu, not this
// one, and sits above this on the same sheet.
function openMenu() {
  sheet((inner, close) => {
    api.hubRows(inner, close);

    add(inner, 'How it plays', '', () => { close(); openRules(); });

    const n = botCount();
    add(inner, 'Players', `${players()} · ${n} computer${n === 1 ? '' : 's'}`,
      () => { close(); openPlayers(); });

    add(inner, 'Computer skill', BOT_LABEL[house().skill], async () => {
      const next = BOT_LEVELS[(BOT_LEVELS.indexOf(house().skill) + 1) % BOT_LEVELS.length];
      close();
      await api.setSettings({ skill: next });
    });

    add(inner, 'New game', '', async () => {
      close();
      if (game && !game.winner && !confirm('Abandon the game in progress?')) return;
      await api.deal();
    });
  });
}

// How many are at the table, and how many of those are the computer. Red and
// blue are the only seats a person can take, so four players always means at
// least two of them are played for.
function openPlayers() {
  sheet((inner, close) => {
    const apply = async (total, bots) => {
      close();
      if (game && !game.winner && !confirm('Start a new game with these players?')) return;
      await api.setSettings({ players: total, bots });
      await api.deal();
    };

    inner.insertAdjacentHTML('beforeend',
      '<div class="row"><span>Two play red and blue. Green and yellow are always the computer.</span></div>');

    for (const total of [2, 4]) {
      for (let b = leastBots(total); b <= total - 1; b++) {
        const people = total - b;
        const label = `${total} players — ${people} human${people === 1 ? '' : 's'}, ` +
                      `${b} computer${b === 1 ? '' : 's'}`;
        const now = players() === total && botCount() === b;
        add(inner, label, now ? 'Playing' : '', () => apply(total, b));
      }
    }
  });
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
//  House rules
// ═══════════════════════════════════════════════════════════════════════

const players = () => (house().players === 4 ? 4 : 2);

// Red and blue are the only seats a person can take, so a four-handed game
// is always at least two computers. A two-handed one may be none.
const leastBots = (total) => (total === 4 ? 2 : 0);

const botCount = () => {
  const total = players();
  const n = Number(house().bots);
  const floor = leastBots(total);
  if (!Number.isFinite(n)) return Math.max(floor, LOCAL ? 1 : 0);
  return Math.max(floor, Math.min(total - 1, n));
};

// ═══════════════════════════════════════════════════════════════════════
//  The hub's handle on this game
// ═══════════════════════════════════════════════════════════════════════

// A fresh board, dealt to the house rules. The hub calls this; it never
// builds a game state itself, because only the game knows what one is.
function deal(prev) {
  // Read the table off whichever board is around, because the hub can deal
  // from the lobby with nothing mounted and no `game` to look at.
  const h = houseOf(prev || game);
  const total = h.players === 4 ? 4 : 2;
  const floor = leastBots(total);
  const bots = Math.max(floor, Math.min(total - 1, Number(h.bots) || 0));

  const first = prev?.winner && sidesOf(prev).includes(prev.winner)
    ? prev.winner            // beaten players do not get to open the next one
    : 'red';
  return newGame({
    first: total === 2 && prev?.winner ? other(prev.winner) : first,
    sides: rosterFor(total),
    bots: botsFor(total, bots),
  });
}

// Draw this game into the screen the hub has already put on the page, and
// hand back the two things the hub needs: somewhere to push new boards, and
// a way to take it all down again when it leaves for another game.
function mount(handle) {
  api = handle;
  LOCAL = handle.local;
  uid = handle.uid;
  sel = null;
  lastRoll = 0;
  thinking = false;
  walking = null;
  builtFor = '';

  // The hub supplies an empty stage and an empty panel. What goes in them
  // is this game's business, which is what lets the next game put a hand of
  // cards there instead of a board and two dice.
  $('game-stage').innerHTML =
    '<svg id="board" viewBox="-0.6 -0.6 20.2 20.2" xmlns="http://www.w3.org/2000/svg"'
    + ' aria-label="Parchís board"></svg>';

  $('game-panel').innerHTML = `
    <div class="status" id="status">Connecting</div>
    <div class="controls">
      <div class="dicebar" id="dicebar"></div>
      <button class="roll" id="btn-roll" disabled>Roll</button>
    </div>
    <div class="lastline" id="lastline"></div>`;

  $('btn-roll').addEventListener('click', doRoll);
  $('btn-menu').addEventListener('click', openMenu);

  return {
    // The hub calls this with every board that arrives, its own and the
    // other phone's alike.
    update(state, ctx) {
      table = ctx.table;
      myColor = ctx.me;
      game = state;
      const roster = [...sidesOf(state)].join(',');
      if (roster !== builtFor) buildBoard(sidesOf(state));
      render();
      settleTurn();
    },
    // Whose move it is, in words the lobby can show without knowing the
    // first thing about Parchís.
    waitingOn(state) {
      if (!state || state.winner) return null;
      return state.turn;
    },
    destroy() {
      api = null;
      game = null;
      pawnNodes = {};
      builtFor = '';
    },
  };
}

export default {
  id: 'parchis',
  title: 'Parchís',
  blurb: 'Four pawns each, two dice, and a long way round.',
  colours: ['red', 'blue'],
  boardRev: BOARD_REV,
  deal,
  mount,
};
