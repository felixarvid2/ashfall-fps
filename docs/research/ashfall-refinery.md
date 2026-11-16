# ASHFALL reference notes (Refinery District)

Source: felixarvid2/Ashfall @ 7c2b0a6612c1009771d298dac04f8aad21a66b3a (read-only).

## Lore
- Kharos IV, mining colony Ashfall. The Lumen — a sleeping alien biosphere woken by deep mining — spreads by spores and infects organisms and machinery. A year after the fall the ash from burning refineries covers the sky.
- Refinery District subzones: The Conveyor Lines (W), The Slag Fields (E), The Smelters' Cathedral (NE), The Smokestack Forest (NW); hub The Coolant Works; Pump Station Delta.
- Landmarks: **The Pillar** (largest smokestack, column of fire, centre north), **the giant crane** over the Slag Fields, the Cathedral's burning windows.
- Hazards: vents (1.5 s warning), molten metal, moving belts.
- Mood: "Heat, alarms, screaming metal, a constant rumble. Orange light from the smelters against black smoke." Palette: grey, black, rust-brown, sickly green Lumen accents, warm orange fire/emergency light.
- Zone render values (src/data/zones/refineryDistrict.ts): ambient #6a5248 (0.62), fog #1c1410 density 0.021, moon #c09070, embers #ff5a1a, lamps #ff7a1a. slag_ground and cooling_slag glow orange.
- The Smelters believe fire purifies infection. Quotable environment text (src/data/lang/en.json "rd" block):
  - "DO NOT open valve 6. Whatever comes out of the slag line is not coolant anymore. — M."
  - "The Lumen is rot. The rot spreads through the flesh. Only the furnace makes the flesh pure."
  - "Line 5 running backwards since Tuesday, nobody knows why."

## Assets selected (all in public/assets, Meshopt-compressed GLB + WebP)
| id | file | height m | notes |
|---|---|---|---|
| env.smokestack | environment/smokestack.glb | 16 | Meshy text-to-3D refine 01a10170-6d75-73aa-91bc-7630b83a57b3 |
| env.pipe_cluster | environment/pipe_cluster.glb | 3 | Meshy 01a10170-6f39-7381-bbec-8d589c3998fa |
| env.catwalk | environment/catwalk.glb | 4 | Meshy 01a10170-6f2a-7632-bdea-717b9d1c1de7 |
| prop.giant_crane | props/giant_crane.glb | 35 | Meshy 01a10171-a03c-743c-aff5-73463330716b |
| prop.the_pillar | props/the_pillar.glb | 70 | Meshy 01a10171-9169-72fe-a936-a4f17347137a |
| prop.fuel_tank | props/fuel_tank.glb | 2.2 | Meshy 01a0fcc7-0f9d-721b-b283-c8d257f1320d |
| prop.signal_tower | props/signal_tower.glb | 9 | Meshy 01a0fe90-4663-733f-99c4-567cf3b521bd |
| prop.vent | props/vent.glb | 0.4 | Meshy 01a10171-b4a0-70b2-b649-55a06e958a12 |
| prop.refinery_silhouette | props/refinery_silhouette.glb | 45 | Meshy 01a0fe8f-674c-73fa-9197-23f5ac563782 |
| prop.cargo_crate | props/cargo_crate.glb | 1.1 | Meshy 01a0fccc-7e0c-7192-864e-6aed49b9beaa |
| prop.barricade | props/barricade.glb | 1.3 | Meshy 01a0fcc6-e747-70cc-a618-e6d5b52752ca |
| prop.supply_chest | props/supply_chest.glb | 0.9 | Meshy 01a0fe90-9b7d-7602-8377-ed276d44566d |
| env.ammo_box | environment/ammo_box.glb | ? | Poly Haven, CC0 |
| enemy.infected_colonist | enemies/infected_colonist.glb | 1.75 | skinned, clips idle/walk/attack/hit/death; Meshy image-to-3D 01a0fcce-…, rig 01a0fcd0-…, anim 01a0fcd1-… |
| enemy.quad_shell | enemies/quad_shell.glb | 1.5 | Quaternius Sci-Fi Essentials (CC0); clips Idle/Walk/Run/Attack/Hit/TurnOff(death) |
| enemy.eye_drone | enemies/eye_drone.glb | 1 | Quaternius (CC0); clips Idle/Attack/Hit, no death |
| enemy.cargo_loader | enemies/cargo_loader.glb | 3.2 | Meshy text-to-3D 01a10172-94f8-730a-a2ee-f9d4a47f70c0; no clips (procedural animation) |
| textures/ground/{slag_ground,cooling_slag,industrial_grit}.webp | | | generated outside Meshy (Ashfall docs/decisions.md 2026-10-03); no licence record |
| audio/amb/industrial.ogg | | | Kenney spaceEngineLarge_000 (CC0), 27.49 s loop |
| audio/music/refinery_district.ogg | | | Abstraction "Week 20.1 - Magnetic Tape SCUFFED" (CC0) |
| audio/sfx.ogg | | | Kenney Sci-Fi Sounds sprite (CC0); key map in Ashfall src/audio/catalog.gen.ts |

## Loader (Ashfall src/render/assets.ts)
```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
loader.setMeshoptDecoder((await import('three/examples/jsm/libs/meshopt_decoder.module.js')).MeshoptDecoder);
```
URLs are `${import.meta.env.BASE_URL}assets/${file}`; LOD files carry no images — `shareLodTextures()` copies map/normal/metalness/roughness/emissive/ao from LOD0 by material name/index.
