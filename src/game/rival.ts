import type { CasinoSnapshot, RivalState, SavedStaff } from './save';
import type { SavedItem } from '../items/placedItem';
import { layoutRect, STAIR_TILE, PORTAL, CENTER_X, FACADE_Z, type Layout } from '../world/grid';
import { itemDef, rotatedSize } from '../items/catalog';
import { randomStaffAppearance } from '../entities/appearance';
import { seeded } from '../render/textures';

export const RIVAL_ID = 'rival';
export const RIVAL_NAME = 'The Golden Viper';

/** Bank needed for each size tier; the rival grows as players lose money there. */
const TIERS: { bank: number; layout: Layout; floors: number }[] = [
  { bank: 0, layout: { width: 1, depth: 2 }, floors: 1 },
  { bank: 320000, layout: { width: 2, depth: 3 }, floors: 1 },
  { bank: 520000, layout: { width: 2, depth: 4 }, floors: 2 },
  { bank: 900000, layout: { width: 2, depth: 5 }, floors: 3 },
  { bank: 1600000, layout: { width: 2, depth: 7 }, floors: 4 },
];

export function rivalTier(bank: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (bank >= TIERS[i].bank) t = i;
  return t;
}

export function rivalLook() {
  return { name: RIVAL_NAME, signFont: 'monoton', signColor: 0xffc53d, wallColor: 0x14142a, trimColor: 0xff4d4d };
}

/** Grow the rival from its bank and a little passive income; returns true if it got bigger. */
export function tickRival(r: RivalState, gameSeconds: number): boolean {
  r.bank += gameSeconds * 1.2;
  const t = rivalTier(r.bank);
  if (t > r.tier) {
    r.tier = t;
    return true;
  }
  return false;
}

export function rivalLotInfo(r: RivalState): { layout: Layout; floors: number } {
  const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, r.tier))];
  return { layout: t.layout, floors: t.floors };
}

/**
 * A full floor plan for the rival: slot rows along the walls, table pits in the middle,
 * a bar by the door and plenty of gold. Invalid spots are simply dropped by the loader.
 */
