export type Category = 'slots' | 'tables' | 'services' | 'decor' | 'rooms';

/** Which business sells an item: the casino, the hotel, or both. */
export type Site = 'casino' | 'hotel';
export type GameKind =
  | 'slot' | 'claw' | 'pachinko' | 'roulette' | 'blackjack' | 'poker' | 'craps' | 'wheel'
  | 'baccarat' | 'threecard' | 'sicbo' | 'videopoker' | 'keno'
  | 'bar' | 'snack' | 'atm' | 'bench' | 'stage' | 'decor' | 'elevator'
  | 'room' | 'desk' | 'pool';

export interface SeatDef {
  /** Tile inside the footprint the occupant paths to (rotation 0). */
  tile: [number, number];
  /** Exact position relative to the footprint centre (rotation 0). */
  pos: [number, number];
  /** Yaw the occupant faces (rotation 0); 0 faces +z. */
  face: number;
  pose: 'sit' | 'stand';
  seatY?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  category: Category;
  kind: GameKind;
  price: number;
  unlock: number;
  size: [number, number];
  seats: SeatDef[];
  staff?: { pos: [number, number]; face: number; role: 'dealer' | 'bartender' | 'performer' | 'chef' };
  layer?: 'object' | 'floor';
  minBet: number;
  maxBet: number;
  roundTime: number;
  rtp: number;
  cashCap: number;
  upkeep: number;
  appeal: number;
  appealRadius: number;
  fun: number;
  breakChance: number;
  description: string;
  colors: number[];
  model: string;
  shared?: boolean;
  jackpot?: boolean;
  litterReduce?: number;
  /** Built by the game itself (the elevator): never in the shop, can't be moved or sold. */
  fixed?: boolean;
  /** Never sold in the shop. */
  hidden?: boolean;
  /** Where it's sold (see itemSites). */
  sites?: Site[];
  /** Extra per-item look parameters handed to the model builder. */
  params?: Record<string, string | number>;
}

const CABINET_COLORS = [0xc8102e, 0x1f4fbf, 0x1e7a46, 0x6a2cc2, 0xf2b632, 0x17151f, 0xff6fb5, 0x2fb8c9, 0xff8a1f, 0xf4f1ea];
const FELT_COLORS = [0x0f7a45, 0x1d4fa0, 0x8a1030, 0x5a2a8a, 0x1a1a24, 0x0d6f73];
const WOOD_COLORS = [0x4a2616, 0x2a1a12, 0x6b3a1e, 0x17151f, 0xe9e1d3, 0x3a1d4d];
const NEON = [0xff3fa4, 0x2fe6ff, 0xffc53d, 0x39ff88, 0xb77bff, 0xff4d4d];

const slotSeat: SeatDef[] = [{ tile: [0, 1], pos: [0, 0.42], face: Math.PI, pose: 'sit', seatY: 0.56 }];
const standSeat: SeatDef[] = [{ tile: [0, 1], pos: [0, 0.38], face: Math.PI, pose: 'stand' }];

const base = {
  seats: [] as SeatDef[],
  minBet: 0,
  maxBet: 0,
  roundTime: 3,
  rtp: 0.9,
  cashCap: 0,
  upkeep: 0,
  appeal: 0,
  appealRadius: 2,
  fun: 1,
  breakChance: 0,
  colors: [] as number[],
};

function faceToward(px: number, pz: number, cx: number, cz: number): number {
  return Math.atan2(cx - px, cz - pz);
}

function arcSeats(cx: number, cz: number, radius: number, angles: number[], tiles: [number, number][], pose: 'sit' | 'stand', seatY = 0.66): SeatDef[] {
  return angles.map((a, i) => {
    const px = cx + Math.sin(a) * radius;
    const pz = cz + Math.cos(a) * radius;
    return { tile: tiles[i], pos: [px, pz], face: faceToward(px, pz, cx, cz), pose, seatY };
  });
}

