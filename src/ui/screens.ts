import type { MainWeaponId } from '../sim/types';
import type { OwnedCardView, Profile, ResultsView, RunSetup, Settings } from './types';
import { el, fmtTime } from './dom';
import { buildOwnedCard } from './cardDom';

export const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Left click', 'Fire'],
  ['R', 'Reload'],
  ['Space', 'Jump'],
  ['Left Shift', 'Dash'],
  ['1 / 2', 'Swap main weapon'],
  ['Q', 'Backup weapon (Service Emitter)'],
  ['E', 'Interact'],
  ['Tab', 'Inspect cards'],
  ['Esc', 'Pause'],
  ['Draft: 1 2 3 / ← → Enter', 'Take a card'],
  ['Draft: R / S', 'Reroll / Skip for Salvage'],
];

interface SliderDef {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const SLIDERS: SliderDef[] = [
  { key: 'mouseSensitivity', label: 'Mouse sensitivity', min: 0.1, max: 5, step: 0.05, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'fov', label: 'Field of view', min: 70, max: 110, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'masterVolume', label: 'Master volume', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'sfxVolume', label: 'SFX volume', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'ambienceVolume', label: 'Ambience volume', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'cameraBob', label: 'Camera bob', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'screenShake', label: 'Screen shake', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'flashIntensity', label: 'Flash intensity', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'renderScale', label: 'Render scale', min: 0.5, max: 1, step: 0.05, fmt: pct },
];

/** Settings form; mutates a private copy and reports it live on every change. */
export function buildSettings(initial: Settings, onChange: (s: Settings) => void): HTMLElement {
  const s: Settings = { ...initial };
  const grid = el('div', 'sw-settings');
  const emit = () => onChange({ ...s });
  for (const d of SLIDERS) {
    const row = el('div', 'sw-set', undefined, grid);
    const id = `sw-set-${d.key}`;
    const lab = el('label', undefined, d.label, row);
    lab.htmlFor = id;
    const inp = el('input', undefined, undefined, row);
    inp.type = 'range';
    inp.id = id;
    inp.min = String(d.min);
    inp.max = String(d.max);
    inp.step = String(d.step);
    inp.value = String(s[d.key] as number);
    const val = el('span', 'val', d.fmt(s[d.key] as number), row);
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      (s[d.key] as number) = v;
      val.textContent = d.fmt(v);
      emit();
    });
  }
  const toggles: [keyof Settings, string][] = [
    ['invertY', 'Invert Y axis'],
    ['showDebug', 'Debug overlay'],
  ];
  for (const [key, label] of toggles) {
    const row = el('div', 'sw-set toggle', undefined, grid);
    const id = `sw-set-${key}`;
    el('label', undefined, label, row).htmlFor = id;
    const inp = el('input', undefined, undefined, row);
    inp.type = 'checkbox';
    inp.id = id;
    inp.checked = s[key] as boolean;
    inp.addEventListener('change', () => {
      (s[key] as boolean) = inp.checked;
      emit();
    });
  }
  return grid;
}

export function buildControls(): HTMLElement {
  const g = el('div', 'sw-keys');
  for (const [k, v] of CONTROLS) {
    el('span', 'sw-kbd', k, g);
    el('span', undefined, v, g);
  }
  return g;
}

export function buildCredits(): HTMLElement {
  const d = el('div');
  el('p', undefined, 'ASHFALL: SLAGWIRE — a browser first-person horde roguelite set in the Refinery District of Kharos IV.', d);
  el('p', undefined, 'Built with Three.js and Rapier physics. Interface type: Rajdhani and Share Tech Mono (SIL Open Font License).', d);
  el('p', 'sw-hint', 'Seeds make runs repeatable: enter the same seed and starter weapon to replay a layout and draft sequence.', d);
  return d;
}

export interface MenuState {
  seed: string;
  starter: MainWeaponId;
}

