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
