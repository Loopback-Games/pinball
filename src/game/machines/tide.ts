import { arc } from '../../engine/shapes.js';
import type { Vec2 } from '../../engine/vec2.js';
import { vec } from '../../engine/vec2.js';
import { TIDE_THEME } from '../../render/theme.js';
import type { Machine } from '../machine.js';
import type { MissionSpec } from '../rules.js';
import { sensorCircle, sensorRect } from '../sensors.js';
import type { BumperSpec, Decal, Table } from '../table.js';
import {
  DOME_CENTER,
  DROP_SURFACE,
  LANE_LEFT,
  LANE_TOP,
  PLAY_LEFT,
  RAIL,
  STANDUP_SURFACE,
  bank,
  buildChassis,
  bumper,
  deg,
  lowStandups,
  mirrorPoint,
  polyline,
  saucerWall,
  segmentGate,
  smoothPath,
} from '../table.js';

/**
 * Three pop bumpers in a row rather than a nest.
 *
 * Strung across the top of the dome, they deflect a ball along the row and
 * back out instead of holding it. That is the whole character of this table:
 * things here move the ball on rather than keeping it.
 */
const BUMPER_POSITIONS: Vec2[] = [
  { x: 206, y: 172 },
  { x: 300, y: 142 },
  { x: 394, y: 172 },
];

/**
 * Tidewreck: a drowned ship, and the open table of the three.
 *
 * It carries no posts at all and its bumpers are strung in a row, so the
 * playfield has fewer things in it than either of the others and the ball
 * keeps moving. The drop bank lies flat across the upper left where Orbit
 * Cadet's stands on the diagonal, and the habitrail takes a lower, wider line
 * over the top.
 */
