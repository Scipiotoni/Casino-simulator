import type { Game } from '../game/game';
import { roman } from '../game/game';
import type { Modals } from './modals';
import { COSMETICS, cosmetic } from '../cosmetics/catalog';
import { DAILY_MULT, GIFT_CHOICES, GIFT_MAX, GIFT_NOTES, LOAN_CALL, LOAN_RATE, canBorrow, dailyReward } from '../game/social';
import { h, clear } from './dom';
import { formatMoney } from '../core/math';
import { audio } from '../core/audio';

/** One row of the street leaderboard. */
export interface LeaderEntry {
  pid: string;
  name: string;
  me: boolean;
  online: boolean;
  /** Net worth, star rating, casino level, rebirths. */
  nw: number;
  st: number;
  lv: number;
  rb: number;
}

/** What the multiplayer layer offers the gift and leaderboard screens. */
export interface SocialApi {
  online(): boolean;
  me(): string;
  players(): { pid: string; name: string; online: boolean; where: string; casino?: string; seen?: number }[];
  sendGift(pid: string, name: string, amount: number, item: string | undefined, note: string): boolean;
  /** Has that player opened this gift of yours? */
  opened(pid: string, id: string): boolean;
  leaderboard(): LeaderEntry[];
  isOnline(pid: string): boolean;
}

/** Wrap a gift for another player: cash, a luxury item, a note. */
export function openGift(g: Game, m: Modals, api: SocialApi | null, pid: string, name: string): void {
  if (!api) {
    g.notify('Multiplayer isn’t connected here.', 'bad');
    return;
  }
  let amount = 5_000;
  let item: string | undefined;
  let note = GIFT_NOTES[0];
  const body = h('div', { class: 'stack gift-modal' });
  const total = h('b', { class: 'gift-total' });
  const send = h('button', { class: 'btn gold big' }) as HTMLButtonElement;
  const amountInput = h('input', { class: 'text-input', type: 'number', value: String(amount), 'aria-label': 'Cash amount' }) as HTMLInputElement;
  amountInput.min = '0';
  amountInput.max = String(GIFT_MAX);
  amountInput.step = '100';
  const amountRow = h('div', { class: 'chips' });
  const itemRow = h('div', { class: 'gift-items' });
  const noteInput = h('input', { class: 'text-input', type: 'text', value: note, maxLength: 80, placeholder: 'Write a note (optional)', 'aria-label': 'Gift note' }) as HTMLInputElement;
  const noteRow = h('div', { class: 'chips' });

  const refresh = () => {
    const price = item ? cosmetic(item)?.price ?? 0 : 0;
    const sum = amount + price;
    total.textContent = sum > 0 ? formatMoney(sum) : '—';
    send.textContent = `🎁 Send to ${name}`;
    send.disabled = sum <= 0 || sum > g.casinoCash;
    amountRow.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.v) === amount));
    itemRow.querySelectorAll('.gift-item').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === (item ?? '')));
    noteRow.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('on', b.textContent === note));
  };

  for (const v of [0, ...GIFT_CHOICES]) {
    amountRow.appendChild(h('button', {
      class: 'chip-btn', text: v ? formatMoney(v) : 'No cash', dataset: { v: String(v) },
      onClick: () => { amount = v; amountInput.value = String(v); audio.play('click'); refresh(); },
    }));
  }
  amountInput.addEventListener('input', () => {
    amount = Math.max(0, Math.min(GIFT_MAX, Math.round(Number(amountInput.value) || 0)));
    refresh();
  });
  itemRow.appendChild(h('button', { class: 'gift-item', dataset: { v: '' }, html: '<span>✖️</span><small>Nothing</small>', onClick: () => { item = undefined; audio.play('click'); refresh(); } }));
  for (const c of COSMETICS) {
    itemRow.appendChild(h('button', {
      class: 'gift-item', dataset: { v: c.id }, title: `${c.name}: ${c.description}`,
      html: `<span>${c.icon}</span><small>${c.name.replace(/</g, '&lt;')}</small><i>${formatMoney(c.price)}</i>`,
      onClick: () => { item = item === c.id ? undefined : c.id; audio.play('click'); refresh(); },
    }));
  }
  for (const n of GIFT_NOTES) {
    noteRow.appendChild(h('button', { class: 'chip-btn', text: n, onClick: () => { note = n; noteInput.value = n; refresh(); } }));
  }
  noteInput.addEventListener('input', () => {
    note = noteInput.value;
    refresh();
  });
  send.addEventListener('click', () => {
    if (api.sendGift(pid, name, amount, item, noteInput.value)) m.close();
  });

  const online = api.isOnline(pid);
  body.append(
    h('p', { class: 'muted small', text: `${online ? `${name} is online: they’ll open it right away.` : `${name} is offline: the gift waits for them (up to two weeks).`} It comes out of your casino’s bank now. Luxury items they already own turn into their price in cash.` }),
    h('div', { class: 'field-label', text: '💵 Cash' }),
    amountRow,
    amountInput,
    h('div', { class: 'field-label', text: '💎 Luxury item (optional)' }),
    itemRow,
    h('div', { class: 'field-label', text: '✉️ Note' }),
    noteRow,
    noteInput,
    h('div', { class: 'kv' }, h('span', { text: `Total (your casino’s bank: ${formatMoney(g.casinoCash)})` }), total),
  );
  refresh();
  m.open(`🎁 Gift for ${name}`, body, { foot: send });
}

