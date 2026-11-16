import '../styles/ui.css';
import type { DebugModel, DraftView, HudModel, OwnedCardView, Profile, ResultsView, Settings, UiActions } from './types';
import type { MainWeaponId } from '../sim/types';
import { InputGuard, el } from './dom';
import { Hud, type BannerKind } from './hud';
import { DraftOverlay } from './draft';
import {
  buildControls,
  buildCredits,
  buildInspect,
  buildMenu,
  buildResults,
  buildSettings,
  type MenuState,
} from './screens';
import { defaultSettings, loadProfile, saveProfile } from '../profile/profile';

export { loadProfile, saveProfile, defaultSettings };

type Screen = 'none' | 'loading' | 'menu' | 'pause' | 'resume' | 'results';

const RESULT_GUARD_MS = 250;

export class Ui {
  private actions: UiActions;
  private guard = new InputGuard();
  private hud: Hud;
  private draft: DraftOverlay;
  private screenHost = el('div', 'sw-screen-host');
  private screenNode: HTMLElement | null = null;
  private modalNode: HTMLElement | null = null;
  private inspectNode: HTMLElement | null = null;
  private screen: Screen = 'none';
  private settings: Settings = defaultSettings();
  private menuState: MenuState = { seed: '', starter: 'coil_carbine' };
  private loadFill: HTMLElement | null = null;
  private loadLabel: HTMLElement | null = null;
  private resultsAt = 0;
  private resultsHandlers: { same(): void; fresh(): void; menu(): void } | null = null;

