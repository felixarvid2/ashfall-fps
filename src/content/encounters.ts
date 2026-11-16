import type { EnemyKind } from '../sim/types';
import { ENEMIES } from './enemies';

/**
 * Seeded encounter templates. An encounter is a block of short waves. Each wave
 * has a finite budget (sum of enemy costs), a live cap, groups that are rolled
 * into bursts (count ranges, lane choice) using the director's RNG stream, and
 * rules for when the next wave starts.
 */

export interface SpawnGroup {
  kind: EnemyKind;
  /** Fixed count or inclusive range (rolled when the wave starts). */
  count: number | [number, number];
  /** Candidate lane ids; each burst takes one (see `pick`). */
  lanes: string[];
  /** Enemies per burst. */
  burst: number;
  /** Seconds between bursts of this group. */
  gap: number;
  /** Offset from wave start of the first burst. */
  delay?: number;
  /** 'random' (default) picks a lane per burst, 'cycle' rotates from a random start. */
  pick?: 'random' | 'cycle';
  /** Walkers only: chance that a spawned walker charges (runs) instead of walking. */
  charge?: number;
  /** HP multiplier for this group's enemies (swarm walkers keep the same look). */
  hpMul?: number;
  /** Probability the group is included at all (default 1). */
  chance?: number;
}

export interface WaveTemplate {
  label: string;
  groups: SpawnGroup[];
  /** Max enemies alive (whole arena) before queued spawns wait. */
  liveCap: number;
  /** Total cost of enemies this wave may spawn (rolled plans are truncated). */
  budget: number;
  /** Next wave starts when pending == 0 and live <= advanceAt ... */
  advanceAt: number;
  /** ...plus this cooldown in seconds. */
  cooldown: number;
  /** Forces the next wave after this many seconds (pressure timer). */
  maxTime: number;
  /** Seconds between wave_warn and contact. */
  warn: number;
  /** Supply crates dropped (visible, on lanes) when the wave starts. */
  resupply?: { kind: 'ammo_coil' | 'ammo_arc' | 'health'; pos: { x: number; y: number; z: number }; amount: number }[];
}

export interface EncounterTemplate {
  arena: string;
  salvage: number;
  waves: WaveTemplate[];
  /** Boss add groups, keyed by call phase (0-based), used by the Cargo Loader. */
  calls?: SpawnGroup[];
}

const wave = (label: string, groups: SpawnGroup[], o: Partial<WaveTemplate> & { liveCap: number; budget: number }): WaveTemplate => ({
  label,
  groups,
  advanceAt: 0,
  cooldown: 6,
  maxTime: 70,
  warn: 2.5,
  ...o,
});

const YARD: EncounterTemplate = {
  arena: 'yard',
  salvage: 40,
  waves: [
    wave('SLOW PACK', [{ kind: 'walker', count: [6, 7], lanes: ['yard_main'], burst: 3, gap: 4.5 }], {
      liveCap: 8, budget: 9, advanceAt: 1, cooldown: 5, warn: 3,
    }),
    wave(
      'OUTER LANE',
      [
        { kind: 'walker', count: [7, 9], lanes: ['yard_outer'], burst: 4, gap: 3.5 },
        { kind: 'walker', count: [2, 3], lanes: ['yard_main'], burst: 3, gap: 3, delay: 3 },
      ],
      { liveCap: 12, budget: 14, advanceAt: 2, cooldown: 4 },
    ),
    wave(
      'HOUNDS',
      [
        { kind: 'hound', count: 3, lanes: ['yard_east', 'yard_outer'], burst: 1, gap: 2.5, pick: 'cycle' },
        { kind: 'walker', count: [4, 5], lanes: ['yard_main'], burst: 3, gap: 4, delay: 1 },
      ],
      { liveCap: 12, budget: 16, advanceAt: 1, cooldown: 4 },
    ),
    wave(
      'FLAME DRONES',
      [
        { kind: 'drone', count: 2, lanes: ['yard_air'], burst: 1, gap: 3, delay: 1 },
        { kind: 'hound', count: 2, lanes: ['yard_east'], burst: 1, gap: 4, delay: 2 },
        { kind: 'walker', count: [6, 8], lanes: ['yard_main', 'yard_outer'], burst: 4, gap: 4, pick: 'cycle', charge: 0.4 },
      ],
      { liveCap: 16, budget: 28, advanceAt: 2, cooldown: 5 },
    ),
    wave(
      'PINCER',
      [
        { kind: 'walker', count: [8, 10], lanes: ['yard_outer', 'yard_east'], burst: 4, gap: 4, pick: 'cycle', charge: 0.5 },
        { kind: 'hound', count: 2, lanes: ['yard_main'], burst: 1, gap: 4, delay: 4 },
        { kind: 'drone', count: 1, lanes: ['yard_air'], burst: 1, gap: 3, delay: 6 },
      ],
      { liveCap: 16, budget: 24, advanceAt: 0, cooldown: 3 },
    ),
  ],
};

