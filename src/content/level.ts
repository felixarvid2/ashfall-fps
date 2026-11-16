import type { BoxDef, HazardDef, LaneDef, LevelDef, PickupDef, PropDef, SignDef, SurfaceMat } from './levelTypes';
import type { Vec3 } from '../sim/types';

/**
 * REFINERY: the SLAGWIRE slice. One continuous route running NORTH (-Z):
 *
 *   deployment pad (z 135..100) -> Conveyor Loading Yard (70x70, z 100..30)
 *   -> connector A (z 30..0, gate 'yard') -> Slag Fields (110x90, z 0..-90)
 *   -> connector B (z -90..-120, gate 'slag') -> Relay approach (z -120..-166)
 *   -> ramp up (gate 'approach') -> Relay platform (deck y=3, z -172..-236)
 *   -> ramp down -> extraction pad (0, 0, -258).
 *
 * Conventions: box `pos` is the center, ramps are pitched boxes whose id starts
 * with "ramp" (positive pitch raises the local -Z end, yaw is applied outside
 * pitch). Collider proxy `offset` is relative to the prop `pos`, which sits on
 * the ground (so offset.y = height / 2 for a prop standing on the floor).
 * Boxes whose id starts with "floor" are ground slabs (top at the stated y).
 */

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const boxes: BoxDef[] = [];
const props: PropDef[] = [];
const landmarks: PropDef[] = [];

function box(
  id: string,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  mat: SurfaceMat,
  extra: Partial<BoxDef> = {},
): BoxDef {
  const b: BoxDef = { id, pos: V(cx, cy, cz), size: V(sx, sy, sz), mat, ...extra };
  boxes.push(b);
  return b;
}

/** Ground slab with its top face at y = 0 (or `top`). */
function floorRect(id: string, x0: number, z0: number, x1: number, z1: number, mat: SurfaceMat, top = 0): void {
  box(`floor_${id}`, (x0 + x1) / 2, top - 0.5, (z0 + z1) / 2, Math.abs(x1 - x0), 1, Math.abs(z1 - z0), mat);
}

type Gap = [number, number];

