// ═══════════════════════════════════════════════════════════════════════
//  THE JASS PACK — thirty-six cards, and how they are drawn.
//
//  A card is one small integer, 0–35, so a whole hand is nine numbers and
//  the game document stays flat. suit = card / 9, rank = card % 9.
//
//  Swiss German pack: Schellen (bells), Schilten (shields), Eicheln
//  (acorns), Rosen (roses). Nine to a suit: Ass, König, Ober, Under,
//  Banner, 9, 8, 7, 6. That order is also the order sequences are counted
//  in, whatever the contract, so a rank's index is its place in a sequence.
//
//  Nothing in here knows the rules. It knows what a card is and what it
//  looks like, and rules.js decides what it is worth today.
// ═══════════════════════════════════════════════════════════════════════

export const SUITS = ['schellen', 'schilten', 'eicheln', 'rosen'];
export const RANKS = ['A', 'K', 'O', 'U', 'B', '9', '8', '7', '6'];

export const DECK_SIZE = 36;

export const suitOf = (c) => (c / 9) | 0;
export const rankOf = (c) => c % 9;
export const cardOf = (suit, rank) => suit * 9 + rank;

// The whole pack, in order, which is only ever used as something to shuffle.
export const DECK = Array.from({ length: DECK_SIZE }, (_, i) => i);

// Rank indices worth naming, because the rules single them out.
export const ASS = 0;
export const KONIG = 1;
export const OBER = 2;
export const UNDER = 3;      // the Puur, when it is trumps
export const BANNER = 4;
export const NELL = 5;       // the nine, worth 14 when it is trumps
export const ACHT = 6;
export const SIEBEN = 7;
export const SECHS = 8;

// The seven of roses. Whoever holds it deals with being forehand on the
// very first hand of a session, which is how a Swiss table settles who
// starts without anybody drawing for it.
export const SIEBEN_ROSEN = cardOf(3, SIEBEN);

// ── Names, for the log and for anything read aloud ────────────────────

export const SUIT_NAME = {
  schellen: 'Bells',
  schilten: 'Shields',
  eicheln: 'Acorns',
  rosen: 'Roses',
};

// What the corner of the card says. The picture cards say their name on a
// real pack; here the letter does that job and the drawing carries the rest.
export const RANK_LABEL = ['A', 'K', 'O', 'U', 'B', '9', '8', '7', '6'];

export const RANK_NAME = ['Ass', 'König', 'Ober', 'Under', 'Banner', 'Nine', 'Eight', 'Seven', 'Six'];

export const cardName = (c) => `${RANK_NAME[rankOf(c)]} of ${SUIT_NAME[SUITS[suitOf(c)]]}`;

// ═══════════════════════════════════════════════════════════════════════
//  The four suit signs
// ═══════════════════════════════════════════════════════════════════════

// Each is drawn inside a 100×100 box and scaled wherever it is needed, so
// the same drawing serves a card face, a trump badge and a contract button.
// Two colours each: the body, and a darker line that gives it an edge at
// the size a phone actually shows it.

export const SUIT_INK = {
  schellen: '#E3A32B',
  schilten: '#3E7CC4',
  eicheln:  '#8A6136',
  rosen:    '#D0434F',
};

const SUIT_EDGE = {
  schellen: '#8E5D0C',
  schilten: '#1D4275',
  eicheln:  '#4B3319',
  rosen:    '#7C1F2A',
};

// A bell: shoulders, a flared skirt, and the clapper hanging below it.
const BELL = `
  <path d="M50 10c-3.4 0-6 2.2-6 4.9v3.6C31 22.4 22.6 33.6 22.6 47.4c0 13.4-2.2 22-6.6 27.4-2.3 2.8-1 6.2 2.8 6.2h62.4c3.8 0 5.1-3.4 2.8-6.2-4.4-5.4-6.6-14-6.6-27.4C77.4 33.6 69 22.4 56 18.5v-3.6c0-2.7-2.6-4.9-6-4.9z"/>
  <circle cx="50" cy="88" r="7.4"/>`;