export const ITEMS: ItemDef[] = [
  // ------------------------------------------------------------------ slots
  {
    ...base, id: 'slot_lucky7', name: 'Lucky 7s', category: 'slots', kind: 'slot', price: 400, unlock: 1, size: [1, 2],
    seats: slotSeat, minBet: 2, maxBet: 25, roundTime: 3.0, rtp: 0.86, cashCap: 1200, appeal: 0.3, fun: 1.0, breakChance: 1 / 260,
    description: 'The classic three-reel slot. Cheap, cheerful, pays small wins often.',
    colors: CABINET_COLORS, model: 'slot', params: { topper: 'LUCKY 7s', topColor: '#ffd24a', deco: 'candle', volatility: 'low' },
  },
  {
    ...base, id: 'slot_fruit', name: 'Fruit Frenzy', category: 'slots', kind: 'slot', price: 900, unlock: 2, size: [1, 2],
    seats: slotSeat, minBet: 5, maxBet: 50, roundTime: 3.0, rtp: 0.87, cashCap: 2200, appeal: 0.4, fun: 1.15, breakChance: 1 / 280,
    description: 'Juicy fruit symbols with bigger bets and a louder cabinet.',
    colors: [0x1e7a46, ...CABINET_COLORS], model: 'slot', params: { topper: 'FRUIT FRENZY', topColor: '#ff6fb5', deco: 'cherry' },
  },
  {
    ...base, id: 'slot_diamond', name: 'Diamond Deluxe', category: 'slots', kind: 'slot', price: 2400, unlock: 4, size: [1, 2],
    seats: slotSeat, minBet: 10, maxBet: 150, roundTime: 3.1, rtp: 0.86, cashCap: 6000, appeal: 0.7, fun: 1.35, breakChance: 1 / 320,
    description: 'High-limit slot with a glittering diamond topper. High rollers love it.',
    colors: [0x1f4fbf, 0x17151f, 0x6a2cc2, 0xf4f1ea, 0xc8102e], model: 'slot', params: { topper: 'DIAMOND', topColor: '#7ff3ff', deco: 'diamond', trim: 1 },
  },
  {
    ...base, id: 'slot_mega', name: 'Mega Jackpot', category: 'slots', kind: 'slot', price: 12000, unlock: 8, size: [2, 2],
    seats: [
      { tile: [0, 1], pos: [-0.5, 0.42], face: Math.PI, pose: 'sit', seatY: 0.56 },
      { tile: [1, 1], pos: [0.5, 0.42], face: Math.PI, pose: 'sit', seatY: 0.56 },
    ],
    minBet: 25, maxBet: 400, roundTime: 3.3, rtp: 0.85, cashCap: 18000, appeal: 1.6, appealRadius: 3.5, fun: 1.8, breakChance: 1 / 360,
    jackpot: true,
    description: 'Linked progressive jackpot. Three 7s pays the whole pot and the whole town hears about it.',
    colors: [0x6a2cc2, 0xc8102e, 0x17151f, 0x1f4fbf, 0xf2b632], model: 'megaslot',
  },
  {
    ...base, id: 'claw', name: 'Claw Crane', category: 'slots', kind: 'claw', price: 350, unlock: 2, size: [1, 2],
    seats: standSeat, minBet: 2, maxBet: 5, roundTime: 6, rtp: 0, cashCap: 600, appeal: 0.6, fun: 0.9, breakChance: 1 / 200,
    description: 'Grab a plushie! Pure profit for you, pure joy for them.',
    colors: [0xff6fb5, 0x2fb8c9, 0xf2b632, 0x6a2cc2, 0x3ddc84], model: 'claw',
  },
  {
    ...base, id: 'pachinko', name: 'Pachinko', category: 'slots', kind: 'pachinko', price: 1500, unlock: 5, size: [1, 2],
    seats: slotSeat, minBet: 5, maxBet: 50, roundTime: 4.5, rtp: 0.86, cashCap: 3000, appeal: 0.6, fun: 1.2, breakChance: 1 / 260,
    description: 'Hundreds of steel balls bouncing through a forest of pins.',
    colors: [0xff8a1f, 0xc8102e, 0x1f4fbf, 0x3ddc84, 0x6a2cc2], model: 'pachinko',
  },

  // ------------------------------------------------------------------ tables
  {
    ...base, id: 'blackjack', name: 'Blackjack', category: 'tables', kind: 'blackjack', price: 3000, unlock: 3, size: [3, 3],
    seats: arcSeats(0, -0.55, 1.62, [-0.8, 0, 0.8], [[0, 2], [1, 2], [2, 2]], 'sit'),
    staff: { pos: [0, -1.05], face: 0, role: 'dealer' },
    minBet: 10, maxBet: 300, roundTime: 7, rtp: 0.95, cashCap: 7000, upkeep: 120, appeal: 0.9, appealRadius: 3, fun: 1.5, breakChance: 0,
    shared: true, description: 'Beat the dealer to 21. Comes with a dealer (daily wage).',
    colors: FELT_COLORS, model: 'blackjack',
  },
  {
    ...base, id: 'roulette', name: 'Roulette', category: 'tables', kind: 'roulette', price: 4500, unlock: 4, size: [3, 3],
    seats: [
      { tile: [0, 2], pos: [-1.0, 0.95], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [1, 2], pos: [-0.3, 0.95], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [1, 2], pos: [0.4, 0.95], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [2, 2], pos: [1.1, 0.95], face: Math.PI, pose: 'sit', seatY: 0.66 },
    ],
    staff: { pos: [-0.9, -1.0], face: 0, role: 'dealer' },
    minBet: 10, maxBet: 500, roundTime: 9, rtp: 0.92, cashCap: 10000, upkeep: 150, appeal: 1.1, appealRadius: 3, fun: 1.6,
    shared: true, description: 'Spin the wheel! Four seats and the most iconic sound in the casino.',
    colors: FELT_COLORS, model: 'roulette',
  },
  {
    ...base, id: 'wheel', name: 'Big Wheel', category: 'tables', kind: 'wheel', price: 2200, unlock: 5, size: [2, 2],
    seats: [
      { tile: [0, 1], pos: [-0.45, 0.6], face: Math.PI, pose: 'stand' },
      { tile: [1, 1], pos: [0.45, 0.6], face: Math.PI, pose: 'stand' },
    ],
    minBet: 5, maxBet: 150, roundTime: 8, rtp: 0.88, cashCap: 5000, appeal: 1.1, appealRadius: 3, fun: 1.3, breakChance: 1 / 400,
    shared: true, description: 'A giant money wheel with chasing lights. Simple and loud.',
    colors: [0xc8102e, 0x6a2cc2, 0x1f4fbf, 0x17151f, 0xf2b632], model: 'bigwheel',
  },
  {
    ...base, id: 'craps', name: 'Craps', category: 'tables', kind: 'craps', price: 6500, unlock: 6, size: [4, 3],
    seats: [
      { tile: [0, 2], pos: [-1.45, 0.95], face: Math.PI, pose: 'stand' },
      { tile: [1, 2], pos: [-0.5, 0.95], face: Math.PI, pose: 'stand' },
      { tile: [2, 2], pos: [0.5, 0.95], face: Math.PI, pose: 'stand' },
      { tile: [3, 2], pos: [1.45, 0.95], face: Math.PI, pose: 'stand' },
    ],
    staff: { pos: [0, -1.05], face: 0, role: 'dealer' },
    minBet: 10, maxBet: 500, roundTime: 6, rtp: 0.94, cashCap: 12000, upkeep: 180, appeal: 1.3, appealRadius: 3.5, fun: 1.7,
    shared: true, description: 'The loudest table in the house. Four shooters, one dealer.',
    colors: FELT_COLORS, model: 'craps',
  },
  {
    ...base, id: 'poker', name: "Hold'em Poker", category: 'tables', kind: 'poker', price: 9000, unlock: 7, size: [4, 3],
    seats: [
      { tile: [1, 2], pos: [-0.62, 1.2], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [2, 2], pos: [0.62, 1.2], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [0, 1], pos: [-1.75, 0.15], face: Math.PI / 2, pose: 'sit', seatY: 0.66 },
      { tile: [3, 1], pos: [1.75, 0.15], face: -Math.PI / 2, pose: 'sit', seatY: 0.66 },
      { tile: [0, 0], pos: [-1.3, -0.95], face: 0.7, pose: 'sit', seatY: 0.66 },
      { tile: [3, 0], pos: [1.3, -0.95], face: -0.7, pose: 'sit', seatY: 0.66 },
    ],
    staff: { pos: [0, -1.15], face: 0, role: 'dealer' },
    minBet: 25, maxBet: 800, roundTime: 11, rtp: 0.93, cashCap: 18000, upkeep: 220, appeal: 1.5, appealRadius: 3.5, fun: 1.8,
    shared: true, description: "Six seats of high-stakes Texas Hold'em against the house.",
    colors: FELT_COLORS, model: 'poker',
  },

  // ------------------------------------------------------------------ services
  {
    ...base, id: 'bar', name: 'Cocktail Bar', category: 'services', kind: 'bar', price: 2500, unlock: 2, size: [4, 3],
    seats: [-1.5, -0.5, 0.5, 1.5].map((x, i) => ({ tile: [i, 2] as [number, number], pos: [x, 0.62] as [number, number], face: Math.PI, pose: 'sit' as const, seatY: 0.74 })),
    staff: { pos: [0, -0.85], face: 0, role: 'bartender' },
    minBet: 10, maxBet: 22, roundTime: 8, cashCap: 3000, upkeep: 90, appeal: 1.3, appealRadius: 3.5, fun: 0.9,
    description: 'Thirsty guests stay longer and spend more. Comes with a bartender.',
    colors: WOOD_COLORS, model: 'bar',
  },
  {
    ...base, id: 'snack', name: 'Snack Bar', category: 'services', kind: 'snack', price: 1800, unlock: 4, size: [3, 3],
    seats: [-1, 0, 1].map((x, i) => ({ tile: [i, 2] as [number, number], pos: [x, 0.62] as [number, number], face: Math.PI, pose: 'sit' as const, seatY: 0.74 })),
    staff: { pos: [0, -0.85], face: 0, role: 'chef' },
    minBet: 8, maxBet: 18, roundTime: 9, cashCap: 2500, upkeep: 70, appeal: 0.8, appealRadius: 3, fun: 0.8,
    description: 'Burgers and fries keep hungry gamblers happy. Comes with a chef.',
    colors: [0xc8102e, 0xf2b632, 0x1f4fbf, 0x1e7a46, 0x17151f], model: 'snack',
  },
  {
    ...base, id: 'atm', name: 'ATM', category: 'services', kind: 'atm', price: 1200, unlock: 3, size: [1, 2],
    seats: standSeat, minBet: 4, maxBet: 4, roundTime: 4, cashCap: 1500, fun: 0.6, breakChance: 1 / 150,
    description: 'Guests who run dry can withdraw more cash (and pay you a fee).',
    colors: [0x2b2b35, 0x1f4fbf, 0x1e7a46, 0xc8102e], model: 'atm',
  },
  {
    ...base, id: 'bench', name: 'Lounge Bench', category: 'services', kind: 'bench', price: 150, unlock: 1, size: [2, 1],
    seats: [
      { tile: [0, 0], pos: [-0.48, 0.08], face: 0, pose: 'sit', seatY: 0.46 },
      { tile: [1, 0], pos: [0.48, 0.08], face: 0, pose: 'sit', seatY: 0.46 },
    ],
    roundTime: 10, appeal: 0.2, fun: 0.5,
    description: 'Tired guests take a breather here instead of heading home.',
    colors: [0x5a0f24, 0x1f4fbf, 0x1e7a46, 0x17151f, 0x6a2cc2, 0xf2b632], model: 'bench',
  },
  {
    ...base, id: 'stage', name: 'Show Stage', category: 'services', kind: 'stage', price: 15000, unlock: 7, size: [4, 3],
    staff: { pos: [0, -0.2], face: 0, role: 'performer' },
    upkeep: 300, appeal: 4, appealRadius: 6, fun: 1.4,
    description: 'A live performer lifts the mood of everyone nearby. Comes with a star (daily wage).',
    colors: [0xc8102e, 0x6a2cc2, 0x1f4fbf, 0x17151f], model: 'stage',
  },

  // ------------------------------------------------------------------ decor
  {
    ...base, id: 'plant', name: 'Potted Plant', category: 'decor', kind: 'decor', price: 60, unlock: 1, size: [1, 1],
    appeal: 0.6, appealRadius: 2.5, description: 'A splash of green. Small but it adds up.',
    colors: [0x2c2433, 0xe9e1d3, 0xc2573a, 0xf2b632], model: 'plant',
  },
  {
    ...base, id: 'rope', name: 'Velvet Rope', category: 'decor', kind: 'decor', price: 80, unlock: 1, size: [1, 1],
    appeal: 0.35, appealRadius: 1.5, description: 'Gold stanchions and red velvet. Instant VIP vibes.',
    colors: [0x9b0f2a, 0x1f4fbf, 0x6a2cc2, 0x17151f], model: 'rope',
  },
  {
    ...base, id: 'bin', name: 'Trash Bin', category: 'decor', kind: 'decor', price: 70, unlock: 1, size: [1, 1],
    appeal: 0.1, appealRadius: 1, litterReduce: 4, description: 'Guests nearby litter far less.',
    colors: [0x9aa0ab, 0x17151f, 0xf2b632, 0x1e7a46], model: 'bin',
  },
  {
    ...base, id: 'rug', name: 'Royal Rug', category: 'decor', kind: 'decor', price: 150, unlock: 1, size: [2, 3], layer: 'floor',
    appeal: 0.5, appealRadius: 2, description: 'A plush rug you can place things on top of.',
    colors: [0x8a1030, 0x1d3f8a, 0x1e5a3a, 0x5a2a8a, 0x1a1a24], model: 'rug',
  },
  {
    ...base, id: 'palm', name: 'Palm Tree', category: 'decor', kind: 'decor', price: 250, unlock: 2, size: [1, 1],
    appeal: 1.1, appealRadius: 3, description: 'Tropical luxury, indoors.',
    colors: [0xe9e1d3, 0x2c2433, 0xf2b632, 0xc2573a], model: 'palm',
  },
  {
    ...base, id: 'lamp', name: 'Golden Lamp', category: 'decor', kind: 'decor', price: 180, unlock: 2, size: [1, 1],
    appeal: 0.6, appealRadius: 2.5, description: 'Warm light for a classy corner.',
    colors: [0xffe2a8, 0xff9fcf, 0x9fe8ff, 0xc9ffb0], model: 'lamp',
  },
  {
    ...base, id: 'neon', name: 'Neon Sign', category: 'decor', kind: 'decor', price: 450, unlock: 3, size: [1, 1],
    appeal: 1.2, appealRadius: 3, description: 'A buzzing neon symbol on a stand.',
    colors: NEON, model: 'neon',
  },
  {
    ...base, id: 'dice', name: 'Giant Dice', category: 'decor', kind: 'decor', price: 600, unlock: 3, size: [1, 1],
    appeal: 1.0, appealRadius: 3, description: 'Two enormous dice. You know you want them.',
    colors: [0xc8102e, 0xf4f1ea, 0x17151f, 0x1f4fbf, 0x3ddc84], model: 'dice',
  },
  {
    ...base, id: 'pillar', name: 'Gold Pillar', category: 'decor', kind: 'decor', price: 900, unlock: 4, size: [1, 1],
    appeal: 1.3, appealRadius: 3, description: 'A fluted golden column. Pure opulence.',
    colors: [0xf2b632, 0xe9e1d3, 0x17151f, 0xff6fb5], model: 'pillar',
  },
  {
    ...base, id: 'fountain', name: 'Fountain', category: 'decor', kind: 'decor', price: 2500, unlock: 4, size: [2, 2],
    appeal: 3, appealRadius: 4.5, description: 'A tiered marble fountain. Guests toss in coins for luck.',
    colors: [0xe9e1d3, 0x2c2433, 0xf2b632, 0x9fb8d9], model: 'fountain',
  },
  {
    ...base, id: 'aquarium', name: 'Aquarium', category: 'decor', kind: 'decor', price: 3500, unlock: 5, size: [2, 1],
    appeal: 2.6, appealRadius: 4, description: 'Tropical fish drifting past the slot floor.',
    colors: [0x17151f, 0xf2b632, 0xe9e1d3, 0x2b2b35], model: 'aquarium',
  },
  {
    ...base, id: 'statue', name: 'Golden You', category: 'decor', kind: 'decor', price: 6000, unlock: 6, size: [1, 1],
    appeal: 3.5, appealRadius: 4.5, description: 'A solid-gold statue of the manager. Humble? Never.',
    colors: [0xe9e1d3, 0x17151f, 0x5a0f24], model: 'statue',
  },
  {
    ...base, id: 'moneytree', name: 'Money Tree', category: 'decor', kind: 'decor', price: 8000, unlock: 8, size: [1, 1],
    appeal: 4, appealRadius: 5, description: 'It literally grows cash. Well, it looks like it does.',
    colors: [0xf2b632, 0xe9e1d3, 0x17151f], model: 'moneytree',
  },
  {
    ...base, id: 'diamond', name: 'Giant Diamond', category: 'decor', kind: 'decor', price: 30000, unlock: 10, size: [2, 2],
    appeal: 8, appealRadius: 7, description: 'A spinning, glittering diamond the size of a car. The ultimate flex.',
    colors: [0x7ff3ff, 0xff9fcf, 0xfff4b0, 0xb9a0ff], model: 'giantdiamond',
  },
  // ------------------------------------------------------------------ more classics
  {
    ...base, id: 'videopoker', name: 'Video Poker', category: 'slots', kind: 'videopoker', price: 1800, unlock: 3, size: [1, 2],
    seats: slotSeat, minBet: 5, maxBet: 100, roundTime: 3.2, rtp: 0.96, appeal: 0.5, fun: 1.25, breakChance: 1 / 300,
    description: 'Jacks or Better, 9/6 paytable. Hold your cards and draw.',
    colors: [0x17151f, 0x1f4fbf, 0xc8102e, 0x6a2cc2], model: 'slot', params: { topper: 'VIDEO POKER', topColor: '#7ff3ff', deco: 'diamond' },
  },
  {
    ...base, id: 'keno', name: 'Keno Lounge', category: 'slots', kind: 'keno', price: 1200, unlock: 3, size: [1, 2],
    seats: slotSeat, minBet: 2, maxBet: 50, roundTime: 4, rtp: 0.75, appeal: 0.45, fun: 1.0, breakChance: 1 / 320,
    description: 'Pick up to ten numbers of 80 and watch twenty balls drop.',
    colors: [0xf2b632, 0x1e7a46, 0x17151f, 0xc8102e], model: 'slot', params: { topper: 'KENO', topColor: '#ffd24a', deco: 'candle', volatility: 'low' },
  },
  {
    ...base, id: 'baccarat', name: 'Baccarat', category: 'tables', kind: 'baccarat', price: 8000, unlock: 6, size: [3, 3],
    seats: arcSeats(0, -0.55, 1.62, [-0.8, 0, 0.8], [[0, 2], [1, 2], [2, 2]], 'sit'),
    staff: { pos: [0, -1.05], face: 0, role: 'dealer' },
    minBet: 25, maxBet: 1000, roundTime: 7, rtp: 0.99, upkeep: 160, appeal: 1.2, appealRadius: 3, fun: 1.55, breakChance: 0,
    shared: true, description: 'Punto banco: bet on the player, the banker or a tie. A high-roller favourite.',
    colors: [0x8a1030, 0x0f7a45, 0x1a1a24, 0x1d4fa0], model: 'blackjack', params: { felt: 'baccarat' },
  },
  {
    ...base, id: 'threecard', name: 'Three Card Poker', category: 'tables', kind: 'threecard', price: 5000, unlock: 5, size: [4, 3],
    seats: [
      { tile: [1, 2], pos: [-0.62, 1.2], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [2, 2], pos: [0.62, 1.2], face: Math.PI, pose: 'sit', seatY: 0.66 },
      { tile: [0, 1], pos: [-1.75, 0.15], face: Math.PI / 2, pose: 'sit', seatY: 0.66 },
      { tile: [3, 1], pos: [1.75, 0.15], face: -Math.PI / 2, pose: 'sit', seatY: 0.66 },
    ],
    staff: { pos: [0, -1.15], face: 0, role: 'dealer' },
    minBet: 10, maxBet: 500, roundTime: 8, rtp: 0.97, upkeep: 150, appeal: 1.2, appealRadius: 3.2, fun: 1.6,
    shared: true, description: 'Ante, Play and Pair Plus against the dealer\'s three cards.',
    colors: FELT_COLORS, model: 'poker', params: { felt: 'threecard' },
  },
  {
    ...base, id: 'sicbo', name: 'Sic Bo', category: 'tables', kind: 'sicbo', price: 5500, unlock: 6, size: [4, 3],
    seats: [
      { tile: [0, 2], pos: [-1.45, 0.95], face: Math.PI, pose: 'stand' },
      { tile: [1, 2], pos: [-0.5, 0.95], face: Math.PI, pose: 'stand' },
      { tile: [2, 2], pos: [0.5, 0.95], face: Math.PI, pose: 'stand' },
      { tile: [3, 2], pos: [1.45, 0.95], face: Math.PI, pose: 'stand' },
    ],
    staff: { pos: [0, -1.05], face: 0, role: 'dealer' },
    minBet: 10, maxBet: 500, roundTime: 6, rtp: 0.93, upkeep: 150, appeal: 1.2, appealRadius: 3.5, fun: 1.6,
    shared: true, description: 'Three dice under a glass shaker: big, small, totals and triples.',
    colors: [0x8a1030, ...FELT_COLORS], model: 'craps', params: { felt: 'sicbo', dice: 3 },
  },
  {
    ...base, id: 'elevator', name: 'Elevator', category: 'services', kind: 'elevator', price: 0, unlock: 99, size: [2, 3],
    appeal: 0.5, appealRadius: 2.5, fixed: true,
    description: 'Takes guests and staff between floors.',
    colors: [0x3a1d4d], model: 'elevator',
  },
  // ------------------------------------------------------------------ hotel
  {
    ...base, id: 'reception', name: 'Reception Desk', category: 'services', kind: 'desk', price: 800, unlock: 1, size: [4, 2], sites: ['hotel'],
    seats: [-0.5, 0.5].map((x, i) => ({ tile: [i + 1, 1] as [number, number], pos: [x, 0.9] as [number, number], face: Math.PI, pose: 'stand' as const })),
    staff: { pos: [0, -0.35], face: 0, role: 'bartender' },
    roundTime: 3.5, upkeep: 40, appeal: 0.6, appealRadius: 3,
    description: 'Guests check in here before heading to their room. No desk, no guests.',
    colors: [0x5a1426, 0x2a1a12, 0x1f2748, 0xe9e1d3], model: 'frontdesk',
  },
  {
    ...base, id: 'room', name: 'Hotel Room', category: 'rooms', kind: 'room', price: 2000, unlock: 1, size: [4, 4], sites: ['hotel'],
    seats: [{ tile: [2, 3], pos: [-0.6, 0.05], face: 0, pose: 'sit', seatY: 0.5 }],
    roundTime: 32, upkeep: 15, appeal: 0.2, appealRadius: 2, fun: 1,
    description: 'Four walls and a single bed. Click it to decorate: the more you spend, the more a night costs.',
    colors: [0xd8cbb4], model: 'room', params: { suite: 0 },
  },
  {
    ...base, id: 'suite', name: 'Luxury Suite', category: 'rooms', kind: 'room', price: 9000, unlock: 4, size: [6, 5], sites: ['hotel'],
    seats: [{ tile: [3, 4], pos: [-1.5, -0.45], face: 0, pose: 'sit', seatY: 0.5 }],
    roundTime: 40, upkeep: 45, appeal: 0.5, appealRadius: 2.5, fun: 1.3,
    description: 'A big room with space for a jacuzzi and a grand piano. High rollers love it.',
    colors: [0xd8cbb4], model: 'room', params: { suite: 1 },
  },
  {
    ...base, id: 'pool', name: 'Swimming Pool', category: 'services', kind: 'pool', price: 12000, unlock: 3, size: [5, 4], sites: ['hotel'],
    seats: [
      { tile: [1, 3], pos: [-1.2, 0.7], face: Math.PI, pose: 'sit', seatY: 0.08 },
      { tile: [3, 3], pos: [0.9, 0.6], face: Math.PI * 0.8, pose: 'sit', seatY: 0.08 },
      { tile: [0, 1], pos: [-1.3, -0.6], face: Math.PI * 0.5, pose: 'sit', seatY: 0.08 },
      { tile: [4, 2], pos: [1.4, -0.3], face: -Math.PI * 0.5, pose: 'sit', seatY: 0.08 },
    ],
    roundTime: 14, upkeep: 120, appeal: 2.2, appealRadius: 5, fun: 1.3,
    description: 'Guests swim between nights. A big boost to your hotel’s rating.',
    colors: [0x2fb8e0, 0x39c9a8, 0x3a6ee0], model: 'pool',
  },
];

