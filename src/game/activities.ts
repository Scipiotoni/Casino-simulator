import type { Pose } from '../entities/characterModel';
import type { SfxName } from '../core/audio';

/**
 * Things you can do with what's in your buildings: sit on sofas, nap in bed, hit the
 * punching bag, drum, play the piano, cook, practise on the home slot machine with pretend
 * chips… Each entry says where you go (on it, lying on it, at its edge or in front of it),
 * how you stand, and what Space does while you're at it. Mostly for fun: only the
 * punching bag pays (a little for every solid punch, more for a combo).
 */
export type Spot = 'sit' | 'lie' | 'edge' | 'front' | 'on';

export interface Activity {
  /** Prompt to start ("Sit down"). */
  label: string;
  spot: Spot;
  pose: Pose;
  /** Seat or mattress height (sit / lie). */
  seatY?: number;
  /** What Space does while you're at it. */
  action?: { label: string; sfx?: SfxName; pose?: Pose; effect?: Effect; lines?: string[]; counter?: string };
  /** Sound now and then while you're at it. */
  ambient?: { sfx: SfxName; every: number };
  /** Something said (thought bubble) when you start. */
  lines?: string[];
  /** Over by itself after this many seconds (one-off things like grabbing a snack). */
  once?: number;
  /** Opens a mini-game: the home slot machine instead of the activity, the arcade alongside it. */
  game?: 'slots' | 'arcade';
}

export type Effect = 'punch' | 'sparkle' | 'smoke' | 'confetti' | 'bubbles' | 'flash' | 'notes' | 'hearts';

const SIT = (label: string, seatY = 0.45, extra: Partial<Activity> = {}): Activity => ({ label, spot: 'sit', pose: 'sit', seatY, ...extra });