  constructor(
    private root: HTMLElement,
    actions: UiActions,
  ) {
    this.actions = actions;
    root.classList.add('sw-root');
    this.hud = new Hud(root);
    root.appendChild(this.screenHost);
    this.draft = new DraftOverlay(root, actions, this.guard);
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** True while any modal screen (loading, menu, pause, click-to-resume, draft, results) wants input. */
  get overlayOpen(): boolean {
    return this.screen !== 'none' || this.draft.open;
  }

  get inspectOpen(): boolean {
    return this.inspectNode !== null;
  }

  // ------------------------------------------------------------ screens

  private setScreen(kind: Screen, node: HTMLElement | null): void {
    this.closeModal();
    this.screenNode?.remove();
    this.screenNode = node;
    this.screen = node ? kind : 'none';
    if (node) this.screenHost.appendChild(node);
  }

  private closeModal(): void {
    this.modalNode?.remove();
    this.modalNode = null;
  }

  /** Sub-panel (settings/controls/credits) layered over menu or pause. */
  private openModal(title: string, body: HTMLElement): void {
    this.closeModal();
    const scr = el('div', 'sw-screen sw-dim', undefined, this.screenHost);
    const panel = el('div', 'sw-panel sw-modal', undefined, scr);
    el('h2', undefined, title, panel);
    panel.appendChild(body);
    const row = el('div', 'sw-modal-row', undefined, panel);
    const back = el('button', 'sw-btn', 'Back [Esc]', row);
    back.onclick = () => this.closeModal();
    this.modalNode = scr;
    back.focus({ preventScroll: true });
  }

  private openSettings(): void {
    this.openModal(
      'Settings',
      buildSettings(this.settings, (s) => {
        this.settings = s;
        this.actions.settingsChanged({ ...s });
      }),
    );
  }

  showLoading(frac: number, label: string): void {
    if (this.screen !== 'loading') {
      const s = el('div', 'sw-screen sw-solid sw-loading');
      const t = el('h1', 'sw-title', undefined, s);
      t.style.fontSize = '64px';
      el('span', 'b', 'Ashfall: Slagwire', t);
      const bar = el('div', 'sw-loadbar', undefined, s);
      this.loadFill = el('i', undefined, undefined, bar);
      this.loadLabel = el('div', 'sw-loadlabel', undefined, s);
      this.setScreen('loading', s);
    }
    const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
    this.loadFill!.style.width = `${(f * 100).toFixed(1)}%`;
    this.loadLabel!.textContent = `${label}  ${Math.round(f * 100)}%`;
  }

  showMenu(profile: Profile): void {
    this.settings = { ...profile.settings };
    this.hud.setVisible(false);
    this.hud.clearTransient();
    this.draft.hide();
    const scr = el('div', 'sw-screen sw-solid');
    scr.appendChild(
      buildMenu(profile, this.menuState, {
        play: (setup) => {
          this.hideOverlays();
          this.actions.startRun(setup);
        },
        settings: () => this.openSettings(),
        controls: () => this.openModal('Controls', buildControls()),
        credits: () => this.openModal('Credits', buildCredits()),
      }),
    );
    this.setScreen('menu', scr);
  }

  showPause(seed: string, settings: Settings): void {
    this.settings = { ...settings };
    this.draft.hide();
    const scr = el('div', 'sw-screen sw-dim');
    const p = el('div', 'sw-panel sw-pause', undefined, scr);
    el('h2', undefined, 'Paused', p);
    el('div', 'sw-label', 'Run seed', p).style.marginTop = '0';
    const sd = el('div', 'seed', undefined, p);
    el('span', undefined, seed, sd);
    const copy = el('button', 'sw-btn small', 'Copy', sd);
    copy.onclick = () => {
      try {
        void navigator.clipboard?.writeText(seed);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Select to copy';
      }
    };
    const btn = (label: string, fn: () => void, cls = 'sw-btn') => {
      const b = el('button', cls, label, p);
      b.onclick = fn;
      return b;
    };
    const first = btn('Continue', () => {
      this.hideOverlays();
      this.actions.resume();
    }, 'sw-btn primary');
    btn('Restart — same seed', () => { this.hideOverlays(); this.actions.restart(true); });
    btn('Restart — new seed', () => { this.hideOverlays(); this.actions.restart(false); });
    btn('Settings', () => this.openSettings());
    btn('Controls', () => this.openModal('Controls', buildControls()));
    btn('Quit to menu', () => { this.hideOverlays(); this.actions.quitToMenu(); });
    this.setScreen('pause', scr);
    first.focus({ preventScroll: true });
  }

  showClickToResume(): void {
    this.draft.hide();
    const scr = el('div', 'sw-screen sw-resume');
    el('div', 'big', 'Click to resume', scr);
    el('div', 'small', 'Esc for pause menu', scr);
    scr.addEventListener('mousedown', (e) => e.stopPropagation());
    scr.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideOverlays();
      this.actions.resume();
    });
    this.setScreen('resume', scr);
  }

  showDraft(view: DraftView): void {
    this.setScreen('none', null);
    this.draft.show(view);
  }

  hideDraft(): void {
    this.draft.hide();
  }

  showResults(view: ResultsView): void {
    this.draft.hide();
    this.hud.clearTransient();
    this.resultsAt = performance.now();
    const go = (fn: () => void) => () => {
      this.hideOverlays();
      fn();
    };
    this.resultsHandlers = {
      same: go(() => this.actions.restart(true)),
      fresh: go(() => this.actions.restart(false)),
      menu: go(() => this.actions.quitToMenu()),
    };
    const scr = el('div', 'sw-screen sw-dim');
    scr.appendChild(buildResults(view, this.resultsHandlers));
    this.setScreen('results', scr);
  }

  hideOverlays(): void {
    this.draft.hide();
    this.setScreen('none', null);
    this.resultsHandlers = null;
    this.hideInspect();
  }

  // ------------------------------------------------------------ HUD

  setHudVisible(v: boolean): void {
    this.hud.setVisible(v);
  }
  updateHud(m: HudModel): void {
    this.hud.update(m);
  }
  updateDebug(m: DebugModel | null): void {
    this.hud.debug(m);
  }
  banner(text: string, kind: BannerKind): void {
    this.hud.banner(text, kind);
  }
  subtitle(speaker: string, text: string, seconds: number): void {
    this.hud.subtitle(speaker, text, seconds);
  }

  /** Array: open the inspect panel (or close it if already open). null: close. Non-modal. */
  toggleInspect(cards: OwnedCardView[] | null): void {
    if (cards === null || this.inspectNode) {
      this.hideInspect();
      return;
    }
    this.inspectNode = buildInspect(cards);
    this.root.appendChild(this.inspectNode);
  }

  private hideInspect(): void {
    this.inspectNode?.remove();
    this.inspectNode = null;
  }

  // ------------------------------------------------------------ keys

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.draft.open) return; // draft owns the keyboard
    if (this.modalNode) {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.closeModal();
      }
      return;
    }
    if (this.screen === 'results' && this.resultsHandlers && performance.now() - this.resultsAt > RESULT_GUARD_MS && !e.repeat) {
      const h = this.resultsHandlers;
      const fn = e.code === 'KeyR' || e.code === 'Enter' ? h.same : e.code === 'KeyN' ? h.fresh : e.code === 'KeyM' ? h.menu : null;
      if (fn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.guard.swallowKey(e.code);
        fn();
      }
    }
  }

  // exposed for dev page / tests
  get starterChoice(): MainWeaponId {
    return this.menuState.starter;
  }
}
