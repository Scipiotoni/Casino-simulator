import { migrateSave, newRival, sanitizeSnapshot, type SaveData } from './save';
import { sanitizeAppearance } from '../entities/appearance';
import { SIGN_FONTS } from '../world/building';
import { sanitizeCosmetics } from '../cosmetics/catalog';
import { emptyStats, type LifetimeStats } from './objectives';

/** Marker at the top of an exported casino file. */
export const EXPORT_FORMAT = 'jackpot-tycoon-casino';

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);

/** A save as a self-describing JSON document you can download or copy. */
export function exportSave(save: SaveData): string {
  return JSON.stringify({ format: EXPORT_FORMAT, v: 2, exportedAt: new Date().toISOString(), save }, null, 1);
}

/** A file name for the download, built from the casino's name. */
export function exportFileName(save: SaveData): string {
  const slug = save.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'casino';
  return `${slug}.jackpot.json`;
}

/**
 * Read an exported casino (or a bare save). Imported files may come from anyone, so
 * every field is checked and clamped the same way other players' casinos are.
 */
export function parseImport(text: string): { save: SaveData } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { error: 'That isn’t a Jackpot Tycoon save (it’s not valid JSON).' };
  }
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).format === EXPORT_FORMAT) raw = (raw as Record<string, unknown>).save;
  const d = migrateSave(raw);
  if (!d) return { error: 'That file isn’t a Jackpot Tycoon save.' };
  const r = d as unknown as Record<string, unknown>;
  const snap = sanitizeSnapshot(d, SIGN_FONTS.map((f) => f.id), sanitizeAppearance);
  if (!snap) return { error: 'The casino in that file is damaged.' };
  const pl = (r.player ?? {}) as Record<string, unknown>;
  const statsIn = (r.stats ?? {}) as Record<string, unknown>;
  const stats = emptyStats();
  for (const k of Object.keys(stats) as (keyof LifetimeStats)[]) stats[k] = num(statsIn[k], -1e15, 1e15, 0);
  const rv = (r.rival ?? {}) as Record<string, unknown>;
  const base = newRival();
  const save: SaveData = {
    ...snap,
    v: 2,
    money: Math.round(num(r.money, -1e12, 1e15, 3000)),
    xp: Math.round(num(r.xp, 0, 1e12, 0)),
    level: Math.round(num(r.level, 1, 99, 1)),
    day: Math.round(num(r.day, 1, 1e6, 1)),
    dayMinutes: num(r.dayMinutes, 0, 1440, 600),
    satAvg: num(r.satAvg, 0, 1, 0.7),
    player: {
      look: sanitizeAppearance(pl.look),
      name: typeof pl.name === 'string' && pl.name.trim() ? pl.name.slice(0, 20) : 'Boss',
      x: 24, z: 37, floor: 0,
    },
    objectives: Array.isArray(r.objectives) ? r.objectives.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
    stats,
    trash: [],
    history: Array.isArray(r.history) ? r.history.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(-60) : [],
    floorPainted: Math.round(num(r.floorPainted, 0, 1e9, 0)),
    lookEdited: r.lookEdited === true,
    renamed: r.renamed === true,
    speed: Math.round(num(r.speed, 1, 3, 1)),
    rival: {
      bank: num(rv.bank, 0, 1e15, base.bank),
      tier: Math.round(num(rv.tier, 0, 20, 0)),
      banUntil: 0,
      net: num(rv.net, -1e15, 1e15, 0),
    },
    createdAt: Math.round(num(r.createdAt, 0, Date.now(), Date.now())),
    cosmetics: sanitizeCosmetics(r.cosmetics),
  };
  return { save };
}