// A heater shield, with a band across it so it still reads as a shield
// when it is only twelve pixels wide.
const SHIELD = `
  <path d="M50 8l38 11v29c0 23.5-16.4 36.6-38 44.9C28.4 84.6 12 71.5 12 48V19z"/>
  <path d="M14.5 44h71v7.5h-71z" opacity=".55"/>`;

// An acorn: the nut, and a hatched cap sitting over it with a short stalk.
const ACORN = `
  <path d="M50 95c-15.6 0-26.4-13.4-26.4-30.6 0-11.4 4.6-21 11-25.4h30.8c6.4 4.4 11 14 11 25.4C76.4 81.6 65.6 95 50 95z"/>
  <path d="M50 14c16.2 0 28.6 10.4 28.6 20.4 0 3.4-2.4 5.6-6.4 5.6H27.8c-4 0-6.4-2.2-6.4-5.6C21.4 24.4 33.8 14 50 14z"/>
  <path d="M46.6 5h6.8v11h-6.8z"/>`;

// A rose seen face on: six petals and a heart.
function rose() {
  let petals = '';
  for (let i = 0; i < 6; i++) {
    petals += `<ellipse cx="50" cy="27" rx="15.5" ry="21" transform="rotate(${i * 60} 50 50)"/>`;
  }
  return `${petals}<circle cx="50" cy="50" r="12.5" opacity=".62"/>`;
}

const SUIT_BODY = {
  schellen: BELL,
  schilten: SHIELD,
  eicheln: ACORN,
  rosen: rose(),
};

