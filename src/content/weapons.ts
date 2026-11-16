import type { PlayerStats, WeaponDef, WeaponId, MainWeaponId, AmmoType } from '../sim/types';

/**
 * Base weapon definitions. Tuning targets (unmodified):
 *  - Coil Carbine: Scorched Walker (60 hp) down in 5 hits at mid range.
 *  - Arc Scattergun: close shot (≤ 7 m) lands ~7 of 9 pellets → kills a walker,
 *    stray pellets threaten neighbours; ineffective past ~20 m.
 *  - Service Emitter: ~6 s to kill a walker; a recovery tool only.
 */
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  coil_carbine: {
    id: 'coil_carbine',
    name: 'Coil Carbine',
    slot: 'main',
    fireModel: 'hitscan',
    automatic: true,
    ammo: 'coil_cells',
    damage: 13,
    pellets: 1,
    spreadDeg: 0.9,
    rangeEffective: 40,
    rangeMax: 120,
    falloffMinMul: 0.55,
    fireInterval: 0.105,
    capacity: 32,
    reloadTime: 1.4,
    reserveMax: 256,
    startReserve: 96,
    equipTime: 0.32,
    recoil: { pitch: 0.55, yawJitter: 0.25, recover: 0.09, kickBack: 0.045 },
    sockets: 2,
    audio: { fire: 'coil_fire', reload: 'coil_reload', empty: 'coil_empty', impact: 'impact_world', equip: 'coil_equip' },
    fx: { tracerColor: 0xffb347, flashColor: 0xffc070, tracerWidth: 0.035, tracerLife: 0.06 },
  },
  arc_scattergun: {
    id: 'arc_scattergun',
    name: 'Arc Scattergun',
    slot: 'main',
    fireModel: 'pellets',
    automatic: false,
    ammo: 'arc_charges',
    damage: 90,
    pellets: 9,
    spreadDeg: 13,
    rangeEffective: 7,
    rangeMax: 24,
    falloffMinMul: 0.15,
    fireInterval: 0.78,
    capacity: 6,
    reloadTime: 1.8,
    reserveMax: 48,
    startReserve: 18,
    equipTime: 0.4,
    recoil: { pitch: 4.5, yawJitter: 0.8, recover: 0.16, kickBack: 0.14 },
    sockets: 2,
    audio: { fire: 'arc_fire', reload: 'arc_reload', empty: 'arc_empty', impact: 'impact_world', equip: 'arc_equip' },
    fx: { tracerColor: 0x9fd8ff, flashColor: 0xd8f0ff, tracerWidth: 0.05, tracerLife: 0.045 },
  },
  service_emitter: {
    id: 'service_emitter',
    name: 'Service Emitter',
    slot: 'backup',
    fireModel: 'hitscan',
    automatic: false,
    ammo: null,
    damage: 7,
    pellets: 1,
    spreadDeg: 0.6,
    rangeEffective: 25,
    rangeMax: 60,
    falloffMinMul: 0.5,
    fireInterval: 0.32,
    capacity: 10,
    reloadTime: 0,
    reserveMax: 0,
    startReserve: 0,
    equipTime: 0.25,
    rechargePerSec: 1.4,
    recoil: { pitch: 0.4, yawJitter: 0.1, recover: 0.08, kickBack: 0.02 },
    sockets: 0,
    audio: { fire: 'emitter_fire', reload: 'emitter_equip', empty: 'emitter_empty', impact: 'impact_world', equip: 'emitter_equip' },
    fx: { tracerColor: 0x8affc8, flashColor: 0x8affc8, tracerWidth: 0.02, tracerLife: 0.05 },
  },
};

export const MAIN_WEAPONS: MainWeaponId[] = ['coil_carbine', 'arc_scattergun'];

export const AMMO_LABEL: Record<AmmoType, string> = {
  coil_cells: 'COIL CELLS',
  arc_charges: 'ARC CHARGES',
};

export const AMMO_OF: Record<MainWeaponId, AmmoType> = {
  coil_carbine: 'coil_cells',
  arc_scattergun: 'arc_charges',
};

/** Ammo pickup sizes (before Salvage Funnel). */
export const AMMO_PICKUP: Record<AmmoType, number> = { coil_cells: 40, arc_charges: 8 };

/** Converting a pickup of one ammo type into the other (pact redirection). */
export const AMMO_CONVERSION: Record<AmmoType, Record<AmmoType, number>> = {
  coil_cells: { coil_cells: 1, arc_charges: 0.2 },
  arc_charges: { coil_cells: 5, arc_charges: 1 },
};

/** A full-size weapon pickup under a pact turns into this. */
export const PACT_WEAPON_PICKUP = { ammoFraction: 0.5, salvage: 15 };

export const BASE_PLAYER: PlayerStats = {
  maxHealth: 100,
  dashCooldown: 2.0,
  pickupAmmoMul: 1,
  moveSpeed: 9.5,
};

/** Clamp floors shared by stat computation (documented in docs/ARCHITECTURE.md). */
export const STAT_LIMITS = {
  minReloadTime: 0.35,
  minFireInterval: 0.045,
  maxCapacityMul: 3,
  minDashCooldown: 0.6,
  maxPellets: 24,
  maxSpreadDeg: 30,
};
