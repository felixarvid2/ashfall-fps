import { REFINERY } from '../content/level';
import { WEAPONS } from '../content/weapons';
import { DEBUG_LOADOUTS } from '../content/cards';
import type { LevelDef } from '../content/levelTypes';
import { normalizeSeed, randomSeed } from '../core/rng';
import { Input } from '../input/input';
import { initPhysics, PhysicsWorld } from '../physics/world';
import { GameRenderer } from '../render';

import { createAudioSystem } from '../audio';
import type { AudioSystem, SfxId } from '../audio/types';
import { Ui, loadProfile, saveProfile } from '../ui';
import type { Profile, ResultsView, RunSetup, Settings, UiActions } from '../ui/types';
import type { GameEvent, MainWeaponId } from '../sim/types';
import { Run } from './run';
import { DEFAULT_FACTORIES } from './factories';
import { FixedStepper, FrameStats } from './loop';
import { buildDebug, buildHud, buildRenderFrame } from './frames';
import { forwardOf } from './math';

export interface DevParams {
  active: boolean;
  seed: string | null;
  loadout: string | null;
  skipTo: 'yard' | 'slag' | 'relay' | null;
  autostart: boolean;
}

/** `?seed=XXXX&loadout=coil-cascade|arc-backwash&skipTo=yard|slag|relay[&autostart=1]` */
export function parseDevParams(search: string): DevParams {
  const q = new URLSearchParams(search);
  const seed = normalizeSeed(q.get('seed') ?? '');
  const lo = q.get('loadout');
  const loadout = lo && DEBUG_LOADOUTS[lo] ? lo : null;
  const st = q.get('skipTo');
  const skipTo = st === 'yard' || st === 'slag' || st === 'relay' ? st : null;
  const autostart = q.get('autostart') === '1';
  return { active: !!(seed || loadout || skipTo || autostart), seed, loadout, skipTo, autostart };
}

type Mode = 'loading' | 'menu' | 'playing' | 'draft' | 'paused' | 'resume' | 'resuming' | 'results';

const ENEMY_AUDIO_TELL: Record<string, SfxId> = {
  walker: 'walker_tell',
  hound: 'hound_charge',
  drone: 'drone_tell',
  loader: 'loader_tell',
};

export class Game {
  private mode: Mode = 'loading';
  private renderer: GameRenderer;
  private audio: AudioSystem;
  private ui: Ui;
  private input: Input;
  private profile: Profile;
  private level: LevelDef = REFINERY;
  private run: Run | null = null;
  private lastSetup: RunSetup = { seed: null, starter: 'coil_carbine' };
  private levelBuilt = false;

  private stepper = new FixedStepper();
  private frames = new FrameStats(300);
  private lastNow = 0;
  private alpha = 1;
  private raf = 0;
  private debugOn = false;
  private intensity = 0;
  private inspectOpen = false;
  private disposed = false;

