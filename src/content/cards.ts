import type { CardDef, TriggerKind, TriggeredEffect } from '../sim/types';

/**
 * First-slice card catalog (plain data). Every number the runtime or the
 * preview uses lives in `modifiers` / `effects[].params`; `text` and `drawback`
 * are templates filled from those same values by `fillText` (src/sim/cards/text.ts).
 *
 * Placeholders: `{key}` = |value|, `{key%}` = round(|value| * 100). Keys come from
 * the merged effect params and the modifier values (keyed by stat name).
 *
 * Two data-only effect kinds are local extensions of TriggerKind (the shared
 * union has no slot for them): 'mass_driver' (pierce damage multiplier) and
 * 'on_pick' (one-shot heal when the card is taken).
 */
export type LocalTriggerKind = TriggerKind | 'mass_driver' | 'on_pick';
const fx = (kind: LocalTriggerKind, params: Record<string, number>): TriggeredEffect => ({
  kind: kind as TriggerKind,
  params,
});

export const CARDS: CardDef[] = [
  {
    id: 'alloy_windings', name: 'Alloy Windings', rarity: 'common', scope: 'both_mains', maxRank: 3,
    requires: [], modifiers: [{ stat: 'damageBonus', value: 0.1 }], effects: [],
    text: '+{damageBonus%}% direct damage per rank.', group: 'damage', affectsWeapons: true,
  },
  {
    id: 'quick_swap_coupler', name: 'Quick-Swap Coupler', rarity: 'common', scope: 'both_mains', maxRank: 2,
    requires: [], modifiers: [{ stat: 'reloadSpeed', value: 0.15 }], effects: [],
    text: '+{reloadSpeed%}% reload speed per rank.', group: 'handling', affectsWeapons: true,
  },
  {
    id: 'extended_cells', name: 'Extended Cells', rarity: 'common', scope: 'both_mains', maxRank: 2,
    requires: [], modifiers: [{ stat: 'capacityBonus', value: 0.2 }], effects: [],
    text: '+{capacityBonus%}% magazine capacity per rank, rounded up. Fill the extra space by reloading from reserve.',
    group: 'ammo', affectsWeapons: true,
  },
  {
    id: 'salvage_funnel', name: 'Salvage Funnel', rarity: 'common', scope: 'ammo', maxRank: 2,
    requires: [], modifiers: [{ stat: 'pickupAmmo', value: 0.25 }], effects: [],
    text: '+{pickupAmmo%}% ammo from pickups per rank.', group: 'ammo', affectsWeapons: false,
  },
  {
    id: 'reactive_liner', name: 'Reactive Liner', rarity: 'common', scope: 'player', maxRank: 2,
    requires: [], modifiers: [{ stat: 'maxHealth', value: 20 }], effects: [fx('on_pick', { heal: 20 })],
    text: '+{maxHealth} maximum health and restore {heal} health immediately.', group: 'survival', affectsWeapons: false,
  },
  {
    id: 'step_assist', name: 'Step Assist', rarity: 'common', scope: 'player', maxRank: 2,
    requires: [], modifiers: [{ stat: 'dashCooldown', value: 0.15 }], effects: [],
    text: '-{dashCooldown%}% base dash cooldown per rank.', group: 'mobility', affectsWeapons: false,
  },
  {
    id: 'hot_cycle', name: 'Hot Cycle', rarity: 'rare', scope: 'both_mains', maxRank: 1,
    requires: [], modifiers: [{ stat: 'fireRate', value: 0.3 }, { stat: 'reloadSpeed', value: -0.2 }], effects: [],
    text: '+{fireRate%}% fire rate.', drawback: '-{reloadSpeed%}% reload speed.', group: 'handling', affectsWeapons: true,
  },
  {
    id: 'chargeback', name: 'Chargeback', rarity: 'uncommon', scope: 'both_mains', maxRank: 1,
    requires: [], modifiers: [], effects: [fx('chargeback', { amount: 1, cooldown: 1.5 })],
    text: 'A direct kill returns {amount} unit of matching ammo to reserve. One refund per {cooldown} s across both weapons.',
    group: 'proc', affectsWeapons: true,
  },
  {
    id: 'ion_primer', name: 'Ion Primer', rarity: 'uncommon', scope: 'both_mains', maxRank: 1,
    requires: [], modifiers: [], effects: [fx('ion_primer', { duration: 3, ionizedBonus: 0.1 })],
    text: 'Direct hits apply or refresh Ionized for {duration} s. Ionized targets take {ionizedBonus%}% more direct damage from subsequent hits.',
    group: 'proc', affectsWeapons: true,
  },
  {
    id: 'breaker_fuse', name: 'Breaker Fuse', rarity: 'rare', scope: 'both_mains', maxRank: 1,
    requires: ['ion_primer'], modifiers: [],
    effects: [fx('breaker_fuse', { damageFrac: 0.3, radius: 3, maxTargets: 4, maxBursts: 1 })],
    text: 'A direct kill on a target already Ionized before the shot bursts for {damageFrac%}% of base shot damage in a {radius} m radius. Up to {maxTargets} nearby targets in line of sight; one burst per shot.',
    group: 'proc', affectsWeapons: true,
  },
  {
    id: 'coil_covenant', name: 'Coil Covenant', rarity: 'rare', scope: 'pact', maxRank: 1,
    requires: [], pactWeapon: 'coil_carbine', modifiers: [], effects: [fx('pact', { damageBonus: 0.1 })],
    text: 'Commit to the Coil Carbine and unlock its exclusive cards. +{damageBonus%}% damage with the carbine.',
    drawback: 'The Arc Scattergun is surrendered for this run.', group: 'pact', affectsWeapons: true,
  },
  {
    id: 'arc_covenant', name: 'Arc Covenant', rarity: 'rare', scope: 'pact', maxRank: 1,
    requires: [], pactWeapon: 'arc_scattergun', modifiers: [], effects: [fx('pact', { damageBonus: 0.1 })],
    text: 'Commit to the Arc Scattergun and unlock its exclusive cards. +{damageBonus%}% damage with the scattergun.',
    drawback: 'The Coil Carbine is surrendered for this run.', group: 'pact', affectsWeapons: true,
  },
  {
    id: 'cascade_bus', name: 'Cascade Bus', rarity: 'uncommon', scope: 'coil_pact', maxRank: 1,
    requires: [], requiresPact: 'coil_carbine', modifiers: [],
    effects: [fx('cascade_bus', { every: 6, damageFrac: 0.4, range: 6, maxTargets: 1 })],
    text: 'Every {every}th Coil shot that deals direct damage arcs from its first hit to one other visible enemy within {range} m for {damageFrac%}% of base shot damage. The charge is consumed even if the arc has no target.',
    group: 'proc', affectsWeapons: true,
  },
  {
    id: 'mass_driver', name: 'Mass Driver', rarity: 'rare', scope: 'coil_pact', maxRank: 1,
    requires: [], requiresPact: 'coil_carbine', modifiers: [{ stat: 'pierce', value: 1, weapons: ['coil_carbine'] }],
    effects: [fx('mass_driver', { pierceDamageMul: 0.6 })],
    text: 'Shots pierce {pierce} additional enemy for {pierceDamageMul%}% of normal direct damage against that second target. Solid geometry stops the shot.',
    group: 'damage', affectsWeapons: true,
  },
  {
    id: 'ground_loop', name: 'Ground Loop', rarity: 'uncommon', scope: 'coil_pact', maxRank: 1,
    requires: [], requiresPact: 'coil_carbine', modifiers: [],
    effects: [fx('ground_loop', { amount: 2, cooldown: 0.75 })],
    text: 'A direct Coil kill while moving transfers up to {amount} cells from reserve to available magazine space. At most once per {cooldown} s.',
    group: 'ammo', affectsWeapons: true,
  },
  {
    id: 'rupture_relay', name: 'Rupture Relay', rarity: 'legendary', scope: 'coil_pact', maxRank: 1,
    requires: ['cascade_bus', 'ion_primer'], requiresPact: 'coil_carbine', modifiers: [],
    effects: [fx('rupture_relay', { range: 5, damageFrac: 0.5, maxChain: 1 })],
    text: 'If the first arc recipient is Ionized, arc once more to a third distinct visible enemy within {range} m of it for {damageFrac%}% of the first arc\'s damage.',
    group: 'proc', affectsWeapons: true,
  },
  {
    id: 'repulsion_chamber', name: 'Repulsion Chamber', rarity: 'uncommon', scope: 'arc_pact', maxRank: 1,
    requires: [], requiresPact: 'arc_scattergun', modifiers: [],
    effects: [fx('repulsion_chamber', { range: 7, strength: 7 })],
    text: 'The first pellet contact within {range} m per enemy per shot pushes light enemies away. Heavies resist the push and give visible hit feedback.',
    group: 'proc', affectsWeapons: true,
  },
  {
    id: 'ion_fan', name: 'Ion Fan', rarity: 'uncommon', scope: 'arc_pact', maxRank: 1,
    requires: [], requiresPact: 'arc_scattergun',
    modifiers: [
      { stat: 'pellets', value: 2, weapons: ['arc_scattergun'] },
      { stat: 'spread', value: 0.25, weapons: ['arc_scattergun'] },
    ],
    effects: [],
    text: '+{pellets} pellets on standard discharges, using the same ammo.', drawback: '+{spread%}% spread.',
    group: 'damage', affectsWeapons: true,
  },
  {
    id: 'cold_chamber', name: 'Cold Chamber', rarity: 'legendary', scope: 'arc_pact', maxRank: 1,
    requires: [], requiresPact: 'arc_scattergun', modifiers: [],
    effects: [fx('cold_chamber', { pellets: 1, pierce: 1, damageFrac1: 0.8, damageFrac2: 0.45 })],
    text: 'The first trigger pull after a completed reload fires a narrow slug. It hits up to two enemies for {damageFrac1%}% then {damageFrac2%}% of base shot damage, using one ammo. The slug replaces the spread and pellet changes for that shot.',
    group: 'damage', affectsWeapons: true,
  },
  {
    id: 'backwash', name: 'Backwash', rarity: 'rare', scope: 'arc_pact', maxRank: 1,
    requires: ['ion_fan'], requiresPact: 'arc_scattergun', modifiers: [],
    effects: [fx('backwash', { minTargets: 3, range: 5.5, halfAngleDeg: 40, maxTargets: 5, cooldown: 1, stagger: 0.9 })],
    text: 'A normal shot that damages at least {minTargets} different enemies emits a short-range stagger cone. Affects up to {maxTargets} nearby targets; at most once per {cooldown} s.',
    group: 'proc', affectsWeapons: true,
  },
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function getCard(id: string): CardDef | undefined {
  return BY_ID.get(id);
}

export function effectOf(card: CardDef, kind: LocalTriggerKind): TriggeredEffect | undefined {
  return card.effects.find((e) => e.kind === (kind as TriggerKind));
}

/** Params of a card's effect (empty object when absent). */
export function paramsOf(cardId: string, kind: LocalTriggerKind): Record<string, number> {
  const c = BY_ID.get(cardId);
  return (c && effectOf(c, kind)?.params) || {};
}

export type SupplyId = 'supply_ammo' | 'supply_health' | 'supply_salvage';
export const SUPPLY_IDS: SupplyId[] = ['supply_ammo', 'supply_health', 'supply_salvage'];

/** Supply filler data (shared by the draft, the views and the integrator). */
export const SUPPLY_DEFS: Record<SupplyId, { name: string; text: string; ammoFraction?: number; heal?: number; salvage?: number }> = {
  supply_ammo: { name: 'Reserve Ammo', text: 'Refill {ammoFraction%}% of reserve capacity for the current weapon.', ammoFraction: 0.5 },
  supply_health: { name: 'Health Kit', text: 'Restore {heal} health.', heal: 40 },
  supply_salvage: { name: 'Salvage Cache', text: 'Gain {salvage} Salvage.', salvage: 30 },
};

export const DRAFT_RULES = {
  rerollCost: 20,
  skipSalvage: 10,
  offerSize: 3,
  /** Base rarity weights; deeper rewards lean stronger (KRYPTA-style, t = depth * 0.25). */
  rarityWeight: { common: 60, uncommon: 28, rare: 10, legendary: 2 },
  /** Weight multiplier for upgrades of the pledged weapon. */
  pactUpgradeWeight: 7,
  weaponSlotChance: 2 / 3,
};

export const DEBUG_LOADOUTS: Record<string, string[]> = {
  'coil-cascade': ['ion_primer', 'coil_covenant', 'cascade_bus', 'rupture_relay'],
  'arc-backwash': ['quick_swap_coupler', 'arc_covenant', 'ion_fan', 'backwash'],
};