/** Menu → Gifts: everyone you can send to, plus what you've sent and opened. */
export function openGifts(g: Game, m: Modals, api: SocialApi | null): void {
  const body = h('div', { class: 'stack' });
  const net = g.net;
  if (!api || !api.online()) {
    body.appendChild(h('p', { class: 'muted', text: 'Gifts need a connection to the street. Other players show up here when you’re online.' }));
  } else {
    const list = api.players();
    body.appendChild(h('div', { class: 'field-label', text: 'Send a gift' }));
    if (!list.length) body.appendChild(h('p', { class: 'muted', text: 'Nobody else is on the street yet.' }));
    // Same name twice (someone playing on a second device): their casinos and when they were on tell them apart.
    const names = new Map<string, number>();
    for (const p of list) names.set(p.name, (names.get(p.name) ?? 0) + 1);
    for (const p of list.slice(0, 40)) {
      const extra = [p.casino && (names.get(p.name) ?? 0) > 1 ? p.casino : '', !p.online && p.seen ? `on ${ago(p.seen)}` : ''].filter(Boolean).join(' · ');
      body.appendChild(h('div', { class: 'gift-row' },
        h('div', {}, h('b', { text: p.name }), h('span', { class: `muted small${p.online ? ' pos' : ''}`, text: ` · ${p.online ? '● online' : 'offline'}${extra ? ` · ${extra}` : ''}` })),
        h('button', { class: 'btn small gold', text: '🎁 Gift', onClick: () => openGift(g, m, api, p.pid, p.name) }),
      ));
    }
  }
  const opened = [...(net.giftLog ?? [])].reverse().slice(0, 15);
  body.appendChild(h('div', { class: 'field-label', text: `Gifts you opened (${g.stats.giftsReceived ?? 0} all time)` }));
  if (!opened.length) body.appendChild(h('p', { class: 'muted small', text: 'None yet.' }));
  for (const x of opened) body.appendChild(giftLine(`From ${x.from}`, x.a, x.c, x.m, x.t));
  const sent = [...(net.gifts ?? [])].reverse().slice(0, 15);
  body.appendChild(h('div', { class: 'field-label', text: `Gifts you sent (${g.stats.giftsSent ?? 0} all time)` }));
  if (!sent.length) body.appendChild(h('p', { class: 'muted small', text: 'None yet. Click a player, or pick one above.' }));
  for (const x of sent) {
    const got = api?.opened(x.to, x.i) ?? false;
    body.appendChild(giftLine(`To ${x.nm || 'a player'}`, x.a, x.c, x.m, x.t, got ? '✓ opened' : '⏳ not opened yet'));
  }
  m.open('🎁 Gifts', body);
}

