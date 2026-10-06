import type { Game } from '../../game/game';
import type { Modals } from '../modals';
import { h } from '../dom';
import { audio } from '../../core/audio';

/**
 * "Learn to play": a short lesson for every casino game in Jackpot Tycoon, written for
 * someone who has never sat at the table. Each lesson gives the goal, how a round goes,
 * what pays what, and a tip. The rules are the ones the games actually use.
 */
export interface Lesson {
  name: string;
  icon: string;
  /** One line: what you're trying to do. */
  goal: string;
  /** A round, step by step. */
  steps: string[];
  /** What wins pay ("to 1" unless it says otherwise). */
  pays: [string, string][];
  /** A word of advice (and the house edge, honestly). */
  tip: string;
}

export const LESSONS: Record<string, Lesson> = {
  slot: {
    name: 'Slot machine', icon: '🎰',
    goal: 'Line up matching symbols on the middle line. That’s it: slots are pure luck.',
    steps: [
      'Pick your bet with the chips.',
      'Press Spin or pull the handle. The three reels stop one after another.',
      'Only the middle line pays. Three of a kind pays; the rarer the symbol, the bigger the win. A cherry on the left reel pays even on its own.',
      'You can see the stops above and below the line: a 7 just off the line is a near miss, nothing more.',
      'Machines with a jackpot pot grow with every bet until someone hits the top symbols.',
    ],
    pays: [['Cherries (2)', 'small win'], ['Three bars', 'medium win'], ['Three 7s', 'big win'], ['Three diamonds', 'jackpot']],
    tip: 'Every spin is independent: a machine is never "due". Low-volatility machines (like Lucky 7s) pay small wins more often.',
  },
  blackjack: {
    name: 'Blackjack', icon: '🃏',
    goal: 'Get closer to 21 than the dealer without going over.',
    steps: [
      'Place your bet. You and the dealer get two cards; one of the dealer’s is face down.',
      'Cards 2–10 count their number, J/Q/K count 10, an Ace counts 1 or 11 (whichever helps).',
      'Hit to take a card, Stand to keep your total. Over 21 is a bust: you lose straight away.',
      'Double: double your bet, take exactly one more card. Split: two cards of the same rank become two hands (one more bet).',
      'Surrender: give up the hand right away and get half your bet back.',
      'The dealer then draws until they have 17 or more. Higher total wins; a tie (push) gives your bet back.',
      'If the dealer shows an Ace you’re offered insurance: a side bet that the dealer has blackjack. With a blackjack of your own it’s called even money (paid 1 to 1 straight away).',
      'With an Ace or a ten showing, the dealer peeks at the hole card: a dealer blackjack ends the hand at once.',
      'Side bets (optional): Perfect Pairs on your first two cards being a pair, and 21+3 on your two cards plus the dealer’s up card making a poker hand.',
      'The cards come from a six-deck shoe. When the plastic cut card comes out, the shoe is shuffled after that hand.',
    ],
    pays: [['Blackjack (Ace + 10-value card)', '3 to 2'], ['Win', '1 to 1'], ['Insurance', '2 to 1'], ['Push', 'bet back'], ['Perfect Pairs', '6, 12 or 25 to 1'], ['21+3', '5 to 1 up to 100 to 1']],
    tip: 'Basic rules of thumb: always split Aces and 8s; stand on 12–16 when the dealer shows 2–6; hit 12–16 when the dealer shows 7 or more; double on 11.',
  },
  poker: {
    name: 'Casino Hold’em', icon: '♠',
    goal: 'Make a better five-card poker hand than the dealer, using your two cards and the five on the table.',
    steps: [
      'Place the Ante. You get two cards, and three shared cards (the flop) are turned up.',
      'Call (twice the ante) if you like your chances, or Fold and give up the ante.',
      'Two more shared cards come, then the dealer shows their two cards.',
      'The dealer needs at least a pair of fours to "qualify". If they don’t, your ante wins and the call is returned.',
      'If they qualify, the best hand wins both bets.',
      'AA Bonus (optional): pays if your two cards and the flop make a pair of aces or better, whether you call or fold.',
    ],
    pays: [['Ante on a royal flush', '100 to 1'], ['Ante on a straight flush', '20 to 1'], ['Ante on four of a kind', '10 to 1'], ['Ante on a full house', '3 to 1'], ['Ante on a flush', '2 to 1'], ['Anything else / the call', '1 to 1']],
    tip: 'Hand ranks from best: royal flush, straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card. Call with any pair or better.',
  },
  roulette: {
    name: 'Roulette', icon: '🎡',
    goal: 'Guess where the ball lands on the wheel (0–36).',
    steps: [
      'Put chips on the felt. Inside bets: a number, or the line between two numbers (split), the end of a row of three (street), the corner of four, or the end between two rows (six line).',
      'Outside bets: red/black, odd/even, 1–18/19–36, a dozen or a column.',
      'The racetrack places French call bets: click a number for it and its two neighbours either side on the wheel, or Voisins, Tiers, Orphelins or Zéro for the classic sections.',
      'Press Spin. The ball runs round the track, drops and settles in one pocket; the dolly marks the number.',
      'Every bet that covers that number wins; the rest are swept away.',
      'Zero is green: it isn’t red or black, odd or even. With la partage you get half your even-money bets back when zero comes up.',
    ],
    pays: [['Straight up (1 number)', '35 to 1'], ['Split (2)', '17 to 1'], ['Street (3)', '11 to 1'], ['Corner (4)', '8 to 1'], ['Six line (6)', '5 to 1'], ['Dozen or column', '2 to 1'], ['Red/black, odd/even, 1–18/19–36', '1 to 1']],
    tip: 'All bets have the same house edge (2.7% with a single zero), except even-money bets with la partage: only 1.35%. The marquee shows past numbers, but the wheel has no memory.',
  },
  craps: {
    name: 'Craps', icon: '🎲',
    goal: 'Bet on the roll of two dice.',
    steps: [
      'The basic bet is Pass Line, placed before the first roll (the "come-out").',
      'Come-out: 7 or 11 wins straight away; 2, 3 or 12 ("craps") loses.',
      'Any other total (4, 5, 6, 8, 9, 10) becomes the point.',
      'Keep rolling: rolling the point again wins, rolling a 7 first loses.',
      'Don’t Pass is the opposite bet. Once there’s a point you can add Odds behind your bet (up to 3, 4 or 5 times it): they pay true odds with no house edge.',
      'Come and Don’t Come work like Pass and Don’t Pass, but start on any roll: the next number rolled becomes that bet’s own point, and the chips move to it.',
      'Place bets win whenever their number rolls before a 7, and stay up. Like hardways they rest (are off) on the come-out roll.',
      'The centre of the table holds the one-roll bets (any seven, any craps, aces, yo, C&E, horn) and the hardways (a pair, like 4-4, before a 7 or the easy way).',
    ],
    pays: [['Pass / Don’t Pass / Come', '1 to 1'], ['Odds on 4 or 10', '2 to 1'], ['Odds on 5 or 9', '3 to 2'], ['Odds on 6 or 8', '6 to 5'], ['Place 6 or 8', '7 to 6'], ['Place 5 or 9', '7 to 5'], ['Place 4 or 10', '9 to 5'], ['Hard 6 or 8', '9 to 1'], ['Hard 4 or 10', '7 to 1'], ['Any seven', '4 to 1']],
    tip: 'Pass Line with as much Odds as you can afford is one of the best bets in the whole casino.',
  },
  wheel: {
    name: 'Big Six Wheel', icon: '🎯',
    goal: 'Pick the symbol the big wheel stops on.',
    steps: [
      'Put chips on the bills ($1, $2, $5, $10, $20), the Joker or the logo. You can bet on several at once.',
      'The wheel spins; its pegs clack past the leather flapper until it stops.',
      'Whatever symbol is under the flapper wins, paying the number on it.',
    ],
    pays: [['$1', '1 to 1'], ['$2', '2 to 1'], ['$5', '5 to 1'], ['$10', '10 to 1'], ['$20', '20 to 1'], ['Logo', '40 to 1']],
    tip: 'The $1 spot comes up most often and has the smallest house edge; the logos are long shots.',
  },
  baccarat: {
    name: 'Baccarat', icon: '💎',
    goal: 'Bet on which hand ends closest to 9: Player, Banker, or a Tie.',
    steps: [
      'Choose Player, Banker or Tie and place your bet. You don’t make any decisions after that.',
      'Both hands get two cards. Aces count 1, 2–9 count their number, 10s and faces count 0.',
      'Only the last digit counts: 7 + 8 = 15 counts as 5.',
      'Sometimes a third card is drawn by fixed rules (it’s dealt sideways). Then the hand closer to 9 wins.',
      'Pair bets win if the first two cards of a hand are a pair.',
      'The scoreboards show the shoe so far: the bead plate lists every coup; the big road stacks streaks of the same winner (green slashes are ties).',
    ],
    pays: [['Player', '1 to 1'], ['Banker', '1 to 1, minus 5% commission'], ['Tie', '8 to 1'], ['Player or Banker pair', '11 to 1']],
    tip: 'Banker wins slightly more often, which is why it pays a commission. It’s still the best bet on the table; the Tie is the worst.',
  },
  videopoker: {
    name: 'Video poker (Jacks or Better)', icon: '🖥',
    goal: 'Make the best poker hand you can with five cards. A pair of Jacks or better pays.',
    steps: [
      'Choose the coin value, then Bet One (1 to 5 coins) or Bet Max.',
      'Press Deal: you get five cards. Tap the cards you want to keep (Hold).',
      'Press Draw: the others are replaced.',
      'Your final hand is paid from the table on the glass, in coins. The royal flush jumps to 4,000 coins when you play all five.',
    ],
    pays: [['Royal flush (5 coins)', '4,000 for 5'], ['Royal flush (1–4 coins)', '250 a coin'], ['Straight flush', '50 to 1'], ['Four of a kind', '25 to 1'], ['Full house', '9 to 1'], ['Flush', '6 to 1'], ['Straight', '4 to 1'], ['Three of a kind', '3 to 1'], ['Two pair', '2 to 1'], ['Jacks or better', '1 to 1']],
    tip: 'Always keep any pair; keep four cards to a flush or straight flush; with nothing, keep your high cards (J, Q, K, A).',
  },
  threecard: {
    name: 'Three Card Poker', icon: '🂡',
    goal: 'Beat the dealer’s three-card hand, or just get a good hand for the Pair Plus bet.',
    steps: [
      'Place the Ante (against the dealer) and/or Pair Plus (on your own hand).',
      'You and the dealer get three cards each. Look at yours, then Play (same again as the ante) or Fold.',
      'The dealer needs Queen-high or better to qualify. If not, your ante wins and the play bet comes back.',
      'If they qualify, the better hand wins. Pair Plus pays on your hand alone, whatever the dealer has.',
      '6-Card Bonus (optional): the best five cards out of your three and the dealer’s three, from three of a kind up to a royal flush.',
    ],
    pays: [['Pair Plus: straight flush', '40 to 1'], ['Three of a kind', '30 to 1'], ['Straight', '6 to 1'], ['Flush', '4 to 1'], ['Pair', '1 to 1'], ['Ante and play wins', '1 to 1 (ante bonus on a straight or better)']],
    tip: 'With three cards a straight beats a flush. Play any hand of Queen-6-4 or better, fold the rest.',
  },
  sicbo: {
    name: 'Sic Bo', icon: '🀄',
    goal: 'Bet on the roll of three dice.',
    steps: [
      'Choose your bets: Big (total 11–17), Small (4–10), a total, a single number, two numbers together (a combination), a double or triples.',
      'The dealer shakes the three dice under the glass dome and lifts it.',
      'Every bet that matches wins. Any triple (three of the same) makes Big and Small lose.',
    ],
    pays: [['Big / Small', '1 to 1'], ['A number on 1 / 2 / 3 dice', '1 / 2 / 3 to 1'], ['Two-dice combination', '5 to 1'], ['A chosen double', '10 to 1'], ['Totals', '6 to 1 up to 60 to 1'], ['Any triple', '30 to 1'], ['A chosen triple', '180 to 1']],
    tip: 'Big and Small have the lowest house edge. Totals and triples pay big but rarely come up.',
  },
  keno: {
    name: 'Keno', icon: '🔢',
    goal: 'Pick numbers from 1 to 80 and hope the draw hits them.',
    steps: [
      'Mark up to 10 numbers (your "spots") on the ticket and choose your bet. Quick pick marks them for you.',
      'Press Draw: 20 balls come up out of the blower one at a time.',
      'The more of your spots get drawn, the more you win. The paytable depends on how many spots you picked.',
    ],
    pays: [['Most of your spots hit', 'big wins'], ['A few spots hit', 'small wins'], ['Too few', 'lose']],
    tip: 'Fewer spots win more often but pay less. Keno has one of the biggest house edges, so play it for fun.',
  },
};

