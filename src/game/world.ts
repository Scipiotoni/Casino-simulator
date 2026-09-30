import type * as THREE from 'three';
import type { Grid } from '../world/grid';
import type { ItemManager } from '../items/itemManager';
import type { TrashManager } from '../world/trash';
import type { Effects } from '../render/effects';
import type { Floaters } from '../ui/floaters';
import type { SfxName } from '../core/audio';
import type { Customer } from '../entities/customer';

export type MoneyReason =
  | 'collect' | 'tip' | 'bust' | 'purchase' | 'upgrade' | 'sell' | 'wages' | 'upkeep' | 'reward' | 'payout' | 'expand' | 'paint'
  | 'comp' | 'event' | 'play' | 'cosmetic';

/** What NPCs and machines are allowed to see and poke of the running game. */
export interface World {
  /** Number of floors in the casino (1 = ground floor only). */
  readonly floors: number;
  gridAt(floor: number): Grid;
  readonly items: ItemManager;
  readonly trash: TrashManager;
  readonly effects: Effects;
  readonly floaters: Floaters;
  readonly time: number;
  readonly customers: Customer[];
  readonly rating: number;
  readonly playerPos: THREE.Vector3;
  onCustomerExited(c: Customer): void;
  onCustomerGone(c: Customer): void;
  addMoney(amount: number, reason: MoneyReason, pos?: THREE.Vector3): void;
  sfxAt(name: SfxName, x: number, z: number, volume?: number): void;
  stageBoostAt(x: number, z: number, floor?: number): number;
  witness(x: number, z: number, radius: number, mood: number, except?: Customer, floor?: number): void;
  notify(text: string, kind?: 'info' | 'good' | 'bad' | 'money' | 'event'): void;
  staffCount(role: string): number;
  onStaffBust(): void;
  onStaffClean(): void;
}
