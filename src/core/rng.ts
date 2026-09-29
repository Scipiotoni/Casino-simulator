export function rand(min = 0, max = 1): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1] ?? null;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Standard normal sample (Box-Muller). */
export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal-ish amount centered around `median`. */
export function skewed(median: number, spread = 0.5): number {
  return median * Math.exp(gaussian() * spread);
}

const FIRST_NAMES = [
  'Ava', 'Ben', 'Carmen', 'Dmitri', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kofi', 'Luna', 'Marco',
  'Nadia', 'Oscar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Vince', 'Wren', 'Xavi', 'Yuki', 'Zoe',
  'Frankie', 'Dolores', 'Bruno', 'Lola', 'Rex', 'Tony', 'Gloria', 'Mabel', 'Hector', 'Ines', 'Jules', 'Kai',
  'Lars', 'Mina', 'Nico', 'Olga', 'Pablo', 'Ruby', 'Stan', 'Tess', 'Vera', 'Walt', 'Ziggy', 'Bea', 'Chad',
  'Duke', 'Esme', 'Fern', 'Gino', 'Hazel', 'Iggy', 'Jack', 'Kira', 'Lenny', 'Moe', 'Nell', 'Otto', 'Pip',
];

const LAST_NAMES = [
  'Lucky', 'Diamond', 'Silver', 'Golden', 'Rollins', 'Ace', 'Spade', 'Dice', 'Winters', 'Cash', 'Blackwood',
  'Monroe', 'Vega', 'Sterling', 'Fortune', 'Chance', 'Hart', 'Kingsley', 'Marlowe', 'Reyes', 'Novak', 'Park',
  'Okafor', 'Rossi', 'Tanaka', 'Moreau', 'Schmidt', 'Costa', 'Nguyen', 'Silva', 'Kowalski', 'Byrne',
];

export function randomName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

export function randomFirstName(): string {
  return pick(FIRST_NAMES);
}
