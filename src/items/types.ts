import type * as THREE from 'three';

export interface Card {
  rank: number; // 0 = Ace .. 12 = King
  suit: number;
}

export type Visual =
  | { kind: 'slot'; symbols: [number, number, number] }
  | { kind: 'claw'; win: boolean }
  | { kind: 'pachinko'; mult: number }
  | { kind: 'roulette'; number: number; bet: string }
  | { kind: 'wheel'; segment: number; bet: number }
  | { kind: 'craps'; dice: number[]; bet: string }
  | { kind: 'blackjack'; player: Card[]; dealer: Card[] }
  | { kind: 'poker'; hole: Card[]; board: Card[]; hand: string }
  | { kind: 'service' }
  | { kind: 'none' };

export type Tier = 'lose' | 'push' | 'win' | 'big' | 'jackpot';

export interface Outcome {
  bet: number;
  payout: number;
  label: string;
  tier: Tier;
  visual: Visual;
}

/** Shared visual state for tables where everyone watches the same spin/roll/deal. */
export type SharedVisual =
  | { kind: 'roulette'; number: number }
  | { kind: 'wheel'; segment: number }
  | { kind: 'craps'; dice: number[] }
  | { kind: 'blackjack'; dealer: Card[]; player?: Card[]; note?: string }
  | { kind: 'poker'; board: Card[]; dealer3?: Card[] }
  | { kind: 'none' };

export type ModelEvent =
  | { type: 'start'; seat: number; outcome: Outcome; duration: number }
  | { type: 'result'; seat: number; outcome: Outcome }
  | { type: 'tableStart'; seats: number[]; outcomes: Map<number, Outcome>; shared: SharedVisual; duration: number }
  | { type: 'tableResult'; seats: number[]; outcomes: Map<number, Outcome>; shared: SharedVisual }
  | { type: 'bet'; seat: number; amount: number }
  | { type: 'clear'; seat: number }
  | { type: 'jackpot'; amount: number };

export interface ModelCtx {
  t: number;
  broken: boolean;
  level: number;
  busy: boolean;
  jackpotPot: number;
}

export interface ItemModel {
  root: THREE.Group;
  /** Height used for status icons floating above the model. */
  height: number;
  update(dt: number, ctx: ModelCtx): void;
  event(ev: ModelEvent): void;
  dispose(): void;
}
