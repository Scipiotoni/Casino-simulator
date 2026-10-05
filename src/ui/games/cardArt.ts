import type { Card } from '../../items/types';
import { RANKS, isRed } from '../../items/cards';

/**
 * Real playing-card faces drawn as SVG (poker size, 200 × 280): corner indices top-left
 * and bottom-right, the traditional pip layouts for 2–10, a big ace, and double-headed
 * court cards (king with sword, queen with flower, jack with halberd) in the red, blue and
 * gold of a classic deck. The back is a red lattice with a white border. Suits are paths,
 * not font glyphs, so they look the same everywhere (no emoji hearts on phones).
 */

const RED = '#c8102e';
const BLACK = '#17151f';
const GOLD = '#e8b923';
const BLUE = '#1f4fbf';
const SKIN = '#f6d2a8';

/** Suit outlines in a 100 × 100 box (♠ ♥ ♦ ♣, matching SUITS). */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
export const SUIT_PATHS = [
  'M50 4C58 22 94 40 94 64C94 80 82 88 70 88C62 88 56 84 53 78C54 88 58 94 66 98L34 98C42 94 46 88 47 78C44 84 38 88 30 88C18 88 6 80 6 64C6 40 42 22 50 4Z',
  'M50 92C40 80 4 58 4 32C4 14 18 4 31 4C41 4 47 10 50 18C53 10 59 4 69 4C82 4 96 14 96 32C96 58 60 80 50 92Z',
  'M50 2C60 20 72 36 88 50C72 64 60 80 50 98C40 80 28 64 12 50C28 36 40 20 50 2Z',
  `${circle(50, 27, 21)}${circle(27, 60, 21)}${circle(73, 60, 21)}${circle(50, 52, 10)}M46 55C46 78 42 90 32 98L68 98C58 90 54 78 54 55Z`,
];

const suitColor = (c: Card) => (isRed(c) ? RED : BLACK);

/** One suit symbol of `size` centred on (x, y), upside down when `flip`. */
export function pip(suit: number, x: number, y: number, size: number, color: string, flip = false): string {
  return `<path d="${SUIT_PATHS[suit]}" fill="${color}" transform="translate(${x} ${y})${flip ? ' rotate(180)' : ''} scale(${size / 100}) translate(-50 -50)"/>`;
}

const L = 64;
const C = 100;
const R = 136;
/** Pip positions for 2–10 (x, y); pips below the middle are printed upside down. */
const PIPS: Record<number, [number, number][]> = {
  2: [[C, 56], [C, 224]],
  3: [[C, 56], [C, 140], [C, 224]],
  4: [[L, 56], [R, 56], [L, 224], [R, 224]],
  5: [[L, 56], [R, 56], [C, 140], [L, 224], [R, 224]],
  6: [[L, 56], [R, 56], [L, 140], [R, 140], [L, 224], [R, 224]],
  7: [[L, 56], [R, 56], [C, 98], [L, 140], [R, 140], [L, 224], [R, 224]],
  8: [[L, 56], [R, 56], [C, 98], [L, 140], [R, 140], [C, 182], [L, 224], [R, 224]],
  9: [[L, 56], [R, 56], [L, 112], [R, 112], [C, 140], [L, 168], [R, 168], [L, 224], [R, 224]],
  10: [[L, 56], [R, 56], [C, 84], [L, 112], [R, 112], [L, 168], [R, 168], [C, 196], [L, 224], [R, 224]],
};

function index(card: Card, color: string): string {
  const r = RANKS[card.rank];
  const ten = r === '10';
  return `<text x="21" y="44" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${ten ? 34 : 40}"${ten ? ' letter-spacing="-3"' : ''} fill="${color}">${r}</text>${pip(card.suit, 21, 64, 24, color)}`;
}

/** Robe colours for a court card's suit: body, sleeves, trim. */
const ROBES: [string, string, string][] = [
  [BLUE, RED, GOLD],
  [RED, BLUE, GOLD],
  [GOLD, RED, BLUE],
  [RED, GOLD, BLUE],
];

