import type { BoxDef, LevelDef } from '../src/content/levelTypes';

/** Minimal level: a big floor, optional extra boxes. */
export function testLevel(boxes: BoxDef[] = []): LevelDef {
  const floor: BoxDef = { pos: { x: 0, y: -0.5, z: 0 }, size: { x: 200, y: 1, z: 200 }, mat: 'concrete' };
  return {
    name: 'test',
    playerStart: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    boxes: [floor, ...boxes],
    props: [],
    landmarks: [],
    arenas: [],
    pickups: [],
    hazards: [],
    weaponRack: { pos: { x: 0, y: 0, z: 0 }, yaw: 0, weapon: 'arc_scattergun' },
    relay: { pos: { x: 0, y: 0, z: 0 }, interactRadius: 2, shutdownTime: 5, arena: 'relay' },
    extraction: { pos: { x: 0, y: 0, z: 0 }, radius: 3 },
    radio: [],
    signs: [],
    killY: -30,
    bounds: { min: { x: -100, y: -30, z: -100 }, max: { x: 100, y: 50, z: 100 } },
  };
}
