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

Two games so far: **Parchís** and **Schieber Jass**.

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
- Jass is **Schieber for four**, him and a computer partner against her and
  hers. Not one of the two-handed Jass variants. His call, made against the
  alternative of a heads-up game with no computer in it.
- **Jass hands ride in the game document** and the screen simply does not
  draw the other three. This is a decision, not an oversight: the private
  documents plus a Firestore rules change were on the table and he chose
  against them. Seeing another hand takes deliberately opening devtools.
- Jass cards are the **Swiss German pack**: bells, shields, acorns, roses,
  with Ober, Under and Banner. Not French suits.

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
    jass/
      cards.js          the 36 card pack, and how a card is drawn
      rules.js          pure engine: contracts, tricks, Weis, Stöck, scoring
      bot.js            the two computer seats, pure and with no randomness
      view.js           draws the table, takes the taps
test/rules.test.mjs     22 tests over Parchís, incl. a 2000 game fuzz run
test/jass.test.mjs      30 tests over Jass, incl. 400 computer-played sessions
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
and separate caches. That is a working stand-in for two phones. So is
running the dev server twice on two ports: `8099` and `8111` are different
origins to Firebase and get an anonymous id each, which lets both sides be
driven from one script without deploying anything.

**Headless Chrome throttles timers in a background tab**, to once a second
and then, after a few minutes, to once a minute. Anything driven by
`setTimeout` looks completely stuck. Two tabs means one of them is always in
the background, so a two-client test needs
`--disable-background-timer-throttling --disable-backgrounding-occluded-windows
--disable-renderer-backgrounding` or it is measuring Chrome and not the app.
This cost most of an afternoon, and twice looked exactly like a sync bug.

The real phone does the same thing when the screen goes off, which is why no
game logic may sit behind a timer holding a flag. See the note on the Jass
scheduler below.

**Deploys.** Bump `?v=` on both links in `index.html` every time, and bump
`CACHE` in `sw.js` whenever `SHELL` changes. The page is fetched with
`no-store` and reloads itself on `controllerchange`; without both of those a
deploy sat invisible and the phone stayed a version behind.

**Do not write to `parchis/table` or `parchis/game` while testing.** That is
their live game.

**On one device the hub never calls `update()`.** `commit()` returns early
when `LOCAL`, so nothing echoes back and `update()` only fires when a game
is dealt. Anything hung off `update()` alone therefore does not happen at
all in `?local=1`, which is exactly where a change gets tried first. Jass
routes both the boards it works out itself and the boards off the wire
through one `adopt()` for this reason.

**`classList.add('')` throws**, and a throw inside `render()` takes the
whole screen with it. `add(cond ? 'x' : '')` is the shape that does it.

## Load-bearing code, do not casually undo

- **`saveSettings` applies the change here as well as sending it.** A game
  almost always deals a fresh board the moment it changes a house rule, and
  the snapshot carrying the new rule back has not arrived by then, so
  `settings()` would hand back the old one and the board would be dealt to
  it. "Change the players, start again" quietly started again with the old
  players. Parchís had this too; it only ever showed up online.
- **A settings row that toggles on tap is not a setting.** Jass shipped with
  Players, Computer skill and Game to as rows that silently flipped to the
  other value when pressed, so there was no way to see the choices, or what
  you were about to change to, before it had changed. They are sheets of
  options now with the current one marked, the way Parchís does Players.
  Same for anything added later.
- **A hand has five moments that have to be said out loud**, and none of
  them were: the contract being named, anybody's Weis, a Stöck, a trick
  going to whoever took it, and who took the hand. They all existed only as
  one line of grey text under the cards, which is not where anybody looks.
  Now: a banner across the middle of the table for the first three and the
  last, the four cards of a finished trick sliding to the seat that took
  them, and a headline over the scoreboard. He reported this after playing
  a whole game, so treat any new game the same way: work out where the
  moments are before shipping, not after.
- **Stöck is announced when both its cards have actually been played**, not
  when the trump is named. The engine knows the holder from the moment the
  contract is chosen and it is sat there in the game document, but saying
  so early tells the other side something they have not earned.
- **Say what is trumps on the cards, not only on the table.** A badge in the
  corner of the table naming a suit is no use until you already know which
  drawing "bells" means, and the whole point of the Swiss pack is that he is
  learning it. So there is a bar directly above the hand with the sign at a
  readable size, and every trump in the hand is banded gold along its bottom
  edge, which is the one part of a card in a fan the next card never covers.
  With no trump the bar carries more weight, not less: obenabe and undenufe
  differ only in which end of the pack wins.
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

### Jass in particular

- **Seating order is `red, blue, green, yellow` and that is why it works.**
  Partners sit two apart, so the partnerships are red+green and blue+yellow,
  and the two seats a person can take end up as opponents. Reorder that list
  and Kev and Ado become partners. Parchís uses a different order for its
  own reasons; the two are not interchangeable.
