import type { PlayerStats, StatKey, WeaponDef, WeaponStats } from '../types';
import { STAT_LIMITS } from '../../content/weapons';
import { CARDS, effectOf } from '../../content/cards';
import type { CardState } from './state';

const PLAYER_KEYS: StatKey[] = ['maxHealth', 'dashCooldown', 'pickupAmmo'];

/** Sums per stat over owned, active cards x rank. `weaponId` null = player stats. */
function sums(state: CardState, weaponId: string | null): Record<StatKey, number> {
  const s = {
    damageBonus: 0, reloadSpeed: 0, capacityBonus: 0, fireRate: 0, pickupAmmo: 0,
    maxHealth: 0, dashCooldown: 0, pellets: 0, spread: 0, pierce: 0,
  } as Record<StatKey, number>;
  for (const card of CARDS) {
    const rank = state.rank(card.id);
    if (rank <= 0 || state.isInactive(card.id)) continue;
    for (const m of card.modifiers) {
      if (PLAYER_KEYS.includes(m.stat) !== (weaponId === null)) continue;
      if (weaponId !== null && m.weapons && !m.weapons.includes(weaponId as never)) continue;
      s[m.stat] += m.value * rank;
    }
  }
  return s;
}

/** Derived weapon stats. Only main weapons are affected by cards. */
export function computeWeaponStats(def: WeaponDef, state: CardState): WeaponStats {
  const surrendered = def.slot === 'main' && state.pact !== null && state.pact !== def.id;
  const base: WeaponStats = {
    id: def.id, damage: def.damage, damageBonus: 0, pellets: def.pellets, spreadDeg: def.spreadDeg,
    fireInterval: def.fireInterval, reloadTime: def.reloadTime, capacity: def.capacity,
    rangeEffective: def.rangeEffective, rangeMax: def.rangeMax, falloffMinMul: def.falloffMinMul,
    pierce: 0, pierceDamageMul: 1, active: !surrendered,
  };
  if (def.slot !== 'main') return base;

  const s = sums(state, def.id);
  let bonus = s.damageBonus;
  let pierceMul = 1;
  for (const card of CARDS) {
    if (!state.has(card.id)) continue;
    const pact = effectOf(card, 'pact');
    if (pact && card.pactWeapon === def.id) bonus += pact.params.damageBonus ?? 0;
    const md = effectOf(card, 'mass_driver');
    if (md && s.pierce > 0) pierceMul = md.params.pierceDamageMul ?? 1;
  }
  const L = STAT_LIMITS;
  const pellets = Math.min(L.maxPellets, def.pellets + s.pellets);
  base.damageBonus = bonus;
  base.pellets = pellets;
  // Total damage of a complete pull at the current pellet count (per-pellet damage is constant).
  base.damage = def.damage * (1 + bonus) * (pellets / def.pellets);
  base.spreadDeg = Math.min(L.maxSpreadDeg, def.spreadDeg * Math.max(0, 1 + s.spread));
  base.fireInterval = Math.max(L.minFireInterval, def.fireInterval / Math.max(0.05, 1 + s.fireRate));
  base.reloadTime = Math.max(L.minReloadTime, def.reloadTime / Math.max(0.05, 1 + s.reloadSpeed));
  base.capacity = Math.ceil(def.capacity * Math.min(L.maxCapacityMul, 1 + s.capacityBonus) - 1e-9);
  base.pierce = Math.max(0, s.pierce);
  base.pierceDamageMul = base.pierce > 0 ? pierceMul : 1;
  return base;
}

export function computePlayerStats(base: PlayerStats, state: CardState): PlayerStats {
  const s = sums(state, null);
  return {
    maxHealth: base.maxHealth + s.maxHealth,
    dashCooldown: Math.max(STAT_LIMITS.minDashCooldown, base.dashCooldown * (1 - s.dashCooldown)),
    pickupAmmoMul: base.pickupAmmoMul * (1 + s.pickupAmmo),
    moveSpeed: base.moveSpeed,
  };
}