export function buildTideTable(): Table {
  const chassis = buildChassis();
  const { colliders, sensors, decals } = chassis;

  /* --- Orbit guides ---------------------------------------------------- */

  colliders.push(
    arc('guide', DOME_CENTER, 222, deg(180), deg(248), RAIL),
    // Stops short of the lane gate, or it forms a pocket with the gate and the
    // shooter divider that swallows the launch.
    arc('guide', DOME_CENTER, 222, deg(292), deg(346), RAIL),
  );
  colliders.push(...polyline('guide', [vec(78, LANE_TOP), vec(78, 566)], 'left', RAIL));
  colliders.push(segmentGate(vec(PLAY_LEFT, 598), vec(96, 668)));
  colliders.push(...polyline('guide', [vec(LANE_LEFT, 424), vec(468, 502)], 'left', RAIL));

  /* --- Pop bumpers ------------------------------------------------------ */

  const bumpers: BumperSpec[] = [];
  for (const [i, center] of BUMPER_POSITIONS.entries()) {
    const b = bumper(`bumper-${i}`, center);
    bumpers.push(b.spec);
    colliders.push(b.body);
  }

  /* --- Target banks ----------------------------------------------------- */

  // The cargo bank lies flat instead of standing on the diagonal, so it is hit
  // by a shot up the left rather than one across it. Its face points down the
  // table, towards where the ball comes from.
  const dropTargets = bank('drop', vec(120, 432), vec(210, 432), 3, 'left', DROP_SURFACE);
  const standupTargets = bank(
    'target',
    mirrorPoint(vec(112, 528)),
    mirrorPoint(vec(170, 452)),
    3,
    'right',
    STANDUP_SURFACE,
  );
  standupTargets.push(...lowStandups(3));

  for (const t of [...dropTargets, ...standupTargets]) colliders.push(t.collider);

  /* --- The wreck -------------------------------------------------------- */

  const saucerCenter = vec(252, 336);
  const saucerRadius = 34;
  colliders.push(saucerWall(saucerCenter, saucerRadius));
  sensors.push(sensorCircle('saucer', saucerCenter, 23));

  /* --- Habitrail -------------------------------------------------------- */

  // The mouth and its funnel walls are Orbit Cadet's, which are placed where
  // they are because every other position tried produced a wedged ball: a gap
  // a shade under one ball wide is not a gap, it is a trap.
  const rampEntry = vec(404, 566);
  colliders.push(
    ...polyline('guide', [vec(368, 610), vec(380, 534)], 'right', RAIL),
    ...polyline('guide', [vec(452, 632), vec(436, 566)], 'left', RAIL),
  );
  sensors.push(sensorCircle('ramp-entry', rampEntry, 24));

  // A lower, wider line than Orbit Cadet's. The bumpers are strung high and in
  // a row, which leaves a clear band across the middle of the dome that Orbit
  // Cadet's nest does not, and the wire runs through it well clear of the
  // wreck below and the bumpers above.
  //
  // The descent is kept out at x >= 96 so it passes to the left of the cargo
  // bank rather than lying across it.
  const rampPath: Vec2[] = smoothPath([
    rampEntry,
    vec(436, 496),
    vec(444, 424),
    vec(430, 352),
    vec(380, 288),
    vec(300, 258),
    vec(212, 268),
    vec(146, 314),
    vec(110, 386),
    vec(98, 468),
    vec(90, 560),
    vec(82, 676),
  ]);

  /* --- Spinner, rollovers, lamps ---------------------------------------- */

  const spinners = [{ id: 'spinner-0', center: vec(51, 568), w: 44, h: 32 }];
  sensors.push(sensorRect('spinner-0', PLAY_LEFT + 2, 548, 54, 40));

  const rollovers: Vec2[] = [
    vec(300 + Math.cos(deg(255)) * 235, 300 + Math.sin(deg(255)) * 235),
    vec(300, 300 - 235),
    vec(300 + Math.cos(deg(285)) * 235, 300 + Math.sin(deg(285)) * 235),
  ];
  rollovers.forEach((p, i) => sensors.push(sensorCircle(`rollover-${i}`, p, 27)));

  const missionLamps: Vec2[] = [0, 1, 2, 3, 4].map((i) => vec(220 + i * 29, 596));

  /* --- Printing ---------------------------------------------------------- */

  decals.push(
    ...[112, 152, 192, 232].map((radius): Decal => ({
      kind: 'ring',
      at: DOME_CENTER,
      radius,
      color: 'print',
    })),
    { kind: 'arrow', at: vec(404, 624), angle: 0, color: 'feature' },
    { kind: 'arrow', at: vec(saucerCenter.x, saucerCenter.y + 66), angle: 0, color: 'feature' },
    { kind: 'arrow', at: vec(51, 616), angle: 0, color: 'primary' },
    { kind: 'label', at: vec(278, 578), text: 'SALVAGE', color: 'feature' },
  );

  return {
    ...chassis,
    bumpers,
    dropTargets,
    standupTargets,
    // Deliberately none. Every post on the other two machines narrows a lane,
    // and this table is the one that does not narrow anything.
    posts: [],
    spinners,
    saucer: { center: saucerCenter, radius: saucerRadius },
    saucerLabel: 'THE WRECK',
    rampPath,
    rollovers,
    missionLamps,
    decals,
  };
}

/** The salvage campaign. */
const MISSIONS: readonly MissionSpec[] = [
  { id: 'lock', name: 'Grapple On', brief: 'Hit three standup targets', target: 3 },
  { id: 'fuel', name: 'Crack the Hold', brief: 'Drop all three cargo targets', target: 3 },
  { id: 'ramp', name: 'Haul the Line', brief: 'Make two ramp shots', target: 2 },
  { id: 'sweep', name: 'Stir the Shoal', brief: 'Strike the pop bumpers 5 times', target: 5 },
  { id: 'orbit', name: 'Ride the Current', brief: 'Complete a full orbit', target: 1 },
];

export const TIDEWRECK: Machine = {
  id: 'tidewreck',
  name: 'Tidewreck',
  tagline: 'No posts, bumpers in a row, room to move.',
  theme: TIDE_THEME,
  art: {},
  ranks: ['Diver', 'Salvor', 'Bosun', 'Mate', 'Skipper', 'Wreckmaster'],
  missions: MISSIONS,
  buildTable: buildTideTable,
};
