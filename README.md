# ASHFALL: SLAGWIRE

A first-person horde-shooter roguelite set in the Refinery District of **Kharos IV**, part of the ASHFALL universe. You play a recovery-team operator following a signal into the refinery. Reach a compromised relay, cut its uplink before the Lumen uses it to reach orbit, and get out. Between fights you draft cards that change your weapons. You can also swear a **Weapon Pact** that commits you to one gun and opens its exclusive upgrade pool.

*Working title in the brief was "BLACK SIGNAL". That name is already used by three released games (ERMedia 2025, Dualbooted 2025, ConOps21), so the slice ships as **SLAGWIRE**. Searches found no game by that name.*

Stack: Vite 8, TypeScript 7, Three.js 0.186, `@dimforge/rapier3d-compat` 0.21, Web Audio, HTML/CSS UI. Targets desktop Firefox and Chromium on Linux with keyboard and mouse. The production build runs fully offline from a local static server.

## Install and run

```bash
npm ci
```

```bash
npm run dev
```

Open http://localhost:5173/

Checks and production build:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run preview
```

Open http://localhost:4173/ (or serve `dist/` with any static server — the build uses relative URLs).

## Controls

| Action | Key |
|---|---|
| Move / look | WASD / mouse |
| Fire | Left click |
| Reload | R |
| Jump / Dash | Space / Left Shift |
| Main weapons / Service Emitter | 1, 2 / Q |
| Interact (rack, cache, relay) | E |
| Inspect cards | Tab |
| Pause | Esc |
| Debug overlay | F3 |
| Draft | 1/2/3 or ←/→ + Enter, R reroll, S skip |

The Settings menu has mouse sensitivity, invert Y, FOV, master/SFX/ambience volume, camera bob, screen shake, flash intensity, render scale and the debug overlay. Settings and unlocks are saved in `localStorage` (`slagwire.profile.v1`), separately from run state.

## The run

1. **Deployment.** You start with the Coil Carbine and a deployment draft (one of three cards). Once you have extracted at least once, the Arc Scattergun can be your starter instead. You can enter a seed manually in the run setup. The seed is shown on the pause and results screens.
2. **Conveyor Loading Yard.** The Arc Scattergun hangs on a weapon rack before the fight. The encounter block runs in waves: a slow pack from the main gate, pressure on the outer lane, then hounds and drones. Clearing it opens a supply cache. That draft offers a pact for each equipped main weapon.
3. **Slag Fields.** A larger field with staggered lanes, an exposed shortcut under the giant crane, and vents that warn before they erupt. Mixed charging groups, hounds and drones. A draft follows.
4. **Relay approach.** A short fight, then a final supply and draft.
5. **Relay platform.** The Cargo Loader boss has two attacks: a claw sweep and an overhead slam. After each attack its glowing joint is exposed, and it calls in walkers at 66% and 33% health. Hold E at the relay to cut the uplink, then reach extraction.
6. **Results.** Shows seed, time, encounters cleared, weapons, pact, active cards and kills. You can restart with the same seed or a fresh one.

## Code map

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, damage pipeline, stat formulas and module APIs. Integration notes are in [docs/integration-notes.md](docs/integration-notes.md).

| Path | Contents |
|---|---|
| `src/sim/types.ts` | Shared simulation contracts and the `GameEvent` channel |
| `src/content/` | Weapons, cards, enemies, encounters, the Refinery level, asset registry |
| `src/sim/cards/` | Card engine, combat/damage pipeline with triggered effects, draft system |
| `src/sim/enemies/`, `src/sim/director.ts` | Horde AI with spatial hash and staggered updates; encounter director |
| `src/sim/player.ts`, `src/sim/weapons.ts` | Kinematic movement with dash; weapon state machine and shot tracing |
| `src/physics/` | Rapier world: static colliders, player capsule, ray queries |
| `src/game/` | Run ownership, fixed-step loop, game shell, frame builders, autoplay bot |
| `src/render/` | Two-pass Three.js renderer (world + viewmodel), assets, level, enemies, FX |
| `src/ui/`, `src/profile/` | HUD, menus, draft/inspect/results overlays; versioned profile |
| `src/audio/` | Procedural Web Audio SFX with voice limits, ambience |

The simulation in `src/sim`, `src/content` and `src/core` is pure TypeScript and runs under Vitest in Node.

## Dev URL flags

These are combined as query parameters, e.g. `/?seed=TEST-1&loadout=coil-cascade&skipTo=slag&autostart=1`.

| Flag | Effect |
|---|---|
| `seed=XXXX` | Fixed run seed |
| `loadout=coil-cascade` or `arc-backwash` | Debug starting cards: Ion Primer → Coil Covenant → Cascade Bus → Rupture Relay, or Quick-Swap Coupler → Arc Covenant → Ion Fan → Backwash |
| `skipTo=yard` / `slag` / `relay` | Start at that sector |
| `autostart=1` | Skip the menu |
| `nolock=1` | Treat pointer lock as granted (automation) |
| `stress=120` | 120-enemy stress encounter |
| `bot=none` / `coil` / `arc` | Autoplayer; the value is the pact path. `assist=1` adds supplies; `turbo=N` speeds it up |

## Assets

[docs/ASSETS.md](docs/ASSETS.md) records the provenance of every shipped file. Environment pieces, props, enemies, ground textures, the industrial ambience and the refinery music come unmodified from [felixarvid2/Ashfall](https://github.com/felixarvid2/Ashfall) @ `7c2b0a6`. The two weapon models were generated for this project with Meshy Text-to-3D; see [assets-src/weapons/PROVENANCE.md](assets-src/weapons/PROVENANCE.md). Card mechanics follow [felixarvid2/krypta](https://github.com/felixarvid2/krypta) @ `06e1521` (reference notes in `docs/research/`).
