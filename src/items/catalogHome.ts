import type { Category, ItemDef, Site } from './catalog';

type Base = Pick<ItemDef, 'seats' | 'minBet' | 'maxBet' | 'roundTime' | 'rtp' | 'cashCap' | 'upkeep' | 'appeal' | 'appealRadius' | 'fun' | 'breakChance' | 'colors'>;

/** [id, name, price, unlock, size, appeal, colors, description, extra] */
type Row = [string, string, number, number, [number, number], number, number[], string, Partial<ItemDef>?];

const WOODS = [0x5a3a1a, 0x2a1a12, 0x8a5a2e, 0xe9e1d3, 0x17151f];
const FABRIC = [0x8a1030, 0x1f2748, 0x145a3e, 0x6a2cc2, 0xd8cbb4, 0x17151f, 0xc89b3c];
const POTS = [0x2c2433, 0xe9e1d3, 0xc2573a, 0xf2b632, 0x1f4fbf];
const NEON = [0xff3fa4, 0x2fe6ff, 0xffc53d, 0x39ff88, 0xb77bff, 0xff4d4d];
const BRIGHT = [0xc8102e, 0x1f4fbf, 0x1e7a46, 0xffc53d, 0x6a2cc2, 0xff6fb5, 0x17151f];

/** Decorations every business (and your house) can buy. */
const DECOR: Row[] = [
  ['bust', 'Marble Bust', 700, 2, [1, 1], 1.2, [0x17151f, 0x8a1030, 0x1f2748, 0xe9e1d3], 'A classical marble head on a pedestal. Very cultured.'],
  ['icesculpt', 'Ice Swan', 1800, 4, [1, 1], 2, [0x2b2b35], 'A swan carved from ice that somehow never melts.'],
  ['candelabra', 'Gold Candelabra', 900, 3, [1, 1], 1.3, [0xf2b632], 'Five flickering candles on a golden stand.'],
  ['vase', 'Crystal Vase', 350, 1, [1, 1], 0.8, [0x9fdcff, 0xffc0d8, 0xd8c8ff, 0xc9ffd0], 'Fresh flowers in cut crystal.'],
  ['bonsai', 'Bonsai Tree', 500, 2, [1, 1], 0.9, POTS, 'A tiny ancient tree. Zen for the high rollers.'],
  ['cactus', 'Desert Cactus', 120, 1, [1, 1], 0.5, POTS, 'A little piece of the desert, with a flower on top.'],
  ['planter', 'Flower Planter', 260, 1, [2, 1], 0.9, [0xe9e1d3, 0x2c2433, 0x8a5a2e], 'A long box of bright flowers.'],
  ['neonflamingo', 'Neon Flamingo', 650, 2, [1, 1], 1.3, [0xff6fb5, 0x2fe6ff, 0xffc53d], 'A pink neon flamingo. Pure Vegas.'],
  ['neoncherry', 'Neon Cherries', 650, 2, [1, 1], 1.3, [0xff2a4a], 'The classic slot cherries in buzzing neon.'],
  ['neoncrown', 'Neon Crown', 900, 4, [1, 1], 1.6, NEON, 'A glowing crown for the kings and queens of the floor.'],
  ['chipstack', 'Giant Chip Stack', 800, 3, [1, 1], 1.2, [0xc8102e, 0x1f4fbf, 0x1e7a46, 0x6a2cc2], 'Three towers of oversized casino chips.'],
  ['giantcard', 'Giant Ace', 750, 3, [1, 1], 1.2, [0x17151f, 0xc8102e], 'A playing card as tall as a guest.'],
  ['goldbars', 'Gold Bar Pyramid', 5000, 6, [1, 1], 3, [0xf2b632], 'A pyramid of solid gold bars. Nobody touches.'],
  ['moneybags', 'Money Bags', 1500, 4, [1, 1], 1.6, [0x1e7a46], 'Sacks of cash with dollar signs on them.'],
  ['champagne', 'Champagne Tower', 2200, 5, [1, 1], 2.2, [0xf4f1ea], 'A pyramid of glasses waiting to be filled.'],
  ['grandpiano', 'Grand Piano', 9000, 6, [2, 2], 3.5, [0x0b0b0e], 'A gleaming black concert grand.', { appealRadius: 4.5 }],
  ['harp', 'Golden Harp', 3500, 5, [1, 1], 2.2, [0xf2b632], 'A gilded harp. Angels sold separately.'],
  ['jukebox', 'Jukebox', 2000, 3, [1, 1], 2, [0xc8102e, 0x1f4fbf, 0xf4f1ea, 0x17151f], 'A retro jukebox with chasing lights.'],
  ['classiccar', 'Classic Car', 25000, 8, [2, 4], 6, [0xc8102e, 0x7ff3ff, 0xf4f1ea, 0x17151f, 0xff6fb5], 'A 1950s convertible on a show platform.', { appealRadius: 6 }],
  ['motorbike', 'Chrome Motorcycle', 8000, 5, [1, 2], 2.8, [0xc8102e, 0x17151f, 0x1f4fbf, 0xf2b632], 'A gleaming cruiser bike on display.'],
  ['armor', 'Suit of Armor', 2800, 4, [1, 1], 1.8, [0xc8102e, 0x1f4fbf, 0xf2b632], 'A knight standing guard with a spear.'],
  ['sphinx', 'Golden Sphinx', 12000, 7, [2, 2], 4.5, [0xf2b632], 'A gold sphinx straight from the desert palaces.', { appealRadius: 5 }],
  ['obelisk', 'Obelisk', 3000, 5, [1, 1], 2, [0xd8c39a, 0x17151f, 0xe9e1d3], 'A tall stone obelisk with a gold tip.'],
  ['globe', 'Antique Globe', 1100, 3, [1, 1], 1.3, [0x5a3a1a], 'A slowly turning globe on a wooden stand.'],
  ['grandclock', 'Grandfather Clock', 1600, 3, [1, 1], 1.5, [0x5a3a1a], 'Tick, tock. Its pendulum swings all night.'],
  ['waterwall', 'Water Wall', 6000, 6, [2, 1], 3.2, [0x3a3844], 'Water sheeting down a stone wall into a pool.', { appealRadius: 4 }],
  ['firebowl', 'Fire Bowl', 1400, 4, [1, 1], 1.8, [0x2b2b35], 'Real flames dancing in an iron bowl.'],
  ['discoball', 'Disco Ball', 2500, 4, [1, 1], 2.2, [0xe8eef6], 'A spinning mirror ball that changes colour.'],
  ['lavalamp', 'Lava Lamp', 300, 1, [1, 1], 0.7, [0xff3fa4, 0x2fe6ff, 0x39ff88, 0xffc53d], 'Groovy blobs floating up and down.'],
  ['bamboo', 'Bamboo Pot', 280, 2, [1, 1], 0.8, POTS, 'Tall bamboo stalks in a big pot.'],
  ['topiary', 'Topiary Spiral', 600, 3, [1, 1], 1.1, POTS, 'A hedge trimmed into a perfect spiral.'],
  ['birdcage', 'Parrot Cage', 1300, 4, [1, 1], 1.6, [0xf2b632], 'A golden cage with a chatty red parrot.'],
  ['telescope', 'Brass Telescope', 1200, 4, [1, 1], 1.2, [0xc9a24a], 'For spotting high rollers from across the room.'],
  ['dragon', 'Jade Dragon', 15000, 8, [2, 2], 5, [0x2fa86a], 'A coiled jade dragon guarding a golden pearl.', { appealRadius: 5.5 }],
  ['lion', 'Stone Lion', 2400, 5, [1, 1], 1.8, [0xc8102e, 0xf2b632, 0x1f4fbf], 'A proud guardian lion.'],
  ['angel', 'Angel Statue', 3200, 5, [1, 1], 2, [0xf4f1ea], 'A marble angel with a glowing halo.'],
  ['trophy', 'Golden Trophy', 1800, 4, [1, 1], 1.5, [0x17151f], 'A champion’s cup on a black plinth.'],
  ['velvetsofa', 'Velvet Sofa', 1200, 2, [2, 1], 1.3, FABRIC, 'A plush velvet sofa (just for show).'],
  ['redrunner', 'Red Carpet Runner', 200, 1, [1, 3], 0.6, [0xa0101f, 0x1f2748, 0x145a3e, 0x17151f], 'A gold-edged runner you can place things on.', { layer: 'floor' }],
  ['starfloor', 'Star Floor Inlay', 700, 3, [2, 2], 1.3, [0x17151f, 0x1f2748, 0x8a1030, 0xe9e1d3], 'A golden star set into the floor.', { layer: 'floor' }],
  ['checkrug', 'Checkered Rug', 250, 1, [2, 2], 0.6, [0x17151f, 0xc8102e, 0x1f4fbf, 0x1e7a46], 'A bold checkerboard rug.', { layer: 'floor' }],
  ['photobooth', 'Photo Booth', 3000, 4, [1, 2], 2, [0xc8102e, 0x1f4fbf, 0x6a2cc2, 0x17151f], 'Strike a pose: four snaps for the memories.'],
  ['balloonarch', 'Balloon Arch', 900, 2, [2, 1], 1.6, [0xffffff], 'A rainbow arch of balloons.'],
  ['giftpile', 'Gift Pile', 400, 1, [1, 1], 0.8, [0xffffff], 'A pile of wrapped presents.'],
  ['xmastree', 'Holiday Tree', 1500, 2, [1, 1], 2, POTS, 'A twinkling tree with a star on top.'],
  ['pumpkins', 'Pumpkin Pile', 300, 1, [1, 1], 0.7, [0xff8a1f], 'Three pumpkins, one with a candle inside.'],
  ['pinball', 'Pinball Machine', 2600, 3, [1, 2], 1.8, [0x1f4fbf, 0xc8102e, 0x6a2cc2, 0x17151f], 'A blinking pinball table (display only).'],
  ['arcade', 'Arcade Cabinet', 1900, 2, [1, 1], 1.5, [0x6a2cc2, 0xc8102e, 0x1f4fbf, 0x17151f], 'A retro arcade cabinet with a glowing screen.'],
  ['teddy', 'Giant Teddy Bear', 700, 2, [1, 1], 1.2, [0x8a5a2e, 0xff9fcf, 0xf4f1ea, 0x6b4422], 'A huge, huggable bear with a bow.'],
  ['rocket', 'Rocket Statue', 4000, 6, [1, 1], 2.5, [0xc8102e, 0x1f4fbf, 0xf2b632], 'A retro rocket blasting off (forever).'],
  ['trex', 'T-Rex Skeleton', 40000, 10, [3, 2], 7, [0xeae2cf], 'A full dinosaur skeleton. Guests can’t stop taking photos.', { appealRadius: 7 }],
  ['hotairballoon', 'Hot Air Balloon', 2800, 5, [1, 1], 1.8, BRIGHT, 'A little balloon model bobbing on a string.'],
  ['elephant', 'Golden Elephant', 18000, 9, [2, 2], 5.5, [0xf2b632], 'A gold elephant with a red saddle.', { appealRadius: 6 }],
  ['mirrorcol', 'Mirror Column', 1000, 3, [1, 1], 1.3, [0xdde8f2], 'A mirrored pillar with gold caps.'],
  ['slotsculpt', 'Lucky 7 Sculpture', 3600, 5, [1, 1], 2.2, [0xc8102e], 'A giant red 7. Good luck guaranteed (not guaranteed).'],
  ['horseshoe', 'Lucky Horseshoe', 500, 2, [1, 1], 1, [0xf2b632], 'A golden horseshoe on a stand.'],
  ['ledcube', 'LED Light Cube', 1700, 4, [1, 1], 1.6, [0xffffff], 'A cube that slowly cycles through every colour.'],
  ['crystaltree', 'Crystal Tree', 6500, 7, [1, 1], 3, [0x17151f], 'A tree with glowing crystal leaves.', { appealRadius: 4 }],
  ['koi', 'Koi Pond', 4500, 5, [2, 2], 2.8, [0x8a8178], 'A round pond with koi circling the lily pads.', { appealRadius: 4 }],
  ['wetfloor', 'Wet Floor Sign', 40, 1, [1, 1], 0, [0xffd23f], 'Safety first. (It does nothing else.)'],
];

