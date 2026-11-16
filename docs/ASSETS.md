# Shipped asset provenance

Source repo: `felixarvid2/Ashfall` at commit `7c2b0a6612c1009771d298dac04f8aad21a66b3a` (read-only clone). Most files under `public/assets/` were copied from its `public/assets/` byte-for-byte; the copies were spot-checked with `cmp` and are identical. Ashfall's models, textures and audio are unmodified outputs of Ashfall's optimizer (Meshopt-compressed GLB, WebP textures, LOD files built from LOD0 with no embedded images). The exceptions are the two weapon models, which were generated for SLAGWIRE (see Weapons). "Role" is the in-game use in SLAGWIRE where the code shows one; otherwise it is the Ashfall role, marked as such.

## Environment and props

Each LOD file (`_lod1`, `_lod2`) is shipped alongside its base file and has the same source, task and licence as the base.

| Shipped path | Source path / commit or generation task | Creator / generator | Licence | Modifications | Attribution required | Role |
|---|---|---|---|---|---|---|
| `environment/smokestack.glb` (+ `_lod1`, `_lod2`) | Ashfall `public/assets/environment/smokestack.glb` @ 7c2b0a6. Meshy preview `01a1008f-35c5-756c-afa4-f8e2f582decf`, refine `01a10170-6d75-73aa-91bc-7630b83a57b3` (30 credits, manifest total) | Meshy AI (text-to-3D, prompt by Ashfall) | Meshy terms, plan-dependent (see Licence notes) | None in SLAGWIRE. Ashfall optimizer: 2K PBR textures to 1024 px WebP, Meshopt, LODs | Not recorded | Ashfall: Refinery District stack (`env.smokestack`). SLAGWIRE: registered in `src/content/assets.ts` only |
| `environment/pipe_cluster.glb` (+ LODs) | Ashfall `environment/pipe_cluster.glb`. Meshy preview `01a1008f-3762-729f-acad-9403d388e496`, refine `01a10170-6f39-7381-bbec-8d589c3998fa` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: Refinery pipes (`env.pipe_cluster`). SLAGWIRE: registered only |
| `environment/catwalk.glb` (+ LODs) | Ashfall `environment/catwalk.glb`. Meshy preview `01a1008f-3742-73ec-9393-ddcc1844509c`, refine `01a10170-6f2a-7632-bdea-717b9d1c1de7` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: raised walkway (`env.catwalk`). SLAGWIRE: registered only |
| `environment/ammo_box.glb` (+ LODs) | Ashfall `environment/ammo_box.glb` (manifest `source: external`, credit "Poly Haven ammo_box (CC0)") | Poly Haven (author not recorded in Ashfall) | CC0 | Ashfall optimizer only | No | Ashfall: scatter prop in Refinery, Cinder Flats and Deep Mines (`env.ammo_box`). SLAGWIRE: registered only |
| `props/the_pillar.glb` (+ LODs) | Ashfall `props/the_pillar.glb`. Meshy preview `01a10090-4942-7519-82f9-70cd6107a08a`, refine `01a10171-9169-72fe-a936-a4f17347137a` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: 70 m landmark smokestack, "The Pillar". SLAGWIRE: registered only |
| `props/giant_crane.glb` (+ LODs) | Ashfall `props/giant_crane.glb`. Meshy preview `01a10090-4b92-70ec-af20-5fe506a835ef`, refine `01a10171-a03c-743c-aff5-73463330716b` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: 35 m gantry crane over the Slag Fields (landmark). SLAGWIRE: registered only |
| `props/fuel_tank.glb` (+ LODs) | Ashfall `props/fuel_tank.glb`. Meshy preview `01a0fcb4-2795-7002-83d2-356866650c17`, refine `01a0fcc7-0f9d-721b-b283-c8d257f1320d` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: decor. SLAGWIRE: used by `src/content/levelTypes.ts` (`prop.fuel_tank`) |
| `props/signal_tower.glb` (+ LODs) | Ashfall `props/signal_tower.glb`. Meshy preview `01a0fe88-6622-741d-8f9a-ec894e7adc31`, refine `01a0fe90-4663-733f-99c4-567cf3b521bd` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: 9 m radio tower prop. SLAGWIRE: registered only |
| `props/refinery_silhouette.glb` (+ LODs) | Ashfall `props/refinery_silhouette.glb`. Meshy preview `01a0fe87-0ab6-7418-a086-e5cd3c8aac69`, refine `01a0fe8f-674c-73fa-9197-23f5ac563782` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: 45 m distant backdrop. SLAGWIRE: registered only |
| `props/cargo_crate.glb` (+ LODs) | Ashfall `props/cargo_crate.glb`. Meshy preview `01a0fcc7-d48d-752d-a693-c650ab7a7915`, refine `01a0fccc-7e0c-7192-864e-6aed49b9beaa` (50 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: decor and cover. SLAGWIRE: registered only |
| `props/barricade.glb` (+ LODs) | Ashfall `props/barricade.glb`. Meshy preview `01a0fcb3-b210-746f-b316-d151664d5445`, refine `01a0fcc6-e747-70cc-a618-e6d5b52752ca` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: cover prop. SLAGWIRE: registered only |
| `props/supply_chest.glb` (+ LODs) | Ashfall `props/supply_chest.glb`. Meshy preview `01a0fe88-6bc2-77b3-b39e-0382188ab48f`, refine `01a0fe90-9b7d-7602-8377-ed276d44566d` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: decor. SLAGWIRE: registered only |
| `props/vent.glb` (+ LODs) | Ashfall `props/vent.glb`. Meshy preview `01a10090-7dc0-75a4-9406-a28ff83e99a0`, refine `01a10171-b4a0-70b2-b649-55a06e958a12` (30 credits) | Meshy AI (text-to-3D) | Meshy terms, plan-dependent | As above | Not recorded | Ashfall: floor vent grate (the hazard is code-driven, 1.5 s warning). SLAGWIRE: registered only |

## Enemies

| Shipped path | Source path / commit or generation task | Creator / generator | Licence | Modifications | Attribution required | Role |
|---|---|---|---|---|---|---|
| `enemies/infected_colonist.glb` | Ashfall `enemies/infected_colonist.glb` (manifest `source: image`). Concept image step per Ashfall decision 2026-10-02 (`nano-banana-2`; per-asset concept not recorded). Meshy image-to-3D preview `01a0fcca-835e-761b-89f8-68669002d3b6`, refine `01a0fcce-2f81-700e-b27d-5cad384e35b3`, rig `01a0fcd0-fa12-7357-b2d0-58986ce40ab4`, animation `01a0fcd1-963c-72d4-90b0-111246cb4c85` (96 credits total). Clips: idle, walk, attack, hit, death | Meshy AI (rig and animation by Meshy); concept image generator per Ashfall decision | Meshy terms, plan-dependent | Ashfall optimizer only; no LODs | Not recorded | Scorched Walker (`enemy.walker`; Ashfall's Ash Walker re-coloured for the Refinery District) |
| `enemies/quad_shell.glb` | Ashfall `enemies/quad_shell.glb`; Quaternius Sci-Fi Essentials Kit, `Enemy_QuadShell` (manifest credit "Quaternius Sci-Fi Essentials Kit Enemy_QuadShell (CC0)") | Quaternius | CC0 | Ashfall optimizer only; no LODs. Clips: Idle, Walk, Run, Attack, Hit, TurnOff (death) | No | Slag Hound (`enemy.hound`) |
| `enemies/eye_drone.glb` | Ashfall `enemies/eye_drone.glb`; Quaternius Sci-Fi Essentials Kit, `Enemy_EyeDrone` (manifest credit "Quaternius Sci-Fi Essentials Kit Enemy_EyeDrone (CC0)") | Quaternius | CC0 | Ashfall optimizer only; no LODs. Clips: Idle, Attack, Hit | No | Flame Drone (`enemy.drone`). Ashfall also uses this model for its rust and governor drone variants |
| `enemies/cargo_loader.glb` (+ `_lod1`, `_lod2`) | Ashfall `enemies/cargo_loader.glb`. Meshy text-to-3D preview `01a10091-42b2-7049-8598-47a7814f49ed`, refine `01a10172-94f8-730a-a2ee-f9d4a47f70c0` (30 credits). No clips (procedural animation) | Meshy AI (text-to-3D, prompt by Ashfall) | Meshy terms, plan-dependent | Ashfall optimizer: Meshopt, WebP, LODs | Not recorded | Cargo Loader, boss-scale role (`enemy.loader`). Ashfall: Heavy enemy in the Refinery District; base of Foreman Krell (Smelter 3 boss) and of the Warden in the Hydroponic Vaults |

## Weapons (new)

These two models were not copied from Ashfall. They were generated for SLAGWIRE and are not Meshopt-compressed. Full details are in `assets-src/weapons/PROVENANCE.md`.

| Shipped path | Source path / commit or generation task | Creator / generator | Licence | Modifications | Attribution required | Role |
|---|---|---|---|---|---|---|
| `weapons/coil_carbine.glb` | Meshy text-to-3D (v2). Preview `01a1e43a-d457-7293-9354-ef2a33e24684`, refine `01a1e43c-1a90-737a-8fdd-97e7f1356bb8`. Raw download `assets-src/weapons/coil_carbine_meshy_raw.glb`. No concept image (fal.ai failed) | Meshy AI (prompt written for SLAGWIRE) | Meshy terms, plan-dependent | Textures resized to 1024 px and converted to WebP (gltf-transform). No geometry, orientation or scale edits. Requires `EXT_texture_webp` | Not recorded | Coil Carbine (`weapon.coil_carbine`) |
| `weapons/arc_scattergun.glb` | Meshy text-to-3D (v2). Preview `01a1e43a-f67f-7663-87a1-c86e6a014f5c`, refine `01a1e43c-1b6e-7674-be5c-9be16fc98345`. Raw download `assets-src/weapons/arc_scattergun_meshy_raw.glb`. No concept image | Meshy AI (prompt written for SLAGWIRE) | Meshy terms, plan-dependent | As above | Not recorded | Arc Scattergun (`weapon.arc_scattergun`) |

Credit cost for these two tasks is not recorded in `PROVENANCE.md`.

## Textures

All eight are seamless ground textures from Ashfall `public/assets/textures/ground/` @ 7c2b0a6. The commit's `docs/decisions.md` (2026-10-03) says they were "generated outside Meshy". No generator, prompt or licence is recorded for them in the repo. Ashfall's `scripts/art/catalog.ts` does not list them, and its `docs/credits.md` does not credit them.

| Shipped path | Source path / commit or generation task | Creator / generator | Licence | Modifications | Attribution required | Role |
|---|---|---|---|---|---|---|
| `textures/ground/slag_ground.webp` | Ashfall `textures/ground/slag_ground.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: slag crust, Slag Fields base layer. SLAGWIRE: `tex.slag` |
| `textures/ground/cooling_slag.webp` | Ashfall `textures/ground/cooling_slag.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: half-cooled glowing crust around molten metal. SLAGWIRE: `tex.cooling_slag` |
| `textures/ground/industrial_grit.webp` | Ashfall `textures/ground/industrial_grit.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: Refinery District base (grit). SLAGWIRE: `tex.grit` |
| `textures/ground/steel_plating.webp` | Ashfall `textures/ground/steel_plating.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: belts and hubs layer (Refinery District). SLAGWIRE: `tex.steel_plating` |
| `textures/ground/steel_grating.webp` | Ashfall `textures/ground/steel_grating.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: interior floor in `instances.ts` and the Deep Mines layer. SLAGWIRE: `tex.steel_grating` |
| `textures/ground/military_concrete.webp` | Ashfall `textures/ground/military_concrete.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: Cinder Flats patches. SLAGWIRE: `tex.concrete` |
| `textures/ground/lumen_infested.webp` | Ashfall `textures/ground/lumen_infested.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: Lumen-infested ground patches (Cinder Flats). SLAGWIRE: `tex.lumen` |
| `textures/ground/scorched_ground.webp` | Ashfall `textures/ground/scorched_ground.webp` | Not recorded (outside Meshy) | Not recorded (verify) | None | Not recorded (verify) | Ashfall: scorched earth patches (Cinder Flats). SLAGWIRE: `tex.scorched` |

Ashfall ships 25 ground textures. SLAGWIRE ships these eight, and the other Ashfall textures are not shipped.

## Audio

| Shipped path | Source path / commit or generation task | Creator / generator | Licence | Modifications | Attribution required | Role |
|---|---|---|---|---|---|---|
| `audio/amb/industrial.ogg`, `audio/amb/industrial.mp3` | Ashfall `scripts/audio/build.ts`, `amb.industrial` = Kenney Sci-Fi Sounds `spaceEngineLarge_000.ogg`. Built into a looped ambience (crossfaded passes, -24 dBFS RMS). Research summary gives a 27.49 s loop | Kenney (Sci-Fi Sounds) | CC0 | Ashfall build: loop, re-encoded to OGG and MP3 | No | Industrial ambience loop (`audio.amb.industrial`). The MP3 is not referenced by `src/` |
| `audio/music/refinery_district.ogg` | Ashfall `scripts/audio/build.ts`, `music.refinery_district` = Abstraction "Week 20.1 - Magnetic Tape SCUFFED" | Abstraction (Ben Burnes), Music Loop Bundle | CC0 | Ashfall build: stereo loop, normalised to -16 LUFS, -1.5 dBTP; length untouched | Not required (credit to "Abstraction" appreciated) | Refinery District music (`audio.music.refinery`) |

Ashfall also ships `audio/sfx.mp3`. It is not copied to SLAGWIRE.

## Fonts

| Shipped path | Source path / commit or generation task | Creator / generator | Licence | Modifications | Attribution required | Role |
|---|---|---|---|---|---|---|
| `fonts/rajdhani-500.woff2`, `fonts/rajdhani-600.woff2`, `fonts/rajdhani-700.woff2` | Ashfall `public/assets/fonts/` (Rajdhani, via Google Fonts per Ashfall `docs/credits.md`) | Indian Type Foundry (Copyright 2014) | SIL Open Font License 1.1 | Ashfall copy, unmodified. Not recorded whether subsetting was applied upstream | Yes: keep `fonts/OFL-Rajdhani.txt` with the files | UI font, weights 500/600/700 |
| `fonts/share-tech-mono-400.woff2` | Ashfall `public/assets/fonts/` (Share Tech Mono, via Google Fonts per Ashfall `docs/credits.md`) | Carrois Type Design (Copyright 2012) | SIL Open Font License 1.1 | Ashfall copy, unmodified | Yes: keep `fonts/OFL-ShareTechMono.txt` with the file | UI monospace font, weight 400 |

The two OFL licence files are shipped alongside the fonts: `public/assets/fonts/OFL-Rajdhani.txt` and `public/assets/fonts/OFL-ShareTechMono.txt`. Both are byte-identical to Ashfall's.

## Licence notes

**CC0 items.** These need no attribution, but Ashfall credits them anyway. Quaternius `quad_shell.glb` and `eye_drone.glb` (Sci-Fi Essentials Kit, CC0 1.0 per Ashfall `docs/credits.md`). Poly Haven `ammo_box` (CC0). Kenney `amb/industrial` (CC0). Abstraction `refinery_district.ogg` (CC0; credit appreciated, not required). Ashfall keeps the pack licence files in its gitignored `assets-src/third-party/`; they are not in this repo.

**Meshy-generated items.** These are the 12 environment and prop models, `cargo_loader`, `infected_colonist`, and the two weapons. Ownership of Meshy outputs depends on the plan the account was on when the tasks ran, under Meshy's terms. Neither the Ashfall nor the SLAGWIRE repo records which plan that was. Meshy's own explanation of commercial use is at https://help.meshy.ai/en/articles/9992001-can-i-use-meshy-assets-commercially-license-copyright-explained. That page was not re-read for this document. `assets-src/weapons/PROVENANCE.md` says to "confirm plan/terms before shipping". That confirmation is still open.

**Ground textures with no recorded licence (verify).** All eight files in `textures/ground/`. Ashfall's `docs/decisions.md` (2026-10-03) says they were generated outside Meshy. The generator, prompt, licence and any credit are not recorded. Either confirm the source and terms before release, or replace them.

**OFL fonts.** Rajdhani (Indian Type Foundry) and Share Tech Mono (Carrois Type Design) are under SIL OFL 1.1. The licence files are shipped as `public/assets/fonts/OFL-Rajdhani.txt` and `public/assets/fonts/OFL-ShareTechMono.txt`. Keep these with the font files.

## Placeholders and procedural elements

- **Service Emitter viewmodel.** No model is shipped. `weapons/` holds only the Coil Carbine and the Arc Scattergun. The emitter is code-generated.
- **Pickups.** No pickup model or sprite is shipped. They are code-generated.
- **Sign boards.** No sign-board files are shipped. They are code-generated.
- **FX.** No particle or effect sprite is shipped in this set. Effects are code-generated.
- **Sound effects.** All weapon, enemy, player, UI and pickup sounds are synthesized at runtime with the Web Audio API (`src/audio/`). Only the industrial ambience and the refinery music track are sample files.
- **Ambience and refinery music.** Both are sample-based, as described above.
