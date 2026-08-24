import { arc } from '../../engine/shapes.js';
import type { Vec2 } from '../../engine/vec2.js';
import { vec } from '../../engine/vec2.js';
import { MOLTEN_THEME } from '../../render/theme.js';
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
  post,
  saucerWall,
  segmentGate,
} from '../table.js';

/**
 * Four pop bumpers in a diamond, filling the middle of the dome.
 *
 * Where Orbit Cadet's three sit in a loose triangle a ball can pass through,
 * these are packed: a shot into the nest rattles rather than passes, which is
 * what makes this the fast, noisy table of the three.
 */
const BUMPER_POSITIONS: Vec2[] = [
  { x: 300, y: 116 },
  { x: 218, y: 196 },
  { x: 382, y: 196 },
  { x: 300, y: 276 },
];

/**
 * Molten Core: a forge, and the table with no habitrail.
 *
 * Orbit Cadet is built around one big rail and the diverter on it. This one
 * takes the rail away entirely and spends the playfield on metal instead: four
 * bumpers packed into a diamond, a drop bank on the right, and five standups.
 * There is nowhere to ride and nothing to wait for — every shot is a target or
 * the crucible.
 *
 * The orbit structure is Orbit Cadet's, and deliberately so. The shooter lane
 * is on the right on every machine, so a launch always lands on the left, and
 * the left has to be the side that feeds the ball back.
 */
export function buildMoltenTable(): Table {
  const chassis = buildChassis();
  const { colliders, sensors, decals } = chassis;

  /* --- Orbit guides ---------------------------------------------------- */

  colliders.push(
    // The gap between the guides sits above the bumper nest: a fast orbit
    // carries across it, a slower one drops into the diamond.
    arc('guide', DOME_CENTER, 222, deg(180), deg(252), RAIL),
    // Stops short of the lane gate. Run down to 360 degrees it ends level with
    // the gate and the shooter divider, and the three of them form a pocket
    // that swallows the launch.
    arc('guide', DOME_CENTER, 222, deg(288), deg(346), RAIL),
  );
  colliders.push(...polyline('guide', [vec(78, LANE_TOP), vec(78, 566)], 'left', RAIL));
  colliders.push(segmentGate(vec(PLAY_LEFT, 598), vec(96, 668)));

  // Orbit return on the live side, or the right channel is a clear run from
  // the top of the table into the outlane.
  colliders.push(...polyline('guide', [vec(LANE_LEFT, 424), vec(468, 502)], 'left', RAIL));

  /* --- Pop bumpers ------------------------------------------------------ */

  const bumpers: BumperSpec[] = [];
  for (const [i, center] of BUMPER_POSITIONS.entries()) {
    const b = bumper(`bumper-${i}`, center, 24);
    bumpers.push(b.spec);
    colliders.push(b.body);
  }

  /* --- Target banks ----------------------------------------------------- */

  // Handedness flips here even though the orbit cannot: the ore bank is on the
  // right and the standups on the left, the opposite way round to Orbit Cadet.
  // A player who has learned where to aim has to relearn it.
  const dropTargets = bank(
    'drop',
    mirrorPoint(vec(112, 528)),
    mirrorPoint(vec(170, 452)),
    3,
    'right',
    DROP_SURFACE,
  );
  const standupTargets = bank(
    'target',
    vec(112, 528),
    vec(170, 452),
    3,
    'left',
    STANDUP_SURFACE,
  );
  standupTargets.push(...lowStandups(3));

  for (const t of [...dropTargets, ...standupTargets]) colliders.push(t.collider);

  /* --- The crucible ----------------------------------------------------- */

  // Offset right of the centre line, where Orbit Cadet offsets left, for the
  // same reason either way: dead centre it intercepts every shot heading for
  // the bumper nest and makes the most important feature on the table
  // unreachable. With no rail overhead there is nothing above it, so it sits
  // higher and more open than Orbit Cadet's.
  const saucerCenter = vec(316, 376);
  const saucerRadius = 34;
  colliders.push(saucerWall(saucerCenter, saucerRadius));
  sensors.push(sensorCircle('saucer', saucerCenter, 23));

  /* --- Posts ------------------------------------------------------------ */

  const posts: BumperSpec[] = [];
  for (const at of [
    vec(148, 606),
    // Kept close to the shooter-lane divider. Nearer the middle of the right
    // channel it leaves about 26 units either side, and a 27 unit ball wedges
    // in a gap it cannot pass through.
    vec(492, 560),
  ]) {
    const p = post(at);
    posts.push(p.spec);
    colliders.push(p.body);
  }

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
    ...[104, 144, 184, 224].map((radius): Decal => ({
      kind: 'ring',
      at: DOME_CENTER,
      radius,
      color: 'print',
    })),
    { kind: 'arrow', at: vec(saucerCenter.x, saucerCenter.y + 66), angle: 0, color: 'feature' },
    { kind: 'arrow', at: vec(51, 616), angle: 0, color: 'primary' },
    { kind: 'arrow', at: vec(430, 560), angle: 0, color: 'secondary' },
    { kind: 'label', at: vec(278, 578), text: 'HEAT', color: 'feature' },
  );

  return {
    ...chassis,
    bumpers,
    dropTargets,
    standupTargets,
    posts,
    spinners,
    saucer: { center: saucerCenter, radius: saucerRadius },
    saucerLabel: 'CRUCIBLE',
    rollovers,
    missionLamps,
    decals,
  };
}

/**
 * The forge campaign.
 *
 * No ramp mission, because there is no ramp. The engine's mission kinds are
 * the shots a table has, and asking for one this playfield cannot make would
 * stall every rank behind it.
 */
const MISSIONS: readonly MissionSpec[] = [
  { id: 'lock', name: 'Tap the Ladle', brief: 'Hit three standup targets', target: 3 },
  { id: 'sweep', name: 'Stoke the Fire', brief: 'Strike the pop bumpers 5 times', target: 5 },
  { id: 'fuel', name: 'Charge the Bank', brief: 'Drop all three ore targets', target: 3 },
  { id: 'orbit', name: 'Full Anneal', brief: 'Complete a full orbit', target: 1 },
  { id: 'sweep', name: 'White Heat', brief: 'Strike the pop bumpers 10 times', target: 10 },
];

export const MOLTEN_CORE: Machine = {
  id: 'molten-core',
  name: 'Molten Core',
  tagline: 'No rail. Four bumpers, eight targets.',
  theme: MOLTEN_THEME,
  ranks: ['Apprentice', 'Smith', 'Founder', 'Bloomer', 'Master', 'Forgemaster'],
  missions: MISSIONS,
  buildTable: buildMoltenTable,
};
