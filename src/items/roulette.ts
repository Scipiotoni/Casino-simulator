/**
 * Single-zero (European) roulette, every bet on the layout: straight ups, splits, streets,
 * corners, six lines, the zero trios and first four, then the outside bets. Every bet pays
 * 36 / (numbers covered) − 1 to 1, so all of them share the same 2.7% edge; with la
 * partage the even-money bets lose only half on zero (1.35%).
 *
 * The layout is three rows of twelve columns: column c, row r (0 = top) holds the number
 * 3c + 3 − r, so 3, 6 … 36 run along the top and 1, 4 … 34 along the bottom.
 */

export type SpotKind =
  | 'straight' | 'split' | 'street' | 'trio' | 'corner' | 'firstFour' | 'line'
  | 'column' | 'dozen' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high';

export interface RouletteSpot {
  id: string;
  kind: SpotKind;
  numbers: number[];
  label: string;
}

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** The numbers in wheel order, clockwise from zero. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export function numberAt(col: number, row: number): number {
  return col * 3 + 3 - row;
}

const EVEN_MONEY: SpotKind[] = ['red', 'black', 'odd', 'even', 'low', 'high'];

/** What a spot pays, to 1. */
export function spotPays(spot: RouletteSpot): number {
  return 36 / spot.numbers.length - 1;
}

/**
 * Everything handed back (stake included) for `amount` on `spot` when `n` comes up. With
 * la partage an even-money bet gets half back on zero.
 */
export function rouletteReturn(spot: RouletteSpot, amount: number, n: number, laPartage = true): number {
  if (spot.numbers.includes(n)) return amount * (spotPays(spot) + 1);
  if (n === 0 && laPartage && EVEN_MONEY.includes(spot.kind)) return amount / 2;
  return 0;
}

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const idFor = (kind: SpotKind, nums: number[]) => `${kind}:${sorted(nums).join('-')}`;

function make(kind: SpotKind, numbers: number[], label?: string): RouletteSpot {
  const ns = sorted(numbers);
  return { id: idFor(kind, ns), kind, numbers: ns, label: label ?? ns.join('/') };
}

let cache: RouletteSpot[] | null = null;

/** Every bet you can make on the layout. */
export function rouletteSpots(): RouletteSpot[] {
  if (cache) return cache;
  const out: RouletteSpot[] = [];
  for (let n = 0; n <= 36; n++) out.push(make('straight', [n], String(n)));
  // Splits: side by side along a row (n, n+3), and up and down a column (n, n+1).
  for (let n = 1; n <= 33; n++) out.push(make('split', [n, n + 3]));
  for (let n = 1; n <= 35; n++) if (n % 3 !== 0) out.push(make('split', [n, n + 1]));
  out.push(make('split', [0, 1]), make('split', [0, 2]), make('split', [0, 3]));
  for (let c = 0; c < 12; c++) out.push(make('street', [3 * c + 1, 3 * c + 2, 3 * c + 3]));
  out.push(make('trio', [0, 1, 2]), make('trio', [0, 2, 3]));
  for (let n = 1; n <= 32; n++) if (n % 3 !== 0) out.push(make('corner', [n, n + 1, n + 3, n + 4]));
  out.push(make('firstFour', [0, 1, 2, 3], 'First four'));
  for (let c = 0; c < 11; c++) out.push(make('line', [1, 2, 3, 4, 5, 6].map((k) => 3 * c + k)));
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  for (let k = 1; k <= 3; k++) out.push({ ...make('column', range(1, 36).filter((n) => n % 3 === k % 3)), id: `column:${k}`, label: '2 to 1' });
  for (let d = 0; d < 3; d++) out.push({ ...make('dozen', range(d * 12 + 1, d * 12 + 12)), id: `dozen:${d + 1}`, label: ['1st 12', '2nd 12', '3rd 12'][d] });
  out.push(
    { ...make('low', range(1, 18)), id: 'low', label: '1 to 18' },
    { ...make('even', range(1, 36).filter((n) => n % 2 === 0)), id: 'even', label: 'EVEN' },
    { ...make('red', [...RED_NUMBERS]), id: 'red', label: 'RED' },
    { ...make('black', range(1, 36).filter((n) => !RED_NUMBERS.has(n))), id: 'black', label: 'BLACK' },
    { ...make('odd', range(1, 36).filter((n) => n % 2 === 1)), id: 'odd', label: 'ODD' },
    { ...make('high', range(19, 36)), id: 'high', label: '19 to 36' },
  );
  cache = out;
  return out;
}

const byId = new Map<string, RouletteSpot>();
export function spotById(id: string): RouletteSpot | undefined {
  if (!byId.size) for (const s of rouletteSpots()) byId.set(s.id, s);
  return byId.get(id);
}

/** The inside bet covering exactly these numbers (a split, corner, street…). */
export function spotFor(kind: SpotKind, numbers: number[]): RouletteSpot | undefined {
  return spotById(idFor(kind, numbers));
}

/**
 * The French "call bets" on the racetrack, each a set of chips (units) on ordinary spots:
 * Voisins du zéro (9 chips, the 17 numbers round zero), Tiers du cylindre (6 chips, the
 * third of the wheel opposite), Orphelins (5 chips, the orphans in between) and Jeu zéro
 * (4 chips, the 7 numbers nearest zero).
 */
export const CALL_BETS: { id: string; name: string; chips: [SpotKind, number[], number][] }[] = [
  {
    id: 'voisins', name: 'Voisins du zéro',
    chips: [['trio', [0, 2, 3], 2], ['split', [4, 7], 1], ['split', [12, 15], 1], ['split', [18, 21], 1], ['split', [19, 22], 1], ['split', [32, 35], 1], ['corner', [25, 26, 28, 29], 2]],
  },
  {
    id: 'tiers', name: 'Tiers du cylindre',
    chips: [['split', [5, 8], 1], ['split', [10, 11], 1], ['split', [13, 16], 1], ['split', [23, 24], 1], ['split', [27, 30], 1], ['split', [33, 36], 1]],
  },
  {
    id: 'orphelins', name: 'Orphelins',
    chips: [['straight', [1], 1], ['split', [6, 9], 1], ['split', [14, 17], 1], ['split', [17, 20], 1], ['split', [31, 34], 1]],
  },
  {
    id: 'jeu0', name: 'Jeu zéro',
    chips: [['split', [0, 3], 1], ['split', [12, 15], 1], ['straight', [26], 1], ['split', [32, 35], 1]],
  },
];

/** A number and its `k` neighbours either side on the wheel ("5 and the neighbours"). */
export function neighbours(n: number, k = 2): number[] {
  const i = WHEEL_ORDER.indexOf(n);
  const out: number[] = [];
  for (let d = -k; d <= k; d++) out.push(WHEEL_ORDER[(i + d + WHEEL_ORDER.length) % WHEEL_ORDER.length]);
  return out;
}