/** Hotel lobby touches. */
const HOTEL_DECOR: Row[] = [
  ['luggagecart', 'Luggage Cart', 500, 1, [1, 1], 0.9, [0xf2b632], 'A brass bellhop cart piled with suitcases.'],
  ['bellstand', 'Bell Desk', 350, 1, [1, 1], 0.6, [0x5a3a1a], 'Ring for service!'],
  ['roomservice', 'Room Service Cart', 600, 2, [1, 1], 0.8, [0xf4f1ea], 'Breakfast under a silver cloche.'],
  ['umbrellastand', 'Umbrella Stand', 150, 1, [1, 1], 0.3, [0xf2b632], 'Brollies for guests, rain or shine.'],
  ['directory', 'Lobby Directory', 450, 1, [1, 1], 0.6, [0x17151f], 'A lit sign pointing the way to everything.'],
];

/** Outdoor touches: yards, Pool Gardens and your house. */
const GARDEN: Row[] = [
  ['flowerbed', 'Flower Bed', 300, 1, [2, 1], 1.1, [0xff4d4d, 0xffc53d, 0xff6fb5, 0xb77bff], 'A raised bed bursting with flowers.'],
  ['gnome', 'Garden Gnome', 90, 1, [1, 1], 0.5, [0xc8102e, 0x1f4fbf, 0x1e7a46], 'He guards the garden. Fiercely.'],
  ['birdbath', 'Bird Bath', 400, 1, [1, 1], 0.9, [0xd8d2c6], 'A stone bath with a little bird.'],
  ['tikitorch', 'Tiki Torch', 250, 1, [1, 1], 0.9, [0x8a5a2e], 'A bamboo torch with a real flame.'],
  ['hammock', 'Hammock', 700, 2, [2, 1], 1.2, [0xf4f1ea, 0x2fb8c9, 0xff8a1f, 0xff6fb5], 'A lazy hammock swaying in the breeze.'],
  ['bbq', 'BBQ Grill', 900, 2, [1, 1], 1, [0xc8102e, 0x17151f, 0x1e7a46], 'A kettle grill with smoke rising.'],
  ['firepit', 'Fire Pit', 1600, 3, [2, 2], 2, [0x8a8178], 'A stone ring of crackling flames.'],
  ['flamingo', 'Lawn Flamingo', 80, 1, [1, 1], 0.5, [0xff6fb5], 'The plastic classic.'],
  ['gardenlamp', 'Garden Lantern', 220, 1, [1, 1], 0.6, [0x17151f], 'A warm lantern on a post.'],
  ['hedgeanimal', 'Hedge Bunny', 1200, 3, [1, 1], 1.5, POTS, 'A hedge trimmed into a rabbit.'],
  ['gazebo', 'Gazebo', 7000, 5, [3, 3], 3.5, [0xc8102e, 0x1f4fbf, 0x1e7a46, 0xf4f1ea], 'A white gazebo with a bench inside.', { appealRadius: 4.5 }],
  ['beachballs', 'Beach Balls', 150, 1, [1, 1], 0.6, [0xffffff], 'A pile of striped beach balls.'],
  ['picnic', 'Picnic Table', 500, 1, [2, 2], 0.8, [0x9a6a3c], 'A wooden picnic table with a red cloth.'],
];

