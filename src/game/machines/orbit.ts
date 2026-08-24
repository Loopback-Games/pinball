import { arc } from '../../engine/shapes.js';
import type { Vec2 } from '../../engine/vec2.js';
import { vec } from '../../engine/vec2.js';
import type { Machine } from '../machine.js';
import type { MissionSpec } from '../rules.js';
import { ORBIT_THEME } from '../../render/theme.js';
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
  smoothPath,
} from '../table.js';

/** Positions of the three pop bumpers. */
const BUMPER_POSITIONS: Vec2[] = [
  { x: 214, y: 246 },
  { x: 342, y: 246 },
  { x: 278, y: 146 },
];

/**
 * Orbit Cadet: the machine this game started as.
 *
 * One long habitrail on the right with a diverter fork, a drop bank on the
 * left, a spinner in the left orbit lane, and a saucer under the ramp's apex.
 * It flows: most of the table is one big loop, and the two sides are
 * deliberately different.
 */
export function buildOrbitTable(): Table {
  const chassis = buildChassis();
  const { colliders, sensors, decals } = chassis;

  /* --- Orbit guides --------------------------------------------------- */

  // Two arcs inside the dome forming the orbit lanes. A ball with enough speed
  // rides the channel between guide and dome all the way over the top.
  colliders.push(
    // The gap between the two guides sits above the bumper nest: a fast orbit
    // carries across it and round, a slower one drops into the bumpers.
    arc('guide', DOME_CENTER, 222, deg(180), deg(252), RAIL),
    // Stops short of the lane gate on purpose. Run down to 360 degrees it
    // ends level with the gate and the divider, and the three of them form a
    // pocket that catches a weakly launched ball.
    arc('guide', DOME_CENTER, 222, deg(288), deg(346), RAIL),
  );

  // Straight continuations that turn each guide into a lane wall lower down.
  colliders.push(...polyline('guide', [vec(78, LANE_TOP), vec(78, 566)], 'left', RAIL));

  // A one-way gate across the foot of the left orbit lane. A ball shot up the
  // lane passes straight through it; a ball returning down the orbit is caught
  // and fed into the playfield instead of running straight on into the drain.
  //
  // This makes the two sides of the table deliberately different. The left
  // orbit is the safe shot, returning the ball to the flippers, while the right
  // side keeps a live outlane. The lane is barely twice the width of the ball,
  // so a gate here can only send every return to the same place; splitting them
  // was tried and simply starved whichever side lost.
  colliders.push(segmentGate(vec(PLAY_LEFT, 598), vec(96, 668)));

  // Orbit return. Without it the right-hand channel is a clear run from the
  // top of the table into the outlane, and every launch drains.
  colliders.push(...polyline('guide', [vec(LANE_LEFT, 424), vec(468, 502)], 'left', RAIL));

  /* --- Pop bumpers ---------------------------------------------------- */

  const bumpers: BumperSpec[] = [];
  for (const [i, center] of BUMPER_POSITIONS.entries()) {
    const b = bumper(`bumper-${i}`, center);
    bumpers.push(b.spec);
    colliders.push(b.body);
  }

  /* --- Target banks ---------------------------------------------------- */

  const dropTargets = bank('drop', vec(112, 528), vec(170, 452), 3, 'left', DROP_SURFACE);
  const standupTargets = bank(
    'target',
    mirrorPoint(vec(112, 528)),
    mirrorPoint(vec(170, 452)),
    3,
    'right',
    STANDUP_SURFACE,
  );
  // A pair of low standups either side of the centre shot: easy to hit off a
  // flipper, and they leave a gap wide enough for the saucer shot.
  // Sloped outward, so a ball that lands on one rolls off towards the
  // slingshot instead of sitting on it like a shelf.
  //
  // These two set the width of the only corridor from the flippers up to the
  // saucer and the bumper nest, so they stay on the mirror line. Moving the
  // right one inboard to clear the ramp funnel closed that corridor by forty
  // units and halved how often the ball ever reached the pop bumpers; the
  // funnel was moved instead.
  standupTargets.push(...lowStandups(3));

  for (const t of [...dropTargets, ...standupTargets]) colliders.push(t.collider);

  /* --- Saucer ---------------------------------------------------------- */

  // Offset from the centre line on purpose: sitting dead centre it intercepted
  // every shot heading for the bumpers, which made the most important feature
  // on the table almost unreachable.
  const saucerCenter = vec(240, 392);
  const saucerRadius = 34;
  colliders.push(saucerWall(saucerCenter, saucerRadius));
  sensors.push(sensorCircle('saucer', saucerCenter, 23));

  /* --- Habitrail ramp --------------------------------------------------- */

  // Entry funnel on the right, feeding a wire ramp that returns the ball to the
  // left inlane. The ramp itself is a path the rule layer walks the ball along.
  const rampEntry = vec(404, 566);
  // Both walls are kept clear of their neighbours, because a gap a shade under
  // one ball wide is not a gap, it is a trap.
  //
  // The left wall starts above the centre standup rather than beside it: level
  // with the target, the notch between the two held the ball and rattled it
  // against the target face for the nine seconds the stuck-ball recovery used
  // to take to notice, and that one spot produced more wedged balls than the
  // rest of the table together.
  //
  // The right wall stops level with the ramp sensor for the same reason at the
  // other end, where it otherwise finished alongside the foot of the standup
  // bank. Nothing is lost by stopping there: a ball that far up the funnel has
  // already tripped the sensor.
  colliders.push(
    ...polyline('guide', [vec(368, 610), vec(380, 534)], 'right', RAIL),
    ...polyline('guide', [vec(452, 632), vec(436, 566)], 'left', RAIL),
  );
  sensors.push(sensorCircle('ramp-entry', rampEntry, 24));

  // The habitrail is raised above the playfield, so it is allowed to cross
  // over the bumpers and guides. It is drawn last, with a shadow, to read that
  // way.
  // Routed to stay clear of the bumpers above and the target banks below, so
  // it never hides a shot the player needs to see.
  //
  // The climb is shared by both branches of the diverter, which is why it is
  // authored once. A fork drawn from two independently authored curves shows
  // the seam at the junction however carefully the numbers are matched.
  const rampClimb: Vec2[] = [rampEntry, vec(436, 496), vec(444, 424), vec(416, 344)];
  /** Where the diverter blade sits, and where the two branches part company. */
  const warpFork = vec(346, 292);
  const rampPath: Vec2[] = smoothPath([
    ...rampClimb,
    warpFork,
    vec(250, 282),
    vec(166, 316),
    vec(118, 388),
    vec(100, 470),
    vec(90, 556),
    vec(86, 620),
    vec(82, 676),
  ]);

  // The short way round. The saucer sits directly under the apex of the ramp,
  // so the fork is a drop of barely a hundred units rather than a second rail
  // needing playfield of its own — and there is none to give it. Anything
  // crossing the table above the bumpers has to run through the rollover
  // inserts, and a wireform over those hides the lanes the player is aiming at.
  //
  // It passes down the right-hand side of the saucer rather than straight down
  // the middle. Dead centre it lies along the corridor from the flippers to
  // the bumper nest and reads, from the shooter's end of the table, as a wall
  // across the shot.
  const warpPath: Vec2[] = smoothPath([
    ...rampClimb,
    warpFork,
    vec(316, 320),
    vec(282, 358),
    saucerCenter,
  ]);
  // The sampler emits each control point exactly, so the fork is at whichever
  // index it landed on rather than at one worked out from the sample rate.
  const warpForkIndex = rampPath.findIndex((p) => p.x === warpFork.x && p.y === warpFork.y);

  /* --- Posts ------------------------------------------------------------ */

  // Posts shape the lanes; none of them may stand in one. Anything on the
  // centre line blocks the saucer shot, and anything near x=404 below y=620
  // blocks the ramp mouth, so both corridors are deliberately left clear.
  const posts: BumperSpec[] = [];
  for (const at of [
    vec(148, 606),
    // Kept close to the shooter-lane divider. Nearer the middle of the right
    // channel it leaves a gap of about 26 units on either side of it, and a
    // 27 unit ball wedges in a gap it cannot pass through: that one post was
    // the last real trap on the table.
    vec(492, 560),
    // The pair that used to guard the mouth of the bumper nest is gone. They
    // narrowed the only corridor into it, and the bumpers are the feature that
    // most wants traffic.
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

  // Sat on the orbit path itself, at the radius a ball actually rides, rather
  // than at the very top of the dome where nothing passes.
  const missionLamps: Vec2[] = [0, 1, 2, 3, 4].map((i) => vec(220 + i * 29, 596));

  /* --- Printing ---------------------------------------------------------- */

  decals.push(
    // Concentric rings echoing the dome, as playfield printing.
    ...[96, 130, 164, 198, 232].map((radius): Decal => ({
      kind: 'ring',
      at: DOME_CENTER,
      radius,
      color: 'print',
    })),
    // Arrow inserts pointing at the two big shots.
    { kind: 'arrow', at: vec(404, 624), angle: 0, color: 'feature' },
    { kind: 'arrow', at: vec(saucerCenter.x, saucerCenter.y + 62), angle: 0, color: 'feature' },
    { kind: 'arrow', at: vec(51, 616), angle: 0, color: 'primary' },
    { kind: 'label', at: vec(278, 578), text: 'RANK PROGRESS', color: 'feature' },
  );

  return {
    ...chassis,
    bumpers,
    dropTargets,
    standupTargets,
    posts,
    spinners,
    saucer: { center: saucerCenter, radius: saucerRadius },
    saucerLabel: 'MISSION',
    rampPath,
    warpPath,
    warpFork,
    warpLabel: 'WARP',
    warpForkIndex,
    rollovers,
    missionLamps,
    decals,
  };
}

/**
 * The campaign, easiest first.
 *
 * Ordered by how often the table actually gives you the shot, measured from
 * bot play rather than guessed. A player always meets the first one first, so
 * if the early ones are hard nobody ever sees the rest of the rules, multiball
 * included.
 */
const MISSIONS: readonly MissionSpec[] = [
  { id: 'lock', name: 'Target Lock', brief: 'Hit three standup targets', target: 3 },
  { id: 'fuel', name: 'Fuel Cells', brief: 'Drop all three fuel targets', target: 3 },
  { id: 'sweep', name: 'Bumper Sweep', brief: 'Strike the pop bumpers 5 times', target: 5 },
  { id: 'ramp', name: 'Ramp Rush', brief: 'Make two ramp shots', target: 2 },
  { id: 'orbit', name: 'Orbit Run', brief: 'Complete a full orbit', target: 1 },
];

export const ORBIT_CADET: Machine = {
  id: 'orbit-cadet',
  name: 'Orbit Cadet',
  tagline: 'One long rail, and a warp that forks it.',
  theme: ORBIT_THEME,
  ranks: ['Cadet', 'Ensign', 'Lieutenant', 'Commander', 'Captain', 'Admiral'],
  missions: MISSIONS,
  buildTable: buildOrbitTable,
};
