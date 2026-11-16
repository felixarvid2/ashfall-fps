import type { DraftOffer, MainWeaponId, Rarity, WeaponId } from '../sim/types';

export interface Settings {
  mouseSensitivity: number; // 0.1 .. 5, 1 = default
  invertY: boolean;
  fov: number; // 70 .. 110 world FOV (vertical-equivalent handled by renderer)
  masterVolume: number; // 0..1
  sfxVolume: number;
  ambienceVolume: number;
  cameraBob: number; // 0..1
  screenShake: number; // 0..1
  flashIntensity: number; // 0..1
  renderScale: number; // 0.5 .. 1
  showDebug: boolean;
}

export interface Profile {
  version: 1;
  settings: Settings;
  unlocks: { arcScattergun: boolean };
  stats: { runs: number; extractions: number; deaths: number; bestTimeSec: number | null };
  feats: string[];
}

export interface HudModel {
  health: number;
  maxHealth: number;
  weaponId: WeaponId;
  weaponName: string;
  magazine: number;
  capacity: number;
  reserve: number;
  ammoLabel: string;
  reloading: number | null; // 0..1 progress
  backupCharge: number; // 0..1
  dashReady: number; // 0..1
  objective: string;
  waveText: string | null;
  enemiesLeft: number | null;
  salvage: number;
  /** Cascade Bus counter, e.g. 4 of 6; null when inactive. */
  cascade: { count: number; of: number } | null;
  /** Cold Chamber: true when the next pull fires a slug; null when not owned. */
  coldChamberReady: boolean | null;
  crosshairSpread: number; // pixels
  hitMarker: number; // 0..1 fade
  killMarker: number; // 0..1 fade
  damageDirs: { angle: number; alpha: number }[]; // radians relative to view, 0 = front
  bossHealth: { name: string; frac: number } | null;
  relayProgress: number | null; // 0..1
  interactPrompt: string | null;
  lowAmmo: boolean;
  slots: { id: WeaponId; name: string; locked: boolean; active: boolean }[];
}

export interface DebugModel {
  frameMs: number;
  p50: number;
  p95: number;
  p99: number;
  liveEnemies: number;
  queuedEnemies: number;
  projectiles: number;
  seed: string;
  wave: string;
  weapon: string;
  cards: string[];
  drawCalls: number;
  triangles: number;
}

export interface CardView {
  id: string;
  name: string;
  rarity: Rarity;
  scopeLabel: string; // e.g. "Both main weapons", "Coil Carbine pact"
  text: string; // effect text with numbers filled in
  drawback: string | null;
  rankLabel: string | null; // e.g. "Rank 1 → 2 of 3"
  previewLines: string[]; // e.g. "Reload 1.40 s → 1.22 s"
  consequences: string[]; // e.g. "Second main weapon surrendered for this run"
  prereqLines: { text: string; met: boolean }[];
  isSupply: boolean;
  isPact: boolean;
}

export interface DraftView {
  offer: DraftOffer;
  title: string; // e.g. "SUPPLY CACHE — CHOOSE ONE"
  cards: CardView[];
  salvage: number;
  canReroll: boolean;
  rerollCost: number;
  skipSalvage: number;
}

export interface OwnedCardView extends CardView {
  rank: number;
  maxRank: number;
  inactive: boolean; // e.g. surrendered weapon after a pact
  group: string;
}

export interface ResultsView {
  outcome: 'extracted' | 'dead';
  seed: string;
  timeSec: number;
  encountersCleared: number;
  encountersTotal: number;
  weapons: string[];
  pact: string | null;
  cards: { name: string; rank: number; inactive: boolean }[];
  kills: number;
  unlockedNow: string[];
}

export interface RunSetup {
  seed: string | null; // null → random
  starter: MainWeaponId;
}

/** Callbacks the UI raises; implemented by the game shell. */
export interface UiActions {
  startRun(setup: RunSetup): void;
  resume(): void;
  quitToMenu(): void;
  restart(sameSeed: boolean): void;
  draftPick(offerId: number, optionIndex: number): void;
  draftReroll(offerId: number): void;
  draftSkip(offerId: number): void;
  settingsChanged(s: Settings): void;
}