/** The lesson for a game kind (or null for a casino attraction with no rules to learn). */
export function lessonFor(kind: string): Lesson | null {
  return LESSONS[kind] ?? null;
}


/** One lesson as a card: goal, steps, payouts and a tip. */
export function lessonCard(l: Lesson): HTMLElement {
  return h('div', { class: 'lesson' },
    h('p', { class: 'lesson-goal', html: `<b>Goal:</b> ${l.goal}` }),
    h('div', { class: 'field-label', text: 'How a round goes' }),
    h('ol', { class: 'lesson-steps' }, ...l.steps.map((t) => h('li', { text: t }))),
    h('div', { class: 'field-label', text: 'What it pays' }),
    h('div', { class: 'lesson-pays' }, ...l.pays.flatMap(([a, b]) => [h('span', { text: a }), h('b', { text: b })])),
    h('p', { class: 'lesson-tip', html: `💡 ${l.tip}` }),
  );
}

/** "How to play" for one game (opened on top of the game screen). */
export function openLesson(modals: Modals, kind: string): void {
  const l = lessonFor(kind);
  if (!l) return;
  audio.play('click');
  modals.open(`${l.icon} How to play ${l.name}`, lessonCard(l), { cls: 'small lesson-modal' });
}

/**
 * Casino school: every game's lesson, with a button to practise it with free pretend
 * chips at a machine or table you own.
 */
