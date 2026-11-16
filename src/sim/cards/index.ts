import type { MainWeaponId } from '../types';
import { DEBUG_LOADOUTS } from '../../content/cards';
import { CardState } from './state';

export { CARDS, DEBUG_LOADOUTS, getCard, SUPPLY_DEFS, DRAFT_RULES } from '../../content/cards';
export { CardState } from './state';
export { computeWeaponStats, computePlayerStats } from './stats';
export { CardRuntime, type ShotOutcome } from './runtime';
export { DraftSystem, isEligible, type DraftContext, type PickResult } from './draft';
export { cardView, ownedCardViews, supplyView, previewLines } from './views';
export { cardText, cardDrawback } from './text';

/** Applies a debug loadout (see DEBUG_LOADOUTS) to a state; equips both mains first. Returns total pick heal. */
export function applyDebugLoadout(state: CardState, key: keyof typeof DEBUG_LOADOUTS | string): number {
  const ids = DEBUG_LOADOUTS[key];
  if (!ids) throw new Error(`Unknown debug loadout ${key}`);
  (['coil_carbine', 'arc_scattergun'] as MainWeaponId[]).forEach((w) => state.equip(w));
  let heal = 0;
  for (const id of ids) {
    state.add(id);
    heal += CardState.pickHeal(id);
  }
  return heal;
}