/** House furniture. */
const FURNITURE: Row[] = [
  ['sofa', 'Leather Sofa', 1500, 1, [3, 1], 1.2, [0x5a3a1a, 0x17151f, 0xe9e1d3, 0x8a1030, 0x1f2748], 'A long leather sofa with cushions.'],
  ['armchair', 'Armchair', 600, 1, [1, 1], 0.6, FABRIC, 'A comfy reading chair.'],
  ['coffeetable', 'Coffee Table', 400, 1, [2, 1], 0.5, WOODS, 'Glass top, gold legs, a book and a mug.'],
  ['tvwall', 'Big-Screen TV', 2500, 1, [2, 1], 1, WOODS, 'A huge flat screen on a media cabinet.'],
  ['kingbed', 'King Bed', 3000, 1, [3, 3], 1.5, FABRIC, 'A king-size bed with silk sheets.'],
  ['wardrobe', 'Wardrobe', 1100, 1, [2, 1], 0.6, WOODS, 'For your many, many suits.'],
  ['bookshelf', 'Bookshelf', 800, 1, [2, 1], 0.8, WOODS, 'Floor-to-ceiling books (some of them read).'],
  ['diningtable', 'Dining Table', 1800, 1, [3, 2], 1.2, WOODS, 'Six chairs and candles for a family dinner.'],
  ['kitchen', 'Kitchen Counter', 2200, 1, [3, 1], 0.8, [0xf4f1ea, 0x17151f, 0x1f2748, 0x145a3e], 'Counter, sink and cupboards.'],
  ['fridge', 'Fridge', 1300, 1, [1, 1], 0.4, [0xd8dde3, 0x17151f, 0xc8102e], 'A big double-door fridge.'],
  ['stove', 'Stove', 900, 1, [1, 1], 0.4, [0xd8dde3, 0x17151f], 'Four burners and an oven.'],
  ['bathtub', 'Gold Bathtub', 3500, 2, [2, 1], 1.4, [0xf2b632], 'A clawfoot tub full of bubbles.'],
  ['desk', 'Office Desk', 1400, 1, [2, 1], 0.6, WOODS, 'Where the empire is run from.'],
  ['fireplace', 'Fireplace', 2800, 2, [2, 1], 2, [0xe9e1d3, 0x8a8178, 0x17151f], 'A crackling fire under a stone mantel.'],
  ['floorlamp', 'Floor Lamp', 200, 1, [1, 1], 0.5, [0xf4f1ea, 0xc8102e, 0x17151f], 'Soft light for a cosy corner.'],
  ['plantbig', 'Fiddle-Leaf Fig', 180, 1, [1, 1], 0.6, POTS, 'The houseplant everyone wants.'],
  ['nightstand', 'Nightstand', 250, 1, [1, 1], 0.4, WOODS, 'With a little lamp on top.'],
  ['winerack', 'Wine Rack', 1600, 3, [2, 1], 1, WOODS, 'Forty bottles of the good stuff.'],
  ['homebar', 'Home Bar', 2400, 3, [2, 1], 1.5, WOODS, 'A private bar with neon trim and stools.'],
];