/** The top half of a court figure (the bottom half is the same, turned round). */
function courtHalf(card: Card, color: string): string {
  const [body, sleeve, trim] = ROBES[card.suit];
  const rank = card.rank; // 10 J, 11 Q, 12 K
  const parts: string[] = [];
  // What they hold, behind the shoulder.
  if (rank === 12) parts.push(`<path d="M127 140L133 58" stroke="#8c9aa8" stroke-width="4"/><path d="M121 98L141 101" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/><circle cx="133" cy="56" r="3" fill="${GOLD}"/>`);
  else if (rank === 11) parts.push(`<path d="M73 140C72 124 76 112 74 100" stroke="#2f8f45" stroke-width="3" fill="none"/><path d="M74 108c-8-2-10 4-10 4c6 2 10-4 10-4z" fill="#2f8f45"/>${[0, 72, 144, 216, 288].map((a) => `<circle cx="${74 + Math.cos((a * Math.PI) / 180) * 5}" cy="${96 + Math.sin((a * Math.PI) / 180) * 5}" r="4" fill="${RED}"/>`).join('')}<circle cx="74" cy="96" r="3" fill="${GOLD}"/>`);
  else parts.push(`<path d="M127 140L129 66" stroke="#7a4a2a" stroke-width="3"/><path d="M129 50C138 58 138 66 129 72C120 66 120 58 129 50Z" fill="#8c9aa8" stroke="${BLACK}" stroke-width="1"/>`);
  // Robe, sleeves, the gold placket and the collar.
  parts.push(
    `<path d="M62 140L64 108C66 100 76 96 86 94L114 94C124 96 134 100 136 108L138 140Z" fill="${body}" stroke="${BLACK}" stroke-width="1.2"/>`,
    `<path d="M62 140L64 110C68 106 74 104 80 106L82 140Z" fill="${sleeve}" stroke="${BLACK}" stroke-width="1.2"/>`,
    `<path d="M138 140L136 110C132 106 126 104 120 106L118 140Z" fill="${sleeve}" stroke="${BLACK}" stroke-width="1.2"/>`,
    `<rect x="92" y="98" width="16" height="42" fill="${trim}" stroke="${BLACK}" stroke-width="1"/>`,
    `<path d="M92 108l8 6l8-6M92 120l8 6l8-6M92 132l8 6l8-6" stroke="${BLACK}" stroke-width="1" fill="none"/>`,
    `<path d="M84 94C88 104 112 104 116 94Z" fill="#fffdf8" stroke="${BLACK}" stroke-width="1"/>`,
  );
  // Hair (and the king's beard), then the face.
  const hair = rank === 10 ? '#7a4a2a' : GOLD;
  parts.push(`<path d="M84 72C82 92 90 96 88 100L112 100C110 96 118 92 116 72Z" fill="${hair}" stroke="${BLACK}" stroke-width="1"/>`);
  parts.push(`<circle cx="100" cy="76" r="14" fill="${SKIN}" stroke="${BLACK}" stroke-width="1.2"/>`);
  if (rank === 12) parts.push(`<path d="M88 80C90 98 110 98 112 80C106 86 94 86 88 80Z" fill="${GOLD}" stroke="${BLACK}" stroke-width="1"/>`);
  parts.push(`<circle cx="95" cy="74" r="1.6" fill="${BLACK}"/><circle cx="105" cy="74" r="1.6" fill="${BLACK}"/><path d="M96 83Q100 85 104 83" stroke="${BLACK}" stroke-width="1" fill="none"/>`);
  // Crown or cap.
  if (rank === 12) parts.push(`<path d="M84 66L85 46L92 55L100 42L108 55L115 46L116 66Z" fill="${GOLD}" stroke="${BLACK}" stroke-width="1.2"/><circle cx="100" cy="58" r="3" fill="${RED}"/><circle cx="90" cy="61" r="2" fill="${BLUE}"/><circle cx="110" cy="61" r="2" fill="${BLUE}"/>`);
  else if (rank === 11) parts.push(`<path d="M86 66L87 54L114 54L114 66Z" fill="${GOLD}" stroke="${BLACK}" stroke-width="1.2"/><circle cx="89" cy="51" r="3" fill="${GOLD}" stroke="${BLACK}"/><circle cx="100" cy="48" r="3.5" fill="${GOLD}" stroke="${BLACK}"/><circle cx="111" cy="51" r="3" fill="${GOLD}" stroke="${BLACK}"/><circle cx="100" cy="60" r="2.5" fill="${RED}"/>`);
  else parts.push(`<path d="M83 68C82 54 96 48 112 52C120 54 120 62 117 68Z" fill="${RED}" stroke="${BLACK}" stroke-width="1.2"/><path d="M112 52C122 42 130 44 134 40" stroke="${GOLD}" stroke-width="3" fill="none"/>`);
  // The suit, up in the frame's corner.
  parts.push(pip(card.suit, 56, 48, 16, color));
  return parts.join('');
}

