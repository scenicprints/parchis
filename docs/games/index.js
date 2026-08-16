// ═══════════════════════════════════════════════════════════════════════
//  Every game the hub knows about.
//
//  A game is one object with an id, a title, a way to deal a fresh state,
//  and a mount() that draws it into the screen the hub has already put up.
//  It never touches Firestore, never asks who is sitting where, and never
//  reaches outside the board: everything it needs comes in through the
//  handle mount() is given.
//
//  Adding one is adding a folder and a line here.
// ═══════════════════════════════════════════════════════════════════════

import parchis from './parchis/view.js';
import jass from './jass/view.js';

export const GAMES = [parchis, jass];

export const byId = (id) => GAMES.find((g) => g.id === id) || null;