export function openSchool(game: Game, modals: Modals): void {
  const g = game;
  const body = h('div', { class: 'stack' });
  body.appendChild(h('p', { class: 'muted small', text: 'Learn every game in the casino. Practise with free pretend chips at any machine or table in your own casino (walk up to it and press Space, or use the Practise button here): no real money changes hands.' }));
  const list = h('div', { class: 'school-list' });
  const show = (kind: string) => {
    const l = LESSONS[kind];
    const mine = g.site === 'casino' && !g.visiting ? g.items.items.find((i) => i.def.kind === kind && i.isGambling && !i.broken) : undefined;
    list.replaceChildren(...Object.entries(LESSONS).map(([k, x]) => h('button', {
      class: `school-tab${k === kind ? ' on' : ''}`, html: `${x.icon} ${x.name}`, onClick: () => show(k),
    })));
    detail.replaceChildren(
      h('h3', { class: 'lesson-title', text: `${l.icon} ${l.name}` }),
      lessonCard(l),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn gold', text: '🎲 Practise it (free chips)', disabled: !mine,
          title: mine ? '' : 'Put one in your casino (Build) and come back',
          onClick: () => {
            if (!mine) return;
            modals.closeAll();
            g.events.emit('practice', mine);
          },
        }),
        !mine ? h('span', { class: 'muted small', text: g.site === 'casino' && !g.visiting ? 'You have none in your casino yet: buy one in Build.' : 'Practise from inside your own casino.' }) : null));
  };
  const detail = h('div', { class: 'school-detail' });
  body.appendChild(h('div', { class: 'school' }, list, detail));
  show('blackjack');
  modals.open('📖 Casino school', body, { wide: true });
}