function giftLine(who: string, cash: number, item: string | undefined, note: string, t: number, status = ''): HTMLElement {
  const c = item ? cosmetic(item) : undefined;
  const what = [cash > 0 ? formatMoney(cash) : '', c ? `${c.icon} ${c.name}` : ''].filter(Boolean).join(' + ');
  return h('div', { class: 'gift-line' },
    h('div', {}, h('b', { text: who }), h('span', { class: 'muted small', text: ` · ${ago(t)}` }), status ? h('span', { class: `small ${status.startsWith('✓') ? 'pos' : 'muted'}`, text: ` · ${status}` }) : null),
    h('div', {}, h('span', { class: 'pos', text: what }), note ? h('span', { class: 'muted small', text: ` “${note}”` }) : null),
  );
}

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** Menu → Leaderboard: everyone on the street ranked. */
export function openLeaderboard(g: Game, m: Modals, api: SocialApi | null): void {
  type Key = 'nw' | 'st' | 'lv' | 'rb';
  let key: Key = 'nw';
  const body = h('div', { class: 'stack' });
  const tabs = h('div', { class: 'seg' });
  const table = h('div', { class: 'leader-list' });
  const tabsDef: [Key, string][] = [['nw', '💰 Net worth'], ['st', '⭐ Rating'], ['lv', '📈 Level'], ['rb', '⟳ Rebirths']];
  const render = () => {
    tabs.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.k === key));
    clear(table);
    const me = { pid: 'me', name: g.player.name, me: true, online: true, nw: g.netWorth, st: Math.round(g.rating * 10) / 10, lv: g.homeLevel, rb: g.rebirths };
    const rows = api ? api.leaderboard() : [me];
    rows.sort((a, b) => b[key] - a[key] || b.nw - a.nw);
    const medals = ['🥇', '🥈', '🥉'];
    rows.slice(0, 50).forEach((r, i) => {
      const val = key === 'nw' ? formatMoney(r.nw) : key === 'st' ? `${r.st.toFixed(1)} ★` : key === 'lv' ? `Level ${r.lv}` : r.rb ? roman(r.rb) : '—';
      table.appendChild(h('div', { class: `leader-row${r.me ? ' me' : ''}` },
        h('span', { class: 'leader-rank', text: medals[i] ?? `${i + 1}` }),
        h('span', { class: 'leader-name' }, h('b', { text: r.name }), r.me ? h('span', { class: 'chip gold', text: 'You' }) : r.online ? h('span', { class: 'muted small pos', text: ' ●' }) : null),
        h('b', { class: 'leader-val', text: val }),
        !r.me && api ? h('button', { class: 'btn small', text: '🎁', title: `Send ${r.name} a gift`, onClick: () => openGift(g, m, api, r.pid, r.name) }) : h('span'),
      ));
    });
    const mine = rows.findIndex((r) => r.me) + 1;
    if (mine > 50) table.appendChild(h('p', { class: 'muted small', text: `You’re #${mine}.` }));
  };
  for (const [k, label] of tabsDef) tabs.appendChild(h('button', { class: 'seg-btn', text: label, dataset: { k }, onClick: () => { key = k; render(); } }));
  body.append(
    h('p', { class: 'muted small', text: api?.online() ? 'Everyone with a casino on the street. Net worth is both banks plus your vault, minus what you owe the bank.' : 'You’re offline: only you are on the board. Other players appear when you’re connected.' }),
    tabs,
    table,
    h('button', { class: 'btn small', text: '↻ Refresh', onClick: () => { audio.play('click'); render(); } }),
  );
  render();
  m.open('🏆 Leaderboard', body);
}

