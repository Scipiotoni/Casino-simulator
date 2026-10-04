/** Read-only view of the game used to measure objective progress. */
export interface ObjectiveView {
  money: number;
  level: number;
  rating: number;
  /** Width steps + depth steps bought. */
  expansion: number;
  /** Floors, including the ground floor. */
  floors: number;
  /** Width step index (last = at the street's width limit). */
  widthStep: number;
  countItem(id: string): number;
  countCategory(cat: string): number;
  countKind(kind: string): number;
  staffTotal: number;
  doorGuards: number;
  customersNow: number;
  stats: LifetimeStats;
  floorPainted: number;
  lookEdited: boolean;
  casinoRenamed: boolean;
  /** Best decorated hotel room (stars). */
  bestRoomStars: number;
  /** Hotel: buildings owned by kind, whether the tower you're in is open, review average. */
  hotelTowers: number;
  hotelGardens: number;
  hotelOpen: boolean;
  reviewAvg: number;
  gardenItems: number;
  /** City life: guns owned, the house and its vault. */
  gunsOwned: number;
  carsOwned: number;
  houseOwned: boolean;
  vaultTier: number;
  vaultMoney: number;
  houseGuards: number;
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
  managerSpins: number;
  /** Net winnings (can be negative) at other casinos on the street. */
  awayNet: number;
  awayHands: number;
  turnedAway: number;
  /** Hotel: rooms redecorated, and whole-floor setups applied. */
  roomsDecorated: number;
  floorSetups: number;
  /** Out on the street with a gun. */
  shotsFired: number;
  targetsHit: number;
  carsHit: number;
  /** Money moved in and out of the vault. */
  deposited: number;
  vaultOpened: number;
  /** Wall tiles built inside. */
  wallsBuilt: number;
  /** Street fights: people you knocked out, cash taken, and times you went down. */
  knockouts: number;
  looted: number;
  knockedDown: number;
  /** Times the police got you, and the most stars you've had. */
  busted: number;
  maxWanted: number;
  /** Cars taken out of traffic. */
  carsStolen: number;
  carsParked?: number;
  /** Other players you've knocked out. */
  pvpKos?: number;
  /** Cash earned hitting the punching bag. */
  earnedPunching?: number;
  /** Cars wrecked (blown up) and vehicles driven out of the military base. */
  carsWrecked?: number;
  baseRaids?: number;
  /** Gifts sent to and opened from other players. */
  giftsSent?: number;
  giftsReceived?: number;
}