function segments(a: number, b: number, gaps: Gap[]): Gap[] {
  const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
  const out: Gap[] = [];
  let cur = a;
  for (const [g0, g1] of sorted) {
    if (g0 > cur) out.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

/** Wall running along X at fixed z, with openings. */
function wallX(id: string, z: number, x0: number, x1: number, h: number, gaps: Gap[], mat: SurfaceMat, t = 1): void {
  segments(x0, x1, gaps).forEach(([a, b], i) => box(`${id}_${i}`, (a + b) / 2, h / 2, z, b - a, h, t, mat));
}

/** Wall running along Z at fixed x, with openings. */
function wallZ(id: string, x: number, z0: number, z1: number, h: number, gaps: Gap[], mat: SurfaceMat, t = 1): void {
  segments(z0, z1, gaps).forEach(([a, b], i) => box(`${id}_${i}`, x, h / 2, (a + b) / 2, t, h, b - a, mat));
}

/** Pitched box whose TOP surface runs from (x0,y0,z0) to (x1,y1,z1). */
function ramp(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, mat: SurfaceMat): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const run = Math.hypot(dx, dz);
  const rise = y1 - y0;
  const dirx = dx / run;
  const dirz = dz / run;
  const theta = Math.atan2(rise, run);
  const len = Math.hypot(run, rise);
  const thick = 0.3;
  const nx = -dirx * Math.sin(theta);
  const ny = Math.cos(theta);
  const nz = -dirz * Math.sin(theta);
  box(
    id,
    (x0 + x1) / 2 - (nx * thick) / 2,
    (y0 + y1) / 2 - (ny * thick) / 2,
    (z0 + z1) / 2 - (nz * thick) / 2,
    width,
    thick,
    len,
    mat,
    { yaw: Math.atan2(-dirx, -dirz), pitch: theta },
  );
}

const CYL = (h: number, r: number) => ({ type: 'cylinder' as const, radius: r, height: h, offset: V(0, h / 2, 0) });
const BOXC = (sx: number, sy: number, sz: number) => ({ type: 'box' as const, size: V(sx, sy, sz), offset: V(0, sy / 2, 0) });

function tank(x: number, z: number, h: number, y = 0): void {
  props.push({ asset: 'prop.fuel_tank', pos: V(x, y, z), height: h, collider: CYL(h, h * 0.42) });
}
function crate(x: number, z: number, yaw = 0, h = 1.1, y = 0): void {
  props.push({ asset: 'prop.cargo_crate', pos: V(x, y, z), yaw, height: h, collider: BOXC(h * 1.2, h, h * 1.2) });
}
function barricade(x: number, z: number, yaw = 0, y = 0): void {
  props.push({ asset: 'prop.barricade', pos: V(x, y, z), yaw, height: 1.3, collider: BOXC(2.6, 1.3, 0.6) });
}
function pipes(x: number, z: number, yaw = 0, h = 3): void {
  props.push({ asset: 'env.pipe_cluster', pos: V(x, 0, z), yaw, height: h, collider: BOXC(h * 1.3, h, h * 0.7) });
}
function vent(id: string, x: number, z: number): void {
  props.push({ asset: 'prop.vent', pos: V(x, 0, z), height: 0.4, collider: null });
  void id;
}

// ---------------------------------------------------------------------------
// Bounds and ground slabs
// ---------------------------------------------------------------------------

const BOUNDS = { min: V(-75, -30, -285), max: V(75, 120, 140) };

// Deployment pad, yard, gate corridor, connector A.
floorRect('pad', -14, 100, 14, 135, 'concrete');
floorRect('yard', -35, 30, 35, 100, 'grit');
floorRect('gate_corridor', -22, 8, -8, 30, 'grit');
floorRect('conn_a', -4, 0, 4, 30, 'hazard');
floorRect('yard_pocket_w', -52, 61, -35, 75, 'grit');
floorRect('yard_pocket_e', 35, 47, 52, 59, 'grit');
// Slag Fields.
floorRect('slag', -55, -90, 55, 0, 'slag');
floorRect('slag_pocket_w', -70, -51, -55, -35, 'slag');
floorRect('slag_pocket_e', 55, -51, 70, -35, 'slag');
floorRect('slag_pocket_nw', -50, -104, -40, -90, 'slag');
floorRect('slag_pocket_ne', 40, -104, 50, -90, 'slag');
floorRect('slag_pocket_sw', -52, 0, -44, 14, 'slag');
floorRect('slag_pocket_se', 44, 0, 52, 14, 'slag');
// Cooling slag patches (decorative, 5 cm proud of the floor).
box('slag_patch_a', -22, 0.025, -20, 14, 0.05, 10, 'cooling_slag', { blocksShots: false });
box('slag_patch_b', 24, 0.025, -34, 12, 0.05, 16, 'cooling_slag', { blocksShots: false });
box('slag_patch_c', -4, 0.025, -74, 16, 0.05, 8, 'cooling_slag', { blocksShots: false });
// Connector B, approach, extraction.
floorRect('conn_b', -4, -120, 4, -90, 'hazard');
floorRect('approach', -28, -166, 28, -120, 'concrete');
floorRect('approach_pocket_w', -42, -151, -28, -139, 'concrete');
floorRect('approach_pocket_e', 28, -151, 42, -139, 'concrete');
floorRect('extraction', -14, -275, 14, -236, 'concrete');

// ---------------------------------------------------------------------------
// Pad + yard shell
// ---------------------------------------------------------------------------

wallX('wall_pad_s', 135, -14, 14, 6, [], 'concrete');
wallZ('wall_pad_w', -14, 100, 135, 6, [], 'concrete');
wallZ('wall_pad_e', 14, 100, 135, 6, [], 'concrete');
// Yard south wall (gap to pad), north wall (main gate opening + closed exit gate).
wallX('wall_yard_s', 100, -35, 35, 6, [[-8, 8]], 'concrete');
wallX('wall_yard_n', 30, -35, 35, 6, [[-22, -8], [-4, 4]], 'concrete');
box('gate_yard', 0, 3, 30, 8, 6, 1.2, 'metal', { gateOpensAfter: 'yard' });
// Yard west wall (outer lane opening) and east wall (lateral opening).
wallZ('wall_yard_w', -35, 30, 100, 6, [[62, 74]], 'concrete');
wallZ('wall_yard_e', 35, 30, 100, 6, [[48, 58]], 'concrete');
// Lateral pockets.
wallX('wall_ypw_n', 61, -52, -35, 6, [], 'rust');
wallX('wall_ypw_s', 75, -52, -35, 6, [], 'rust');
wallZ('wall_ypw_w', -52, 61, 75, 6, [], 'rust');
wallX('wall_ype_n', 47, 35, 52, 6, [], 'rust');
wallX('wall_ype_s', 59, 35, 52, 6, [], 'rust');
wallZ('wall_ype_e', 52, 47, 59, 6, [], 'rust');
// Main gate corridor (visible slow pack approaches down it) + connector A walls.
wallZ('wall_corr_w', -22, 8, 30, 6, [], 'rust');
wallX('wall_corr_n', 8, -22, -8, 6, [], 'rust');
box('wall_corr_e', -6, 3, 19, 4, 6, 22, 'concrete'); // thick wall x -8..-4, z 8..30
wallZ('wall_conn_a_e', 4, 0, 30, 6, [], 'concrete');
wallZ('wall_conn_a_w', -4, 0, 8, 6, [], 'concrete');

// ---------------------------------------------------------------------------
// Conveyor Loading Yard dressing: central conveyor, catwalk, three big covers
// ---------------------------------------------------------------------------

box('conveyor_main', 0, 1.2, 65, 4, 2.4, 40, 'conveyor'); // 2.4 m housing: cover, not standable
box('conveyor_motor_n', 0, 1.6, 43.5, 4.5, 3.2, 3, 'metal');
box('conveyor_motor_s', 0, 1.6, 86.5, 4.5, 3.2, 3, 'metal');
// Catwalk beside the belt: deck top y=3.2, ramps at both ends (25 degrees).
const DECK_Y = 3.2;
box('deck_yard', 8, DECK_Y - 0.15, 64, 4, 0.3, 32, 'metal');
ramp('ramp_yard_up', 8, 0, 86.9, 8, DECK_Y, 80, 4, 'metal');
ramp('ramp_yard_down', 8, 0, 41.1, 8, DECK_Y, 48, 4, 'metal');
for (const z of [49, 56, 64, 72, 79]) {
  box(`deck_col_w_${z}`, 6.3, 1.45, z, 0.4, 2.9, 0.4, 'metal');
  box(`deck_col_e_${z}`, 9.7, 1.45, z, 0.4, 2.9, 0.4, 'metal');
}
box('deck_rail_w', 6.05, DECK_Y + 0.5, 64, 0.1, 1, 32, 'metal', { blocksShots: false });
box('deck_rail_e', 9.95, DECK_Y + 0.5, 64, 0.1, 1, 32, 'metal', { blocksShots: false });
// Big cover A: the fuel tank. B: container stack. C: machine block.
tank(-22, 58, 6.5);
box('cover_b_container', 23, 1.6, 66, 5, 3.2, 12, 'rust', { yaw: 0.15 });
box('cover_b_top', 23.6, 3.5, 66, 4, 0.8, 8, 'rust', { yaw: 0.15 });
box('cover_c_machine', -3, 1.9, 40, 7, 3.8, 5, 'metal');
// Small cover scatter.
barricade(-8, 76, 0.3);
barricade(-12, 70, -0.5);
barricade(16, 52, 0.2);
barricade(14, 84, -0.3);
crate(-28, 84, 0.4);
crate(-26.6, 85, 0.1, 1.1);
crate(30, 46, 0.2);
pipes(-30, 44, 0.2, 3.2);
pipes(30, 90, -0.4, 3.2);
crate(-20, 94, 0.2);

// ---------------------------------------------------------------------------
// Slag Fields shell
// ---------------------------------------------------------------------------

wallX('wall_slag_s', 0, -55, 55, 6, [[-4, 4], [-52, -44], [44, 52]], 'concrete');
wallX('wall_slag_n', -90, -55, 55, 6, [[-4, 4], [-50, -40], [40, 50]], 'concrete');
box('gate_slag', 0, 3, -90, 8, 6, 1.2, 'metal', { gateOpensAfter: 'slag' });
wallZ('wall_slag_w', -55, -90, 0, 6, [[-51, -35]], 'concrete');
wallZ('wall_slag_e', 55, -90, 0, 6, [[-51, -35]], 'concrete');
// Side pockets.
wallX('wall_spw_n', -51, -70, -55, 6, [], 'rust');
wallX('wall_spw_s', -35, -70, -55, 6, [], 'rust');
wallZ('wall_spw_w', -70, -51, -35, 6, [], 'rust');
wallX('wall_spe_n', -51, 55, 70, 6, [], 'rust');
wallX('wall_spe_s', -35, 55, 70, 6, [], 'rust');
wallZ('wall_spe_e', 70, -51, -35, 6, [], 'rust');
// Far (north) pockets.
wallZ('wall_snw_w', -50, -104, -90, 6, [], 'rust');
wallZ('wall_snw_e', -40, -104, -90, 6, [], 'rust');
wallX('wall_snw_n', -104, -50, -40, 6, [], 'rust');
wallZ('wall_sne_w', 40, -104, -90, 6, [], 'rust');
wallZ('wall_sne_e', 50, -104, -90, 6, [], 'rust');
wallX('wall_sne_n', -104, 40, 50, 6, [], 'rust');
// Rear (south) pockets.
wallZ('wall_ssw_w', -52, 0, 14, 6, [], 'rust');
wallZ('wall_ssw_e', -44, 0, 14, 6, [], 'rust');
wallX('wall_ssw_s', 14, -52, -44, 6, [], 'rust');
wallZ('wall_sse_w', 44, 0, 14, 6, [], 'rust');
wallZ('wall_sse_e', 52, 0, 14, 6, [], 'rust');
wallX('wall_sse_s', 14, 44, 52, 6, [], 'rust');
// Connector A north end into the slag field; connector B.
wallZ('wall_conn_b_w', -4, -120, -90, 6, [], 'concrete');
wallZ('wall_conn_b_e', 4, -120, -90, 6, [], 'concrete');

// ---------------------------------------------------------------------------
// Slag Fields dressing. Center lane (x -9..9) is the exposed shortcut under
// the crane; the outside paths hug x +-40 behind cover.
// ---------------------------------------------------------------------------

// Big cover: slag kettle tank, container block, gantry frame.
tank(-30, -30, 7.5);
box('cover_slag_block', 28, 2, -50, 14, 4, 6, 'rust', { yaw: 0.3 });
box('cover_slag_gantry_a', -22, 2.5, -72, 3, 5, 3, 'metal');
box('cover_slag_gantry_b', -14, 2.5, -72, 3, 5, 3, 'metal');
box('cover_slag_gantry_top', -18, 5.25, -72, 11, 0.5, 3, 'metal');
// Low obstructions (1.5 m): break shooter LOS, force routing.
for (const [x, z, w] of [[-14, -22, 6], [14, -26, 6], [-14, -58, 6], [14, -62, 6], [-36, -62, 8], [38, -18, 8], [40, -74, 8], [-40, -8, 6]] as const) {
  box(`low_${x}_${-z}`, x, 0.75, z, w, 1.5, 0.8, 'concrete');
}
barricade(-20, -12, 0.2);
barricade(22, -10, -0.4);
barricade(-46, -50, 1.4);
barricade(46, -30, 1.2);
crate(-40, -44, 0.2);
crate(41, -50, 0.5, 1.3);
pipes(-48, -20, 1.5, 3.2);
pipes(48, -66, -1.2, 3.2);
tank(36, -84, 4);
tank(-34, -84, 4);

// ---------------------------------------------------------------------------
// Relay approach shell
// ---------------------------------------------------------------------------

wallX('wall_appr_s', -120, -28, 28, 6, [[-4, 4]], 'concrete');
wallX('wall_appr_n', -166, -28, 28, 6, [[-8, 8]], 'concrete');
box('gate_approach', 0, 3, -166, 16, 6, 1.2, 'metal', { gateOpensAfter: 'approach' });
wallZ('wall_appr_w', -28, -166, -120, 6, [[-151, -139]], 'concrete');
wallZ('wall_appr_e', 28, -166, -120, 6, [[-151, -139]], 'concrete');
wallX('wall_apw_n', -151, -42, -28, 6, [], 'rust');
wallX('wall_apw_s', -139, -42, -28, 6, [], 'rust');
wallZ('wall_apw_w', -42, -151, -139, 6, [], 'rust');
wallX('wall_ape_n', -151, 28, 42, 6, [], 'rust');
wallX('wall_ape_s', -139, 28, 42, 6, [], 'rust');
wallZ('wall_ape_e', 42, -151, -139, 6, [], 'rust');
// Approach cover and rear alcoves.
box('cover_appr_block', 0, 1.75, -142, 10, 3.5, 4, 'metal');
tank(-14, -152, 4.5);
tank(15, -130, 4.5);
barricade(-18, -135, 0.2);
barricade(18, -148, -0.3);
barricade(-6, -128, 0);
crate(20, -158, 0.3);
crate(-22, -158, -0.2);
box('alcove_rear_w', -22, 1, -126, 8, 2, 0.8, 'concrete');
box('alcove_rear_e', 22, 1, -126, 8, 2, 0.8, 'concrete');

// ---------------------------------------------------------------------------
// Relay platform: solid deck at y=3, ramp up from the approach, ramp down to
// extraction, invisible edge walls above the deck.
// ---------------------------------------------------------------------------

const PLAT_Y = 3;
ramp('ramp_relay_up', 0, 0, -165.6, 0, PLAT_Y, -172.4, 12, 'metal');
box('platform_relay', 0, PLAT_Y / 2, -204.2, 68, PLAT_Y, 63.6, 'metal');
// Edge walls (shoulder-high rails collide, do not block shots).
box('plat_rail_w', -34.3, PLAT_Y + 1, -204.2, 0.6, 2, 63.6, 'invisible', { blocksShots: false });
box('plat_rail_e', 34.3, PLAT_Y + 1, -204.2, 0.6, 2, 63.6, 'invisible', { blocksShots: false });
box('plat_rail_sw', -20.2, PLAT_Y + 1, -172.4, 28, 2, 0.6, 'invisible', { blocksShots: false });
box('plat_rail_se', 20.2, PLAT_Y + 1, -172.4, 28, 2, 0.6, 'invisible', { blocksShots: false });
box('plat_rail_nw', -20, PLAT_Y + 1, -236, 28, 2, 0.6, 'invisible', { blocksShots: false });
box('plat_rail_ne', 20, PLAT_Y + 1, -236, 28, 2, 0.6, 'invisible', { blocksShots: false });
ramp('ramp_extract_down', 0, PLAT_Y, -236, 0, 0, -243.4, 8, 'metal');
box('rail_extract_w', -4.3, 3, -240, 0.4, 3, 8, 'invisible', { blocksShots: false });
box('rail_extract_e', 4.3, 3, -240, 0.4, 3, 8, 'invisible', { blocksShots: false });
// Extraction pad enclosure.
wallZ('wall_ext_w', -14, -275, -236, 6, [], 'concrete');
wallZ('wall_ext_e', 14, -275, -236, 6, [], 'concrete');
wallX('wall_ext_n', -275, -14, 14, 6, [], 'concrete');
// Relay platform cover.
box('relay_cover_w', -20, PLAT_Y + 1.5, -195, 6, 3, 3, 'rust');
box('relay_cover_e', 20, PLAT_Y + 1.5, -195, 6, 3, 3, 'rust');
box('relay_cover_nw', -18, PLAT_Y + 1.5, -222, 5, 3, 3, 'rust');
box('relay_cover_ne', 18, PLAT_Y + 1.5, -222, 5, 3, 3, 'rust');
box('relay_pylon_w', -8, PLAT_Y + 2, -208, 2.2, 4, 2.2, 'metal');
box('relay_pylon_e', 8, PLAT_Y + 2, -208, 2.2, 4, 2.2, 'metal');
props.push({ asset: 'prop.signal_tower', pos: V(0, PLAT_Y, -231), height: 9, collider: CYL(9, 1.1) });
crate(-29, -185, 0.3, 1.1, PLAT_Y);
crate(29, -185, -0.3, 1.1, PLAT_Y);
crate(-30, -228, 0.5, 1.1, PLAT_Y);

// Outer invisible boundary walls (safety net around the playable envelope).
box('bound_w', BOUNDS.min.x - 0.5, 20, -72, 1, 60, 420, 'invisible');
box('bound_e', BOUNDS.max.x + 0.5, 20, -72, 1, 60, 420, 'invisible');
box('bound_s', 0, 20, BOUNDS.max.z + 0.5, 150, 60, 1, 'invisible');
box('bound_n', 0, 20, BOUNDS.min.z - 0.5, 150, 60, 1, 'invisible');

// ---------------------------------------------------------------------------
// Landmarks (no collision)
// ---------------------------------------------------------------------------

landmarks.push({ asset: 'prop.the_pillar', pos: V(0, 0, -310), height: 70 });
landmarks.push({ asset: 'prop.giant_crane', pos: V(0, 0, -48), height: 35 });
for (const [x, z, h] of [
  [-62, 100, 16], [66, 112, 18], [-66, 20, 17], [70, -12, 16], [-80, -70, 18], [82, -100, 16],
  [-78, -150, 17], [80, -170, 16], [-62, -215, 18], [64, -225, 16], [-40, -300, 19], [44, -296, 18],
] as const) {
  landmarks.push({ asset: 'env.smokestack', pos: V(x, 0, z), height: h, yaw: x * 0.1 });
}
for (const [x, z] of [
  [-130, 60], [135, 40], [-140, -60], [145, -90], [-120, -190], [125, -200], [-100, -300], [110, -310], [0, -360],
] as const) {
  landmarks.push({ asset: 'prop.refinery_silhouette', pos: V(x, 0, z), height: 45, yaw: z * 0.01 });
}

// ---------------------------------------------------------------------------
// Arenas and lanes
// ---------------------------------------------------------------------------

const lane = (id: string, label: string, spawns: Vec3[], path: Vec3[], air = false): LaneDef =>
  air ? { id, label, spawns, path, air: true } : { id, label, spawns, path };

const yardLanes: LaneDef[] = [
  lane('yard_main', 'MAIN GATE', [V(-12.5, 0, 12), V(-15, 0, 12), V(-18, 0, 12), V(-15, 0, 15.5)], [V(-15, 0, 26), V(-15, 0, 37), V(-17, 0, 50), V(-9, 0, 68)]),
  lane('yard_outer', 'OUTER LANE', [V(-49, 0, 65), V(-49, 0, 68), V(-49, 0, 71)], [V(-37, 0, 68), V(-27, 0, 72), V(-15, 0, 78)]),
  lane('yard_east', 'EAST SIDE', [V(49, 0, 50), V(49, 0, 53), V(49, 0, 56)], [V(38, 0, 53), V(28, 0, 55), V(16, 0, 60)]),
  lane('yard_air', 'AIR - NORTH', [V(-30, 16, 12), V(30, 16, 12), V(0, 18, 10)], [V(0, 10, 48)], true),
];
const slagLanes: LaneDef[] = [
  lane('slag_nw', 'NORTH-WEST BREACH', [V(-45, 0, -100), V(-42, 0, -98), V(-47, 0, -98)], [V(-45, 0, -86), V(-45, 0, -62), V(-36, 0, -40), V(-20, 0, -26)]),
  lane('slag_ne', 'NORTH-EAST BREACH', [V(45, 0, -100), V(42, 0, -98), V(47, 0, -98)], [V(45, 0, -86), V(45, 0, -62), V(36, 0, -40), V(22, 0, -26)]),
  lane('slag_west', 'WEST FLANK', [V(-66, 0, -46), V(-66, 0, -40), V(-62, 0, -43)], [V(-50, 0, -43), V(-40, 0, -40), V(-26, 0, -34)]),
  lane('slag_east', 'EAST FLANK', [V(66, 0, -46), V(66, 0, -40), V(62, 0, -43)], [V(50, 0, -43), V(40, 0, -40), V(26, 0, -34)]),
  lane('slag_rear_w', 'REAR - WEST', [V(-48, 0, 10), V(-48, 0, 6)], [V(-48, 0, -4), V(-40, 0, -14), V(-26, 0, -24)]),
  lane('slag_rear_e', 'REAR - EAST', [V(48, 0, 10), V(48, 0, 6)], [V(48, 0, -4), V(40, 0, -14), V(26, 0, -24)]),
  lane('slag_air', 'AIR - NORTH', [V(-40, 18, -100), V(40, 18, -100), V(0, 20, -100)], [V(0, 12, -40)], true),
];
const approachLanes: LaneDef[] = [
  lane('appr_west', 'WEST FLANK', [V(-40, 0, -147), V(-40, 0, -143)], [V(-32, 0, -145), V(-22, 0, -140), V(-8, 0, -134)]),
  lane('appr_east', 'EAST FLANK', [V(40, 0, -147), V(40, 0, -143)], [V(32, 0, -145), V(22, 0, -140), V(8, 0, -134)]),
  lane('appr_rear', 'REAR ALCOVES', [V(-24, 0, -123.5), V(24, 0, -123.5)], [V(-16, 0, -134), V(16, 0, -134)]),
  lane('appr_air', 'AIR - NORTH', [V(-20, 16, -165), V(20, 16, -165)], [V(0, 10, -140)], true),
];
const relayLanes: LaneDef[] = [
  lane('relay_loader', 'LOADER BAY', [V(0, PLAT_Y, -216)], [V(0, PLAT_Y, -200)]),
  lane('relay_west', 'WEST DECK', [V(-30, PLAT_Y, -226), V(-30, PLAT_Y, -214)], [V(-20, PLAT_Y, -205)]),
  lane('relay_east', 'EAST DECK', [V(30, PLAT_Y, -226), V(30, PLAT_Y, -214)], [V(20, PLAT_Y, -205)]),
  lane('relay_north', 'NORTH DECK', [V(-12, PLAT_Y, -233), V(12, PLAT_Y, -233)], [V(0, PLAT_Y, -214)]),
  lane('relay_air', 'AIR - NORTH', [V(-25, PLAT_Y + 16, -224), V(25, PLAT_Y + 16, -224)], [V(0, PLAT_Y + 9, -200)], true),
];

// ---------------------------------------------------------------------------
// Pickups, hazards, signs, radio
// ---------------------------------------------------------------------------

const pickups: PickupDef[] = [
  // Deployment / rack.
  { kind: 'ammo_coil', pos: V(-9, 0, 94), amount: 40 },
  { kind: 'ammo_arc', pos: V(-15, 0, 94), amount: 12 },
  { kind: 'health', pos: V(10, 0, 92), amount: 25 },
  // Yard, inside the fight (crates along the outer lanes).
  { kind: 'ammo_coil', pos: V(-30, 0, 86), amount: 60 },
  { kind: 'ammo_coil', pos: V(30, 0, 44), amount: 60 },
  { kind: 'ammo_coil', pos: V(8, 3.2, 56), amount: 40 },
  { kind: 'health', pos: V(-28, 0, 50), amount: 25 },
  // After the yard (predictable top-up before the connector).
  { kind: 'health', pos: V(-2, 0, 22), amount: 40, afterArena: 'yard' },
  { kind: 'ammo_coil', pos: V(-2, 0, 16), amount: 90, afterArena: 'yard' },
  { kind: 'ammo_coil', pos: V(2, 0, 12), amount: 90, afterArena: 'yard' },
  { kind: 'ammo_arc', pos: V(0, 0, 8), amount: 14, afterArena: 'yard' },
  { kind: 'salvage', pos: V(0, 0, 4), amount: 20, afterArena: 'yard' },
  // Slag Fields, inside the fight: outside paths and the crane shortcut.
  { kind: 'ammo_coil', pos: V(-44, 0, -14), amount: 70 },
  { kind: 'ammo_coil', pos: V(44, 0, -22), amount: 70 },
  { kind: 'ammo_coil', pos: V(-42, 0, -56), amount: 70 },
  { kind: 'ammo_coil', pos: V(42, 0, -58), amount: 70 },
  { kind: 'ammo_arc', pos: V(0, 0, -30), amount: 10 },
  { kind: 'ammo_arc', pos: V(43, 0, -52), amount: 10 },
  { kind: 'health', pos: V(-42, 0, -44), amount: 30 },
  { kind: 'health', pos: V(0, 0, -78), amount: 30 },
  // After the Slag Fields.
  { kind: 'health', pos: V(-2, 0, -100), amount: 50, afterArena: 'slag' },
  { kind: 'ammo_coil', pos: V(2, 0, -104), amount: 90, afterArena: 'slag' },
  { kind: 'ammo_coil', pos: V(-2, 0, -96), amount: 90, afterArena: 'slag' },
  { kind: 'ammo_arc', pos: V(-2, 0, -108), amount: 16, afterArena: 'slag' },
  { kind: 'armor', pos: V(0, 0, -112), amount: 25, afterArena: 'slag' },
  // Relay approach, inside the fight.
  { kind: 'ammo_coil', pos: V(-25, 0, -132), amount: 60 },
  { kind: 'ammo_coil', pos: V(25, 0, -132), amount: 60 },
  { kind: 'ammo_arc', pos: V(0, 0, -124), amount: 8 },
  // After the approach.
  { kind: 'health', pos: V(-6, 0, -158), amount: 50, afterArena: 'approach' },
  { kind: 'ammo_coil', pos: V(6, 0, -158), amount: 90, afterArena: 'approach' },
  { kind: 'ammo_coil', pos: V(-10, 0, -154), amount: 90, afterArena: 'approach' },
  { kind: 'ammo_arc', pos: V(0, 0, -160), amount: 16, afterArena: 'approach' },
  // Relay platform: crates at the ramp head for the loader fight.
  { kind: 'ammo_coil', pos: V(-26, PLAT_Y, -192), amount: 70 },
  { kind: 'ammo_coil', pos: V(26, PLAT_Y, -192), amount: 70 },
  { kind: 'ammo_arc', pos: V(0, PLAT_Y, -180), amount: 10 },
  { kind: 'health', pos: V(0, PLAT_Y, -178), amount: 30 },
  // After the loader.
  { kind: 'health', pos: V(-4, PLAT_Y, -224), amount: 50, afterArena: 'relay' },
  { kind: 'salvage', pos: V(4, PLAT_Y, -224), amount: 40, afterArena: 'relay' },
];

const hazards: HazardDef[] = [
  { id: 'vent_shortcut', kind: 'vent', pos: V(0, 0, -62), radius: 4, period: 7, warn: 1.5, active: 1.2, offset: 0, damagePerSec: 28 },
  { id: 'vent_entry', kind: 'vent', pos: V(-8, 0, -26), radius: 3, period: 8, warn: 1.5, active: 1.0, offset: 3, damagePerSec: 24 },
  { id: 'vent_outside', kind: 'vent', pos: V(40, 0, -62), radius: 3.5, period: 7.5, warn: 1.5, active: 1.2, offset: 4, damagePerSec: 28 },
];
vent('vent_shortcut', 0, -62);
vent('vent_entry', -8, -26);
vent('vent_outside', 40, -62);

const signs: SignDef[] = [
  { pos: V(-6, 3.4, 134.2), yaw: 0, width: 5, height: 1.6, style: 'stencil', lines: ['RECOVERY TEAM 7', 'DEPLOYMENT PAD', 'FOLLOW THE SIGNAL NORTH'] },
  { pos: V(-14.4, 2.2, 97), yaw: Math.PI / 2, width: 3.2, height: 1.4, style: 'stencil', lines: ['SIDEARM LOCKER', 'ARC SCATTERGUN - ISSUE 2', 'TAKE IT. YOU WILL NEED IT.'] },
  { pos: V(-14, 3.6, 30.7), yaw: 0, width: 5.5, height: 1.6, style: 'warning', lines: ['MAIN GATE - LINE 5', 'DO NOT OPEN VALVE 6', 'WHATEVER COMES OUT IS NOT COOLANT'] },
  { pos: V(0, 4.5, 30.7), yaw: 0, width: 5, height: 1.4, style: 'stencil', lines: ['YARD EXIT - LOCKED', 'CLEAR THE LINE'] },
  { pos: V(-6.5, 1.5, 6), yaw: Math.PI / 2, width: 3, height: 1.2, style: 'scrawl', lines: ['LINE 5 RUNNING BACKWARDS', 'SINCE TUESDAY. NOBODY KNOWS WHY.'] },
  { pos: V(0, 3.6, -0.7), yaw: 0, width: 5, height: 1.6, style: 'warning', lines: ['SLAG FIELDS', 'VENTS CYCLE - WATCH THE GLOW'] },
  { pos: V(-9, 2.6, -64), yaw: Math.PI / 2, width: 3, height: 1.2, style: 'warning', lines: ['VENT 3', 'STAND CLEAR WHEN GLOWING'] },
  { pos: V(37.5, 2.6, -64), yaw: -Math.PI / 2, width: 3, height: 1.2, style: 'warning', lines: ['VENT 4', 'STEAM - 1.5 S WARNING'] },
  { pos: V(-54.4, 3, -20), yaw: Math.PI / 2, width: 4, height: 1.4, style: 'scrawl', lines: ['THE LUMEN IS ROT.', 'ONLY THE FURNACE MAKES THE FLESH PURE.', '- SMELTERS'] },
  { pos: V(0, 4, -119.3), yaw: 0, width: 5, height: 1.4, style: 'stencil', lines: ['RELAY 9 - UPLINK', 'AUTHORISED PERSONNEL'] },
  { pos: V(0, 4.6, -165.3), yaw: 0, width: 6, height: 1.6, style: 'warning', lines: ['RELAY PLATFORM', 'CARGO LOADER 3 - OFFLINE', 'DO NOT APPROACH'] },
  { pos: V(0, 7.5, -234.6), yaw: 0, width: 6, height: 1.6, style: 'stencil', lines: ['UPLINK 9 - SHUT DOWN', 'EXTRACTION NORTH'] },
];

const radio: LevelDef['radio'] = [
  {
    pos: V(0, 0, 118),
    lines: [
      { speaker: 'DISPATCH', text: 'Team 7, signal is still pinging from Relay 9. North through the refinery.' },
      { speaker: 'DISPATCH', text: 'Cut the uplink before the Lumen reaches orbit. Then get out.' },
    ],
  },
  {
    pos: V(0, 0, 90),
    lines: [{ speaker: 'DISPATCH', text: 'Your carbine will hold. There is a scattergun in the rack by the gate. Take it.' }],
  },
  {
    pos: V(0, 0, 14),
    lines: [{ speaker: 'DISPATCH', text: 'Yard is quiet. Too quiet. Slag Fields next. Keep moving between the vents.' }],
  },
  {
    pos: V(0, 0, -104),
    lines: [
      { speaker: 'RELAY 9', text: '...recovery... recovery... send recovery... uplink open... 71 percent...' },
      { speaker: 'DISPATCH', text: 'That is the relay talking. It is not a person. Do not answer it.' },
    ],
  },
  {
    pos: V(0, 0, -160),
    lines: [{ speaker: 'DISPATCH', text: 'Loader 3 is on that platform. Lumen got into the drive. It is still working.' }],
  },
  {
    pos: V(0, PLAT_Y, -224),
    lines: [{ speaker: 'DISPATCH', text: 'Uplink is yours. Hold the relay. Then run north.' }],
  },
];

export const REFINERY: LevelDef = {
  name: 'Refinery District - Relay 9',
  playerStart: { pos: V(0, 0, 126), yaw: 0 },
  boxes,
  props,
  landmarks,
  arenas: [
    {
      id: 'yard',
      name: 'Conveyor Loading Yard',
      trigger: { min: V(-30, 0, 58), max: V(30, 10, 88) },
      bounds: { min: V(-54, -30, 6), max: V(54, 60, 101) },
      lanes: yardLanes,
      cache: V(12, 0, 37),
      objective: 'Clear the yard. Open the exit gate.',
    },
    {
      id: 'slag',
      name: 'Slag Fields',
      trigger: { min: V(-14, 0, -14), max: V(14, 10, -2) },
      bounds: { min: V(-72, -30, -106), max: V(72, 60, 16) },
      lanes: slagLanes,
      cache: V(0, 0, -84),
      objective: 'Cross the Slag Fields. Break the swarm.',
    },
    {
      id: 'approach',
      name: 'Relay Approach',
      trigger: { min: V(-20, 0, -136), max: V(20, 10, -122) },
      bounds: { min: V(-44, -30, -168), max: V(44, 60, -118) },
      lanes: approachLanes,
      cache: V(0, 0, -156),
      objective: 'Clear the approach. Reach the relay platform.',
    },
    {
      id: 'relay',
      name: 'Relay Platform',
      trigger: { min: V(-30, 2, -190), max: V(30, 12, -174) },
      bounds: { min: V(-34, -30, -238), max: V(34, 60, -170) },
      lanes: relayLanes,
      cache: V(-14, PLAT_Y, -230),
      objective: 'Destroy the Cargo Loader. Cut the Relay 9 uplink.',
    },
  ],
  pickups,
  hazards,
  weaponRack: { pos: V(-12, 0, 97), yaw: 0, weapon: 'arc_scattergun' },
  relay: { pos: V(0, PLAT_Y, -226.5), interactRadius: 3.5, shutdownTime: 14, arena: 'relay' },
  extraction: { pos: V(0, 0, -258), radius: 4.5 },
  radio,
  signs,
  killY: -20,
  bounds: BOUNDS,
};