  private actions: UiActions = {
    startRun: (setup) => this.startRun(setup),
    resume: () => this.resume(),
    quitToMenu: () => this.quitToMenu(),
    restart: (same) => this.restart(same),
    draftPick: (offerId, index) => this.draftPick(offerId, index),
    draftReroll: (offerId) => this.draftReroll(offerId),
    draftSkip: (offerId) => this.draftSkip(offerId),
    settingsChanged: (s) => this.settingsChanged(s),
  };

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private dev: DevParams,
  ) {
    this.profile = loadProfile();
    this.debugOn = this.profile.settings.showDebug;
    this.renderer = new GameRenderer(canvas);
    this.audio = createAudioSystem();
    this.ui = new Ui(uiRoot, this.actions);
    this.input = new Input(canvas, {
      onLockLost: () => this.pause(),
      onEscape: () => this.pause(),
      onBlur: () => this.pause(),
      onInspect: () => this.toggleInspect(),
      onToggleDebug: () => this.toggleDebug(),
    });
    this.input.configure(this.profile.settings);
    window.addEventListener('resize', this.onResize);
  }

  // -- boot ----------------------------------------------------------------

  async boot(): Promise<void> {
    this.ui.showLoading(0, 'Initializing physics');
    await initPhysics();
    this.ui.showLoading(0.02, 'Loading assets');
    await this.renderer.load((f, label) => this.ui.showLoading(0.02 + f * 0.98, label));
    this.applySettings(this.profile.settings);
    this.onResize();
    this.mode = 'menu';
    this.ui.showMenu(this.profile);
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    if (this.dev.autostart) {
      const starter: MainWeaponId = this.dev.loadout === 'arc-backwash' ? 'arc_scattergun' : 'coil_carbine';
      this.startRun({ seed: this.dev.seed, starter });
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.run?.dispose();
    this.run = null;
    this.input.dispose();
    this.audio.stopAll();
    this.renderer.dispose();
  }

  // -- settings / window ---------------------------------------------------

  private applySettings(s: Settings): void {
    this.input.configure(s);
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambienceVolume);
    this.renderer.applySettings(s);
  }

  private settingsChanged(s: Settings): void {
    this.profile = { ...this.profile, settings: { ...s } };
    saveProfile(this.profile);
    this.debugOn = s.showDebug;
    this.applySettings(s);
  }

  private onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  };

  private toggleDebug(): void {
    this.debugOn = !this.debugOn;
    if (!this.debugOn) this.ui.updateDebug(null);
  }

  private toggleInspect(): void {
    if (!this.run || (this.mode !== 'playing' && this.mode !== 'paused')) return;
    this.inspectOpen = !this.inspectOpen;
    this.ui.toggleInspect(this.inspectOpen ? this.run.ownedCards() : null);
  }

  // -- run lifecycle -------------------------------------------------------

  private startRun(setup: RunSetup): void {
    this.lastSetup = setup;
    // Pointer lock + audio must start inside this user gesture.
    void this.audio.resume();
    this.beginRun(normalizeSeed(setup.seed ?? '') ?? this.dev.seed ?? randomSeed(), setup.starter);
  }

  private restart(sameSeed: boolean): void {
    void this.audio.resume();
    const seed = sameSeed && this.run ? this.run.seed : randomSeed();
    this.beginRun(seed, this.lastSetup.starter);
  }

  private beginRun(seed: string, requestedStarter: MainWeaponId): void {
    this.endRun();
    const devActive = !!(this.dev.loadout || this.dev.skipTo);
    let starter = requestedStarter;
    if (starter === 'arc_scattergun' && !this.profile.unlocks.arcScattergun && !devActive) starter = 'coil_carbine';
    if (this.dev.loadout === 'arc-backwash') starter = 'arc_scattergun';
    try {
      if (!this.levelBuilt) {
        this.renderer.buildLevel(this.level);
        this.levelBuilt = true;
      }
      this.renderer.resetRun();
      const phys = PhysicsWorld.createSync(this.level);
      this.run = new Run({ level: this.level, seed, starter, loadout: this.dev.loadout, skipTo: this.dev.skipTo }, phys, DEFAULT_FACTORIES);
    } catch (err) {
      console.error('[ashfall] failed to create run', err);
      this.mode = 'menu';
      this.ui.showMenu(this.profile);
      return;
    }
    const run = this.run;
    this.input.setView(this.level.playerStart.yaw, 0);
    if (this.dev.skipTo) this.input.setView(0, 0);
    this.input.setEnabled(false);
    this.stepper.reset();
    this.frames.clear();
    this.inspectOpen = false;
    this.intensity = 0;
    this.alpha = 1;
    this.ui.hideOverlays();
    this.ui.setHudVisible(true);
    this.audio.startAmbience();
    run.start({ skipDeployment: devActive });
    if (run.draft) this.enterDraft();
    else void this.beginPlay();
  }

  private endRun(): void {
    if (this.run) {
      this.run.dispose();
      this.run = null;
    }
    this.input.setEnabled(false);
    this.input.exitLock();
    this.inspectOpen = false;
    this.ui.toggleInspect(null);
    this.ui.updateDebug(null);
  }

  private quitToMenu(): void {
    this.endRun();
    this.renderer.resetRun();
    this.audio.stopAll();
    this.mode = 'menu';
    this.ui.setHudVisible(false);
    this.ui.showMenu(this.profile);
  }

  // -- play / pause / lock -------------------------------------------------

  private async beginPlay(): Promise<void> {
    if (!this.run) return;
    this.mode = 'resuming';
    this.input.setEnabled(false);
    const ok = await this.input.requestLock();
    if (this.mode !== 'resuming' || !this.run) return;
    if (ok) this.enterPlaying();
    else {
      this.mode = 'resume';
      this.ui.showClickToResume();
    }
  }

  private enterPlaying(): void {
    this.mode = 'playing';
    this.ui.hideOverlays();
    this.ui.setHudVisible(true);
    this.input.setEnabled(true); // clears held keys/buttons: the confirming click cannot fire a shot
    this.stepper.reset();
  }

  private pause(): void {
    if (this.mode !== 'playing' || !this.run) return;
    this.mode = 'paused';
    this.input.setEnabled(false);
    this.input.exitLock();
    this.ui.showPause(this.run.seed, this.profile.settings);
  }

  private resume(): void {
    if (!this.run) return;
    if (this.mode === 'paused' || this.mode === 'resume') {
      void this.audio.resume();
      void this.beginPlay();
    }
  }

  private enterDraft(): void {
    const run = this.run;
    if (!run?.draft) return;
    this.mode = 'draft';
    this.input.setEnabled(false);
    this.input.exitLock();
    this.inspectOpen = false;
    this.ui.toggleInspect(null);
    this.ui.showDraft(run.draftView()!);
  }

  private draftPick(offerId: number, index: number): void {
    const run = this.run;
    if (!run || this.mode !== 'draft') return;
    if (!run.draftPick(offerId, index).ok) return;
    this.ui.hideDraft();
    void this.beginPlay();
  }

  private draftReroll(offerId: number): void {
    const run = this.run;
    if (!run || this.mode !== 'draft') return;
    if (run.draftReroll(offerId).ok) this.ui.showDraft(run.draftView()!);
  }

  private draftSkip(offerId: number): void {
    const run = this.run;
    if (!run || this.mode !== 'draft') return;
    if (!run.draftSkip(offerId).ok) return;
    this.ui.hideDraft();
    void this.beginPlay();
  }

  private finishRun(): void {
    const run = this.run;
    if (!run) return;
    this.mode = 'results';
    this.input.setEnabled(false);
    this.input.exitLock();
    this.ui.toggleInspect(null);
    this.inspectOpen = false;
    const outcome = run.outcome ?? 'dead';
    const unlockedNow: string[] = [];
    const devActive = !!(this.dev.loadout || this.dev.skipTo);
    if (!devActive) {
      const p = this.profile;
      const stats = { ...p.stats, runs: p.stats.runs + 1 };
      const feats = new Set(p.feats);
      let unlocks = p.unlocks;
      if (outcome === 'extracted') {
        stats.extractions++;
        stats.bestTimeSec = stats.bestTimeSec === null ? run.time : Math.min(stats.bestTimeSec, run.time);
        feats.add('first_extraction');
        if (!unlocks.arcScattergun) {
          unlocks = { ...unlocks, arcScattergun: true };
          unlockedNow.push('Arc Scattergun: now selectable as a starting weapon');
        }
      } else {
        stats.deaths++;
        feats.add('first_death');
      }
      this.profile = { ...p, stats, unlocks, feats: [...feats] };
      saveProfile(this.profile);
    }
    const weapons = run.weapons.mains.filter((w) => !run.weapons.isLocked(w)).map((w) => WEAPONS[w].name);
    weapons.push(WEAPONS.service_emitter.name);
    const view: ResultsView = {
      outcome,
      seed: run.seed,
      timeSec: run.time,
      encountersCleared: run.arenasCleared,
      encountersTotal: this.level.arenas.length,
      weapons,
      pact: run.cards.pact ? `${WEAPONS[run.cards.pact].name} pact` : null,
      cards: run.ownedCards().map((c) => ({ name: c.name, rank: c.rank, inactive: c.inactive })),
      kills: run.kills,
      unlockedNow,
    };
    this.ui.showResults(view);
  }

  // -- frame loop ----------------------------------------------------------

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dtMs = Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const dt = Math.min(dtMs / 1000, 0.25);
    this.frames.push(dtMs);
    const run = this.run;
    if (!run) return;

    if (this.mode === 'playing' && !run.frozen) {
      this.alpha = this.stepper.advance(dt, () => {
        if (!run.frozen) run.step(this.input.sample());
      });
      if (run.draft) {
        this.routeEvents(run.drainEvents());
        this.enterDraft();
      }
    }
    const events = run.drainEvents();
    if (events.length) this.routeEvents(events);
    if (this.mode === 'playing' && run.finished) this.finishRun();

    this.drawFrame(run, dt);
  };

  private drawFrame(run: Run, dt: number): void {
    const settings = this.profile.settings;
    const look = this.input.takeLook();
    const enemies = run.enemies.renderStates(this.alpha);
    const frame = buildRenderFrame(
      run,
      this.alpha,
      { yaw: this.input.yaw, pitch: this.input.pitch, lookDX: look.dx, lookDY: look.dy },
      settings,
      enemies,
    );
    this.renderer.render(frame, dt);

    const fwd = forwardOf(frame.camera.yaw, frame.camera.pitch);
    this.audio.setListener(frame.camera.pos, fwd);
    const target = Math.min(1, run.enemies.liveCount() / 12);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.5);
    this.audio.setIntensity(this.intensity);

    this.ui.updateHud(buildHud(run, settings, this.input.yaw, window.innerHeight, enemies));
    if (this.debugOn) {
      this.ui.updateDebug(
        buildDebug(
          run,
          { ms: this.frames.last, p50: this.frames.percentile(50), p95: this.frames.percentile(95), p99: this.frames.percentile(99) },
          this.renderer.stats(),
        ),
      );
    }
  }

  // -- events --------------------------------------------------------------

  private routeEvents(events: GameEvent[]): void {
    this.renderer.handleEvents(events);
    for (const e of events) this.playEvent(e);
  }

  private playEvent(e: GameEvent): void {
    const a = this.audio;
    const ui = this.ui;
    switch (e.type) {
      case 'shot':
        a.play(e.slug ? 'arc_slug' : (WEAPONS[e.weapon].audio.fire as SfxId));
        break;
      case 'impact':
        if (e.surface === 'world') a.play((e.weapon ? WEAPONS[e.weapon].audio.impact : 'impact_world') as SfxId, { pos: e.point, volume: 0.7 });
        break;
      case 'dry_fire':
        a.play(WEAPONS[e.weapon].audio.empty as SfxId);
        break;
      case 'reload_start':
        a.play(WEAPONS[e.weapon].audio.reload as SfxId);
        break;
      case 'swap':
        a.play(WEAPONS[e.to].audio.equip as SfxId);
        break;
      case 'enemy_hit':
        a.play(e.armorBreak ? 'armor_break' : e.kind === 'loader' ? 'impact_metal' : 'impact_flesh', { pos: e.point });
        break;
      case 'enemy_die':
        a.play('enemy_die', { pos: e.pos });
        break;
      case 'enemy_tell':
        a.play(ENEMY_AUDIO_TELL[e.kind] ?? 'walker_tell', { pos: e.pos });
        break;
      case 'enemy_attack': {
        const id: SfxId =
          e.kind === 'hound' ? 'hound_lunge'
          : e.kind === 'drone' ? 'drone_flame'
          : e.kind === 'loader' ? (e.attack === 'slam' ? 'loader_slam' : e.attack === 'call' ? 'loader_call' : 'loader_swing')
          : 'walker_growl';
        a.play(id, { pos: e.pos });
        break;
      }
      case 'arc':
        a.play('arc_proc', { pos: e.from });
        break;
      case 'burst':
        a.play('burst_proc', { pos: e.pos });
        break;
      case 'cone':
        a.play('backwash_proc', { pos: e.pos });
        break;
      case 'player_hurt':
        a.play('player_hurt');
        break;
      case 'player_die':
        a.play('player_die');
        break;
      case 'player_jump':
        a.play('jump');
        break;
      case 'player_land':
        a.play('land', { volume: Math.min(1, e.speed / 12) });
        break;
      case 'player_step':
        a.play('footstep');
        break;
      case 'player_dash':
        a.play('dash');
        break;
      case 'pickup': {
        const id: SfxId = e.item.startsWith('weapon') ? 'pickup_weapon' : e.item.startsWith('ammo') ? 'pickup_ammo' : e.item === 'salvage' ? 'pickup_salvage' : 'pickup_health';
        a.play(id, { pos: e.pos });
        break;
      }
      case 'hazard_warn':
        a.play('vent_warn', { pos: e.pos });
        break;
      case 'hazard_active':
        a.play('vent_burst', { pos: e.pos });
        break;
      case 'wave_warn':
        a.play('wave_warn');
        ui.banner(`INCOMING: ${e.lane}`, 'warn');
        break;
      case 'wave_start':
        ui.banner(`WAVE ${e.wave}/${e.total}`, 'wave');
        break;
      case 'encounter_clear':
        a.play('encounter_clear');
        ui.banner('SECTOR CLEAR', 'clear');
        break;
      case 'objective':
        ui.banner(e.text, 'objective');
        break;
      case 'subtitle':
        a.play('radio_blip');
        ui.subtitle(e.speaker, e.text, e.duration);
        break;
      case 'boss_phase':
        ui.banner(e.phase <= 1 ? 'CARGO LOADER: JOINT EXPOSED' : 'CARGO LOADER CALLS REINFORCEMENTS', 'warn');
        break;
      case 'relay_progress':
        if (e.value >= 1) a.play('relay_down');
        else if (Math.round(e.value * 100) % 20 === 0) a.play('relay_hum');
        break;
      case 'draft_open':
        a.play('ui_open');
        break;
      case 'card_picked':
        a.play('ui_select');
        break;
      default:
        break;
    }
  }
}