export const ITEM_BY_ID = new Map(ITEMS.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID.get(id);
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'slots', label: 'Machines' },
  { id: 'tables', label: 'Tables' },
  { id: 'services', label: 'Services' },
  { id: 'decor', label: 'Decor' },
];

// ------------------------------------------------------------------ rotation math

export function rotatedSize(def: ItemDef, rot: number): [number, number] {
  return rot % 2 === 0 ? [def.size[0], def.size[1]] : [def.size[1], def.size[0]];
}

/** Rotate a local offset (relative to footprint centre) by rot × 90° (same convention as Object3D.rotation.y). */
export function rotateOffset(px: number, pz: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [pz, -px];
    case 2:
      return [-px, -pz];
    case 3:
      return [-pz, px];
    default:
      return [px, pz];
  }
}

export function footprintCenter(def: ItemDef, tx: number, tz: number, rot: number): [number, number] {
  const [w, d] = rotatedSize(def, rot);
  return [tx + w / 2, tz + d / 2];
}

export function localTileToWorld(def: ItemDef, tx: number, tz: number, rot: number, lx: number, lz: number): [number, number] {
  const [cx, cz] = footprintCenter(def, tx, tz, rot);
  const ox = lx + 0.5 - def.size[0] / 2;
  const oz = lz + 0.5 - def.size[1] / 2;
  const [rx, rz] = rotateOffset(ox, oz, rot);
  return [Math.round(cx + rx - 0.5), Math.round(cz + rz - 0.5)];
}

