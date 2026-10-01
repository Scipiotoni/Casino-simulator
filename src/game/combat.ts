import type { Game } from './game';
import { audio } from '../core/audio';
import { formatMoney } from '../core/math';

/** Health you start with (and wake up with). */
export const MAX_HP = 100;
/** Share of the cash on you that whoever knocks you out takes (the vault keeps the rest safe). */
export const KO_SHARE = 0.1;
export const KO_MAX_LOSS = 250_000;
/** Seconds you're down for, and safe afterwards. */
export const KO_SECONDS = 5;
export const PROTECT_SECONDS = 5;

/** No map teleports for this long after you're hurt (no escaping a fight by teleporting). */
export const TELEPORT_LOCK_SECONDS = 20;

/** Cash a knockout costs you. */
export function koLoss(cash: number): number {
  return Math.max(0, Math.min(KO_MAX_LOSS, Math.floor(Math.max(0, cash) * KO_SHARE)));
}

/** What getting busted costs: 5% of your cash per wanted star, plus a flat fee. */
export function bustFine(cash: number, stars: number): number {
  const s = Math.max(1, Math.min(5, stars));
  return Math.max(0, Math.min(KO_MAX_LOSS, Math.floor(Math.max(0, cash) * 0.05 * s) + 250 * s, Math.floor(Math.max(0, cash))));
}

/** Another player you could hit, in the world frame you're looking at. */
export interface RemoteTarget {
  pid: string;
  name: string;
  x: number;
  z: number;
  y: number;
  height: number;
}

/** A hit you landed (for the crosshair's hit marker). */
export interface HitMark {
  t: number;
  head: boolean;
  ko: boolean;
}

/**
 * Street fights: your health, getting knocked out (and robbed), waking up again, and the
 * hit markers for shots you land. Only out on the street: inside every building you're safe.
 */
export class Combat {
  hp = MAX_HP;
  /** Seconds left lying on the pavement. */
  ko = 0;
  /** Seconds of "just woke up" safety. */
  protect = 0;
  /** Seconds since you were last hurt (health comes back after a while). */
  sinceHurt = 99;
  /** Red flash on screen when you're hit (0..1). */
  flash = 0;
  /** The direction the last hit came from, relative to where you face (radians), for the damage arrow. */
  hitFrom: number | null = null;
  mark: HitMark | null = null;
  /** Who knocked you out last, and what it cost. */
  lastKo: { by: string; lost: number; busted?: boolean } | null = null;
  private beatT = 0;
  /** Net hooks: tell the other player they hit you / they get your cash. */
  onLoot: ((pid: string, amount: number) => void) | null = null;
  onHitRemote: ((pid: string, dmg: number) => void) | null = null;
  remoteTargets: () => RemoteTarget[] = () => [];
  /** You're protected (blinking) right after waking up. */
  get safe(): boolean {
    return this.protect > 0 || this.ko > 0;
  }

  constructor(private g: Game) {}

  /** Seconds before you can teleport again (0 = free to go). */
  get teleportLock(): number {
    return Math.max(0, TELEPORT_LOCK_SECONDS - this.sinceHurt);
  }

  /** Out on the street, where fights happen. */
  get exposed(): boolean {
    const g = this.g;
    return g.state === 'playing' && !g.inside && g.player.floor === 0 && (!g.player.seat || !!g.drive.driving);
  }

  update(dt: number): void {
    const g = this.g;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.sinceHurt += dt;
    if (this.protect > 0) this.protect = Math.max(0, this.protect - dt);
    if (this.ko > 0) {
      this.ko -= dt;
      g.player.playEmote('ko', 0.3);
      if (this.ko <= 0) this.wake();
      return;
    }
    if (this.hp < MAX_HP && this.sinceHurt > 5) {
      this.hp = Math.min(MAX_HP, this.hp + dt * 9);
      if (this.hp >= MAX_HP) g.events.emit('combat', undefined);
    }
    if (this.hp < 35) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 0.9;
        audio.play('heartbeat', { volume: 0.7 });
      }
    }
  }

  /** You got shot by another player (or anything else). */
  damage(dmg: number, fromPid: string, fromName: string, fromX?: number, fromZ?: number): void {
    const g = this.g;
    if (dmg <= 0 || this.safe || !this.exposed) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHurt = 0;
    this.flash = Math.min(1, this.flash + 0.35 + dmg / 120);
    if (fromX !== undefined && fromZ !== undefined) {
      const a = Math.atan2(fromX - g.player.x, fromZ - g.player.z);
      const face = g.cam.mode === 'first' ? g.cam.lookYaw : g.player.yaw;
      this.hitFrom = a - face;
    }
    g.player.model.flinch = 1;
    g.cam.shake(0.08);
    audio.play('hurt');
    if (this.hp <= 0) this.knockOut(fromPid, fromName);
    g.events.emit('combat', undefined);
  }

  /** Down you go: the shooter takes a share of the cash on you. */
  private knockOut(fromPid: string, fromName: string): void {
    const g = this.g;
    this.ko = KO_SECONDS;
    this.hp = 0;
    if (fromPid === 'police') {
      // Busted: the police fine you and the chase is over.
      const police = g.street.police;
      const fine = bustFine(g.money, police.stars);
      if (fine > 0) g.spend(fine, 'robbed');
      police.clear();
      this.lastKo = { by: 'the police', lost: fine, busted: true };
      g.stats.knockedDown++;
      g.stats.busted = (g.stats.busted ?? 0) + 1;
      g.gunplay.drop();
      audio.play('busted');
      g.cam.shake(0.2);
      g.notify(fine > 0 ? `BUSTED! The police fined you ${formatMoney(fine)}. Cash in your vault is safe.` : 'BUSTED! Lucky for you, your pockets were empty.', 'bad');
      g.requestSave();
      return;
    }
    const lost = koLoss(g.money);
    if (lost > 0) {
      g.spend(lost, 'robbed');
      this.onLoot?.(fromPid, lost);
    }
    this.lastKo = { by: fromName, lost };
    g.stats.knockedDown++;
    g.gunplay.drop();
    audio.play('knockout');
    g.cam.shake(0.25);
    g.notify(lost > 0
      ? `${fromName} knocked you out and took ${formatMoney(lost)}. Cash in your vault is safe.`
      : `${fromName} knocked you out. Good thing your pockets were empty.`, 'bad');
    g.requestSave();
  }

  private wake(): void {
    this.ko = 0;
    this.hp = MAX_HP;
    this.protect = PROTECT_SECONDS;
    this.hitFrom = null;
    this.g.player.emote = null;
    this.g.events.emit('combat', undefined);
  }

  /** A shot of yours landed on somebody. */
  landed(head: boolean, ko: boolean): void {
    this.mark = { t: performance.now(), head, ko };
    audio.play(head ? 'headshot' : 'hitmarker');
    this.g.events.emit('combat', undefined);
  }

  /** Cash from someone you knocked out. */
  loot(amount: number, from: string): void {
    const g = this.g;
    if (amount <= 0) return;
    g.addMoney(amount, 'loot');
    g.stats.looted += amount;
    g.notify(`You took ${formatMoney(amount)} off ${from}.`, 'money');
    audio.play('cash');
    g.requestSave();
  }

  /** Forget everything (new game, title screen). */
  reset(): void {
    this.sinceHurt = 99;
    this.hp = MAX_HP;
    this.ko = 0;
    this.protect = 0;
    this.flash = 0;
    this.hitFrom = null;
    this.mark = null;
  }
}
