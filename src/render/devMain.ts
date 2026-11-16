/** Standalone visual test page for the renderer (render-test.html). Not used by the game. */
import { GameRenderer } from './index';
import type { EnemyRenderState, RenderFrame, ViewmodelState } from './types';
import type { LevelDef, BoxDef } from '../content/levelTypes';
import type { EnemyKind, EnemyState, GameEvent, WeaponId } from '../sim/types';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: BoxDef['mat'], extra: Partial<BoxDef> = {}): BoxDef => ({
  pos: v(x, y + h / 2, z),
  size: v(w, h, d),
  mat,
  ...extra,
});

function makeLevel(): LevelDef {
  const boxes: BoxDef[] = [
    box(0, -1, 0, 160, 1, 160, 'slag'),
    box(25, -0.98, 0, 30, 1, 30, 'cooling_slag'),
    box(-25, -0.97, 10, 24, 1, 24, 'grit'),
    box(0, -0.96, -30, 30, 1, 14, 'concrete'),
    box(-8, 0, -14, 10, 3, 0.6, 'concrete'),
    box(8, 0, -14, 6, 4, 0.6, 'metal'),
    box(14, 0, -10, 4, 1.2, 4, 'rust'),
    box(-4, 0, -8, 8, 0.15, 3, 'conveyor'),
    box(2, 0.01, -6, 6, 0.05, 1.2, 'hazard'),
    box(-14, 0, -4, 3, 3, 0.4, 'hazard', { gateOpensAfter: 'yard', id: 'gate_a' }),
    { pos: v(10, 0.6, -2), size: v(6, 0.25, 8), mat: 'metal', pitch: -0.22 },
    box(0, 0, 40, 60, 2, 1, 'invisible'),
  ];
  return {
    name: 'Render test',
    playerStart: { pos: v(0, 1.7, 8), yaw: 0 },
    boxes,
    props: [
      { asset: 'prop.fuel_tank', pos: v(-6, 0, -4), yaw: 0.4 },
      { asset: 'prop.cargo_crate', pos: v(-3, 0, -3), yaw: 0.2 },
      { asset: 'prop.cargo_crate', pos: v(-2.8, 1.1, -3), yaw: 0.9 },
      { asset: 'prop.barricade', pos: v(3, 0, -4), yaw: 0 },
      { asset: 'env.pipe_cluster', pos: v(12, 0, 4), yaw: 1 },
      { asset: 'env.catwalk', pos: v(-12, 0, -10), yaw: 0 },
      { asset: 'env.smokestack', pos: v(30, 0, -40), yaw: 0 },
    ],
    landmarks: [
      { asset: 'prop.the_pillar', pos: v(0, 0, -180) },
      { asset: 'prop.giant_crane', pos: v(70, 0, -90) },
      { asset: 'prop.refinery_silhouette', pos: v(-90, 0, -100) },
    ],
    arenas: [
      {
        id: 'yard',
        name: 'Yard',
        trigger: { min: v(-5, 0, -5), max: v(5, 3, 5) },
        bounds: { min: v(-20, 0, -20), max: v(20, 5, 20) },
        lanes: [],
        cache: v(-8, 0, 3),
        objective: 'x',
      },
    ],
    pickups: [],
    hazards: [
      { id: 'vent1', kind: 'vent', pos: v(6, 0, 0), radius: 1.6, period: 6, warn: 1.5, active: 2, offset: 0, damagePerSec: 10 },
      { id: 'vent2', kind: 'vent', pos: v(9, 0, 3), radius: 1.6, period: 6, warn: 1.5, active: 2, offset: 0, damagePerSec: 10 },
    ],
    weaponRack: { pos: v(-2, 0, 6), yaw: 0.3, weapon: 'arc_scattergun' },
    relay: { pos: v(-20, 0, -20), interactRadius: 3, shutdownTime: 10, arena: 'yard' },
    extraction: { pos: v(20, 0, 14), radius: 3 },
    radio: [],
    signs: [
      { pos: v(0, 2.2, -13.6), yaw: 0, width: 3, height: 1, lines: ['SECTOR 7', 'SLAG LINE 5'], style: 'stencil' },
      { pos: v(8, 2.6, -13.6), yaw: 0, width: 2.4, height: 1, lines: ['WARNING', 'HOT METAL'], style: 'warning' },
      { pos: v(-8, 2.0, -13.6), yaw: 0, width: 2.2, height: 1.2, lines: ['DO NOT OPEN', 'VALVE 6'], style: 'scrawl' },
    ],
    killY: -20,
    bounds: { min: v(-80, -5, -80), max: v(80, 30, 80) },
  };
}

