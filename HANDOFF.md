# Handoff

Everything a fresh session needs to carry this on. Read this before touching
anything; most of what is below was learned the hard way.

---

## What it is

A two-player game hub for Kevin and his wife (Ado), built as an installable
web app so it works on his Android and her iPhone with no app store.

- **Live:** <https://scenicprints.github.io/parchis/>
- **Repo:** `scenicprints/parchis` (public), GitHub Pages serving `main` `/docs`
- **Local:** `C:\Users\jkevi\parchis`
- **Backend:** Firebase project **foos-6ecf3**, shared with his foos league app.
  Anonymous auth. **Spark (free) plan.**

Parchís was the whole app; as of the hub overhaul it is the first game in it.
The URL and documents deliberately still say `parchis` — renaming them would
have cost a migration and a Firestore rules change for nothing.

## Decisions already made, do not relitigate

- Installable web app, **not** native. He rejected TestFlight to avoid the
  Apple developer account and the 90 day build expiry.
- **One game at a time.** Starting another asks before abandoning the current.
- Same URL. The hub took over the existing address rather than moving.
- In a two-handed Parchís game the **two unused corners stay empty**. His call.
  Do not fill them with score, log or dice.
- The Parchís board is a **printed white board**: white paper, one ink colour
  ruling every square, solid colour yards. Two earlier attempts failed by
  adjusting overall brightness when the problem was contrast between parts.

---

## Layout

```
docs/
  index.html            the shell: lobby screen, game screen, seat picker
  hub.js                identity, seats, Firestore, record, house rules,
                        lobby, which game is open
  ui.js                 the bottom sheet and its rows, borrowed by any game
  styles.css            shell + shared furniture + Parchís board styles
  sw.js                 offline shell, and the update path
  games/
    index.js            the registry: one import, one array entry
    parchis/
      rules.js          pure engine, no DOM and no network
      board.js          where all 68 squares physically sit
      view.js           draws the board, takes the taps
test/rules.test.mjs     22 tests over the engine, incl. a 2000 game fuzz run
scripts/serve.mjs       dev server on :8099, plus POST /shot/<name>
scripts/make-icons.mjs  redraws the home screen icons
firestore.rules         what is actually published
```

## The game module contract

A game is one default export. It never learns that a network exists.

```js
export default {
  id: 'parchis',
  title: 'Parchís',
  blurb: 'Four pawns each, two dice, and a long way round.',
  boardRev: 2,              // bump to force a redeal when the board changes
  deal(prev),               // -> a fresh state object
  mount(handle),            // -> { update(state, ctx), waitingOn(state), destroy() }
};
```

`handle` from the hub: `{ local, uid, settings(), setSettings(patch),
commit(state), deal(), hubRows(inner, close) }`.

`update(state, ctx)` is called with every board that arrives, the game's own
writes and the other phone's alike. `ctx` is `{ table, me }`.

The hub puts up the frame and hands the game an empty `#game-stage` and
`#game-panel` to fill however it likes. The hub owns `#seatbar`, `#score`,
`#btn-back` and `#btn-menu`. **The frame is rebuilt on every open**, so no
listener from the last game can still be attached to a button in this one.

Adding a game: a folder under `docs/games/`, a line in `games/index.js`, and
its files added to `SHELL` in `sw.js`.

## Data

Two documents, both in the `parchis` collection:

- **`parchis/table`** — `seats` (red/blue, each `{uid, name}`), `record`
  (combined), `byGame`, `settings` (per game id), `score` (legacy Parchís
  tally, still written so an old client shows the right number), `lastScored`
- **`parchis/game`** — the live board plus `kind` (which game) and `id`

`?room=<name>` suffixes both document ids. That is how you break things on
purpose without touching the live game.

Firestore rules (already published):

```
match /parchis/{doc} {
  allow read, write: if request.auth != null;
}
```

---

## Traps

Each of these cost real time. They are all still live hazards.

**Never use PowerShell `Get-Content`/`Set-Content` on source files.**
Windows PowerShell 5.1 reads UTF-8 as ANSI and silently mangles every
accented and box-drawing character. Use Node, or the Write/Edit tools.

