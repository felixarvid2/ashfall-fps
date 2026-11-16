import type { Settings, HudModel, DebugModel } from '../ui/types';
import type { EnemyRenderState, RenderFrame } from '../render/types';
import { AMMO_LABEL, WEAPONS } from '../content/weapons';
import type { Run } from './run';
import { clamp } from './math';

export interface ViewState {
  yaw: number;
  pitch: number;
  lookDX: number;
  lookDY: number;
}

const wrapPi = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function buildRenderFrame(run: Run, alpha: number, view: ViewState, settings: Settings, enemies: EnemyRenderState[]): RenderFrame {
  const p = run.player;
  const w = run.weapons;
  const feel = p.feel(alpha);
  const eye = p.eyePos(alpha);
  const bob = settings.cameraBob;
  const cam = {
    pos: { x: eye.x, y: eye.y + (feel.bobY + feel.landDip) * bob, z: eye.z },
    yaw: view.yaw + w.recoilYaw,
    pitch: clamp(view.pitch + w.recoilPitch, -1.55, 1.55),
    roll: feel.roll * bob,
    fov: settings.fov,
    shake: feel.shake * settings.screenShake,
  };
  // Side bob follows the camera's right vector.
  const rx = Math.cos(view.yaw);
  const rz = -Math.sin(view.yaw);
  cam.pos.x += rx * feel.bobX * bob;
  cam.pos.z += rz * feel.bobX * bob;

  const cur = w.current;
  const hurt = Math.max(0, 1 - p.sinceHurt / 0.5);
  return {
    time: run.time,
    camera: cam,
    viewmodel: {
      weapon: cur,
      raise: w.raise,
      reload: w.reloadProgress,
      kick: w.kick,
      sinceShot: w.sinceShot,
      speed: clamp(p.horizontalSpeed / p.stats.moveSpeed, 0, 1),
      grounded: p.grounded,
      lookDX: view.lookDX,
      lookDY: view.lookDY,
      slugReady: cur === 'arc_scattergun' && run.cardRuntime.coldChamberReady() === true,
      charge: w.chargeFrac(),
      dashing: p.dashing,
    },
    enemies,
    pickups: run.renderPickups(),
    hazards: run.level.hazards.map((h) => ({ id: h.id, ...run.hazardState(h) })),
    caches: run.caches.map((c) => ({ arena: c.arena.id, pos: c.arena.cache, open: c.open, available: c.available && !c.open })),
    rackHasWeapon: run.rackHasWeapon,
    relay: { ...run.relay },
    extractionActive: run.extractionActive,
    gatesOpen: run.phys.gateStates(),
    projectiles: run.enemies.projectiles(),
    flash: { amount: hurt * settings.flashIntensity, color: 0xff2a14 },
  };
}

export function buildHud(run: Run, settings: Settings, viewYaw: number, viewportHeight: number, enemies: EnemyRenderState[]): HudModel {
  const p = run.player;
  const w = run.weapons;
  const cur = w.current;
  const def = WEAPONS[cur];
  const stats = run.weaponStatsFor(cur);
  const st = run.director.status;
  const active = st.arena !== null && !st.cleared.includes(st.arena);
  const mag = w.magazine(cur);
  const cap = w.capacityOf(cur);
  const reserve = cur === 'service_emitter' ? 0 : w.reserve(cur);

  // Crosshair: weapon cone plus a movement/recoil bloom, in screen pixels.
  const spreadDeg = stats.spreadDeg + (p.horizontalSpeed / p.stats.moveSpeed) * 0.5 + w.kick * 0.6;
  const half = Math.tan((spreadDeg * Math.PI) / 360) / Math.tan((settings.fov * Math.PI) / 360);
  const crosshairSpread = clamp(half * (viewportHeight / 2), 4, 90);

  const boss = enemies.find((e) => e.kind === 'loader' && e.state !== 'dead');
  const px = p.pos.x;
  const pz = p.pos.z;

  return {
    health: Math.ceil(p.health),
    maxHealth: p.maxHealth,
    weaponId: cur,
    weaponName: def.name,
    magazine: mag,
    capacity: cap,
    reserve,
    ammoLabel: def.ammo ? AMMO_LABEL[def.ammo] : 'EMITTER CHARGE',
    reloading: w.reloadProgress,
    backupCharge: w.chargeFrac(),
    dashReady: p.dashReady,
    objective: run.objective,
    waveText: active && st.waves > 0 ? `WAVE ${Math.max(1, st.wave)}/${st.waves}` : null,
    enemiesLeft: active ? st.live + st.queued : null,
    salvage: run.salvage,
    cascade: run.cardRuntime.cascadeCounter(),
    coldChamberReady: run.cardRuntime.coldChamberReady(),
    crosshairSpread,
    hitMarker: run.hitMarker,
    killMarker: run.killMarker,
    damageDirs: run.hurtMarks.map((m) => {
      const dx = m.from.x - px;
      const dz = m.from.z - pz;
      const attackerYaw = Math.atan2(-dx, -dz);
      // 0 = in front, +PI/2 = to the right (clockwise on screen).
      return { angle: -wrapPi(attackerYaw - viewYaw), alpha: clamp(1 - m.t / 2.2, 0, 1) };
    }),
    bossHealth: boss ? { name: 'CARGO LOADER', frac: boss.hpFrac } : null,
    relayProgress: run.relay.active || run.relay.done || run.relay.progress > 0 ? run.relay.progress : null,
    interactPrompt: run.interactPrompt,
    lowAmmo: cur !== 'service_emitter' && reserve === 0 && mag <= Math.max(1, cap * 0.3),
    slots: w.slots().map((s) => ({ id: s.id, name: WEAPONS[s.id].name, locked: s.locked, active: s.active })),
  };
}

export function buildDebug(
  run: Run,
  frame: { ms: number; p50: number; p95: number; p99: number },
  render: { drawCalls: number; triangles: number },
): DebugModel {
  const st = run.director.status;
  return {
    frameMs: frame.ms,
    p50: frame.p50,
    p95: frame.p95,
    p99: frame.p99,
    liveEnemies: run.enemies.liveCount(),
    queuedEnemies: st.queued,
    projectiles: run.enemies.projectileCount(),
    seed: run.seed,
    wave: st.arena ? `${st.arena} ${st.wave}/${st.waves}` : 'none',
    weapon: WEAPONS[run.weapons.current].name,
    cards: run.ownedCards().map((c) => `${c.name} x${c.rank}${c.inactive ? ' (off)' : ''}`),
    drawCalls: render.drawCalls,
    triangles: render.triangles,
  };
}
