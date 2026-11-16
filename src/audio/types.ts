import type { Vec3 } from '../sim/types';

/** Every sound the game can request. Implementations synthesize or sample them. */
export type SfxId =
  | 'coil_fire' | 'coil_reload' | 'coil_empty' | 'coil_equip'
  | 'arc_fire' | 'arc_reload' | 'arc_empty' | 'arc_equip' | 'arc_slug'
  | 'emitter_fire' | 'emitter_empty' | 'emitter_equip'
  | 'impact_world' | 'impact_flesh' | 'impact_metal' | 'armor_break'
  | 'enemy_die' | 'walker_tell' | 'walker_growl' | 'hound_charge' | 'hound_lunge'
  | 'drone_hum' | 'drone_tell' | 'drone_flame' | 'loader_tell' | 'loader_swing' | 'loader_slam' | 'loader_call'
  | 'arc_proc' | 'burst_proc' | 'backwash_proc' | 'ion_tag'
  | 'player_hurt' | 'player_die' | 'footstep' | 'jump' | 'land' | 'dash'
  | 'pickup_ammo' | 'pickup_health' | 'pickup_salvage' | 'pickup_weapon'
  | 'vent_warn' | 'vent_burst' | 'wave_warn' | 'encounter_clear' | 'radio_blip'
  | 'ui_hover' | 'ui_select' | 'ui_reroll' | 'ui_open' | 'relay_hum' | 'relay_down';

export interface PlayOptions {
  /** World position for 3D panning/attenuation; omit for UI / first-person sounds. */
  pos?: Vec3;
  volume?: number;
  /** Playback-rate / pitch multiplier. */
  rate?: number;
}

export interface AudioSystem {
  /** Must be called from a user gesture (Play / Continue). */
  resume(): Promise<void>;
  play(id: SfxId, opts?: PlayOptions): void;
  /** Camera position + forward each frame. */
  setListener(pos: Vec3, forward: Vec3): void;
  setVolumes(master: number, sfx: number, ambience: number): void;
  /** Loops `public/assets/audio/amb/industrial.ogg` (or a fallback drone). */
  startAmbience(): void;
  stopAll(): void;
  /** 0..1 combat intensity; ducks ambience, raises the tension layer. */
  setIntensity(v: number): void;
}
