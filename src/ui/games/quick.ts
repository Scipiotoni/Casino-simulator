import { h } from '../dom';
import { formatMoney } from '../../core/math';
import { audio } from '../../core/audio';
import { resolveClaw, resolvePachinko } from '../../items/games';
import { type GameCtx, Session, chipRow, chipValues, resultLine, setResult, sleep } from './common';

/** Pachinko and the claw crane: one button, one little show. */
export function openQuick(ctx: GameCtx): void {
  const s = new Session(ctx);
  const claw = ctx.item.def.kind === 'claw';
  const chips = chipValues(s.min);
  let bet = chips[0];
  let busy = false;
  const stage = h('div', { class: `qk ${claw ? 'claw' : 'pachinko'}` });
  const ball = h('div', { class: claw ? 'qk-claw' : 'qk-ball' });
  stage.appendChild(ball);
  if (!claw) for (let i = 0; i < 24; i++) stage.appendChild(h('i', { class: 'qk-pin', style: `left:${8 + (i % 6) * 17 + (Math.floor(i / 6) % 2) * 8}%;top:${14 + Math.floor(i / 6) * 18}%` }));
  else for (let i = 0; i < 9; i++) stage.appendChild(h('span', { class: 'qk-toy', text: ['🧸', '🐰', '🦄', '🐸', '🐙', '🐼', '🦊', '🐯', '🐶'][i], style: `left:${8 + (i % 5) * 18}%;bottom:${6 + Math.floor(i / 5) * 18}%` }));
  const result = resultLine();
  const go = h('button', { class: 'btn gold tg-main', text: claw ? 'Drop the claw' : 'Launch ball' });
  go.addEventListener('click', async () => {
    if (busy || s.closed) return;
    if (!s.bet(bet)) return;
    busy = true;
    setResult(result, '');
    const o = claw ? resolveClaw(bet, false) : resolvePachinko(bet, ctx.item.def.rtp, false);
    audio.play(claw ? 'claw' : 'spin');
    ball.className = claw ? 'qk-claw drop' : 'qk-ball fall';
    ball.style.left = `${20 + Math.random() * 60}%`;
    await sleep(claw ? 1600 : 1500);
    s.settle(bet, o.payout);
    setResult(result, o.payout > bet ? `${o.label}  +${formatMoney(o.payout - bet)}` : o.payout === bet ? o.label : `${o.label}  −${formatMoney(bet - o.payout)}`, o.payout > bet ? (o.tier === 'big' || o.tier === 'jackpot' ? 'big' : 'win') : 'lose');
    ball.className = claw ? `qk-claw${o.payout > 0 ? ' got' : ''}` : 'qk-ball';
    busy = false;
  });
  const body = h('div', { class: 'mg tg' },
    s.head,
    stage,
    result,
    chipRow(chips, () => bet, (v) => (bet = v), { min: s.min, bank: () => s.bank }),
    go,
  );
  ctx.modals.open(ctx.item.def.name, body, { cls: 'minigame table-game', onClose: () => s.dispose() });
}
