# ASHFALL: SLAGWIRE — architecture

Working title of the brief was *BLACK SIGNAL*; renamed to **SLAGWIRE** (that name is taken by three released games).

Stack: Vite 8 + TypeScript 7 + Three.js 0.186 + `@dimforge/rapier3d-compat` 0.21 + Web Audio + DOM/CSS UI. Vitest for sim/card tests.

## Principles
- `src/sim`, `src/content`, `src/core` are pure TS: no Three.js scene objects, no DOM. They run under Vitest in Node.
- 60 Hz fixed simulation step (`SIM_DT`). Rendering via `requestAnimationFrame` with interpolation; catch-up capped at 5 steps; accumulator reset on pause/blur. Mouse deltas are applied to view angles immediately (frame-rate independent), and sampled by the sim at step time.
- The sim is authoritative for shot timing, ammo and damage. Render/audio/UI only consume `RunFrame` state + the `GameEvent` queue (`src/sim/types.ts`).
- A run (`src/game/run.ts`) owns its entities, physics world, encounter state and RNG streams. Restart disposes the run (scene objects, listeners, timers, audio voices) and keeps shared asset caches.
- RNG: `new Rng(seed)` root; forks: `draft`, `spawns`, `pickups`, `fx`. Drafts never share a stream with anything frame-dependent.

## Damage pipeline (order)
1. Weapon sim decides a trigger pull happened (fire interval, ammo) → asks `CardRuntime.shotShape()`.
2. Weapon sim traces rays from the **eye** (world camera): static world via Rapier, enemies via analytic capsule tests. Muzzle reconciliation: if the segment eye→muzzle is obstructed, or the muzzle is inside geometry, the shot stops at that obstruction (no shooting through a pillar the barrel is tucked behind).
3. `CardRuntime.resolveShot(trace, world)` resolves **direct** damage per target per shot: pellets on the same target are summed, distance falloff per pellet, then `× (1 + damageBonus)`, then `× 1.10` if the target was Ionized **before** the shot (checked once per target per shot). Pierce damage multipliers apply to the 2nd target.
4. Deaths are applied once (`damageEnemy` returns `killed` once).
5. Bounded secondary effects in fixed order: Ion Primer tags → Chargeback → Ground Loop → Breaker Fuse → Cascade Bus → Rupture Relay → Repulsion → Backwash. Secondary damage (`cascade`/`rupture`/`burst`/`backwash`) never triggers direct-hit/direct-kill effects. Limits (targets, radius, cooldowns, per-shot caps) live in card `params`.
6. Target ties break by (distance, id).

## Stat formulas (card engine)
- damage = base × (1 + Σ damageBonus) (pact adds +0.10 to Σ for the pledged weapon)
- fireInterval = max(minFireInterval, base / (1 + Σ fireRate))
- reloadTime = max(minReloadTime, base / (1 + Σ reloadSpeed)) — Hot Cycle contributes −0.20 reload speed
- capacity = ceil(base × min(maxCapacityMul, 1 + Σ capacityBonus))
- dashCooldown = max(minDashCooldown, base × (1 − Σ dashCooldown))
- pellets = min(maxPellets, base + Σ pellets); spread = min(maxSpreadDeg, base × (1 + Σ spread))
Limits: `STAT_LIMITS` in `src/content/weapons.ts`.

## Module ownership (parallel workers — edit only your own paths)
| Area | Paths | Exports |
|---|---|---|
| Contracts (lead) | `src/sim/types.ts`, `src/render/types.ts`, `src/ui/types.ts`, `src/audio/types.ts`, `src/content/levelTypes.ts`, `src/content/assetTypes.ts`, `src/physics/types.ts`, `src/core/rng.ts`, `src/content/weapons.ts` | — |
| Cards & combat | `src/content/cards.ts`, `src/sim/cards/**`, `tests/cards*.test.ts`, `tests/combat*.test.ts`, `tests/draft*.test.ts` | see below |
| Enemies, director, level | `src/content/level.ts`, `src/content/enemies.ts`, `src/content/encounters.ts`, `src/sim/enemies/**`, `src/sim/director.ts`, `tests/enemies*.test.ts`, `tests/director*.test.ts` | see below |
| Render | `src/render/**` (except types.ts), `src/content/assets.ts` is read-only for render | `GameRenderer` |
| UI & profile | `src/ui/**` (except types.ts), `src/profile/**`, `src/styles/**`, `tests/profile*.test.ts` | `Ui`, `loadProfile`, `saveProfile` |
| Audio | `src/audio/**` (except types.ts) | `createAudioSystem()` |
| Assets | `public/assets/**` (except `weapons/`), `src/content/assets.ts`, `docs/ASSETS.md` | `ASSETS` |
| Engine & shell | `index.html`, `src/main.ts`, `src/game/**`, `src/physics/**` (except types.ts), `src/input/**`, `src/sim/player.ts`, `src/sim/weapons.ts`, `tests/player*.test.ts`, `tests/weapons*.test.ts`, `tests/run*.test.ts` | `Game` |

