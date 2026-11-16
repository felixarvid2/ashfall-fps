# Integration notes (from module workers)

## Cards & combat (src/sim/cards)
- `new CardRuntime(state, w => computeWeaponStats(WEAPONS[w], state))`.
- Per trigger pull: `shotShape(w)` before tracing, then ALWAYS `resolveShot(trace, world)` (it spends Cold Chamber when `trace.slug`). Call `onReloadComplete(w)` when a reload completes.
- `PickResult = { option, newRank?, pact?, supply?, heal?, salvage?, ammoFraction? }`. `heal` = Reactive Liner 20 or Health Kit 40; Salvage Cache gives 30; Reserve Ammo refills `ammoFraction` (0.5) of reserve capacity.
- `reroll()` returns `{ offer, cost: 20 }` and does NOT deduct salvage — caller deducts. `skip()` returns `{ salvage: 10 }` — caller adds. Errors: `stale_offer`, `no_rerolls_left`, `not_enough_salvage`, `no_alternative_offer`.
- Pact pick sets `state.equipped` to the pledged weapon only. Call `state.equip('arc_scattergun')` when the rack weapon is picked up.
- No pact cards at reward 0; reward 1 offers one pact per equipped main.
- Heavy enemies hit by Repulsion get an `enemy_hit` with amount 0 instead of a push.
- `ShotOutcome.kills` counts direct + secondary kills.
- `cardView(id, state)` for offers, `ownedCardViews(state)` for inspect; `applyDebugLoadout(state, key)`; `DraftSystem.currentOffer()`.
- `src/sim/cards/fakeWorld.ts` exports a test FakeWorld + `straightTrace`.

## Audio (src/audio)
- `createAudioSystem()`; sounds pre-render on first `resume()`. A play before its render finishes is skipped once.
- `stopAll()` also stops ambience → call `startAmbience()` again after restart.

## UI (src/ui, src/profile)
- `ui.overlayOpen` true for loading/menu/pause/click-to-resume/draft/results → the game ignores its own input then. Inspect (Tab) is non-modal: `ui.inspectOpen`.
- Release pointer lock BEFORE `showDraft`/`showResults`/`showPause`/`showMenu`.
- Construct `Ui` before registering game window capture-phase listeners (draft swallows the confirming keyup/click at window capture).
- `settingsChanged` only notifies; the game persists with `saveProfile`. `recordRunEnd(profile, outcome, timeSec)` mutates the profile and returns newly unlocked names (Arc Scattergun on first extraction).
- If the game rejects a pick, call `showDraft` again. Ui does not handle Esc on the pause screen itself (game handles Esc → resume).
- Draft keys: 1/2/3, ←/→ (A/D) + Enter/Space, R reroll, S skip; Esc/Tab inert; 250 ms input guard; one action per `showDraft`.
- Results keys: R/Enter same seed, N new seed, M menu.

## Enemies, director, level
- EnemyManager emits enemy_spawn/hit/die/tell/attack/boss_phase itself; Director emits wave_warn/wave_start/encounter_clear and opens arena gates on clear (`setGateOpen` matches gate id or `gateOpensAfter`). The run must not duplicate them.
- Loader adds: manager queues call requests at 66%/33%; Director drains them in `step`.
- `renderStates().fade` 0→1 after death (alpha = 1 − fade); `pos` is model base; drones hover 3–5 m.
- Ramp convention: positive pitch raises the local −Z end; yaw applied outside pitch. Physics + render must match.
- Prop collider `offset` is relative to a ground-based `pos`.
- Layout: start (0,0,126); yard centre (0,0,65); rack (−12,0,97); slag centre (0,0,−45); approach (0,0,−143); relay (0,3,−226.5); extraction (0,0,−258); The Pillar (0,0,−310).

## Render (src/render)
- `camera.fov` in RenderFrame = HORIZONTAL degrees (converted per aspect); 0 → settings.fov.
- Prop/enemy/pickup/cache `pos` = base on the ground. Enemy yaw 0 faces −Z.
- `frame.gatesOpen` keyed by box.id, then gateOpensAfter, then gateClosesOn; gateOpensAfter defaults closed, gateClosesOn defaults open.
- Caches draw only when `available || open`. Loader `clawYaw` is body-relative.
- Extras: `renderer.debug`, `dispose()`. Dev page: render-test.html (?manual, window.dev).
- Open: Service Emitter barely visible (MUZZLE_OFFSET y), carbine renders bright, no hands.
