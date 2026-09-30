import type { GameCtx } from './common';
import { openSlots } from './slots';
import { openBlackjack } from './blackjack';
import { openHoldem } from './holdem';
import { openRoulette } from './roulette';
import { openCraps } from './craps';
import { openWheel } from './wheel';
import { openQuick } from './quick';
import { openBaccarat } from './baccarat';
import { openVideoPoker } from './videopoker';
import { openThreeCard } from './threecard';
import { openSicBo } from './sicbo';
import { openKeno } from './keno';

export type { GameCtx } from './common';

/** Open the right game screen for whatever you walked up to. */
export function openTableGame(ctx: GameCtx): void {
  switch (ctx.item.def.kind) {
    case 'slot':
      return openSlots(ctx);
    case 'blackjack':
      return openBlackjack(ctx);
    case 'poker':
      return openHoldem(ctx);
    case 'roulette':
      return openRoulette(ctx);
    case 'craps':
      return openCraps(ctx);
    case 'wheel':
      return openWheel(ctx);
    case 'baccarat':
      return openBaccarat(ctx);
    case 'videopoker':
      return openVideoPoker(ctx);
    case 'threecard':
      return openThreeCard(ctx);
    case 'sicbo':
      return openSicBo(ctx);
    case 'keno':
      return openKeno(ctx);
    default:
      return openQuick(ctx);
  }
}
