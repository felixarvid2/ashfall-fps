/** Dev harness: /ui-test.html?screen=menu|pause|draft|results|hud|inspect|settings|resume|loading */
import { Ui } from './index';
import { defaultProfile } from '../profile/profile';
import type { CardView, DraftView, HudModel, OwnedCardView, ResultsView, UiActions } from './types';

declare global {
  interface Window {
    __log: string[];
    __ui: Ui;
  }
}
window.__log = [];
const log = (s: string) => {
  window.__log.push(s);
  console.log('[action]', s);
};

const actions: UiActions = {
  startRun: (s) => log(`startRun ${JSON.stringify(s)}`),
  resume: () => log('resume'),
  quitToMenu: () => log('quitToMenu'),
  restart: (same) => log(`restart ${same}`),
  draftPick: (o, i) => log(`draftPick ${o} ${i}`),
  draftReroll: (o) => log(`draftReroll ${o}`),
  draftSkip: (o) => log(`draftSkip ${o}`),
  settingsChanged: (s) => log(`settings ${JSON.stringify(s)}`),
};

const ui = new Ui(document.getElementById('ui')!, actions);
window.__ui = ui;

const cards: CardView[] = [
  {
    id: 'hot_cycle', name: 'Hot Cycle', rarity: 'common', scopeLabel: 'Both main weapons',
    text: 'Reload 20% faster for each rank.', drawback: 'Magazine capacity -10%.',
    rankLabel: 'Rank 1 → 2 of 3', previewLines: ['Reload 1.40 s → 1.22 s', 'Capacity 30 → 27'],
    consequences: [], prereqLines: [], isSupply: false, isPact: false,
  },
  {
    id: 'cascade_bus', name: 'Cascade Bus', rarity: 'rare', scopeLabel: 'Arc Scattergun pact',
    text: 'Every 6th direct hit arcs 40% damage to 3 nearby enemies.', drawback: null,
    rankLabel: 'Rank 1 of 2', previewLines: ['Arc damage 0 → 40%'],
    consequences: [], prereqLines: [{ text: 'Requires Ion Primer', met: true }, { text: 'Requires Arc Scattergun pact', met: false }],
    isSupply: false, isPact: false,
  },
  {
    id: 'pact_coil', name: 'Coil Pact', rarity: 'legendary', scopeLabel: 'Pact — Coil Carbine',
    text: 'Pledge to the Coil Carbine: +10% damage, and weapon upgrades unlock.', drawback: 'Cannot swap to another main weapon.',
    rankLabel: null, previewLines: ['Damage +0% → +10%'],
    consequences: ['Second main weapon surrendered for this run'], prereqLines: [], isSupply: false, isPact: true,
  },
];
const draft = (overrides: Partial<DraftView> = {}): DraftView => ({
  offer: { offerId: 7, rewardIndex: 1, options: [], rerollsLeft: 1, rerollCost: 20, skipSalvage: 15 },
  title: 'SUPPLY CACHE — CHOOSE ONE', cards, salvage: 35, canReroll: true, rerollCost: 20, skipSalvage: 15, ...overrides,
});

const owned: OwnedCardView[] = [
  { ...cards[0]!, rank: 2, maxRank: 3, inactive: false, group: 'handling' },
  { ...cards[1]!, id: 'ion', name: 'Ion Primer', rarity: 'uncommon', rank: 1, maxRank: 2, inactive: false, group: 'proc', prereqLines: [], text: 'Direct hits Ionize targets for 4 s.' },
  { ...cards[1]!, rank: 1, maxRank: 2, inactive: true, group: 'proc' },
  { ...cards[0]!, id: 'dmg', name: 'Overcharge', rarity: 'common', rank: 3, maxRank: 5, inactive: false, group: 'damage', drawback: null, text: '+10% damage per rank.' },
  { ...cards[2]!, rank: 1, maxRank: 1, inactive: false, group: 'pact' },
  { ...cards[0]!, id: 'plate', name: 'Slag Plate', rarity: 'rare', rank: 1, maxRank: 3, inactive: false, group: 'survival', text: '+25 max integrity.', drawback: null },
];

const hud: HudModel = {
  health: 72, maxHealth: 100, weaponId: 'arc_scattergun', weaponName: 'Arc Scattergun', magazine: 4, capacity: 8,
  reserve: 36, ammoLabel: 'Arc cells', reloading: 0.45, backupCharge: 0.6, dashReady: 1,
  objective: 'Hold the conveyor yard', waveText: 'WAVE 2 / 4', enemiesLeft: 11, salvage: 85,
  cascade: { count: 4, of: 6 }, coldChamberReady: true, crosshairSpread: 18, hitMarker: 1, killMarker: 0,
  damageDirs: [{ angle: 0.6, alpha: 0.9 }, { angle: -2.4, alpha: 0.5 }], bossHealth: { name: 'Cargo Loader', frac: 0.62 },
  relayProgress: 0.37, interactPrompt: '[E] Open supply chest', lowAmmo: true,
  slots: [
    { id: 'coil_carbine', name: 'Coil Carbine', locked: true, active: false },
    { id: 'arc_scattergun', name: 'Arc Scattergun', locked: false, active: true },
    { id: 'service_emitter', name: 'Service Emitter', locked: false, active: false },
  ],
};

const results: ResultsView = {
  outcome: 'extracted', seed: 'ASH-4471', timeSec: 812, encountersCleared: 4, encountersTotal: 4,
  weapons: ['Coil Carbine', 'Service Emitter'], pact: 'Coil Carbine', kills: 213, unlockedNow: ['Arc Scattergun'],
  cards: [{ name: 'Hot Cycle', rank: 2, inactive: false }, { name: 'Ion Primer', rank: 1, inactive: false }, { name: 'Cascade Bus', rank: 1, inactive: true }, { name: 'Overcharge', rank: 3, inactive: false }],
};

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'menu';
const profile = defaultProfile();
if (q.get('unlocked')) profile.unlocks.arcScattergun = true;
const settings = profile.settings;

switch (screen) {
  case 'loading': ui.showLoading(0.62, 'Loading refinery assets'); break;
  case 'menu': ui.showMenu(profile); break;
  case 'pause': ui.showPause('ASH-4471', settings); break;
  case 'resume': ui.showClickToResume(); break;
  case 'settings': ui.showPause('ASH-4471', settings); (document.querySelectorAll('.sw-pause button')[3] as HTMLElement).click(); break;
  case 'draft': ui.showDraft(draft(q.get('norr') ? { canReroll: false, salvage: 5 } : {})); break;
  case 'results': ui.showResults(q.get('dead') ? { ...results, outcome: 'dead', unlockedNow: [] } : results); break;
  case 'inspect': ui.setHudVisible(true); ui.updateHud(hud); ui.toggleInspect(owned); break;
  case 'hud':
    ui.setHudVisible(true);
    ui.updateHud(hud);
    ui.updateDebug({ frameMs: 6.9, p50: 6.2, p95: 8.1, p99: 11.4, liveEnemies: 24, queuedEnemies: 12, projectiles: 3, seed: 'ASH-4471', wave: '2/4', weapon: 'arc_scattergun', cards: ['hot_cycle', 'ion_primer'], drawCalls: 148, triangles: 212000 });
    ui.banner('WAVE 2', 'wave');
    ui.subtitle('DISPATCH', 'Relay crew, hold the yard until the uplink completes.', 30);
    break;
}
