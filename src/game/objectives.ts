import { EXPANSIONS } from '../world/grid';

/** Read-only view of the game used to measure objective progress. */
export interface ObjectiveView {
  money: number;
  level: number;
  rating: number;
  expansion: number;
  countItem(id: string): number;
  countCategory(cat: string): number;
  countKind(kind: string): number;
  staffTotal: number;
  customersNow: number;
  stats: LifetimeStats;
  floorPainted: number;
  lookEdited: boolean;
  casinoRenamed: boolean;
}

export interface LifetimeStats {
  collected: number;
  earnedTotal: number;
  visitors: number;
  jackpots: number;
  bigWins: number;
  biggestWin: number;
  cheatersCaught: number;
  repairs: number;
  trashCleaned: number;
  vipsGreeted: number;
  drinksServed: number;
  rounds: number;
  comps: number;
  purchases: number;
}

export function emptyStats(): LifetimeStats {
  return {
    collected: 0, earnedTotal: 0, visitors: 0, jackpots: 0, bigWins: 0, biggestWin: 0, cheatersCaught: 0, repairs: 0,
    trashCleaned: 0, vipsGreeted: 0, drinksServed: 0, rounds: 0, comps: 0, purchases: 0,
  };
}

export interface Objective {
  id: string;
  text: string;
  hint: string;
  target: number;
  reward: number;
  xp: number;
  progress: (v: ObjectiveView) => number;
}

export const OBJECTIVES: Objective[] = [
  { id: 'first_slot', text: 'Buy your first slot machine', hint: 'Open Build and pick Lucky 7s.', target: 1, reward: 250, xp: 60, progress: (v) => v.countCategory('slots') },
  { id: 'collect_100', text: 'Collect $100 from your machines', hint: 'Walk next to machines with a floating coin.', target: 100, reward: 150, xp: 60, progress: (v) => v.stats.collected },
  { id: 'five_slots', text: 'Own 5 slot machines', hint: 'More seats means more guests.', target: 5, reward: 400, xp: 100, progress: (v) => v.countCategory('slots') },
  { id: 'decor', text: 'Place 3 decorations', hint: 'Decor raises guest mood and your rating.', target: 3, reward: 250, xp: 80, progress: (v) => v.countCategory('decor') },
  { id: 'visitors_25', text: 'Welcome 25 guests', hint: 'Keep machines free and guests keep coming.', target: 25, reward: 400, xp: 120, progress: (v) => v.stats.visitors },
  { id: 'rename', text: 'Rename your casino', hint: 'Open Casino and give it a name.', target: 1, reward: 150, xp: 40, progress: (v) => (v.casinoRenamed ? 1 : 0) },
  { id: 'bench', text: 'Place a lounge bench', hint: 'Tired guests rest instead of leaving.', target: 1, reward: 120, xp: 40, progress: (v) => v.countItem('bench') },
  { id: 'money_5k', text: 'Have $5,000 in the bank', hint: 'Collect cash often.', target: 5000, reward: 500, xp: 150, progress: (v) => v.money },
  { id: 'repair', text: 'Fix a broken machine', hint: 'Stand next to it and hold Space (or the action button).', target: 1, reward: 300, xp: 100, progress: (v) => v.stats.repairs },
  { id: 'bar', text: 'Build a cocktail bar', hint: 'Unlocks at level 2. Thirsty guests stay longer.', target: 1, reward: 600, xp: 150, progress: (v) => v.countItem('bar') },
  { id: 'paint', text: 'Paint 20 floor tiles', hint: 'Open Floor and drag across the carpet.', target: 20, reward: 250, xp: 80, progress: (v) => v.floorPainted },
  { id: 'staff', text: 'Hire your first staff member', hint: 'Open Staff. Janitors keep the floor clean.', target: 1, reward: 500, xp: 150, progress: (v) => v.staffTotal },
  { id: 'table', text: 'Buy a table game', hint: 'Blackjack unlocks at level 3.', target: 1, reward: 1000, xp: 250, progress: (v) => v.countCategory('tables') },
  { id: 'rating_3', text: 'Reach a 3-star rating', hint: 'Happy guests, decor, variety and clean floors.', target: 3, reward: 1000, xp: 300, progress: (v) => v.rating },
  { id: 'expand', text: 'Expand your casino', hint: 'Open Casino and buy more floor space.', target: 1, reward: 1500, xp: 300, progress: (v) => v.expansion },
  { id: 'cheater', text: 'Catch a cheater', hint: 'Look for the red ? badge and press Space next to them.', target: 1, reward: 800, xp: 250, progress: (v) => v.stats.cheatersCaught },
  { id: 'vip', text: 'Greet 3 VIP guests', hint: 'VIPs sparkle gold. Greet them for a tip.', target: 3, reward: 900, xp: 250, progress: (v) => v.stats.vipsGreeted },
  { id: 'crowd_25', text: 'Have 25 guests inside at once', hint: 'More seats and a better rating.', target: 25, reward: 2000, xp: 400, progress: (v) => v.customersNow },
  { id: 'jackpot', text: 'Witness a jackpot', hint: 'Triple 7s pays big. Brace yourself.', target: 1, reward: 1500, xp: 300, progress: (v) => v.stats.jackpots },
  { id: 'earn_50k', text: 'Earn $50,000 in total', hint: 'Every dollar you collect counts.', target: 50000, reward: 5000, xp: 800, progress: (v) => v.stats.earnedTotal },
  { id: 'roulette', text: 'Install a roulette table', hint: 'Unlocks at level 4.', target: 1, reward: 2000, xp: 400, progress: (v) => v.countItem('roulette') },
  { id: 'rating_4', text: 'Reach a 4-star rating', hint: 'Decor and variety push you over the top.', target: 4, reward: 5000, xp: 1000, progress: (v) => v.rating },
  { id: 'stage', text: 'Open a show stage', hint: 'Unlocks at level 7.', target: 1, reward: 6000, xp: 1200, progress: (v) => v.countItem('stage') },
  { id: 'mega', text: 'Install a Mega Jackpot machine', hint: 'Unlocks at level 8.', target: 1, reward: 8000, xp: 1500, progress: (v) => v.countItem('slot_mega') },
  { id: 'expand_max', text: `Expand to the full ${EXPANSIONS[EXPANSIONS.length - 1].w}×${EXPANSIONS[EXPANSIONS.length - 1].d} lot`, hint: 'The biggest casino on the Strip.', target: EXPANSIONS.length - 1, reward: 50000, xp: 5000, progress: (v) => v.expansion },
  { id: 'rating_5', text: 'Reach a 5-star rating', hint: 'A true casino legend.', target: 4.95, reward: 25000, xp: 5000, progress: (v) => v.rating },
  { id: 'earn_1m', text: 'Earn $1,000,000 in total', hint: 'Welcome to the high life.', target: 1_000_000, reward: 100000, xp: 10000, progress: (v) => v.stats.earnedTotal },
];

export const ACTIVE_OBJECTIVES = 3;

export function xpForLevel(level: number): number {
  return Math.round(220 * Math.pow(level, 1.55));
}