export const ACTIVITIES: Record<string, Activity> = {
  // Seats
  sofa: SIT('Sit on the sofa', 0.45, { lines: ['Ahh…', 'Feet up.', 'Long day on the floor.'] }),
  velvetsofa: SIT('Sit on the sofa', 0.45, { lines: ['So plush.', 'Fancy.'] }),
  armchair: SIT('Sit in the armchair', 0.45, { lines: ['Comfy.', 'Now where’s my book?'] }),
  bench: SIT('Sit on the bench', 0.45),
  diningtable: { label: 'Sit at the table', spot: 'edge', pose: 'sit', seatY: 0.45, action: { label: 'Eat dinner', sfx: 'clack', effect: 'sparkle', lines: ['Delicious!', 'Pass the salt.', 'Mmm, steak.'] } },
  picnic: { label: 'Sit at the picnic table', spot: 'edge', pose: 'sit', seatY: 0.45, action: { label: 'Have a sandwich', sfx: 'pop', lines: ['Lovely day for it.', 'Ants!'] } },
  gazebo: SIT('Sit in the gazebo', 0.45, { lines: ['Peaceful.'] }),
  desk: { label: 'Work at the desk', spot: 'edge', pose: 'sitPlay', seatY: 0.45, ambient: { sfx: 'tick', every: 0.18 }, action: { label: 'Check the books', sfx: 'coin', lines: ['Numbers look good.', 'Expand again?', 'More slots. Definitely more slots.'] } },
  homebar: { label: 'Sit at the bar', spot: 'edge', pose: 'sit', seatY: 0.6, action: { label: 'Have a drink', sfx: 'drink', pose: 'drink', counter: 'drinks', lines: ['Cheers!', 'Shaken, not stirred.', 'One more.'] } },
  gamingrig: { label: 'Play video games', spot: 'edge', pose: 'sitPlay', seatY: 0.5, game: 'arcade', ambient: { sfx: 'blip', every: 0.35 }, action: { label: 'Clutch play!', sfx: 'win', effect: 'confetti', counter: 'wins', lines: ['GG!', 'Victory royale!', 'Headshot!'] } },
  homecinema: { label: 'Watch a movie', spot: 'front', pose: 'sit', seatY: 0.0, lines: ['🍿', 'No spoilers!'], action: { label: 'Eat popcorn', sfx: 'pop', lines: ['🍿', 'Plot twist!', 'Best movie ever.'] } },
  tvwall: { label: 'Watch TV', spot: 'front', pose: 'sit', seatY: 0.0, lines: ['📺'], action: { label: 'Change channel', sfx: 'blip', lines: ['News…', 'Cooking show!', 'Casino ads. Mine!', 'Cartoons.'] } },
  // Lie down
  kingbed: { label: 'Take a nap', spot: 'lie', pose: 'sleep', seatY: 0.55, lines: ['Zzz…'], ambient: { sfx: 'heartbeat', every: 3 } },
  hammock: { label: 'Lie in the hammock', spot: 'lie', pose: 'sleep', seatY: 0.6, lines: ['This is the life.'] },
  bathtub: { label: 'Take a bubble bath', spot: 'lie', pose: 'sleep', seatY: 0.25, lines: ['🛁', 'Bubbles!'], action: { label: 'Splash', sfx: 'splash', effect: 'bubbles' } },
  hottubhome: { label: 'Get in the hot tub', spot: 'sit', pose: 'sit', seatY: 0.05, lines: ['Ahhh, warm.'], action: { label: 'Turn on the jets', sfx: 'splash', effect: 'bubbles' } },
  // Workouts
  punchbag: { label: 'Hit the punching bag (earns cash)', spot: 'front', pose: 'box', action: { label: 'Punch!', sfx: 'thud', effect: 'punch', counter: 'punches' } },
  treadmill: { label: 'Run on the treadmill', spot: 'on', pose: 'run', ambient: { sfx: 'tick', every: 0.32 }, lines: ['Cardio!', 'One more mile.'] },
  // Music
  drumkit: { label: 'Play the drums', spot: 'front', pose: 'drum', ambient: { sfx: 'drumhit', every: 0.22 }, action: { label: 'Crash cymbal!', sfx: 'cymbal', effect: 'notes' } },
  guitar: { label: 'Play the guitar', spot: 'front', pose: 'strum', action: { label: 'Strum', sfx: 'strum', effect: 'notes', lines: ['🎸', 'Rock on!'] } },
  grandpiano: { label: 'Play the piano', spot: 'edge', pose: 'sitPlay', seatY: 0.45, action: { label: 'Play a chord', sfx: 'piano', effect: 'notes' } },
  harp: { label: 'Play the harp', spot: 'front', pose: 'sitPlay', seatY: 0.45, action: { label: 'Pluck the strings', sfx: 'piano', effect: 'notes' } },
  jukebox: { label: 'Use the jukebox', spot: 'front', pose: 'idle', action: { label: 'Next song', sfx: 'win', effect: 'notes', lines: ['🎶', 'Classic!', 'My jam!'] } },
  // Games
  slothome: { label: 'Play (practice chips, no real money)', spot: 'front', pose: 'standPlay', game: 'slots' },
  arcade: { label: 'Play the arcade game', spot: 'front', pose: 'standPlay', game: 'arcade', ambient: { sfx: 'blip', every: 0.25 }, action: { label: 'Mash the buttons', sfx: 'blip', counter: 'points' } },
  pinball: { label: 'Play pinball', spot: 'front', pose: 'standPlay', ambient: { sfx: 'clack', every: 0.6 }, action: { label: 'Flippers!', sfx: 'ping', counter: 'points' } },
  pooltable: { label: 'Play pool', spot: 'front', pose: 'standPlay', action: { label: 'Take a shot', sfx: 'clack', counter: 'balls potted', lines: ['Corner pocket.', 'Nice shot!', 'Scratch!'] } },
  pingpong: { label: 'Play ping pong', spot: 'front', pose: 'standPlay', ambient: { sfx: 'ping', every: 0.55 }, action: { label: 'Smash!', sfx: 'clack', counter: 'points' } },
  photobooth: { label: 'Take photos', spot: 'front', pose: 'cheer', action: { label: 'Say cheese!', sfx: 'shutter', effect: 'flash', counter: 'photos' } },
  // Kitchen and home
  fridge: { label: 'Grab a snack', spot: 'front', pose: 'standPlay', once: 2.2, lines: ['🍕', '🍰', 'Midnight snack!'] },
  stove: { label: 'Cook', spot: 'front', pose: 'standPlay', ambient: { sfx: 'sizzle', every: 1.2 }, action: { label: 'Flip it', sfx: 'pop', effect: 'smoke', lines: ['🍳', 'Smells great!'] } },
  kitchen: { label: 'Wash the dishes', spot: 'front', pose: 'sweep', action: { label: 'Scrub', sfx: 'splash', effect: 'bubbles' } },
  bbq: { label: 'Fire up the grill', spot: 'front', pose: 'standPlay', ambient: { sfx: 'sizzle', every: 1.1 }, action: { label: 'Flip the burgers', sfx: 'pop', effect: 'smoke', lines: ['🍔', 'Medium rare!'] } },
  fireplace: { label: 'Warm up by the fire', spot: 'front', pose: 'idle', lines: ['Cosy.', 'Toasty!'] },
  firepit: { label: 'Toast marshmallows', spot: 'front', pose: 'standPlay', action: { label: 'Toast one', sfx: 'sizzle', effect: 'sparkle', lines: ['Perfect golden brown.', 'Oops, on fire!'] } },
  bookshelf: { label: 'Read a book', spot: 'front', pose: 'think', lines: ['Hmm…', 'The Art of the Deal.', 'Card counting for dummies.'] },
  winerack: { label: 'Pick a bottle', spot: 'front', pose: 'standPlay', once: 2.2, lines: ['A fine vintage.', '🍷'] },
  wardrobe: { label: 'Change your outfit', spot: 'front', pose: 'idle', once: 0.3 },
  // Fun and decor
  discoball: { label: 'Dance', spot: 'front', pose: 'dance', ambient: { sfx: 'drumhit', every: 0.5 }, lines: ['🕺', 'Disco!'] },
  teddy: { label: 'Hug the bear', spot: 'front', pose: 'clap', once: 2, lines: ['🧸', 'Aww.'] },
  telescope: { label: 'Look through the telescope', spot: 'front', pose: 'point', lines: ['Is that the rival’s casino?', 'A shooting star!'] },
  birdcage: { label: 'Talk to the parrot', spot: 'front', pose: 'wave', action: { label: 'Say hello', sfx: 'blip', lines: ['Squawk! Jackpot!', 'Pretty bird!', 'Hit me! Squawk!'] } },
  koi: { label: 'Feed the fish', spot: 'front', pose: 'crouch', action: { label: 'Throw food', sfx: 'splash', effect: 'sparkle' } },
  trophycase: { label: 'Admire your trophies', spot: 'front', pose: 'clap', lines: ['Champion!'] },
  grandclock: { label: 'Check the time', spot: 'front', pose: 'think', once: 2, lines: ['Time to make money.'] },
  xmastree: { label: 'Shake the presents', spot: 'front', pose: 'cheer', once: 2, lines: ['🎁', 'Is it a slot machine?'] },
  giftpile: { label: 'Open a present', spot: 'front', pose: 'cheer', once: 2, lines: ['🎁', 'Socks…'] },
  classiccar: { label: 'Admire the car', spot: 'front', pose: 'point', lines: ['What a beauty.'] },
  motorbike: { label: 'Rev the bike', spot: 'front', pose: 'cheer', action: { label: 'Vroom!', sfx: 'honk', effect: 'smoke' } },
  slotsculpt: { label: 'Rub it for luck', spot: 'front', pose: 'clap', once: 1.8, lines: ['🍀 Lucky!'] },
  horseshoe: { label: 'Touch it for luck', spot: 'front', pose: 'clap', once: 1.8, lines: ['🍀'] },
  wetfloor: { label: 'Slip on purpose', spot: 'on', pose: 'ko', once: 2.4, lines: ['Whoa!'] },
};

/** Practice-play for your own casino's machines and tables. */
export const PRACTICE_LABEL = 'Practice play (pretend chips, no real money)';

export function activityFor(kit: string | undefined): Activity | null {
  return kit ? ACTIVITIES[kit] ?? null : null;
}

/**
 * Cash for a punch on the bag: a base that grows with your level, times a combo for punches
 * thrown in quick succession (up to ×3). Mashing faster than a real boxer pays nothing.
 */
export function punchPay(level: number, combo: number, sinceLast: number): number {
  if (sinceLast < 0.22) return 0;
  const base = 10 + Math.max(1, level) * 3;
  return Math.round(base * Math.min(3, 1 + Math.max(0, combo - 1) * 0.1));
}