- A partnership is **named for the human seat in it**, so `winner` is
  already the `'red'` or `'blue'` the hub records a point against.
- **`iAct(seat)` decides which phone moves the game on**, for the computer's
  turns and for sweeping up a finished trick alike. A trick is swept by the
  device of whoever won it; the computer is driven by the seat earliest in
  turn order. Two phones both doing it writes the same move twice and one of
  them lands on top of a turn that has already moved past it.
- **`schedule()` / `step()` must stay one timer at a time, and must not hold
  a flag.** The first version was a loop that set `busy = true`, awaited a
  string of sleeps while the computer played, and cleared it at the end.
  Anything that stopped that loop finishing left `busy` set, and `busy`
  blocked every tap: the game froze with no way out. A backgrounded phone
  does exactly that, because its timers get clamped to once a minute, so
  picking the phone up mid-hand would have found the cards dead. Now one
  step is scheduled at a time, stamped with `game.rev`; if it fires against
  a board that has moved on, it drops itself and looks again. Nothing is
  held open, so nothing can be left open. Do not reintroduce a flag.
- `commit()` **fires the Firestore write without awaiting it**. Firestore's
  own cache has already taken it and echoes it straight back, and awaiting
  it puts the whole turn machine behind a server round trip on whatever
  signal the phone has. Parchís now does the same, for the same reason: its
  `botTurn` held `thinking` set for the length of the write, and `thinking`
  locks the board.
- A finished trick **stays on the table** in its own `gather` phase rather
  than being swept the instant the fourth card lands. Without that the other
  phone gets the next board and never sees the trick it just lost.
- **A card's rank and suit both live in the strip down its left edge.** Nine
  cards on a phone overlap to about 36 of their 58 pixels, so anything in
  the far corner is under the next card. Putting the suit top right, the way
  a French pack does, made a hand read as nine bare letters.
- `weisIn` counts sequences down the pack's own order, **A K O U B 9 8 7 6**,
  whatever the contract is doing to the ranking. In undenufe the six beats
  the seven in a trick and still sits at the bottom of a run.
- The `dealt` copy of the hands is kept alongside the live ones because Weis
  and Stöck are about what you were dealt, not what you are still holding.

## Testing

```bash
npm test                       # both engines: 52 tests
npm run test:jass              # Jass only, about two minutes
node scripts/serve.mjs 8099    # dev server, port optional
```

`http://localhost:8099/?local=1` plays every side with no network.

Both fuzz runs are what catch turn-machine deadlocks; run them after any
rules change. Parchís plays 2000 games, Jass plays 400 whole sessions with
the computer holding all four hands, checking after every hand that the pack
still comes to 157 and that the slate moved by what the hand said. Together
they take five to ten minutes on his laptop, much longer with browser
drivers running.

`node --test test/` does **not** work here: it reads the directory as a file
name and fails with MODULE_NOT_FOUND. The script names both files outright.

---

## Open

- **Hidden information is decided, not solved.** All four Jass hands sit in
  `parchis/game` and the screen draws only your own. Anybody who opens
  devtools can read the other three. The alternative was a hand per seat in
  its own document with a Firestore rules change to match, and he chose
  against it. Do not "fix" this without asking; and if it ever does get
  fixed, note that a computer partner's cards have to be readable by
  whichever phone is driving it, so private documents alone would not have
  made a four-handed game airtight either.
- **The Jass computer is competent, not good.** It counts what has been
  played, knows when its partner is safe and feeds them points, and picks a
  contract by what the hand projects times the multiplier. It does not plan
  a hand out. Hard beats Easy in 196 of 200 matches, averaging 1213 to 538,
  so the heuristics are doing real work rather than shuffling legal cards;
  that says nothing about whether it is any good against a person. If he
  says the partner played something stupid, that is a real report about
  `bot.js` and not about the rules, and it wants the position it happened
  in, not a general tune-up.
- **Push notifications** need Cloud Functions, which needs the **Blaze** plan
  on a project shared with his foos data. His call, still undecided. The
  in-app "Your move" badge is as far as it goes without it.
- **Four players with computers is lightly tested.** He plays it. It has now
  been driven through a thousand presses in a real browser without locking
  up, which is not the same as anybody enjoying it.
- The home screen icon is three fanned cards with a red and a blue token.
  It **only changes when the app is added to the home screen again**, so a
  phone that already has the old board tile keeps it until it is reinstalled.

## How he works

- Read the source before answering. Do not guess at behaviour.
- **No emdashes.** Commas or periods.
- Big batched updates, not a stream of small ones.
- Do not over-explain after a correction. Fix it and move on.
- Never push without an explicit go-ahead.
- When he says something looks wrong, believe him and go and look properly.
  Every time it was dismissed as caching, it was a real bug underneath.