const SLAG_GROUND = ['slag_nw', 'slag_ne', 'slag_west', 'slag_east', 'slag_rear_w', 'slag_rear_e'];

const SLAG: EncounterTemplate = {
  arena: 'slag',
  salvage: 70,
  waves: [
    wave(
      'CHARGING PACKS',
      [{ kind: 'walker', count: [10, 12], lanes: ['slag_nw', 'slag_ne'], burst: 5, gap: 4, pick: 'cycle', charge: 1 }],
      { liveCap: 14, budget: 14, advanceAt: 3, cooldown: 6, warn: 3 },
    ),
    wave(
      'ROUTE BREAKERS',
      [
        { kind: 'hound', count: [5, 6], lanes: ['slag_west', 'slag_east'], burst: 2, gap: 3.5, pick: 'cycle' },
        { kind: 'walker', count: [7, 9], lanes: ['slag_nw', 'slag_ne', 'slag_rear_w', 'slag_rear_e'], burst: 4, gap: 4, delay: 2 },
      ],
      { liveCap: 24, budget: 36, advanceAt: 5, cooldown: 3 },
    ),
    wave(
      'STRAIGHT LINES',
      [
        { kind: 'drone', count: [3, 4], lanes: ['slag_air'], burst: 2, gap: 6 },
        { kind: 'walker', count: [10, 12], lanes: ['slag_west', 'slag_east'], burst: 6, gap: 5, pick: 'cycle', charge: 0.5, delay: 1 },
      ],
      { liveCap: 30, budget: 58, advanceAt: 12, cooldown: 1 },
    ),
    wave(
      'CRANE DROP',
      [
        { kind: 'drone', count: 3, lanes: ['slag_air'], burst: 1, gap: 5 },
        { kind: 'hound', count: 4, lanes: ['slag_nw', 'slag_ne', 'slag_rear_w', 'slag_rear_e'], burst: 2, gap: 5, delay: 2 },
        { kind: 'walker', count: [9, 11], lanes: SLAG_GROUND, burst: 5, gap: 4, delay: 1, charge: 0.4 },
      ],
      { liveCap: 28, budget: 40, advanceAt: 4, cooldown: 6 },
    ),
    wave(
      'THE SWARM',
      [
        { kind: 'walker', count: [62, 68], lanes: SLAG_GROUND, burst: 18, gap: 2.4, charge: 0.35, hpMul: 0.6 },
        { kind: 'hound', count: 8, lanes: ['slag_west', 'slag_east', 'slag_rear_w', 'slag_rear_e'], burst: 2, gap: 5, delay: 3 },
        { kind: 'drone', count: 4, lanes: ['slag_air'], burst: 2, gap: 9, delay: 5 },
      ],
      {
        liveCap: 76, budget: 108, advanceAt: 10, cooldown: 2, maxTime: 90,
        resupply: [
          { kind: 'ammo_coil', pos: { x: -6, y: 0, z: -40 }, amount: 90 },
          { kind: 'ammo_coil', pos: { x: 6, y: 0, z: -48 }, amount: 90 },
          { kind: 'ammo_coil', pos: { x: 0, y: 0, z: -56 }, amount: 90 },
          { kind: 'ammo_arc', pos: { x: -4, y: 0, z: -44 }, amount: 12 },
          { kind: 'ammo_arc', pos: { x: 4, y: 0, z: -52 }, amount: 12 },
          { kind: 'health', pos: { x: 0, y: 0, z: -34 }, amount: 50 },
          { kind: 'health', pos: { x: -8, y: 0, z: -60 }, amount: 50 },
          { kind: 'health', pos: { x: 8, y: 0, z: -60 }, amount: 50 },
        ],
      },
    ),
    wave(
      'STRAGGLERS',
      [
        { kind: 'walker', count: 8, lanes: ['slag_nw', 'slag_ne'], burst: 4, gap: 3, pick: 'cycle', charge: 0.6 },
        { kind: 'hound', count: 3, lanes: ['slag_rear_w', 'slag_rear_e'], burst: 1, gap: 3, pick: 'cycle' },
      ],
      { liveCap: 16, budget: 20, advanceAt: 0, cooldown: 2 },
    ),
  ],
};

