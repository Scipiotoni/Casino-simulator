import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { Shoe, bjTotal, dealerShouldHit, isBlackjack } from '../../items/cards';
import { perfectPairs, twentyOnePlus3 } from '../../items/rules';
import type { Card, Outcome } from '../../items/types';
import {
  type GameCtx, Session, betCircle, cardEl, chipRow, chipValues, feltArc, resultLine, reveal, setResult, shoeView, sleep,
} from './common';

/** Six decks, cut card about a deck and a half from the back (75% penetration). */
const shoe = new Shoe(6, Math.random, 78);
shoe.burn();

interface Hand {
  cards: Card[];
  stake: number;
  done: boolean;
  surrendered: boolean;
  /** Split aces get exactly one card each. */
  splitAces: boolean;
  box: HTMLElement;
  row: HTMLElement;
  total: HTMLElement;
}

/** Ten-value cards split with each other only when the ranks match (like real tables). */
const MAX_HANDS = 4;

/**
 * Las Vegas blackjack: a 6-deck shoe dealt to the cut card, dealer peeks for blackjack and
 * stands on all 17s, blackjack pays 3:2, insurance 2:1 (even money on your blackjack),
 * double on any two cards (also after a split), split up to four hands (aces once, one
 * card each), late surrender, and the Perfect Pairs and 21+3 side bets.
 */
