import type { AssetEntry } from './assetTypes';

/**
 * Shipped assets. Provenance: docs/ASSETS.md. Files copied unmodified from
 * felixarvid2/Ashfall @ 7c2b0a6 (public/assets) unless noted. Ashfall models
 * use EXT_meshopt_compression + EXT_texture_webp + KHR_mesh_quantization, and
 * their LOD files carry no images (share textures from LOD0).
 */
const lods = (file: string): string[] => [file.replace('.glb', '_lod1.glb'), file.replace('.glb', '_lod2.glb')];
const model = (id: string, file: string, heightMeters: number): AssetEntry => ({
  id,
  file,
  lods: lods(file),
  kind: 'model',
  heightMeters,
  meshopt: true,
});

export const ASSETS: Record<string, AssetEntry> = {
  'env.smokestack': model('env.smokestack', 'environment/smokestack.glb', 16),
  'env.pipe_cluster': model('env.pipe_cluster', 'environment/pipe_cluster.glb', 3),
  'env.catwalk': model('env.catwalk', 'environment/catwalk.glb', 4),
  'env.ammo_box': { ...model('env.ammo_box', 'environment/ammo_box.glb', 0.45) },
  'prop.giant_crane': model('prop.giant_crane', 'props/giant_crane.glb', 35),
  'prop.the_pillar': model('prop.the_pillar', 'props/the_pillar.glb', 70),
  'prop.fuel_tank': model('prop.fuel_tank', 'props/fuel_tank.glb', 2.2),
  'prop.signal_tower': model('prop.signal_tower', 'props/signal_tower.glb', 9),
  'prop.vent': model('prop.vent', 'props/vent.glb', 0.4),
  'prop.refinery_silhouette': model('prop.refinery_silhouette', 'props/refinery_silhouette.glb', 45),
  'prop.cargo_crate': model('prop.cargo_crate', 'props/cargo_crate.glb', 1.1),
  'prop.barricade': model('prop.barricade', 'props/barricade.glb', 1.3),
  'prop.supply_chest': model('prop.supply_chest', 'props/supply_chest.glb', 0.9),

  'enemy.walker': {
    id: 'enemy.walker',
    file: 'enemies/infected_colonist.glb',
    kind: 'skinned',
    heightMeters: 1.75,
    meshopt: true,
    clips: { idle: 'idle', walk: 'walk', run: 'walk', attack: 'attack', hit: 'hit', death: 'death' },
  },
  'enemy.hound': {
    id: 'enemy.hound',
    file: 'enemies/quad_shell.glb',
    kind: 'skinned',
    heightMeters: 1.5,
    meshopt: true,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', hit: 'Hit', death: 'TurnOff' },
  },
  'enemy.drone': {
    id: 'enemy.drone',
    file: 'enemies/eye_drone.glb',
    kind: 'skinned',
    heightMeters: 1,
    meshopt: true,
    clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', attack: 'Attack', hit: 'Hit' },
  },
  'enemy.loader': { ...model('enemy.loader', 'enemies/cargo_loader.glb', 3.2) },

  // New for SLAGWIRE: Meshy Text-to-3D (see assets-src/weapons/PROVENANCE.md).
  // Not meshopt-compressed; muzzle points along -X, +Y up, ~1.9 m long as exported.
  'weapon.coil_carbine': { id: 'weapon.coil_carbine', file: 'weapons/coil_carbine.glb', kind: 'model', forward: '-x' },
  'weapon.arc_scattergun': { id: 'weapon.arc_scattergun', file: 'weapons/arc_scattergun.glb', kind: 'model', forward: '-x' },

  'tex.slag': { id: 'tex.slag', file: 'textures/ground/slag_ground.webp', kind: 'texture' },
  'tex.cooling_slag': { id: 'tex.cooling_slag', file: 'textures/ground/cooling_slag.webp', kind: 'texture' },
  'tex.grit': { id: 'tex.grit', file: 'textures/ground/industrial_grit.webp', kind: 'texture' },
  'tex.steel_grating': { id: 'tex.steel_grating', file: 'textures/ground/steel_grating.webp', kind: 'texture' },
  'tex.steel_plating': { id: 'tex.steel_plating', file: 'textures/ground/steel_plating.webp', kind: 'texture' },
  'tex.concrete': { id: 'tex.concrete', file: 'textures/ground/military_concrete.webp', kind: 'texture' },
  'tex.lumen': { id: 'tex.lumen', file: 'textures/ground/lumen_infested.webp', kind: 'texture' },
  'tex.scorched': { id: 'tex.scorched', file: 'textures/ground/scorched_ground.webp', kind: 'texture' },

  'audio.amb.industrial': { id: 'audio.amb.industrial', file: 'audio/amb/industrial.ogg', kind: 'audio' },
  'audio.music.refinery': { id: 'audio.music.refinery', file: 'audio/music/refinery_district.ogg', kind: 'audio' },
};