### Cards & combat API (`src/sim/cards/index.ts`)
```ts
CARDS: CardDef[]; getCard(id): CardDef | undefined
class CardState { ranks: Map<string, number>; pact: MainWeaponId | null; equipped: MainWeaponId[];
  rank(id); owns(id); add(id): number /* new rank */; isInactive(id): boolean; activeIds(): string[] }
computeWeaponStats(def: WeaponDef, state: CardState): WeaponStats
computePlayerStats(base: PlayerStats, state: CardState): PlayerStats
class CardRuntime { constructor(state: CardState, stats: (w: WeaponId) => WeaponStats)
  shotShape(w: WeaponId): ShotShape; onReloadComplete(w: WeaponId): void; onSwap(): void
  resolveShot(trace: ShotTrace, world: CombatWorld): ShotOutcome
  cascadeCounter(): { count: number; of: number } | null; coldChamberReady(): boolean | null }
interface ShotOutcome { damage: DamageEvent[]; tracerEnds: Vec3[]; kills: number }
class DraftSystem { constructor(rng: Rng)
  open(rewardIndex: number, ctx: DraftContext): DraftOffer
  reroll(offerId, ctx): { offer: DraftOffer; cost: number } | { error: string }
  pick(offerId, index, ctx): PickResult | { error: string }   // applies card rank to ctx.state exactly once
  skip(offerId, ctx): { salvage: number } | { error: string } }
interface DraftContext { state: CardState; salvage: number; depth: number }
interface PickResult { option: DraftOption; newRank?: number; pact?: MainWeaponId; supply?: SupplyKind }
cardView(id, state, nextRank?): CardView; ownedCardViews(state): OwnedCardView[]; supplyView(kind): CardView
```
Reward schedule: index 0 deployment, 1 after the Conveyor Yard (pact per equipped main + flexible), 2 after the Slag Fields, 3 after the relay approach. After a pact, rewards 2 and 3 each guarantee one eligible pact upgrade while that pool has candidates.

### Enemies & director API
```ts
// src/sim/enemies/index.ts
interface PlayerTarget { pos: Vec3; vel: Vec3; alive: boolean; hurt(amount: number, from: Vec3): void }
class EnemyManager { constructor(level: LevelDef, phys: PhysicsQueries, rng: Rng, emit: (e: GameEvent) => void)
  spawn(kind: EnemyKind, pos: Vec3, laneId?: string): number
  step(dt: number, time: number, player: PlayerTarget): void
  info(id): EnemyInfo | undefined; inRadius(center, r): EnemyInfo[]
  applyDamage(id, amount, point, origin: DamageOrigin): { killed: boolean; armorBreak: boolean } | null
  push(id, dir, strength); stagger(id, seconds); setIonized(id, until)
  raycast(origin: Vec3, dir: Vec3, maxDist: number, maxHits: number): RayEnemyHit[]
  liveCount(): number; renderStates(alpha: number): EnemyRenderState[]; setGateOpen(id, open); clear() }
// src/sim/director.ts
class Director { constructor(level: LevelDef, enemies: EnemyManager, rng: Rng, emit)
  startArena(id: string): void; step(dt: number, time: number, playerPos: Vec3): void
  readonly status: { arena: string | null; wave: number; waves: number; live: number; queued: number; cleared: string[] }
  isCleared(id: string): boolean; reset(): void }
```

### Render API (`src/render/index.ts`)
```ts
class GameRenderer { constructor(canvas: HTMLCanvasElement)
  load(onProgress: (f: number, label: string) => void): Promise<void>
  buildLevel(level: LevelDef): void; resetRun(): void
  applySettings(s: Settings): void; resize(w: number, h: number): void
  handleEvents(events: readonly GameEvent[]): void; render(frame: RenderFrame, dt: number): void
  stats(): { drawCalls: number; triangles: number } }
```
Two-pass: `autoClear = false`; `clear()`, world scene + world camera, `clearDepth()`, viewmodel scene + viewmodel camera (own FOV). Both aspects updated on resize.

### UI API (`src/ui/index.ts`)
```ts
class Ui { constructor(root: HTMLElement, actions: UiActions)
  showLoading(frac, label); showMenu(profile: Profile); showPause(seed: string, settings: Settings)
  showClickToResume(); showDraft(view: DraftView); hideDraft(); showResults(view: ResultsView)
  setHudVisible(v: boolean); updateHud(m: HudModel); updateDebug(m: DebugModel | null)
  toggleInspect(cards: OwnedCardView[] | null); banner(text: string, kind: 'wave' | 'clear' | 'objective' | 'warn')
  subtitle(speaker, text, seconds); hideOverlays(); readonly overlayOpen: boolean }
loadProfile(): Profile; saveProfile(p: Profile): void; defaultSettings(): Settings
```

### Audio API (`src/audio/index.ts`)
`createAudioSystem(): AudioSystem` (see `src/audio/types.ts`).
