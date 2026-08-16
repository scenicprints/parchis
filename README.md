# Games

A two-player game hub, built as an installable web app so it lands on an
iPhone and an Android phone the same way with no App Store and no developer
account. Parchís is the first game in it.

**<https://scenicprints.github.io/parchis/>**

Carrying this on in a new session? Read [`HANDOFF.md`](HANDOFF.md) first.

---

## The shape of it

The hub owns everything true of the whole table: the two seats, the record,
the house rules, and the single document a game is played in. A game owns its
rules, its board and its screen, and nothing else. It is handed a board to
show and one way to hand a new board back, and never learns that a network
exists.

```
docs/
  index.html          the shell
  hub.js              identity, the wire, the lobby, which game is open
  ui.js               the bottom sheet, borrowed by any game
  sw.js               offline shell and the update path
  games/
    index.js          the registry
    parchis/          rules.js · board.js · view.js
test/rules.test.mjs   22 tests, including 2000 games played end to end
scripts/              dev server, icon maker, board preview
```

Adding a game is a folder under `docs/games/` and a line in the registry.

| | |
|---|---|
| **Players** | Two people, red and blue. Some games seat more; the rest are the computer. |
| **Online** | One Firestore document. Either phone can move on its turn, from anywhere. |
| **At once** | One game at a time. Starting another asks before abandoning the last. |
| **Install** | Add to Home Screen on either phone. |
| **Build step** | None. Plain ES modules. |

## Parchís

Parchís proper, not Ludo and not Hasbro Parcheesi: 68-square ring, two dice,
twelve safe squares, walls, bonus 20 and 10, three doubles sends your lead
pawn back. A crossing is 63 squares from your own entry to your own ramp.
The full list is in the app under **How it plays**.

`docs/games/parchis/rules.js` is pure — no DOM, no network — which is why the
whole game can be played thousands of times in a terminal.

## Working on it

```bash
npm test
```

```bash
node scripts/serve.mjs
```

Then <http://localhost:8099>. Add `?local=1` to play both sides on one device
with no network. Add `?room=name` to play in a separate pair of documents,
which is how to break things on purpose without touching the live game.

**Bump `?v=` on both links in `index.html` when you deploy**, and bump `CACHE`
in `sw.js` if you changed which files the shell caches.

## Putting it on a phone

- **iPhone:** open the link in **Safari**, Share, **Add to Home Screen**. It
  has to be Safari; Chrome on iOS cannot install a web app.
- **Android:** open in Chrome, menu, **Install app**.

First open asks for a name and a side. If your name is already on a side, tap
it to get back in — that is the way back after a reinstall, which gives the
phone a new identity and leaves the old one holding the seat.

## Known gap

**No push notification when it is your turn.** The lobby shows a "Your move"
badge while the app is open, but reaching a closed phone needs a server, which
means Cloud Functions and the Blaze plan on a project that also holds the foos
data. Undecided on purpose.
