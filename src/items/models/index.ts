import type { ItemModel } from '../types';
import type { BuildOpts } from './common';
import { atmModel, clawModel, megaSlotModel, pachinkoModel, slotModel } from './slots';
import { bigWheelModel, blackjackModel, crapsModel, pokerModel, rouletteModel } from './tables';
import { barModel, benchModel, elevatorModel, frontDeskModel, snackModel, stageModel } from './services';
import {
  aquariumModel, binModel, diceModel, fountainModel, giantDiamondModel, lampModel, moneyTreeModel, neonModel, palmModel,
  pillarModel, plantModel, ropeModel, rugModel, statueModel,
} from './decor';

import { poolModel, roomModel } from './hotel';

export type { BuildOpts } from './common';

const BUILDERS: Record<string, (o: BuildOpts) => ItemModel> = {
  slot: slotModel,
  megaslot: megaSlotModel,
  claw: clawModel,
  pachinko: pachinkoModel,
  atm: atmModel,
  blackjack: blackjackModel,
  roulette: rouletteModel,
  bigwheel: bigWheelModel,
  craps: crapsModel,
  poker: pokerModel,
  bar: barModel,
  snack: snackModel,
  bench: benchModel,
  stage: stageModel,
  elevator: elevatorModel,
  frontdesk: frontDeskModel,
  room: roomModel,
  pool: poolModel,
  plant: plantModel,
  palm: palmModel,
  rope: ropeModel,
  bin: binModel,
  rug: rugModel,
  lamp: lampModel,
  neon: neonModel,
  dice: diceModel,
  pillar: pillarModel,
  fountain: fountainModel,
  aquarium: aquariumModel,
  statue: statueModel,
  moneytree: moneyTreeModel,
  giantdiamond: giantDiamondModel,
};

export function buildModel(key: string, opts: BuildOpts): ItemModel {
  const b = BUILDERS[key];
  if (!b) throw new Error(`No model builder for ${key}`);
  return b(opts);
}