export function localPosToWorld(def: ItemDef, tx: number, tz: number, rot: number, px: number, pz: number): [number, number] {
  const [cx, cz] = footprintCenter(def, tx, tz, rot);
  const [rx, rz] = rotateOffset(px, pz, rot);
  return [cx + rx, cz + rz];
}

export function footprintTiles(def: ItemDef, tx: number, tz: number, rot: number): [number, number][] {
  const [w, d] = rotatedSize(def, rot);
  const out: [number, number][] = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push([tx + x, tz + z]);
  return out;
}

export function describeItem(def: ItemDef): string {
  const seats = def.seats.length;
  switch (def.kind) {
    case 'decor':
      return def.litterReduce ? 'Cuts litter nearby' : `Appeal +${def.appeal}`;
    case 'bar':
    case 'snack':
      return `Sells $${def.minBet}–$${def.maxBet} · ${seats} stools`;
    case 'atm':
      return `Withdrawal fee $${def.minBet}`;
    case 'bench':
      return `${seats} seats · rest spot`;
    case 'stage':
      return `Mood boost · radius ${def.appealRadius}`;
    case 'claw':
      return `Plays $${def.minBet}–$${def.maxBet} · prizes`;
    case 'room':
      return 'Decorate after placing';
    case 'desk':
      return `Check-in · ${seats} guests at a time`;
    case 'pool':
      return `${seats} swimmers · big appeal`;
    case 'elevator':
      return 'Links the floors';
    default:
      return `Bets $${def.minBet}–$${def.maxBet} · ${seats} ${seats === 1 ? 'seat' : 'seats'}`;
  }
}

/** Items the casino shop sells by default: all of them except the hotel's; decor and services are shared. */
const SHARED_KINDS = new Set<GameKind>(['decor', 'bench', 'bar', 'snack', 'atm', 'stage']);

export function itemSites(d: ItemDef): Site[] {
  if (d.sites) return d.sites;
  return SHARED_KINDS.has(d.kind) ? ['casino', 'hotel'] : ['casino'];
}

export function soldAt(d: ItemDef, site: Site): boolean {
  return !d.fixed && !d.hidden && itemSites(d).includes(site);
}

export function categoriesFor(site: Site): { id: Category; label: string }[] {
  return site === 'hotel'
    ? [{ id: 'rooms', label: 'Rooms' }, { id: 'services', label: 'Services' }, { id: 'decor', label: 'Decor' }]
    : CATEGORIES;
}