/** Things to do at home. */
const FUN: Row[] = [
  ['pooltable', 'Pool Table', 4000, 2, [3, 2], 1.8, [0x1e7a46, 0x1d4fa0, 0x8a1030], 'Racked up and ready to break.'],
  ['pingpong', 'Ping Pong Table', 1800, 1, [3, 2], 1, [0x1f4fbf, 0x1e7a46], 'Best of five?'],
  ['drumkit', 'Drum Kit', 2200, 2, [2, 2], 1.4, [0xc8102e, 0x17151f, 0x1f4fbf, 0xf2b632], 'Rock star practice.'],
  ['homecinema', 'Home Cinema', 8000, 4, [3, 1], 2.5, [0x8a1030, 0x17151f], 'A giant screen playing movies all night.'],
  ['gamingrig', 'Gaming Setup', 3000, 2, [2, 1], 1.4, [0x17151f, 0xc8102e, 0x1f4fbf], 'Three monitors and RGB everything.'],
  ['treadmill', 'Treadmill', 1500, 1, [1, 2], 0.5, [0xc8102e, 0x2fe6ff], 'For staying in shape between deals.'],
  ['punchbag', 'Punching Bag', 500, 1, [1, 1], 0.5, [0xc8102e, 0x17151f], 'Take it out on the bag, not the dealers.'],
  ['guitar', 'Electric Guitar', 800, 1, [1, 1], 0.8, [0xc8102e, 0x17151f, 0xf4f1ea, 0x1f4fbf], 'On a stand, ready for a solo.'],
  ['trophycase', 'Trophy Case', 2500, 3, [2, 1], 1.6, WOODS, 'Show off every win.'],
  ['hottubhome', 'Home Hot Tub', 6000, 4, [2, 2], 2.2, [0x5a3a1a, 0xe9e1d3, 0x17151f], 'Bubbles on demand.'],
  ['slothome', 'Home Slot Machine', 2000, 2, [1, 1], 1.2, [0xc8102e, 0x1f4fbf, 0x6a2cc2], 'For when you just can’t leave work at work.'],
];