export function openBlackjack(ctx: GameCtx): void {
  const s = new Session(ctx);
  const chips = chipValues(s.min);
  let chip = chips[Math.min(1, chips.length - 1)];
  let busy = false;
  const placed = { main: 0, pp: 0, t3: 0 };
  let last: typeof placed | null = null;
  const dealerRow = h('div', { class: 'pc-row' });
  const handsEl = h('div', { class: 'bj-hands' });
  const dealerTotal = h('span', { class: 'bj-total' });
  const result = resultLine();
  const sideNote = h('div', { class: 'bj-side-note' });
  const setSide = (text: string, kind: '' | 'win' | 'lose' = '') => {
    sideNote.textContent = text;
    sideNote.className = `bj-side-note ${kind}`;
  };
  const sv = shoeView(shoe);
  const circles = {
    pp: betCircle('PERFECT', 'PAIRS 25:1', 'side'),
    main: betCircle('BET', '', 'main'),
    t3: betCircle('21+3', '100:1', 'side'),
  };
  const chipsEl = chipRow(chips, () => chip, (v) => (chip = v), { min: s.min, bank: () => s.bank });
  const dealBtn = h('button', { class: 'btn gold tg-main', text: 'Deal' });
  const rebetBtn = h('button', { class: 'btn', text: 'Rebet' });
  const clearBtn = h('button', { class: 'btn', text: 'Clear' });
  const betRow = h('div', { class: 'tg-actions' }, clearBtn, rebetBtn);
  const hitBtn = h('button', { class: 'btn', text: 'Hit' });
  const standBtn = h('button', { class: 'btn', text: 'Stand' });
  const dblBtn = h('button', { class: 'btn', text: 'Double' });
  const splitBtn = h('button', { class: 'btn', text: 'Split' });
  const surBtn = h('button', { class: 'btn', text: 'Surrender' });
  const actions = h('div', { class: 'tg-actions' }, hitBtn, standBtn, dblBtn, splitBtn, surBtn);
  const yesBtn = h('button', { class: 'btn gold', text: 'Take insurance' });
  const noBtn = h('button', { class: 'btn', text: 'No insurance' });
  const askRow = h('div', { class: 'tg-actions' }, yesBtn, noBtn);
  let hands: Hand[] = [];
  let active = 0;
  let dealer: Card[] = [];
  let holeEl: HTMLElement | null = null;
  let insurance = 0;
  let ask: ((take: boolean) => void) | null = null;

  const showBets = () => {
    for (const k of ['main', 'pp', 't3'] as const) circles[k].set(placed[k]);
  };
  const addTo = (k: keyof typeof placed, sign: 1 | -1) => {
    if (busy || s.closed) return;
    placed[k] = Math.max(0, placed[k] + sign * chip);
    audio.play(sign > 0 ? 'chips' : 'click', { volume: 0.5 });
    showBets();
  };
  for (const k of ['main', 'pp', 't3'] as const) {
    circles[k].el.addEventListener('click', () => addTo(k, 1));
    circles[k].el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      addTo(k, -1);
    });
  }
  clearBtn.addEventListener('click', () => {
    if (busy) return;
    placed.main = placed.pp = placed.t3 = 0;
    showBets();
  });
  rebetBtn.addEventListener('click', () => {
    if (busy || !last) return;
    Object.assign(placed, last);
    audio.play('chips', { volume: 0.5 });
    showBets();
  });

  const hand = () => hands[active];
  const setMode = (m: 'bet' | 'play' | 'wait' | 'ask') => {
    dealBtn.hidden = m !== 'bet';
    betRow.hidden = m !== 'bet';
    actions.hidden = m !== 'play';
    askRow.hidden = m !== 'ask';
    chipsEl.classList.toggle('disabled', m !== 'bet');
    for (const c of Object.values(circles)) c.el.disabled = m !== 'bet';
    if (m === 'play') {
      const hd = hand();
      const two = hd.cards.length === 2;
      dblBtn.disabled = !(two && !hd.splitAces && s.bank >= hd.stake);
      splitBtn.disabled = !(two && hands.length < MAX_HANDS && hd.cards[0].rank === hd.cards[1].rank && !hd.splitAces && s.bank >= hd.stake);
      surBtn.disabled = !(two && hands.length === 1);
      hitBtn.disabled = hd.splitAces;
    }
    hands.forEach((hd, i) => hd.box.classList.toggle('active', m === 'play' && i === active && hands.length > 1));
  };
  const showTotals = (hideHole: boolean) => {
    for (const hd of hands) {
      const p = bjTotal(hd.cards);
      hd.total.textContent = hd.surrendered ? 'Surrendered' : isBlackjack(hd.cards) && hands.length === 1 ? 'Blackjack' : `${p.soft && p.total < 21 ? `${p.total - 10}/` : ''}${p.total}${p.total > 21 ? ' bust' : ''}${hd.stake > 0 ? ` · ${formatMoney(hd.stake)}` : ''}`;
      hd.box.classList.toggle('bust', p.total > 21);
    }
    const d = bjTotal(hideHole ? [dealer[0]] : dealer);
    dealerTotal.textContent = dealer.length ? `${d.soft && d.total < 21 && hideHole ? `${d.total - 10}/` : ''}${d.total}${d.total > 21 ? ' bust' : ''}` : '';
  };
  const addCard = (row: HTMLElement, c: Card | null, delay = 0) => {
    const el = cardEl(c, delay);
    row.appendChild(el);
    audio.play('cards', { volume: 0.6 });
    sv.update();
    return el;
  };
  const newHand = (cards: Card[], stake: number, splitAces = false): Hand => {
    const row = h('div', { class: 'pc-row' });
    const total = h('span', { class: 'bj-total' });
    const box = h('div', { class: 'bj-hand' }, row, h('div', { class: 'bj-label' }, hands.length ? `Hand ${hands.length + 1} ` : 'You ', total));
    const hd: Hand = { cards, stake, done: false, surrendered: false, splitAces, box, row, total };
    for (const c of cards) addCard(row, c);
    return hd;
  };
  const flipHole = () => {
    if (holeEl) reveal(holeEl, dealer[1]);
    holeEl = null;
    showTotals(false);
  };
  const asking = (yes: string, no: string) => {
    yesBtn.textContent = yes;
    noBtn.textContent = no;
    setMode('ask');
    return new Promise<boolean>((r) => (ask = r));
  };

  /** Show the finished round on the real table and pay the hands out. */
  const finish = (lines: string[], staked: number, paid: number) => {
    const main = hands[0];
    const oc: Outcome = { bet: staked, payout: paid, label: '', tier: paid > staked ? 'win' : paid === staked ? 'push' : 'lose', visual: { kind: 'blackjack', player: main.cards, dealer } };
    s.animate({ kind: 'blackjack', dealer }, 2.2, oc);
    s.settle(staked, paid);
    const net = paid - staked;
    const big = hands.length === 1 && isBlackjack(main.cards) && net > 0;
    setResult(result, `${lines.join(' · ')}  ${net > 0 ? '+' : net < 0 ? '−' : ''}${net ? formatMoney(Math.abs(net)) : ''}`.trim(), big ? 'big' : net > 0 ? 'win' : net < 0 ? 'lose' : '');
    placed.pp = placed.t3 = 0;
    placed.main = 0;
    showBets();
    busy = false;
    setMode('bet');
    if (shoe.cutCardOut) setSide('The cut card is out: the shoe is shuffled before the next deal.');
  };

  const settleAll = async () => {
    setMode('wait');
    flipHole();
    const live = hands.filter((hd) => !hd.surrendered && bjTotal(hd.cards).total <= 21);
    if (live.length) {
      await sleep(500);
      while (dealerShouldHit(dealer)) {
        dealer.push(shoe.draw());
        addCard(dealerRow, dealer[dealer.length - 1]);
        showTotals(false);
        await sleep(550);
      }
    }
    const d = bjTotal(dealer).total;
    let staked = insurance;
    let paid = 0;
    const lines: string[] = [];
    hands.forEach((hd, i) => {
      const tag = hands.length > 1 ? `H${i + 1}: ` : '';
      const p = bjTotal(hd.cards).total;
      staked += hd.stake;
      if (hd.surrendered) {
        paid += Math.floor(hd.stake / 2);
        lines.push(`${tag}surrendered, half back`);
      } else if (p > 21) lines.push(`${tag}bust`);
      else if (d > 21) {
        paid += hd.stake * 2;
        lines.push(`${tag}dealer busts, win`);
      } else if (p > d) {
        paid += hd.stake * 2;
        lines.push(`${tag}your ${p} beats ${d}`);
      } else if (p === d) {
        paid += hd.stake;
        lines.push(`${tag}push at ${p}`);
      } else lines.push(`${tag}dealer's ${d} beats your ${p}`);
    });
    if (insurance) lines.push('insurance lost');
    finish(lines, staked, paid);
  };

  /** Move on to the next unfinished hand, or let the dealer play. */
  const advance = async () => {
    while (active < hands.length && hands[active].done) active++;
    if (active >= hands.length) return settleAll();
    const hd = hand();
    if (hd.cards.length === 1) {
      // Second card for a freshly split hand.
      await sleep(300);
      hd.cards.push(shoe.draw());
      addCard(hd.row, hd.cards[1]);
      showTotals(true);
      if (hd.splitAces || bjTotal(hd.cards).total === 21) {
        hd.done = true;
        await sleep(350);
        return advance();
      }
    }
    setMode('play');
  };

  dealBtn.addEventListener('click', async () => {
    if (busy || s.closed) return;
    // An empty circle plays the last bet again (or the chip in your hand).
    if (!placed.main) placed.main = last?.main ?? chip;
    if (placed.main < s.min) {
      audio.play('error');
      setResult(result, `The table minimum is ${formatMoney(s.min)}.`, 'lose');
      return;
    }
    const total = placed.main + placed.pp + placed.t3;
    if (!s.bet(total)) return;
    busy = true;
    last = { ...placed };
    const bet = placed.main;
    insurance = 0;
    setMode('wait');
    setResult(result, '');
    setSide('');
    showBets();
    hands = [];
    if (shoe.cutCardOut) {
      // Change the shoe: shuffle, cut, burn one.
      setResult(result, 'Shuffling a fresh shoe…');
      sv.el.classList.add('shuffling');
      audio.play('cards');
      await sleep(1100);
      shoe.shuffle();
      shoe.burn();
      sv.el.classList.remove('shuffling');
      sv.update();
      setResult(result, '');
    }
    dealerRow.replaceChildren();
    handsEl.replaceChildren();
    active = 0;
    const p = [shoe.draw(), shoe.draw()];
    dealer = [shoe.draw(), shoe.draw()];
    const first = newHand([], bet);
    hands.push(first);
    handsEl.appendChild(first.box);
    first.cards.push(p[0]);
    addCard(first.row, p[0]);
    await sleep(260);
    addCard(dealerRow, dealer[0]);
    await sleep(260);
    first.cards.push(p[1]);
    addCard(first.row, p[1]);
    await sleep(260);
    holeEl = addCard(dealerRow, null);
    showTotals(true);
    await sleep(300);
    // Side bets are settled straight after the deal.
    const sideStake = placed.pp + placed.t3;
    if (sideStake) {
      const ppR = perfectPairs(p[0], p[1]);
      const t3R = twentyOnePlus3([p[0], p[1], dealer[0]]);
      let back = 0;
      const notes: string[] = [];
      if (placed.pp) {
        back += ppR.pays ? placed.pp * (ppR.pays + 1) : 0;
        notes.push(ppR.pays ? `Perfect Pairs: ${ppR.name.toLowerCase()} pays ${ppR.pays}:1` : 'Perfect Pairs loses');
      }
      if (placed.t3) {
        back += t3R.pays ? placed.t3 * (t3R.pays + 1) : 0;
        notes.push(t3R.pays ? `21+3: ${t3R.name.toLowerCase()} pays ${t3R.pays}:1` : '21+3 loses');
      }
      s.settle(sideStake, back);
      setSide(notes.join(' · '), back > sideStake ? 'win' : 'lose');
      if (back > sideStake) audio.play('win');
      placed.pp = placed.t3 = 0;
      showBets();
    }
    const pBJ = isBlackjack(first.cards);
    const half = Math.floor(bet / 2);
    if (dealer[0].rank === 0 && pBJ) {
      // Even money: take 1:1 now, or risk a push against a dealer blackjack for 3:2.
      setResult(result, 'Blackjack against an ace. Even money?');
      const take = await asking('Even money (1:1)', 'No, play it out');
      setMode('wait');
      if (take) {
        flipHole();
        return finish(['Even money paid'], bet, bet * 2);
      }
    } else if (dealer[0].rank === 0 && half > 0 && s.bank >= half) {
      setResult(result, 'Dealer shows an ace. Insurance pays 2 to 1.');
      const take = await asking(`Insurance (${formatMoney(half)})`, 'No insurance');
      if (take && s.bet(half)) insurance = half;
      setMode('wait');
      setResult(result, '');
    }
    // The dealer peeks under an ace or a ten.
    const dBJ = isBlackjack(dealer);
    if (pBJ || dBJ) {
      if (dealer[0].rank === 0 || dealer[0].rank >= 9) {
        setResult(result, 'Dealer checks for blackjack…');
        await sleep(600);
      }
      flipHole();
      await sleep(400);
      const insPaid = dBJ ? insurance * 3 : 0;
      const insLine = insurance ? (dBJ ? 'insurance pays 2:1' : 'insurance lost') : '';
      if (pBJ && dBJ) return finish(['Both have blackjack: push', insLine].filter(Boolean), bet + insurance, bet + insPaid);
      if (pBJ) return finish(['BLACKJACK! Pays 3 to 2'], bet, Math.floor(bet * 2.5));
      return finish(['Dealer has blackjack', insLine].filter(Boolean), bet + insurance, insPaid);
    }
    if (dealer[0].rank === 0 || dealer[0].rank >= 9) {
      setResult(result, 'Dealer checks: no blackjack.');
      await sleep(500);
      setResult(result, '');
    }
    if (insurance) {
      setResult(result, 'No blackjack: insurance lost.', 'lose');
      // Insurance settles straight away when the dealer checks.
      s.settle(insurance, 0);
      insurance = 0;
    }
    if (bjTotal(first.cards).total === 21) first.done = true;
    void advance();
  });
  yesBtn.addEventListener('click', () => ask?.(true));
  noBtn.addEventListener('click', () => ask?.(false));
  hitBtn.addEventListener('click', async () => {
    if (!busy || actions.hidden) return;
    const hd = hand();
    hd.cards.push(shoe.draw());
    addCard(hd.row, hd.cards[hd.cards.length - 1]);
    showTotals(true);
    const t = bjTotal(hd.cards).total;
    if (t >= 21) {
      hd.done = true;
      setMode('wait');
      await sleep(400);
      return advance();
    }
    setMode('play');
  });
  standBtn.addEventListener('click', () => {
    if (!busy || actions.hidden) return;
    hand().done = true;
    setMode('wait');
    void advance();
  });
  dblBtn.addEventListener('click', async () => {
    const hd = hand();
    if (!busy || actions.hidden || hd.cards.length !== 2) return;
    if (!s.bet(hd.stake)) return;
    hd.stake *= 2;
    hd.cards.push(shoe.draw());
    const el = addCard(hd.row, hd.cards[2]);
    // A doubled card goes down sideways.
    el.classList.add('sideways');
    showTotals(true);
    hd.done = true;
    setMode('wait');
    await sleep(500);
    void advance();
  });
  splitBtn.addEventListener('click', async () => {
    const hd = hand();
    if (!busy || actions.hidden || hd.cards.length !== 2 || hd.cards[0].rank !== hd.cards[1].rank) return;
    if (!s.bet(hd.stake)) return;
    const aces = hd.cards[0].rank === 0;
    const moved = hd.cards.pop()!;
    hd.row.lastChild?.remove();
    hd.splitAces = aces;
    const other = newHand([moved], hd.stake, aces);
    hands.splice(active + 1, 0, other);
    hd.box.after(other.box);
    hands.forEach((x, i) => {
      const lbl = x.box.querySelector('.bj-label');
      if (lbl?.firstChild) lbl.firstChild.textContent = `Hand ${i + 1} `;
    });
    setMode('wait');
    await sleep(250);
    // Deal the second card to the current hand, then keep playing it.
    hd.cards.push(shoe.draw());
    addCard(hd.row, hd.cards[1]);
    showTotals(true);
    if (aces || bjTotal(hd.cards).total === 21) hd.done = true;
    void advance();
  });
  surBtn.addEventListener('click', () => {
    const hd = hand();
    if (!busy || actions.hidden || hands.length !== 1 || hd.cards.length !== 2) return;
    hd.surrendered = true;
    hd.done = true;
    void settleAll();
  });

  setMode('bet');
  showBets();
  setResult(result, 'Place your bet in the circle, then Deal.');
  const body = h('div', { class: 'mg tg' },
    s.head,
    h('div', { class: 'felt bj-felt' },
      h('div', { class: 'bj-dealer' }, h('div', { class: 'bj-label' }, 'Dealer ', dealerTotal), sv.el),
      dealerRow,
      feltArc([
        { text: 'BLACKJACK PAYS 3 TO 2', size: 19, cls: 'arc-gold' },
        { text: 'Dealer must draw to 16 and stand on all 17s', size: 11 },
        { text: '— INSURANCE PAYS 2 TO 1 —', size: 12, cls: 'arc-band' },
      ]),
      handsEl,
      h('div', { class: 'bj-circles' }, circles.pp.el, circles.main.el, circles.t3.el),
      sideNote,
    ),
    result,
    dealBtn,
    askRow,
    actions,
    chipsEl,
    betRow,
    h('details', { class: 'mg-pay' }, h('summary', { text: 'Side bets' }),
      h('div', { class: 'mg-pay-grid' }, ...[
        ['Perfect Pairs (your two cards)', ''], ['Perfect pair (same suit)', '25:1'], ['Coloured pair', '12:1'], ['Mixed pair', '6:1'],
        ['21+3 (your two cards + dealer up card)', ''], ['Suited trips', '100:1'], ['Straight flush', '40:1'], ['Three of a kind', '30:1'], ['Straight', '10:1'], ['Flush', '5:1'],
      ].map(([a, b]) => h('div', { class: 'mg-pay-row' }, b ? h('span', { text: a }) : h('b', { text: a }), h('b', { text: b }))))),
  );
  ctx.modals.open(`${ctx.item.def.name}`, body, {
    cls: 'minigame table-game',
    onClose: () => {
      ask?.(false);
      // Leaving mid-hand forfeits whatever is on the table.
      if (busy && !s.closed) {
        const main = hands.length ? hands.reduce((a, hd) => a + hd.stake, 0) : placed.main;
        const staked = main + insurance + placed.pp + placed.t3;
        if (staked) s.settle(staked, 0);
      }
      s.dispose();
    },
  });
}
