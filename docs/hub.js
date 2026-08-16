// ═══════════════════════════════════════════════════════════════════════
//  THE HUB — who you are, what is on the wire, and which game is open.
//
//  Everything that is true of the whole table lives here: the two seats,
//  the record, the house rules, and the one document a game is played in.
//  Games know none of it. The hub puts a screen on the page, hands the game
//  a handle, and the game hands boards back.
//
//  One game at a time. The game document says which game it is, and both
//  phones follow that; which screen you happen to be looking at is your own
//  business and stays on your own device.
//
//  ?local=1  plays both sides here with no network.
//  ?room=x   plays in a separate pair of documents, for breaking on purpose.
// ═══════════════════════════════════════════════════════════════════════

import { GAMES, byId } from './games/index.js';
import { $, sheet, addRow, addNote } from './ui.js';

const params = new URLSearchParams(location.search);
const LOCAL = params.has('local');
const ROOM = (params.get('room') || '').replace(/[^a-z0-9-]/gi, '');

// The two seats a person can take. Games may seat more colours than this;
// the rest of them are always the computer.
const SEATS = ['red', 'blue'];
const SEAT_NAME = { red: 'Red', blue: 'Blue' };
const other = (c) => (c === 'red' ? 'blue' : 'red');

// ── What the hub is holding right now ────────────────────────────────
let uid = null;
let table = null;        // seats, record, house rules
let game = null;         // the live board, whichever game it belongs to
let myColor = null;
let gameLoaded = false;
let open = null;         // { def, handle } for the game on screen
let booting = true;

// ═══════════════════════════════════════════════════════════════════════
//  Reading the table
// ═══════════════════════════════════════════════════════════════════════

const seats = () => table?.seats || {};

// The record, combined and per game. Older tables only ever had `score`,
// which was Parchís and nothing else, so that is where those numbers come
// from until the first game finishes under the new shape.
function record() {
  if (table?.record) return { red: 0, blue: 0, ...table.record };
  return { red: 0, blue: 0, ...(table?.score || {}) };
}

function recordFor(id) {
  const byGame = table?.byGame || {};
  if (byGame[id]) return { red: 0, blue: 0, ...byGame[id] };
  if (id === 'parchis') return { red: 0, blue: 0, ...(table?.score || {}) };
  return { red: 0, blue: 0 };
}

const settingsFor = (id) => (table?.settings || {})[id] || {};

// Which game the live board belongs to. Boards written before the hub had
// no idea they were one game among several, and all of them were Parchís.
const kindOf = (state) => state?.kind || 'parchis';

const nameOf = (color) => seats()[color]?.name || SEAT_NAME[color] || color;

// ═══════════════════════════════════════════════════════════════════════
//  The handle a game is given
// ═══════════════════════════════════════════════════════════════════════

