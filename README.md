# Parchís

Two players, one board, from anywhere. An installable web app, so it lands on
an iPhone and an Android phone the same way with no App Store and no developer
account.

![the board](preview.svg)

---

## What it is

| | |
|---|---|
| **Rules** | Parchís, the Spanish game. Two dice, safe squares, walls, bonus 20 and 10, three doubles costs your lead pawn. The full list is in the app under **How it plays**. |
| **Players** | Two. Red starts bottom-left, blue top-right. The board turns itself around so your own colour is always nearest you. |
| **Online** | The whole game is one Firestore document. Either phone can move on its turn, from anywhere, and pick the game back up hours later. |
| **Install** | Add to Home Screen on either phone. Own icon, full screen, no browser bars. |
| **Build step** | None. Plain ES modules, the same shape as the foos app. |

## The files

```
docs/                 what GitHub Pages serves
  index.html
  styles.css
  rules.js            the game itself, pure, no DOM and no network
  board.js            where all 68 squares are
  app.js              drawing, taps, and Firestore
  sw.js               offline shell
test/rules.test.mjs   22 tests, including 2000 games played end to end
scripts/              icon maker, dev server, board preview
firestore.rules       the one thing that has to be pasted by hand
```

`rules.js` knows nothing about the screen or the network, which is why the
rules can be tested on their own and why the board can be driven by a script.

## Working on it

```bash
npm test
```

```bash
node scripts/serve.mjs
```

Then <http://localhost:8099>. Add `?local=1` to play both sides on one device
with no network at all, which is the quickest way to try a rules change.

```bash
node scripts/make-icons.mjs
```

Redraws the home-screen icons. `node scripts/board-preview.mjs` redraws the
picture at the top of this file.

---

## It is live

**<https://scenicprints.github.io/parchis/>**

Already done, on 2026-07-29:

- Firestore rules published to **foos-6ecf3**, adding `/parchis/{doc}`
  alongside the league's own rule. See [`firestore.rules`](firestore.rules).
  Previous versions are kept in the console, so a rollback is one click.
- Repo pushed to `scenicprints/parchis`, Pages serving **main /docs**.
- Verified live: anonymous sign-in works, Firestore reads succeed, the
  manifest and all three icons serve, and the service worker registers.

### Put it on the two phones

- **iPhone:** open the link in **Safari**, Share, **Add to Home Screen**. It
  has to be Safari. Chrome on iOS cannot install a web app.
- **Android:** open in Chrome, menu, **Install app**.

First open on each phone asks for a name and a side. Whoever goes second gets
the side that is left. Both seats are still open.

### Deploying a change

Push to `main` and Pages rebuilds within a minute or so.

**Bump `?v=` when you do.** `index.html` links `styles.css?v=1` and
`app.js?v=1`. Raise the number on both when you change either, so no phone
keeps running yesterday's copy.

---

## Known gap

**No push notification when it is your turn.** The app shows a live board the
moment it is open, but it cannot tap you on the shoulder while it is closed.
Sending a push needs a server, which means Firebase Cloud Functions and putting
the project on the Blaze plan. Usage for two people stays inside the free
allowance, but it does want a card on file, so it is worth deciding on rather
than assuming.