// The sign on its own, as markup that can be dropped anywhere. `size` is in
// px; the drawing is centred in a square of that side.
export function suitMark(suit, size, extra = '') {
  return `<svg class="suitmark" width="${size}" height="${size}" viewBox="0 0 100 100"
    aria-hidden="true" ${extra}><g fill="${SUIT_INK[suit]}" stroke="${SUIT_EDGE[suit]}"
    stroke-width="4" stroke-linejoin="round">${SUIT_BODY[suit]}</g></svg>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  A card face
// ═══════════════════════════════════════════════════════════════════════

// The two cards a Swiss pack is famous for confusing are the Ass and the
// Banner: both carry two suit signs. So they are drawn as differently as
// the pack itself draws them. The Ass gets its pair of signs standing free,
// and the Banner gets a flag on a pole with the signs on the cloth. At the
// size a hand of nine takes on a phone, that difference has to be the
// silhouette, not a detail.

const CROWN = `<path d="M6 74V16l17 15 15-25 15 25 17-15v58z" fill="#E9C45C" stroke="#8C6614"
  stroke-width="6" stroke-linejoin="round"/>
  <path d="M6 62h64" stroke="#8C6614" stroke-width="5"/>`;

// The whole card, as an <svg> string, drawn in a 60 by 88 box and scaled
// from there.
//
// The layout is decided by how a hand of nine is actually held: they
// overlap, and all you can see of the ones underneath is a strip down the
// left. So the rank AND the suit both live in that strip, one above the
// other, and the picture stays clear of it. Putting the suit sign in the
// far corner, the way a French pack does, hid it under the next card.
const COL = 17;          // the strip that stays visible when cards overlap
const ART = { x: COL + 3, y: 20, w: 60 - COL - 6, h: 60 };

export function cardFace(card, { w = 60 } = {}) {
  const suit = SUITS[suitOf(card)];
  const rank = rankOf(card);
  const h = Math.round(w * 88 / 60);
  const ink = SUIT_INK[suit];
  const edge = SUIT_EDGE[suit];

  // One suit sign, `s` across, with its top left corner at (x, y).
  const sign = (x, y, s) =>
    `<g transform="translate(${x} ${y}) scale(${s / 100})" fill="${ink}" stroke="${edge}"
       stroke-width="5" stroke-linejoin="round">${SUIT_BODY[suit]}</g>`;

  const mid = ART.x + ART.w / 2;

  let art = '';
  if (rank === ASS) {
    // Two signs standing free. That pair is what makes it an Ass, and it is
    // the only thing that tells it apart from the Banner at arm's length,
    // so the Banner puts its pair on a flag instead.
    art = sign(ART.x, 23, 24) + sign(ART.x + 13, 43, 24);
  } else if (rank === BANNER) {
    art = `
      <path d="M${ART.x + 2} 21v58" stroke="#B9A77F" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M${ART.x + 3} 23h33l-7 12 7 12h-33z" fill="#FBF7EC" stroke="#A2926F"
        stroke-width="2.6" stroke-linejoin="round"/>
      ${sign(ART.x + 6, 27, 13)}${sign(ART.x + 19, 27, 13)}`;
  } else if (rank === KONIG) {
    art = `<g transform="translate(${ART.x + 1} 22) scale(.30)">${CROWN}</g>`
      + sign(mid - 11, 48, 22);
  } else if (rank === OBER) {
    // On a real pack the Ober wears its suit sign above the figure and the
    // Under wears it below. High and low is the whole difference, so that
    // is the whole difference here.
    art = sign(mid - 13, 21, 26)
      + `<path d="M${mid - 12} 58h24" stroke="${edge}" stroke-width="3.4" stroke-linecap="round"/>
         <path d="M${mid - 8} 65h16" stroke="${edge}" stroke-width="3.4" stroke-linecap="round"
           opacity=".5"/>`;
  } else if (rank === UNDER) {
    art = `<path d="M${mid - 12} 26h24" stroke="${edge}" stroke-width="3.4" stroke-linecap="round"/>
           <path d="M${mid - 8} 33h16" stroke="${edge}" stroke-width="3.4" stroke-linecap="round"
             opacity=".5"/>`
      + sign(mid - 13, 42, 26);
  } else {
    // 9, 8, 7, 6: the numeral does the work, with one sign beneath it.
    art = `<text x="${mid}" y="47" text-anchor="middle" font-size="30" font-weight="800"
      fill="${ink}" stroke="${edge}" stroke-width="1.2"
      font-family="ui-rounded, system-ui, sans-serif">${RANK_LABEL[rank]}</text>`
      + sign(mid - 11, 53, 22);
  }

  return `<svg class="cardface" width="${w}" height="${h}" viewBox="0 0 60 88"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${cardName(card)}">
    <rect x="1" y="1" width="58" height="86" rx="6" fill="#F7F2E6" stroke="#171C24"
      stroke-width="2"/>
    ${art}
    <text x="9" y="20" text-anchor="middle" font-size="17" font-weight="900" fill="${edge}"
      font-family="ui-rounded, system-ui, sans-serif">${RANK_LABEL[rank]}</text>
    <g transform="translate(2.5 24) scale(.13)" fill="${ink}" stroke="${edge}"
      stroke-width="11" stroke-linejoin="round">${SUIT_BODY[suit]}</g>
  </svg>`;
}

// The back. One deck, so one back, and it must not read as any seat's
// colour or a face-down fan starts looking like it belongs to somebody.
//
// The pattern repeats across the whole card on purpose. A fan of nine shows
// nothing of the ones underneath but a strip down the left, and a single
// motif in the middle leaves those strips looking like eight blank slivers
// with one real card on the end.
const LATTICE = (() => {
  let out = '';
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 11 + col * 13 + (row % 2 ? 6.5 : 0);
      const y = 12 + row * 13;
      if (x > 52) continue;
      out += `<path d="M${x} ${y - 4}l4 4-4 4-4-4z"/>`;
    }
  }
  return out;
})();

export function cardBack({ w = 60 } = {}) {
  const h = Math.round(w * 88 / 60);
  return `<svg class="cardface back" width="${w}" height="${h}" viewBox="0 0 60 88"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1" y="1" width="58" height="86" rx="6" fill="#1B2331" stroke="#0B0F15"
      stroke-width="2"/>
    <g fill="#D6A93B" opacity=".28">${LATTICE}</g>
    <rect x="5" y="5" width="50" height="78" rx="3.5" fill="none" stroke="#D6A93B"
      stroke-width="1.3" opacity=".5"/>
  </svg>`;
}
