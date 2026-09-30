/** Pure-show items bought with casino profits. They do nothing but look expensive. */
export type CosmeticTarget = 'player' | 'casino';

export interface Cosmetic {
  id: string;
  name: string;
  target: CosmeticTarget;
  price: number;
  icon: string;
  description: string;
}

export const COSMETICS: Cosmetic[] = [
  { id: 'crown', name: 'Solid Gold Crown', target: 'player', price: 250_000, icon: '👑', description: 'Heavy is the head. Sparkles too.' },
  { id: 'sparkle', name: 'Sparkle Aura', target: 'player', price: 400_000, icon: '✨', description: 'A cloud of glitter follows you everywhere.' },
  { id: 'dice', name: 'Orbiting Lucky Dice', target: 'player', price: 750_000, icon: '🎲', description: 'Two giant dice circle you like moons.' },
  { id: 'pup', name: 'Casino Pup', target: 'player', price: 1_000_000, icon: '🐶', description: 'A loyal little dog in a bow tie trots at your heels.' },
  { id: 'goldpup', name: 'Golden Pup', target: 'player', price: 5_000_000, icon: '🐕', description: 'The same good dog, cast in 24-karat gold.' },
  { id: 'halo', name: 'Neon Halo', target: 'player', price: 2_500_000, icon: '😇', description: 'For a manager who has never, ever rigged a slot.' },
  { id: 'searchlights', name: 'Hollywood Searchlights', target: 'casino', price: 600_000, icon: '🔦', description: 'Twin beams sweep the sky above your roof.' },
  { id: 'rainbow', name: 'Rainbow Neon', target: 'casino', price: 900_000, icon: '🌈', description: 'Your trim cycles through every colour of the strip.' },
  { id: 'fireworks', name: 'Nightly Fireworks', target: 'casino', price: 2_000_000, icon: '🎆', description: 'Rockets burst over your casino, all day, every day.' },
  { id: 'goldfacade', name: 'Gold-Plated Facade', target: 'casino', price: 8_000_000, icon: '🏆', description: 'Every outside wall dipped in gold. Subtle.' },
];

export const COSMETIC_IDS = new Set(COSMETICS.map((c) => c.id));

export function cosmetic(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

export interface CosmeticState {
  owned: string[];
  /** Equipped (switched on) items. */
  on: string[];
}

export function emptyCosmetics(): CosmeticState {
  return { owned: [], on: [] };
}

/** Keep only known ids (for saves, imports and other players' data). */
export function cleanCosmetics(list: unknown): string[] {
  return Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string' && COSMETIC_IDS.has(x)))].slice(0, 20) : [];
}

export function sanitizeCosmetics(raw: unknown): CosmeticState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const owned = cleanCosmetics(r.owned);
  return { owned, on: cleanCosmetics(r.on).filter((id) => owned.includes(id)) };
}

/** Equipped ids for one target. */
export function equipped(s: CosmeticState, target: CosmeticTarget): string[] {
  return s.on.filter((id) => cosmetic(id)?.target === target);
}