function handleFor(def) {
  return {
    local: LOCAL,
    uid,
    settings: () => settingsFor(def.id),

    async setSettings(patch) {
      await saveSettings(def.id, patch);
    },

    // A board the game has just worked out. Straight onto the wire.
    async commit(next) {
      game = { ...next, kind: def.id };
      if (LOCAL) return;
      try {
        await saveGame(game);
      } catch (err) {
        fatal(err);
      }
    },

    // Deal a fresh one. The game decides what a fresh board is; the hub
    // only decides where it goes.
    async deal() {
      await deal(def.id);
    },

    // The rows that belong to the whole table rather than to this game.
    // They sit at the top of the game's own menu so there is one sheet.
    hubRows(inner, close) {
      const r = record();
      if (!LOCAL) {
        addNote(inner, 'Overall', `${nameOf('red')} ${r.red} · ${nameOf('blue')} ${r.blue}`);
      }
      addRow(inner, 'Back to the games', '', () => { close(); showLobby(); });
      if (LOCAL) {
        addRow(inner, 'Back to the real game', '', () => { location.href = location.pathname; });
      } else {
        addRow(inner, 'Play on this device', '', () => { location.href = `${location.pathname}?local=1`; });
        addRow(inner, 'Change my name', seats()[myColor]?.name || '', async () => {
          const name = prompt('Your name', seats()[myColor]?.name || '');
          if (name && name.trim()) { await claimSeat(myColor, name.trim()); close(); }
        });
        addRow(inner, 'Give up this seat', '', async () => {
          if (!confirm('Free up your side so it can be taken again?')) return;
          await releaseSeat();
          close();
          location.reload();
        }, true);
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Screens
// ═══════════════════════════════════════════════════════════════════════

// The frame every game is drawn inside. Rebuilt from scratch on each open,
// which is the cheapest way to be certain no listener from the last game is
// still attached to a button this one is about to use.
const GAME_FRAME = `
  <header class="bar">
    <button class="iconb" id="btn-back" aria-label="Back to the games">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7"/>
      </svg>
    </button>
    <div class="seatbar" id="seatbar"></div>
    <div class="score" id="score">—</div>
    <button class="iconb" id="btn-menu" aria-label="Menu">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
      </svg>
    </button>
  </header>
  <div class="stage" id="game-stage"></div>
  <footer class="panel" id="game-panel"></footer>`;

function show(which) {
  for (const id of ['screen-lobby', 'screen-game']) {
    $(id).classList.toggle('hidden', id !== `screen-${which}`);
  }
}

function showLobby() {
  if (open) { open.handle.destroy?.(); open = null; }
  location.hash = '';
  show('lobby');
  renderLobby();
}

function openGame(id) {
  const def = byId(id);
  if (!def) return showLobby();

  if (open?.def.id !== id) {
    if (open) open.handle.destroy?.();
    $('screen-game').innerHTML = GAME_FRAME;
    $('btn-back').addEventListener('click', showLobby);
    open = { def, handle: def.mount(handleFor(def)) };
  }

  location.hash = id;
  show('game');
  if (game && kindOf(game) === id) {
    open.handle.update(game, { table, me: myColor });
  }
  renderHubScore();
}

function renderHubScore() {
  const el = $('score');
  if (!el) return;
  const r = record();
  el.textContent = LOCAL ? '' : `${r.red} – ${r.blue}`;
}

// ── The lobby ────────────────────────────────────────────────────────

function renderLobby() {
  const r = record();
  $('hub-record').textContent = LOCAL
    ? 'This device'
    : `${nameOf('red')} ${r.red} · ${nameOf('blue')} ${r.blue}`;

  const list = $('gamelist');
  list.innerHTML = '';

  for (const def of GAMES) {
    const inPlay = game && kindOf(game) === def.id && !game.winner;
    const gr = recordFor(def.id);

    const card = document.createElement('button');
    card.className = `gamecard${inPlay ? ' live' : ''}`;

    // Whose move it is, said plainly, so the lobby is worth opening.
    let badge = '';
    if (inPlay) {
      let waiting = open?.def.id === def.id
        ? open.handle.waitingOn?.(game)
        : game.turn;
      // A game may seat more colours than a person can hold, and then the
      // turn belongs to the computer. Nobody is being waited on, so the
      // card says so rather than naming a colour at somebody.
      if (!SEATS.includes(waiting)) waiting = null;
      badge = LOCAL || !waiting ? 'In play'
        : waiting === myColor ? 'Your move'
        : `${nameOf(waiting)} to move`;
    }

    card.innerHTML = `
      <span class="gt"></span>
      <span class="gb"></span>
      <span class="gmeta"><span class="grec"></span><span class="gbadge"></span></span>`;
    card.querySelector('.gt').textContent = def.title;
    card.querySelector('.gb').textContent = def.blurb || '';
    card.querySelector('.grec').textContent = LOCAL ? '' : `${gr.red} – ${gr.blue}`;
    const b = card.querySelector('.gbadge');
    b.textContent = badge;
    b.classList.toggle('yours', badge === 'Your move');
    b.classList.toggle('on', Boolean(badge));

    card.addEventListener('click', () => startOrResume(def));
    list.appendChild(card);
  }

  const soon = document.createElement('div');
  soon.className = 'soon';
  soon.textContent = 'More games drop in here.';
  list.appendChild(soon);
}

async function startOrResume(def) {
  const inPlay = game && !game.winner;
  const sameGame = inPlay && kindOf(game) === def.id;

  if (inPlay && !sameGame) {
    const label = byId(kindOf(game))?.title || 'the game';
    if (!confirm(`Abandon the ${label} game in progress?`)) return;
  }
  openGame(def.id);
  if (!sameGame) await deal(def.id);
}

// ═══════════════════════════════════════════════════════════════════════
//  Dealing, and the record
// ═══════════════════════════════════════════════════════════════════════

async function deal(id) {
  const def = byId(id);
  if (!def) return;
  const prev = game && kindOf(game) === id ? game : null;
  const fresh = { ...def.deal(prev), kind: id, id: `${Date.now()}` };
  game = fresh;
  if (LOCAL) {
    if (open?.def.id === id) open.handle.update(game, { table, me: myColor });
    return;
  }
  await saveGame(fresh);
}

// ═══════════════════════════════════════════════════════════════════════
//  Firestore
// ═══════════════════════════════════════════════════════════════════════

let db, fs, TABLE, GAME;

async function connect() {
  const [{ initializeApp }, authMod, store] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);
  fs = store;

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

  // Still the same two documents the game has always lived in. The names
  // are internal, and keeping them means every seat, every point and the
  // game in progress carried straight over into the hub.
  const suffix = ROOM ? `-${ROOM}` : '';
  TABLE = fs.doc(db, 'parchis', `table${suffix}`);
  GAME = fs.doc(db, 'parchis', `game${suffix}`);

  await authMod.signInAnonymously(auth);
  uid = auth.currentUser.uid;

  fs.onSnapshot(TABLE, (snap) => {
    table = snap.exists() ? snap.data() : { seats: {}, record: { red: 0, blue: 0 } };
    settleSeat();
  }, fatal);

  fs.onSnapshot(GAME, (snap) => {
    gameLoaded = true;
    game = snap.exists() ? snap.data() : null;
    if (!game) { arrive(); return; }

    const def = byId(kindOf(game));
    // The board changed shape under this game, so its pieces now mean
    // something else. Nothing to salvage: deal again.
    if (def && def.boardRev && game.board !== def.boardRev) {
      booted();
      if (myColor) { deal(def.id); return; }
    }
    arrive();
  }, fatal);
}

const saveGame = (state) => fs.setDoc(GAME, state);

// Held here as well as sent, not only sent. A game almost always deals a
// fresh board the moment it changes a house rule, and the snapshot carrying
// the new rule back has not arrived by then: `settings()` would still hand
// back the old one and the new board would be dealt to it. That is
// "change the players, start again" quietly starting again with the old
// players. The snapshot confirms this a moment later either way.
function saveSettings(id, patch) {
  const settings = { ...(table?.settings || {}),
    [id]: { ...settingsFor(id), ...patch } };
  table = { ...(table || {}), settings };
  if (LOCAL) return Promise.resolve();
  return fs.setDoc(TABLE, { settings }, { merge: true });
}

// A seat is held by this browser's anonymous id, and that id does not
// survive a reinstall. So a held seat can always be taken, with the screen
// asking first.
const claimSeat = (color, name) => fs.runTransaction(db, async (tx) => {
  const snap = await tx.get(TABLE);
  const t = snap.exists() ? snap.data() : { seats: {}, record: { red: 0, blue: 0 } };
  const next = { ...(t.seats || {}) };
  const foe = other(color);
  if (next[foe]?.uid === uid) next[foe] = null;     // nobody holds both sides
  next[color] = { uid, name };
  tx.set(TABLE, { ...t, seats: next }, { merge: true });
});

const releaseSeat = () => fs.runTransaction(db, async (tx) => {
  const snap = await tx.get(TABLE);
  if (!snap.exists()) return;
  const t = snap.data();
  if (t.seats?.[myColor]?.uid !== uid) return;
  tx.set(TABLE, { ...t, seats: { ...t.seats, [myColor]: null } });
});

// One point to the winner, on the combined record and on that game's own.
// Both phones try; whoever gets there first stamps the game id and the
// other one finds it already done.
const recordWin = (id, kind, winner) => fs.runTransaction(db, async (tx) => {
  const snap = await tx.get(TABLE);
  const t = snap.exists() ? snap.data() : {};
  if (t.lastScored === id) return;

  const overall = { red: 0, blue: 0, ...(t.record || t.score || {}) };
  const byGame = { ...(t.byGame || {}) };
  const mine = { red: 0, blue: 0, ...(byGame[kind] || (kind === 'parchis' ? t.score : null) || {}) };

  if (winner === 'red' || winner === 'blue') {
    overall[winner] = (overall[winner] || 0) + 1;
    mine[winner] = (mine[winner] || 0) + 1;
  }
  byGame[kind] = mine;

  // `score` is still written so an older copy of the app, on a phone that
  // has not picked up the hub yet, keeps showing the right Parchís tally.
  const patch = { lastScored: id, record: overall, byGame };
  if (kind === 'parchis') patch.score = mine;
  tx.set(TABLE, patch, { merge: true });
});

// ═══════════════════════════════════════════════════════════════════════
//  Seats
// ═══════════════════════════════════════════════════════════════════════

function settleSeat() {
  const found = SEATS.find((c) => seats()[c]?.uid === uid);

  if (found) {
    myColor = found;
    $('seatpick').classList.add('hidden');
    arrive();
    return;
  }

  myColor = null;
  for (const c of SEATS) {
    const held = seats()[c];
    const btn = document.querySelector(`.seatbtn.${c}`);
    $(`who-${c}`).textContent = held?.name ? held.name : 'Open';
    // Never disabled. A taken seat still has to be pressable, or a phone
    // that has lost its old identity has no way back into its own game.
    btn.disabled = false;
    btn.classList.toggle('taken', Boolean(held?.uid));
  }
  $('seatpick').classList.remove('hidden');
  booted();
}

// ═══════════════════════════════════════════════════════════════════════
//  Settling on a screen
// ═══════════════════════════════════════════════════════════════════════

// Called whenever anything lands: a seat, a board, either of them changing.
// Works out what should be on screen and puts it there.
function arrive() {
  if (!LOCAL && !myColor) return;          // still choosing a side
  if (!LOCAL && !gameLoaded) return;

  booted();

  const inPlay = game && !game.winner;
  const kind = game ? kindOf(game) : null;

  // First look of the session: drop straight into a game that is waiting,
  // otherwise the lobby. After that, respect whichever screen you are on.
  if (booting) {
    booting = false;
    if (inPlay && byId(kind)) { openGame(kind); return; }
    showLobby();
    return;
  }

  if (open) {
    if (kind && kind !== open.def.id) { openGame(kind); return; }
    if (game) open.handle.update(game, { table, me: myColor });
    renderHubScore();
  } else {
    renderLobby();
  }

  if (game?.winner && game.id) {
    recordWin(game.id, kindOf(game), game.winner).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Start up
// ═══════════════════════════════════════════════════════════════════════

function booted() {
  const b = $('boot');
  // Called again every time a seat or a board settles, and by then this is
  // usually gone. Reading through the null threw before anything could be
  // drawn, which is what once left a phone stuck on "Connecting".
  if (!b || b.classList.contains('gone')) return;
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
       Paste this into the Firebase console under Firestore Database → Rules,
       publish it, then reopen.</p>
       <code>match /parchis/{doc} {
  allow read, write: if request.auth != null;
}</code>`
    : `<h2>Something went wrong</h2><code>${String(err?.message || err)}</code>`;
}

function wire() {
  for (const btn of document.querySelectorAll('.seatbtn')) {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.color;
      const held = seats()[color];
      // Coming back to a seat you already had, the name on it is the
      // obvious one to keep, so an empty box is not a reason to refuse.
      const name = $('seat-name').value.trim() || held?.name || '';
      if (!name) { $('seat-err').textContent = 'Put your name in first.'; return; }

      if (held?.uid && held.uid !== uid &&
          !confirm(`${held.name} is on this side. Take it over?`)) return;

      $('seat-err').textContent = '';
      btn.classList.add('busy');
      try {
        await claimSeat(color, name);
      } catch (err) {
        $('seat-err').textContent = err?.message || String(err);
      } finally {
        btn.classList.remove('busy');
      }
    });
  }

  addEventListener('hashchange', () => {
    const id = location.hash.replace(/^#/, '');
    if (!id) { if (open) showLobby(); return; }
    if (byId(id) && open?.def.id !== id) openGame(id);
  });
}

async function main() {
  wire();

  if (LOCAL) {
    table = { seats: {}, record: { red: 0, blue: 0 }, settings: {} };
    myColor = null;
    gameLoaded = true;
    booted();
    showLobby();
    return;
  }

  try {
    await connect();
  } catch (err) {
    fatal(err);
  }
}

main();

// ── Picking up a new version ─────────────────────────────────────────
// The worker already running is the one that serves the page you are
// looking at. A new one installs quietly behind it and only takes over
// afterwards, so without this every open showed the release before last.
if ('serviceWorker' in navigator) {
  const hadWorker = !!navigator.serviceWorker.controller;
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || refreshing) return;
    refreshing = true;
    location.reload();
  });

  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  });
}