const KINDS: EnemyKind[] = ['walker', 'hound', 'drone', 'walker', 'walker', 'hound', 'loader'];

function fakeEnemies(t: number, n: number): EnemyRenderState[] {
  const out: EnemyRenderState[] = [];
  for (let i = 0; i < n; i++) {
    const kind = KINDS[i % KINDS.length];
    const ring = 6 + (i % 7) * 4 + Math.floor(i / 7) * 3;
    const dir = i % 2 ? 1 : -1;
    const sp = (kind === 'hound' ? 5 : kind === 'loader' ? 1.5 : 1.6) / ring;
    const a = i * 2.399 + dir * t * sp;
    const cx = 0, cz = -14;
    const x = cx + Math.cos(a) * ring;
    const z = cz + Math.sin(a) * ring;
    const yaw = -(a + (dir > 0 ? Math.PI / 2 : -Math.PI / 2)) - Math.PI / 2;
    // cycle 9 s
    const ct = (t + i * 0.7) % 9;
    let state: EnemyState = 'advance';
    let stateTime = ct;
    let dur = 0;
    if (ct > 4 && ct < 5) { state = 'windup'; stateTime = ct - 4; dur = 1; }
    else if (ct >= 5 && ct < 5.5) { state = 'attack'; stateTime = ct - 5; dur = 0.5; }
    else if (ct >= 5.5 && ct < 6.2) { state = 'recover'; stateTime = ct - 5.5; dur = 0.7; }
    else if (ct >= 6.2 && ct < 6.8) { state = 'stagger'; stateTime = ct - 6.2; dur = 0.6; }
    else if (ct >= 6.8) { state = 'advance'; stateTime = ct - 6.8; }
    const dead = i % 11 === 10;
    if (dead) { state = 'dead'; stateTime = ct; }
    const y = kind === 'drone' ? 2.2 + Math.sin(t + i) * 0.3 : 0;
    out.push({
      id: i,
      kind,
      pos: v(x, y, z),
      yaw,
      state,
      stateTime,
      stateDuration: dur,
      hpFrac: 1,
      ionized: i % 5 === 0,
      sinceHit: state === 'stagger' ? stateTime : 5,
      fade: dead ? Math.max(0, (ct - 4) / 5) : 0,
      loader: kind === 'loader' ? { attack: i % 2 ? 'slam' : 'sweep', jointExposed: state === 'recover' || state === 'stagger', clawYaw: state === 'attack' ? Math.sin(stateTime * 6) * 1.1 : 0 } : undefined,
    });
  }
  return out;
}

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const params = new URLSearchParams(location.search);
  const r = new GameRenderer(canvas);
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  await r.load((f, label) => {
    hud.textContent = `loading ${(f * 100).toFixed(0)}% ${label}`;
  });
  const level = makeLevel();
  r.buildLevel(level);
  r.resize(innerWidth, innerHeight);
  addEventListener('resize', () => r.resize(innerWidth, innerHeight));

  const dev = {
    r,
    t: 0,
    paused: params.has('pause'),
    enemyCount: Number(params.get('n') ?? 60),
    cam: { pos: v(0, 1.7, 10), yaw: 0, pitch: 0, roll: 0, fov: 90, shake: 0 },
    vm: {
      weapon: (params.get('weapon') ?? 'coil_carbine') as WeaponId,
      raise: 1, reload: null as number | null, kick: 0, sinceShot: 9, speed: 0, grounded: true,
      lookDX: 0, lookDY: 0, slugReady: false, charge: 1, dashing: false,
    } as ViewmodelState,
    custom: null as EnemyRenderState[] | null,
    autoFire: false,
    autoReload: false,
    cycleWeapons: params.has('cycle'),
    extra: {
      hazardPhase: 'idle' as 'idle' | 'warn' | 'active',
      relayActive: false, relayProgress: 0, relayDone: false, extraction: true,
      cacheAvailable: true, rack: true, gate: false, flash: 0,
    },
    pickups: [
      { id: 1, kind: 'ammo_coil', pos: v(-1.5, 0, 4) },
      { id: 2, kind: 'ammo_arc', pos: v(-0.5, 0, 4) },
      { id: 3, kind: 'health', pos: v(0.5, 0, 4) },
      { id: 4, kind: 'salvage', pos: v(1.5, 0, 4) },
      { id: 5, kind: 'armor', pos: v(2.5, 0, 4) },
      { id: 6, kind: 'weapon_arc_scattergun', pos: v(4, 0, 4) },
    ],
    projectiles: [{ id: 1, kind: 'fireball' as const, pos: v(2, 1.6, 2), vel: v(0, 0, 8) }],
    events: [] as GameEvent[],
    fire() {
      const w = dev.vm.weapon;
      dev.vm.sinceShot = 0;
      dev.vm.kick = 1;
      const origin = dev.cam.pos;
      const dir = v(-Math.sin(dev.cam.yaw), 0, -Math.cos(dev.cam.yaw));
      const hits = w === 'arc_scattergun' ? Array.from({ length: 8 }, () => v(origin.x + dir.x * 14 + (Math.random() - 0.5) * 3, 1 + Math.random(), origin.z + dir.z * 14 + (Math.random() - 0.5) * 3)) : [v(origin.x + dir.x * 20, 1.2, origin.z + dir.z * 20)];
      dev.events.push({ type: 'shot', shotId: 1, weapon: w, origin, dir, hits });
      for (const h of hits.slice(0, 4)) dev.events.push({ type: 'impact', weapon: w, point: h, normal: v(-dir.x, 0.2, -dir.z), surface: 'world' });
    },
    pushEvent(e: GameEvent) { dev.events.push(e); },
    frame(): RenderFrame {
      const x = dev.extra;
      return {
        time: dev.t,
        camera: dev.cam,
        viewmodel: dev.vm,
        enemies: dev.custom ?? (dev.enemyCount > 0 ? fakeEnemies(dev.t, dev.enemyCount) : []),
        pickups: dev.pickups,
        hazards: level.hazards.map((h) => ({ id: h.id, phase: x.hazardPhase, t: 0 })),
        caches: [{ arena: 'yard', pos: level.arenas[0].cache, open: false, available: x.cacheAvailable }],
        rackHasWeapon: x.rack,
        relay: { progress: x.relayProgress, active: x.relayActive, done: x.relayDone },
        extractionActive: x.extraction,
        gatesOpen: { yard: x.gate },
        projectiles: dev.projectiles,
        flash: { amount: x.flash, color: 0xff2010 },
      };
    },
  };
  (window as unknown as { dev: typeof dev }).dev = dev;
  (window as unknown as { devReady: boolean }).devReady = true;
  (window as unknown as { devErrors: string[] }).devErrors = errors;

  let last = performance.now();
  let acc = 0;
  const manual = params.has('manual');
  let frames = 0;
  let fpsT = 0;
  const loop = (now: number) => {
    const dt = manual ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    if (manual) return;
    if (!dev.paused) dev.t += dt;
    dev.vm.sinceShot += dt;
    dev.vm.kick = Math.max(0, dev.vm.kick - dt * 6);
    if (dev.autoFire) {
      acc += dt;
      if (acc > 0.35) { acc = 0; dev.fire(); }
    }
    if (dev.autoReload) {
      const p = ((dev.t * 0.45) % 1.4) / 1.4;
      dev.vm.reload = p < 1 ? p : null;
    }
    if (dev.cycleWeapons) {
      const ids: WeaponId[] = ['coil_carbine', 'arc_scattergun', 'service_emitter'];
      dev.vm.weapon = ids[Math.floor(dev.t / 4) % 3];
      if (Math.floor(dev.t * 3) !== Math.floor((dev.t - dt) * 3) && Math.floor(dev.t * 3) % 2 === 0) dev.fire();
    }
    if (dev.events.length) {
      r.handleEvents(dev.events);
      dev.events.length = 0;
    }
    r.render(dev.frame(), dt);
    frames++;
    fpsT += dt;
    if (fpsT > 1) {
      const s = r.stats();
      hud.textContent = `${(frames / fpsT).toFixed(0)} fps  calls ${s.drawCalls}  tris ${s.triangles}`;
      frames = 0;
      fpsT = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  /** Manual mode: advance sim time by `dt` in `n` sub-steps and render once. Returns ms spent. */
  (dev as unknown as { step: (dt: number, n?: number) => number }).step = (dt: number, n = 1) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      dev.t += dt;
      dev.vm.sinceShot += dt;
      dev.vm.kick = Math.max(0, dev.vm.kick - dt * 6);
      if (dev.events.length) {
        r.handleEvents(dev.events);
        dev.events.length = 0;
      }
      r.render(dev.frame(), dt);
    }
    return performance.now() - t0;
  };
}
main();