function face(card: Card): string {
  const color = suitColor(card);
  const parts: string[] = [];
  const idx = index(card, color);
  if (card.rank === 0) {
    parts.push(pip(card.suit, 100, 140, card.suit === 0 ? 112 : 84, color));
    if (card.suit === 0) parts.push(`<circle cx="100" cy="140" r="64" fill="none" stroke="${BLACK}" stroke-width="1.5" stroke-dasharray="2 4"/>`);
  } else if (card.rank <= 9) {
    for (const [x, y] of PIPS[card.rank + 1]) parts.push(pip(card.suit, x, y, 38, color, y > 140));
  } else {
    const half = courtHalf(card, color);
    parts.push(
      `<rect x="44" y="34" width="112" height="212" rx="4" fill="#fbf3dc" stroke="${color}" stroke-width="2"/>`,
      `<g>${half}</g><g transform="rotate(180 100 140)">${half}</g>`,
      `<path d="M45 150L155 130" stroke="${color}" stroke-width="1.5"/>`,
    );
  }
  return `<rect x="1" y="1" width="198" height="278" rx="13" fill="#fffdf8" stroke="#cfc8b8" stroke-width="2"/>${parts.join('')}${idx}<g transform="rotate(180 100 140)">${idx}</g>`;
}

/** Clip a line through the rectangle (for the lattice on the back). */
function latticeLines(x0: number, y0: number, x1: number, y1: number, step: number): string {
  let d = '';
  const w = x1 - x0;
  const h = y1 - y0;
  for (let k = -h; k <= w; k += step) {
    // x − y = k (down-right) and x + y = k′ (down-left), within the box.
    const a = { x: x0 + Math.max(k, 0), y: y0 + Math.max(-k, 0) };
    const len = Math.min(w - Math.max(k, 0), h - Math.max(-k, 0));
    if (len > 0) d += `M${a.x} ${a.y}l${len} ${len}`;
    const kk = k + h;
    const b = { x: x0 + Math.min(kk, w), y: y0 + Math.max(kk - w, 0) };
    const len2 = Math.min(b.x - x0, h - (b.y - y0));
    if (len2 > 0) d += `M${b.x} ${b.y}l${-len2} ${len2}`;
  }
  return d;
}

function back(): string {
  return `<rect x="1" y="1" width="198" height="278" rx="13" fill="#fffdf8" stroke="#cfc8b8" stroke-width="2"/>`
    + '<rect x="11" y="11" width="178" height="258" rx="7" fill="#a8152c"/>'
    + `<path d="${latticeLines(11, 11, 189, 269, 12)}" stroke="#f3c6cf" stroke-width="1.6" opacity=".55"/>`
    + '<rect x="18" y="18" width="164" height="244" rx="5" fill="none" stroke="#fffdf8" stroke-width="2.5"/>'
    + '<ellipse cx="100" cy="140" rx="38" ry="52" fill="#8f1024" stroke="#fffdf8" stroke-width="2.5"/>'
    + `<g opacity=".95">${pip(0, 100, 116, 20, '#fffdf8')}${pip(1, 82, 140, 20, '#fffdf8')}${pip(2, 118, 140, 20, '#fffdf8')}${pip(3, 100, 164, 20, '#fffdf8')}</g>`;
}

const cache = new Map<string, string>();

/** The SVG for a card face (or the back when `card` is null). */
export function cardSvg(card: Card | null): string {
  const key = card ? `${card.rank}-${card.suit}` : 'back';
  let s = cache.get(key);
  if (!s) {
    s = `<svg viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${card ? face(card) : back()}</svg>`;
    cache.set(key, s);
  }
  return s;
}