/** Menu → Bank loan: borrow against your casino, pay it back before interest runs away. */
export function openLoan(g: Game, m: Modals): void {
  const body = h('div', { class: 'stack' });
  const intro = h('p', { class: 'muted small' });
  const owedEl = h('b');
  const freeEl = h('b');
  const dayEl = h('b');
  const bar = h('div', { class: 'loan-bar', title: 'How close you are to the bank calling in the loan' });
  const blockEl = h('p', { class: 'chip bad', hidden: true });
  // Buttons stay put (amounts are worked out when clicked) so a click never lands on a rebuilt screen.
  const borrowFracs = [0.1, 0.25, 0.5, 1];
  const repayFracs = [0.1, 0.25, 0.5];
  const borrowBtns = borrowFracs.map((f) => h('button', { class: 'btn small', onClick: () => { g.borrow(Math.floor(canBorrow(g.loanOwed, g.homeLevel, g.rebirths) * f)); update(); } }) as HTMLButtonElement);
  const repayBtns = repayFracs.map((f) => h('button', { class: 'btn small', onClick: () => { g.repayLoan(Math.floor(g.loanOwed * f)); update(); } }) as HTMLButtonElement);
  const payAll = h('button', { class: 'btn small gold', onClick: () => { g.repayLoan(Math.ceil(g.loanOwed)); update(); } }) as HTMLButtonElement;
  const update = () => {
    const owed = g.loanOwed;
    const line = g.loanLine;
    const free = canBorrow(owed, g.homeLevel, g.rebirths);
    const block = g.loanBlock();
    intro.textContent = `The bank lends against your casino: up to ${formatMoney(line)} at level ${g.homeLevel}${g.rebirths ? ` with ${g.rebirths} rebirth${g.rebirths > 1 ? 's' : ''}` : ''}. Interest is ${Math.round(LOAN_RATE * 100)}% a game day, charged only while you play. If interest pushes what you owe past ${formatMoney(line * LOAN_CALL)}, the bank calls the loan in and takes it all from your casino, even if that puts you in the red. Your loan follows you through rebirths.`;
    owedEl.textContent = owed > 0 ? formatMoney(owed) : 'Nothing';
    owedEl.className = owed > 0 ? 'neg' : 'pos';
    freeEl.textContent = formatMoney(free);
    dayEl.textContent = owed > 0 ? formatMoney(owed * LOAN_RATE) : '—';
    const pct = Math.min(100, (owed / (line * LOAN_CALL)) * 100);
    bar.style.setProperty('--p', `${pct}%`);
    bar.classList.toggle('hot', pct > 80);
    blockEl.hidden = !block;
    blockEl.textContent = block ?? '';
    borrowFracs.forEach((f, i) => {
      const a = Math.floor(free * f);
      borrowBtns[i].textContent = f === 1 ? `All · ${formatMoney(a)}` : formatMoney(a);
      borrowBtns[i].disabled = !!block || a < 100;
    });
    repayFracs.forEach((f, i) => {
      const a = Math.floor(owed * f);
      repayBtns[i].textContent = formatMoney(a);
      repayBtns[i].disabled = !!block || a < 1 || g.money < 1;
    });
    payAll.textContent = `Pay it all · ${formatMoney(Math.ceil(owed))}`;
    payAll.disabled = !!block || owed < 1 || g.money < Math.ceil(owed);
  };
  body.append(
    intro,
    h('div', { class: 'kv' }, h('span', { text: 'You owe' }), owedEl),
    h('div', { class: 'kv' }, h('span', { text: 'You can still borrow' }), freeEl),
    h('div', { class: 'kv' }, h('span', { text: 'Interest per game day' }), dayEl),
    bar,
    blockEl,
    h('div', { class: 'field-label', text: 'Borrow' }),
    h('div', { class: 'btn-row wrap' }, ...borrowBtns),
    h('div', { class: 'field-label', text: 'Pay back' }),
    h('div', { class: 'btn-row wrap' }, ...repayBtns, payAll),
  );
  update();
  const t = window.setInterval(update, 1000);
  m.open('🏦 Bank loan', body, { cls: 'small', onClose: () => window.clearInterval(t) });
}

/** The daily login reward: seven days in a row, the seventh is the big one. */
export function openDaily(g: Game, m: Modals): void {
  const info = g.dailyInfo();
  const body = h('div', { class: 'stack daily-modal' });
  const row = h('div', { class: 'daily-row' });
  // Where today sits in the 7-day cycle.
  const cyc = ((info.streak - 1) % DAILY_MULT.length) + 1;
  const base = info.streak - cyc;
  for (let d = 1; d <= DAILY_MULT.length; d++) {
    const done = d < cyc || (d === cyc && !info.claimable);
    const today = d === cyc && info.claimable;
    row.appendChild(h('div', { class: `daily-box${done ? ' done' : ''}${today ? ' today' : ''}${d === 7 ? ' big' : ''}` },
      h('small', { text: `Day ${d}` }),
      h('span', { text: done ? '✅' : d === 7 ? '💎' : '🎁' }),
      h('b', { text: formatMoney(dailyReward(base + d, g.homeLevel)) }),
    ));
  }
  body.append(
    h('p', { class: 'muted small', text: info.claimable
      ? `Come back every day for a bigger reward. Day ${info.streak} of your streak. Miss a day and it starts over.`
      : `You’ve claimed today’s reward (${info.streak}-day streak). Come back tomorrow!` }),
    row,
  );
  const claim = h('button', {
    class: 'btn gold big', text: info.claimable ? `Claim ${formatMoney(info.reward)}` : 'See you tomorrow', disabled: !info.claimable,
    onClick: () => {
      const got = g.claimDaily();
      if (got > 0) g.notify(`📅 Day ${info.streak} reward: ${formatMoney(got)}!${g.inHotel ? ' It’s in your casino’s bank.' : ''}`, 'money');
      m.close();
    },
  });
  m.open('📅 Daily reward', body, { foot: claim, cls: 'small' });
}