const APPROACH: EncounterTemplate = {
  arena: 'approach',
  salvage: 45,
  waves: [
    wave(
      'RELAY GUARD',
      [
        { kind: 'walker', count: [8, 9], lanes: ['appr_west', 'appr_east'], burst: 4, gap: 4, pick: 'cycle', charge: 0.3 },
        { kind: 'hound', count: 2, lanes: ['appr_rear'], burst: 1, gap: 3, delay: 3 },
      ],
      { liveCap: 14, budget: 18, advanceAt: 2, cooldown: 3 },
    ),
    wave(
      'LAST PACK',
      [
        { kind: 'drone', count: 2, lanes: ['appr_air'], burst: 1, gap: 3 },
        { kind: 'walker', count: [6, 8], lanes: ['appr_rear', 'appr_west', 'appr_east'], burst: 4, gap: 3.5, pick: 'cycle', delay: 1 },
        { kind: 'hound', count: 2, lanes: ['appr_west', 'appr_east'], burst: 1, gap: 4, delay: 3, pick: 'cycle' },
      ],
      { liveCap: 16, budget: 26, advanceAt: 2, cooldown: 5 },
    ),
    wave(
      'SECOND SQUAD',
      [
        { kind: 'walker', count: [8, 10], lanes: ['appr_west', 'appr_east', 'appr_rear'], burst: 4, gap: 4, pick: 'cycle', charge: 0.4 },
        { kind: 'drone', count: 2, lanes: ['appr_air'], burst: 1, gap: 5, delay: 3 },
      ],
      { liveCap: 16, budget: 22, advanceAt: 0, cooldown: 3 },
    ),
  ],
};

const RELAY: EncounterTemplate = {
  arena: 'relay',
  salvage: 100,
  waves: [
    wave('CARGO LOADER', [{ kind: 'loader', count: 1, lanes: ['relay_loader'], burst: 1, gap: 1 }], {
      liveCap: 20, budget: ENEMIES.loader.cost, advanceAt: 0, cooldown: 0, warn: 3.5, maxTime: 9999,
    }),
  ],
  calls: [
    { kind: 'walker', count: ENEMIES.loader.call.adds[0]!, lanes: ['relay_west', 'relay_east', 'relay_north'], burst: 3, gap: 1.6, pick: 'cycle', charge: 0.3 },
    { kind: 'walker', count: ENEMIES.loader.call.adds[1]!, lanes: ['relay_west', 'relay_east', 'relay_north'], burst: 4, gap: 1.6, pick: 'cycle', charge: 0.5 },
  ],
};

export const ENCOUNTERS: Record<string, EncounterTemplate> = {
  yard: YARD,
  slag: SLAG,
  approach: APPROACH,
  relay: RELAY,
};

/** Kind mix used by `Director.startStress`. */
export const STRESS_MIX: { kind: EnemyKind; weight: number }[] = [
  { kind: 'walker', weight: 0.72 },
  { kind: 'hound', weight: 0.2 },
  { kind: 'drone', weight: 0.08 },
];

/** Total cost of the fixed part of a wave (upper bound of rolled counts). */
export function waveMaxCost(w: WaveTemplate): number {
  let c = 0;
  for (const g of w.groups) {
    const n = typeof g.count === 'number' ? g.count : g.count[1];
    c += n * ENEMIES[g.kind].cost;
  }
  return c;
}