export function generateRival(r: RivalState): CasinoSnapshot {
  const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, r.tier))];
  const rect = layoutRect(tier.layout);
  const rnd = seeded(7 + r.tier * 13);
  const items: SavedItem[] = [];
  const taken = new Set<string>();
  const put = (id: string, f: number, tx: number, tz: number, rot: number, color?: number, label?: string): boolean => {
    const def = itemDef(id);
    const [w, d] = rotatedSize(def, rot);
    const tiles: string[] = [];
    for (let z = tz; z < tz + d; z++) {
      for (let x = tx; x < tx + w; x++) {
        if (x < rect.x0 || x > rect.x1 || z < rect.z0 || z > rect.z1) return false;
        if (tier.floors > 1 && x >= STAIR_TILE[0] - 1 && x <= PORTAL[0] + 1 && z >= STAIR_TILE[1] - 1 && z <= STAIR_TILE[1] + 3) return false;
        if (f === 0 && z >= FACADE_Z - 4 && x >= CENTER_X - 2 && x <= CENTER_X + 1) return false;
        const key = `${f}:${x},${z}`;
        if (taken.has(key)) return false;
        tiles.push(key);
      }
    }
    tiles.forEach((k) => taken.add(k));
    items.push({
      id, f: f || undefined, tx, tz, rot, level: Math.min(5, 1 + r.tier + Math.floor(rnd() * 2)), color: color ?? def.colors[0],
      broken: false, stats: { plays: 0, wagered: 0, paid: 0, income: 0, bigWins: 0 }, label,
    });
    return true;
  };
  const slotIds = ['slot_lucky7', 'slot_fruit', 'videopoker', 'slot_diamond', 'keno', 'slot_fruit', 'videopoker'];
  const cabinet = [0x17151f, 0xc8102e, 0xf2b632, 0x6a2cc2];
  for (let f = 0; f < tier.floors; f++) {
    // Slot row along the back wall
    for (let x = rect.x0 + 1; x <= rect.x1 - 1; x++) {
      const id = f > 0 && x % 7 === 3 && r.tier >= 2 ? 'slot_mega' : slotIds[(x + f) % slotIds.length];
      if (put(id, f, x, rect.z0, 0, cabinet[(x + f) % cabinet.length], x % 5 === 0 ? 'VIPER' : undefined) && id === 'slot_mega') x++;
    }
    // Side rows facing inwards
    for (let z = rect.z0 + 3; z <= rect.z1 - 5; z++) {
      put(slotIds[(z + 1) % slotIds.length], f, rect.x0, z, 3, cabinet[z % cabinet.length]);
      put(slotIds[z % slotIds.length], f, rect.x1 - 1, z, 1, cabinet[(z + 2) % cabinet.length]);
    }
    // Table pits in the middle
    const tables = f % 2 === 0 ? ['blackjack', 'roulette', 'baccarat', 'craps', 'threecard', 'wheel', 'sicbo', 'poker'] : ['poker', 'baccarat', 'blackjack', 'sicbo', 'roulette', 'threecard', 'wheel', 'craps'];
    let ti = 0;
    for (let z = rect.z0 + 4; z <= rect.z1 - 8; z += 6) {
      for (let x = rect.x0 + 4; x <= rect.x1 - 6; x += 6) {
        put(tables[ti++ % tables.length], f, x, z, 0, [0x0f7a45, 0x8a1030, 0x1d4fa0][ti % 3]);
      }
    }
    if (f === 0) {
      put('bar', f, rect.x1 - 5, rect.z1 - 6, 0, 0x5a1426);
      put('atm', f, rect.x0 + 1, rect.z1 - 3, 1);
      put('bench', f, rect.x1 - 3, rect.z1 - 1, 2, 0x8a1030);
    } else {
      put(f % 2 ? 'snack' : 'bar', f, rect.x1 - 5, rect.z1 - 6, 0, 0x5a1426);
      put('bench', f, rect.x0 + 3, rect.z1 - 1, 2, 0x8a1030);
    }
    // Gold and greenery
    for (const [x, z, id] of [
      [rect.x0 + 2, rect.z1 - 1, 'palm'], [rect.x1 - 1, rect.z1 - 3, 'palm'], [CENTER_X - 3, rect.z1 - 2, 'pillar'],
      [CENTER_X + 2, rect.z1 - 2, 'pillar'], [rect.x0 + 1, rect.z0 + 2, 'neon'], [rect.x1 - 1, rect.z0 + 2, 'neon'],
      [CENTER_X - 1, rect.z0 + 3, 'statue'],
    ] as [number, number, string][]) {
      put(id, f, x, z, 0, id === 'neon' ? 0xffc53d : undefined);
    }
    if (r.tier >= 1) put('fountain', f, CENTER_X - 1, rect.z1 - 8, 0);
  }
  const staff: SavedStaff[] = [
    { role: 'doorman', name: 'Vince', look: randomStaffAppearance('doorman') },
    { role: 'doorman', name: 'Rocco', look: randomStaffAppearance('doorman') },
    { role: 'security', name: 'Sal', look: randomStaffAppearance('security') },
    { role: 'janitor', name: 'Dot', look: randomStaffAppearance('janitor') },
  ];
  if (tier.floors > 1) staff.push({ role: 'technician', name: 'Gus', look: randomStaffAppearance('technician') });
  const w = rect.x1 - rect.x0 + 1;
  const d = rect.z1 - rect.z0 + 1;
  // Crimson (or midnight upstairs) carpet with a gold walkway down the middle
  const paint: string[] = [];
  for (let f = 0; f < tier.floors; f++) {
    const parts: string[] = [];
    for (let z = 0; z < d; z++) {
      const mid = w / 2;
      parts.push(`${f % 2 ? 1 : 0}:${mid - 2}`, `6:4`, `${f % 2 ? 1 : 0}:${w - mid - 2}`);
    }
    paint.push(parts.join(','));
  }
  return {
    name: RIVAL_NAME,
    look: rivalLook(),
    layout: tier.layout,
    floors: tier.floors,
    paint,
    items,
    staff,
    rating: 3.6 + r.tier * 0.25,
    jackpotPot: 25000 + r.tier * 15000,
  };
}