export function buildMenu(
  profile: Profile,
  state: MenuState,
  h: { play(setup: RunSetup): void; settings(): void; controls(): void; credits(): void },
): HTMLElement {
  const wrap = el('div', 'sw-menu');
  const left = el('div', undefined, undefined, wrap);
  const t = el('h1', 'sw-title', undefined, left);
  el('span', 'a', 'Ashfall', t);
  el('span', 'b', 'Slagwire', t);
  el('div', 'sw-tag', 'Refinery District • Kharos IV • One way out', left);
  const nav = el('div', 'sw-nav', undefined, left);
  const stats = profile.stats;

  const setup = el('div', 'sw-panel', undefined, wrap);
  el('h2', undefined, 'Run setup', setup);
  el('div', 'sw-label', 'Seed', setup);
  const seed = el('input', 'sw-input', undefined, setup);
  seed.type = 'text';
  seed.maxLength = 32;
  seed.placeholder = 'Random';
  seed.value = state.seed;
  seed.spellcheck = false;
  seed.autocomplete = 'off';
  seed.id = 'sw-seed';
  seed.addEventListener('input', () => (state.seed = seed.value));
  el('div', 'sw-hint', 'Leave empty for a random seed.', setup);

  el('div', 'sw-label', 'Starter weapon', setup);
  const starters = el('div', 'sw-starters', undefined, setup);
  starters.setAttribute('role', 'radiogroup');
  const defs: { id: MainWeaponId; name: string; desc: string; locked: boolean }[] = [
    { id: 'coil_carbine', name: 'Coil Carbine', desc: 'Precise, steady rifle. Rewards clean hits.', locked: false },
    {
      id: 'arc_scattergun',
      name: 'Arc Scattergun',
      desc: 'Close-range pellets that arc between targets.',
      locked: !profile.unlocks.arcScattergun,
    },
  ];
  if (defs[1]!.locked) state.starter = 'coil_carbine';
  const btns: HTMLElement[] = [];
  const refresh = () => btns.forEach((b, i) => b.setAttribute('aria-checked', String(defs[i]!.id === state.starter)));
  for (const d of defs) {
    const b = el('button', `sw-starter${d.locked ? ' locked' : ''}`, undefined, starters);
    b.setAttribute('role', 'radio');
    el('b', undefined, d.name + (d.locked ? ' — LOCKED' : ''), b);
    el('span', undefined, d.desc, b);
    if (d.locked) el('span', 'why', 'Extract once with the Coil Carbine to unlock.', b);
    b.addEventListener('click', () => {
      if (d.locked) return;
      state.starter = d.id;
      refresh();
    });
    btns.push(b);
  }
  refresh();
  const go = el('button', 'sw-btn primary', 'Deploy', setup);
  go.style.marginTop = '22px';
  go.style.width = '100%';
  go.id = 'sw-deploy';
  const deploy = () => {
    const sd = state.seed.trim();
    h.play({ seed: sd === '' ? null : sd, starter: state.starter });
  };
  go.addEventListener('click', deploy);
  seed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') deploy();
    e.stopPropagation();
  });
  nav.append(el('button', 'sw-btn', 'Settings'), el('button', 'sw-btn', 'Controls'), el('button', 'sw-btn', 'Credits'));
  (nav.children[0] as HTMLElement).onclick = h.settings;
  (nav.children[1] as HTMLElement).onclick = h.controls;
  (nav.children[2] as HTMLElement).onclick = h.credits;
  el('div', 'sw-hint sw-mono', `Runs ${stats.runs}  •  Extractions ${stats.extractions}  •  Deaths ${stats.deaths}` + (stats.bestTimeSec !== null ? `  •  Best ${fmtTime(stats.bestTimeSec)}` : ''), setup).style.marginTop = '16px';
  return wrap;
}

export function buildResults(
  v: ResultsView,
  h: { same(): void; fresh(): void; menu(): void },
): HTMLElement {
  const p = el('div', 'sw-panel sw-results');
  const ex = v.outcome === 'extracted';
  el('h1', `head ${v.outcome}`, ex ? 'Extracted' : 'Signal lost', p);
  el('div', 'sub', ex ? 'You made it out of the Refinery District' : 'Your run ended in the Refinery District', p);
  if (v.unlockedNow.length) {
    el('div', 'sw-unlock', `Unlocked: ${v.unlockedNow.join(', ')} — now available as a starter weapon`, p);
  }
  const grid = el('div', 'sw-stats', undefined, p);
  const stat = (k: string, val: string) => {
    const s = el('div', 'sw-stat', undefined, grid);
    el('small', undefined, k, s);
    el('b', undefined, val, s);
  };
  stat('Seed', v.seed);
  stat('Time', fmtTime(v.timeSec));
  stat('Encounters', `${v.encountersCleared} / ${v.encountersTotal}`);
  stat('Kills', String(v.kills));
  el('div', 'sw-label', `Weapons${v.pact ? '  •  Pact: ' + v.pact : ''}`, p);
  const wc = el('div', 'sw-chips', undefined, p);
  for (const w of v.weapons) el('span', 'sw-chip', w, wc);
  el('div', 'sw-label', 'Active cards', p);
  const cc = el('div', 'sw-chips', undefined, p);
  if (!v.cards.length) el('span', 'sw-hint', 'None drafted', cc);
  for (const c of v.cards) el('span', `sw-chip${c.inactive ? ' off' : ''}`, `${c.name}${c.rank > 1 ? ' ×' + c.rank : ''}`, cc);
  const row = el('div', 'sw-modal-row', undefined, p);
  const b1 = el('button', 'sw-btn primary', 'Restart same seed [R]', row);
  const b2 = el('button', 'sw-btn', 'New seed [N]', row);
  const b3 = el('button', 'sw-btn', 'Main menu [M]', row);
  b1.onclick = h.same;
  b2.onclick = h.fresh;
  b3.onclick = h.menu;
  return p;
}

const GROUP_ORDER = ['damage', 'handling', 'ammo', 'survival', 'mobility', 'proc', 'pact'];

export function buildInspect(cards: OwnedCardView[]): HTMLElement {
  const p = el('div', 'sw-panel sw-inspect');
  el('h2', undefined, 'Installed cards  •  Tab to close', p);
  if (!cards.length) {
    el('div', 'sw-empty', 'No cards installed yet. Draft rewards appear after encounters.', p);
    return p;
  }
  const groups = new Map<string, OwnedCardView[]>();
  for (const c of cards) {
    const g = groups.get(c.group) ?? [];
    g.push(c);
    groups.set(c.group, g);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const cols = el('div', 'cols', undefined, p);
  for (const g of order) {
    const box = el('div', 'sw-grp', undefined, cols);
    el('h3', undefined, g.charAt(0).toUpperCase() + g.slice(1), box);
    for (const c of groups.get(g)!) box.appendChild(buildOwnedCard(c));
  }
  return p;
}