export function emptyStats(): LifetimeStats {
  return {
    collected: 0, earnedTotal: 0, visitors: 0, jackpots: 0, bigWins: 0, biggestWin: 0, cheatersCaught: 0, repairs: 0,
    trashCleaned: 0, vipsGreeted: 0, drinksServed: 0, rounds: 0, comps: 0, purchases: 0, managerSpins: 0,
    awayNet: 0, awayHands: 0, turnedAway: 0, roomsDecorated: 0, floorSetups: 0,
    shotsFired: 0, targetsHit: 0, carsHit: 0, deposited: 0, vaultOpened: 0, wallsBuilt: 0, knockouts: 0, looted: 0, knockedDown: 0, busted: 0, maxWanted: 0, carsStolen: 0,
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
  { id: 'collect_100', text: 'Make $100 from your guests', hint: 'Bets land in your bank as soon as each round ends.', target: 100, reward: 150, xp: 60, progress: (v) => v.stats.collected },
  { id: 'five_slots', text: 'Own 5 slot machines', hint: 'More seats means more guests.', target: 5, reward: 400, xp: 100, progress: (v) => v.countCategory('slots') },
  { id: 'decor', text: 'Own 5 decorations', hint: 'Decor raises guest mood and your rating.', target: 5, reward: 250, xp: 80, progress: (v) => v.countCategory('decor') },
  { id: 'visitors_25', text: 'Welcome 25 guests', hint: 'Keep machines free and guests keep coming.', target: 25, reward: 400, xp: 120, progress: (v) => v.stats.visitors },
  { id: 'rename', text: 'Rename your casino', hint: 'Open Casino and give it a name.', target: 1, reward: 150, xp: 40, progress: (v) => (v.casinoRenamed ? 1 : 0) },
  { id: 'bench', text: 'Place a lounge bench', hint: 'Tired guests rest instead of leaving.', target: 1, reward: 120, xp: 40, progress: (v) => v.countItem('bench') },
  { id: 'money_5k', text: 'Have $5,000 in the bank', hint: 'More machines, more bets.', target: 5000, reward: 500, xp: 150, progress: (v) => v.money },
  { id: 'repair', text: 'Fix a broken machine', hint: 'Stand next to it and hold Space (or the action button).', target: 1, reward: 300, xp: 100, progress: (v) => v.stats.repairs },
  { id: 'bar', text: 'Build a cocktail bar', hint: 'Unlocks at level 2. Thirsty guests stay longer.', target: 1, reward: 600, xp: 150, progress: (v) => v.countItem('bar') },
  { id: 'paint', text: 'Paint 20 floor tiles', hint: 'Casino → Paint floor, then drag across the carpet.', target: 20, reward: 250, xp: 80, progress: (v) => v.floorPainted },
  { id: 'walls', text: 'Build 12 tiles of wall', hint: 'Build → Walls, then drag across the floor to make a room.', target: 12, reward: 400, xp: 100, progress: (v) => v.stats.wallsBuilt },
  { id: 'staff', text: 'Hire your first staff member', hint: 'Open Staff. Janitors keep the floor clean.', target: 1, reward: 500, xp: 150, progress: (v) => v.staffTotal },
  { id: 'table', text: 'Buy a table game', hint: 'Blackjack unlocks at level 3.', target: 1, reward: 1000, xp: 250, progress: (v) => v.countCategory('tables') },
  { id: 'rating_3', text: 'Reach a 3-star rating', hint: 'Happy guests, decor, variety and clean floors.', target: 3, reward: 1000, xp: 300, progress: (v) => v.rating },
  { id: 'expand', text: 'Expand your casino', hint: 'Open Casino and buy more floor space.', target: 1, reward: 1500, xp: 300, progress: (v) => v.expansion },
  { id: 'visit', text: 'Play a hand at another casino', hint: 'Walk out the front door and down the street.', target: 1, reward: 500, xp: 120, progress: (v) => v.stats.awayHands },
  { id: 'gun', text: 'Buy a gun at Bullseye Guns', hint: 'The gun shop is on the Strip, next to the rival. Guns only fire out on the street.', target: 1, reward: 400, xp: 100, progress: (v) => v.gunsOwned },
  { id: 'targets_10', text: 'Shoot 10 targets', hint: 'Tin cans, bottles and balloons wait on the sidewalks.', target: 10, reward: 500, xp: 150, progress: (v) => v.stats.targetsHit },
  { id: 'car', text: 'Buy a car at Velocity Motors', hint: 'The dealership is on Downtown Boulevard (🚗 on the city map), or Menu → Cars.', target: 1, reward: 1500, xp: 300, progress: (v) => v.carsOwned },
  { id: 'house', text: 'Buy a house on Palm Avenue', hint: 'Open Home on the toolbar (casino level 3).', target: 1, reward: 1500, xp: 300, progress: (v) => (v.houseOwned ? 1 : 0) },
  { id: 'vault', text: 'Put a vault in your house', hint: 'In your house: Build → Security → Vault, then pick a code.', target: 1, reward: 1000, xp: 250, progress: (v) => v.vaultTier },
  { id: 'bank_10k', text: 'Keep $10,000 in your vault', hint: 'Open the vault and deposit casino cash. It earns interest every day.', target: 10000, reward: 1500, xp: 300, progress: (v) => v.vaultMoney },
  { id: 'doorman', text: 'Post a door guard at the entrance', hint: 'Staff → Door Guard. Turns cheaters away.', target: 1, reward: 700, xp: 200, progress: (v) => v.doorGuards },
  { id: 'cheater', text: 'Catch a cheater', hint: 'Look for the red ? badge and press Space next to them.', target: 1, reward: 800, xp: 250, progress: (v) => v.stats.cheatersCaught },
  { id: 'vip', text: 'Greet 3 VIP guests', hint: 'VIPs sparkle gold. Greet them for a tip.', target: 3, reward: 900, xp: 250, progress: (v) => v.stats.vipsGreeted },
  { id: 'crowd_25', text: 'Have 25 guests inside at once', hint: 'More seats and a better rating.', target: 25, reward: 2000, xp: 400, progress: (v) => v.customersNow },
  { id: 'bodyguard', text: 'Hire a bodyguard for your house', hint: 'In your house: Staff → Bodyguard. Security matters.', target: 1, reward: 1500, xp: 300, progress: (v) => v.houseGuards },
  { id: 'targets_100', text: 'Shoot 100 targets', hint: 'A shotgun clears a whole crate at once.', target: 100, reward: 3000, xp: 600, progress: (v) => v.stats.targetsHit },
  { id: 'jackpot', text: 'Witness a jackpot', hint: 'Triple 7s pays big. Brace yourself.', target: 1, reward: 1500, xp: 300, progress: (v) => v.stats.jackpots },
  { id: 'earn_50k', text: 'Earn $50,000 in total', hint: 'Every dollar you collect counts.', target: 50000, reward: 5000, xp: 800, progress: (v) => v.stats.earnedTotal },
  { id: 'roulette', text: 'Install a roulette table', hint: 'Unlocks at level 4.', target: 1, reward: 2000, xp: 400, progress: (v) => v.countItem('roulette') },
  { id: 'rating_4', text: 'Reach a 4-star rating', hint: 'Decor and variety push you over the top.', target: 4, reward: 5000, xp: 1000, progress: (v) => v.rating },
  { id: 'stage', text: 'Open a show stage', hint: 'Unlocks at level 7.', target: 1, reward: 6000, xp: 1200, progress: (v) => v.countItem('stage') },
  { id: 'mega', text: 'Install a Mega Jackpot machine', hint: 'Unlocks at level 8.', target: 1, reward: 8000, xp: 1500, progress: (v) => v.countItem('slot_mega') },
  { id: 'floor2', text: 'Build a second floor', hint: 'Casino → Add a floor. The elevator links them.', target: 2, reward: 12000, xp: 2000, progress: (v) => v.floors },
  { id: 'full_width', text: 'Build out to the full lot width', hint: 'Every lot on the street has the same width limit.', target: 1, reward: 8000, xp: 1500, progress: (v) => (v.widthStep >= 2 ? 1 : 0) },
  { id: 'vault3', text: 'Upgrade to a Titanium Vault', hint: 'Open your vault and upgrade it twice.', target: 3, reward: 20000, xp: 3000, progress: (v) => v.vaultTier },
  { id: 'bank_1m', text: 'Keep $1,000,000 in your vault', hint: 'A Bank Vault holds a million.', target: 1_000_000, reward: 50000, xp: 6000, progress: (v) => v.vaultMoney },
  { id: 'floor4', text: 'Stack four floors', hint: 'A tower on the Strip.', target: 4, reward: 60000, xp: 6000, progress: (v) => v.floors },
  { id: 'rating_5', text: 'Reach a 5-star rating', hint: 'A true casino legend.', target: 4.95, reward: 25000, xp: 5000, progress: (v) => v.rating },
  { id: 'earn_1m', text: 'Earn $1,000,000 in total', hint: 'Welcome to the high life.', target: 1_000_000, reward: 100000, xp: 10000, progress: (v) => v.stats.earnedTotal },
];

/** The hotel's own goals (the hotel is a separate tycoon with its own bank and level). */
export const HOTEL_OBJECTIVES: Objective[] = [
  { id: 'h_desk', text: 'Build a reception desk', hint: 'Build → Services. Guests check in here.', target: 1, reward: 300, xp: 60, progress: (v) => v.countItem('reception') },
  { id: 'h_buffet', text: 'Build a breakfast buffet', hint: 'Build → Services. No hotel opens without breakfast.', target: 1, reward: 400, xp: 80, progress: (v) => v.countItem('buffet') },
  { id: 'h_room', text: 'Build your first room', hint: 'Build → Rooms. It comes with a single bed.', target: 1, reward: 400, xp: 80, progress: (v) => v.countCategory('rooms') },
  { id: 'h_staff', text: 'Hire a housekeeper', hint: 'Staff → Housekeeper. They make up rooms after guests leave.', target: 1, reward: 600, xp: 150, progress: (v) => v.staffTotal },
  { id: 'h_open', text: 'Open the hotel for guests', hint: 'Tick off the checklist at the top of Goals.', target: 1, reward: 1000, xp: 200, progress: (v) => (v.hotelOpen ? 1 : 0) },
  { id: 'h_night', text: 'Sell your first night', hint: 'Guests check in, then sleep in your rooms.', target: 1, reward: 300, xp: 80, progress: (v) => v.stats.rounds },
  { id: 'h_decorate', text: 'Decorate a room', hint: 'Click a room and pick a bigger bed, colours, extras or a quick theme.', target: 1, reward: 500, xp: 100, progress: (v) => v.stats.roomsDecorated },
  { id: 'h_rooms4', text: 'Have 4 rooms', hint: 'More rooms, more guests every night.', target: 4, reward: 1000, xp: 200, progress: (v) => v.countCategory('rooms') },
  { id: 'h_stars3', text: 'Decorate a 3-star room', hint: 'Spend about $5,000 on one room.', target: 3, reward: 1500, xp: 300, progress: (v) => v.bestRoomStars },
  { id: 'h_floorsetup', text: 'Copy a room’s setup to a whole floor', hint: 'Open a room and use “Apply to all rooms on this floor”.', target: 1, reward: 1500, xp: 300, progress: (v) => v.stats.floorSetups },
  { id: 'h_garden', text: 'Open a Pool Garden', hint: 'Hotel → Add a Pool Garden. Pools only go outdoors.', target: 1, reward: 3000, xp: 500, progress: (v) => v.hotelGardens },
  { id: 'h_pool', text: 'Fill a Pool Garden with 5 things', hint: 'A pool, loungers, a hot tub, a tiki bar…', target: 5, reward: 3000, xp: 500, progress: (v) => v.gardenItems },
  { id: 'h_bank20k', text: 'Have $20,000 in the hotel bank', hint: 'Better rooms charge more per night.', target: 20000, reward: 2000, xp: 400, progress: (v) => v.money },
  { id: 'h_suite', text: 'Build a luxury suite', hint: 'Unlocks at hotel level 4. VIPs only take the finest rooms.', target: 1, reward: 6000, xp: 1000, progress: (v) => v.countItem('suite') },
  { id: 'h_reviews', text: 'Get a 4-star review average', hint: 'Happy guests: breakfast, clean rooms, nice decor.', target: 4, reward: 5000, xp: 900, progress: (v) => v.reviewAvg },
  { id: 'h_rooms12', text: 'Have 12 rooms', hint: 'Expand the tower, or build another one.', target: 12, reward: 5000, xp: 800, progress: (v) => v.countCategory('rooms') },
  { id: 'h_tower2', text: 'Build a second tower', hint: 'Hotel → Add a tower.', target: 2, reward: 15000, xp: 2000, progress: (v) => v.hotelTowers },
  { id: 'h_penthouse', text: 'Build a penthouse', hint: 'Unlocks at hotel level 7. Only VIPs can afford it.', target: 1, reward: 20000, xp: 3000, progress: (v) => v.countItem('penthouse') },
  { id: 'h_rating4', text: 'Reach a 4-star hotel rating', hint: 'Great rooms, great reviews, a pool next door.', target: 4, reward: 8000, xp: 1500, progress: (v) => v.rating },
  { id: 'h_stars5', text: 'Create a 5-star room', hint: 'Royal bed, gold walls, marble, chandelier… about $25,000.', target: 5, reward: 20000, xp: 3000, progress: (v) => v.bestRoomStars },
  { id: 'h_nights500', text: 'Sell 500 nights', hint: 'A busy hotel never sleeps.', target: 500, reward: 25000, xp: 4000, progress: (v) => v.stats.rounds },
  { id: 'h_earn1m', text: 'Earn $1,000,000 at the hotel', hint: 'The finest address on the Strip.', target: 1_000_000, reward: 100000, xp: 10000, progress: (v) => v.stats.earnedTotal },
];

export const ACTIVE_OBJECTIVES = 3;

export function xpForLevel(level: number): number {
  return Math.round(220 * Math.pow(level, 1.55));
}