/** Gadgets that raise your house's security rating. */
const SECURITY: Row[] = [
  ['cctv', 'Security Camera', 1500, 1, [1, 1], 0, [0xf4f1ea], 'A camera that sweeps the room. Security +6.', { security: 6, upkeep: 10 }],
  ['alarm', 'Alarm Panel', 2500, 1, [1, 1], 0, [0xf4f1ea], 'Keypad, sirens and a flashing beacon. Security +8.', { security: 8, upkeep: 10 }],
  ['spotlight', 'Security Spotlight', 1200, 1, [1, 1], 0, [0x2b2b35], 'A sweeping searchlight. Security +4.', { security: 4, upkeep: 5 }],
  ['panicbutton', 'Panic Button', 900, 1, [1, 1], 0, [0xff2a2a], 'One press brings the bodyguards running. Security +3.', { security: 3 }],
  ['safe', 'Floor Safe', 3000, 2, [1, 1], 0, [0x3a3c44], 'A heavy safe for small valuables. Security +5.', { security: 5 }],
  ['doghouse', 'Guard Dog', 4000, 2, [2, 2], 0.5, [0x8a5a2e, 0xe9e1d3, 0x1f4fbf], 'A good boy with a very loud bark. Security +10.', { security: 10, upkeep: 20 }],
  ['metaldetector', 'Metal Detector', 6000, 3, [1, 2], 0, [0xd8d2c6], 'Walk-through scanner at the door. Security +9.', { security: 9, upkeep: 15 }],
  ['laser', 'Laser Grid', 8000, 4, [2, 1], 0, [0x17151f], 'Red laser beams like in the movies. Security +12.', { security: 12, upkeep: 25 }],
];

export function homeItems(base: Base): ItemDef[] {
  const make = (rows: Row[], category: Category, sites?: Site[]) =>
    rows.map(([id, name, price, unlock, size, appeal, colors, description, extra]): ItemDef => ({
      ...base, id, name, category, kind: 'decor', price, unlock, size, appeal, appealRadius: Math.max(1.5, 2 + appeal * 0.6), colors,
      model: 'kit', params: { kit: id }, description, ...(sites ? { sites } : {}), ...(extra ?? {}),
    }));
  return [
    ...make(DECOR, 'decor'),
    ...make(HOTEL_DECOR, 'decor', ['hotel']),
    ...make(GARDEN, 'garden'),
    ...make(FURNITURE, 'furniture', ['house']),
    ...make(FUN, 'fun', ['house']),
    {
      ...base, id: 'vault', name: 'Vault', category: 'security', kind: 'vault', price: 5000, unlock: 1, size: [3, 2], sites: ['house'], appeal: 0.5,
      colors: [0x8c9099], model: 'vault', security: 0,
      description: 'Your bank: a steel vault door with a code you pick. Store casino and hotel money in it, earn interest, upgrade it to hold more.',
    },
    ...make(SECURITY, 'security', ['house']),
  ];
}