**Do not verify visuals by re-rendering the SVG yourself.** Cloning the board
element and rasterising it looks like a screenshot and is not one. Doing that
hid a serious bug for three deploys. Drive real headless Chrome instead:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu
  --hide-scrollbars --user-data-dir=<temp> --window-size=390,844
  --virtual-time-budget=9000 --screenshot=<out.png> <url>
```

**But do not trust that image for layout either.** It renders some pages at
the wrong width and crops them, which twice looked exactly like content being
cut off. For anything about size or overflow, measure:
`getBoundingClientRect()` and `documentElement.scrollWidth` are the truth.

**The in-app Browser pane cannot take screenshots here** — it does not
composite, so `computer{action:"screenshot"}` times out. It is still the best
tool for driving and measuring a page.

**Android Chrome auto-darkens pages it judges to be light**, inverting the
white board into a near-black negative while leaving saturated colours alone.
`<meta name="color-scheme">` and `color-scheme: dark` in the CSS opt out of
it. Do not remove either. Reproduce with `--enable-features=WebContentsForceDark`.

**`?local=1` skips the network entirely.** Every bug that reached him in the
seat and sync paths got there because everything was tested with that flag on.
Use `?room=<name>` to exercise the real thing safely.

**Two clients, for anything about syncing.** `http://localhost:8099` and the
live site are different origins, so they get different anonymous identities
and separate caches. That is a working stand-in for two phones.

**Deploys.** Bump `?v=` on both links in `index.html` every time, and bump
`CACHE` in `sw.js` whenever `SHELL` changes. The page is fetched with
`no-store` and reloads itself on `controllerchange`; without both of those a
deploy sat invisible and the phone stayed a version behind.

**Do not write to `parchis/table` or `parchis/game` while testing.** That is
their live game.

## Load-bearing code, do not casually undo

- `booted()` must stay null-safe. It removes the splash 400ms after its first
  call and is called again on every seat and board change; reading through the
  null threw before `render()` and caused three separate reported symptoms.
- `walkPawn()` must keep its `try/finally`. A throw mid-animation used to
  leave `walking` set forever, and `applyMove` refuses to start while it is.
- `applyMove()` captures `base = game` before the walk and drops the move if
  `moved(base, game)`. Compared by value, not identity: every snapshot is a
  fresh object, including the echo of this device's own write.
- Markers are appended **after** pawns so a destination on an occupied square
  is tappable. Their hit radius (0.62) must stay well under 1.0 or they start
  eating taps meant for the piece on the next square.
- A taken seat must stay **pressable**. Seats are held by an anonymous id that
  does not survive a reinstall, and disabling them locked him out of his own
  game with no way back.
- Board geometry: 68 = 8 lanes × 8 + 4 arm tips. `ENTRY` and `TURN_IN` are
  stated outright rather than derived; the crossing is 63 squares, not 68.

## Testing

```bash
npm test                       # 22 engine tests, incl. 2000 fuzzed games
node scripts/serve.mjs         # dev server on :8099
```

`http://localhost:8099/?local=1` plays both sides with no network.
The fuzz test is what catches turn-machine deadlocks; run it after any rules
change. It takes ~10s idle, much longer if browser drivers are running.

---

## Open

- **Card games need hidden information solved first.** Any signed-in client
  can read the whole game document, so a hand would be visible to the other
  player. That is a rules and data-shape problem, not a UI one.
- **Push notifications** need Cloud Functions, which needs the **Blaze** plan
  on a project shared with his foos data. His call, still undecided. The
  in-app "Your move" badge is as far as it goes without it.
- **Four players with computers is lightly tested.** He plays it; it has never
  been exercised properly.
- The home screen icon is still a Parchís board and the app is now called
  "Games". Cosmetic, and only changes on a reinstall.

## How he works

- Read the source before answering. Do not guess at behaviour.
- **No emdashes.** Commas or periods.
- Big batched updates, not a stream of small ones.
- Do not over-explain after a correction. Fix it and move on.
- Never push without an explicit go-ahead.
- When he says something looks wrong, believe him and go and look properly.
  Every time it was dismissed as caching, it was a real bug underneath.
