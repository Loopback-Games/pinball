import { Flipper } from '../engine/flipper.js';
import type { Collider } from '../engine/shapes.js';
import { arc, circle, segment, segmentFlipped } from '../engine/shapes.js';
import type { SurfaceOptions } from '../engine/shapes.js';
import type { Vec2 } from '../engine/vec2.js';
import { distance, lerp, vec } from '../engine/vec2.js';
import { SLINGSHOT_KICK } from './rules.js';
import type { Sensor } from './sensors.js';
import { sensorCircle, sensorRect } from './sensors.js';

/* ------------------------------------------------------------------ *
 * Table dimensions.
 *
 * One unit is roughly one millimetre of a real playfield, which keeps the
 * physics constants in a range that behaves like the real thing. The shooter
 * lane sits outside the play area on the right, so the play area is not
 * centred on the table: the dome spans the full width, the flippers do not.
 * ------------------------------------------------------------------ */

export const TABLE_W = 600;
export const TABLE_H = 1000;

export const PLAY_LEFT = 24;
export const PLAY_RIGHT = 532;
/** Mirror axis for the play area: x' = MIRROR - x. */
export const MIRROR = PLAY_LEFT + PLAY_RIGHT;
export const PLAY_CENTER = MIRROR / 2;

export const LANE_LEFT = PLAY_RIGHT;
export const LANE_RIGHT = 576;
export const LANE_CENTER = (LANE_LEFT + LANE_RIGHT) / 2;
export const LANE_FLOOR = 962;
/** Height at which the shooter lane opens into the dome. */
export const LANE_TOP = 300;

export const DOME_CENTER: Vec2 = { x: 300, y: 300 };
export const DOME_RADIUS = 276;

export const BALL_RADIUS = 13.5;

/**
 * How far the plunger draws back, in table units.
 *
 * The ball rests on the extended plunger tip and travels down with it, so its
 * resting position must leave this much room above the lane floor. Get it wrong
 * and a fully drawn plunger pushes the ball through the floor and out of the
 * world.
 */
export const PLUNGER_TRAVEL = 46;

/** Everything below this line, inside the play area, is lost. */
export const DRAIN_Y = 958;

const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * Sample a Catmull-Rom spline through `points`, producing a dense polyline.
 *
 * The habitrail is authored as a handful of control points; drawing or walking
 * a ball along those directly shows every kink. Sampling a spline through them
 * gives a curve that looks and feels like bent wire.
 */
function smoothPath(points: readonly Vec2[], perSegment = 10): Vec2[] {
  if (points.length < 3) return [...points];
  const out: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let j = 0; j < perSegment; j += 1) {
      const t = j / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        vec(
          0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        ),
      );
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}
const mirrorPoint = (p: Vec2): Vec2 => vec(MIRROR - p.x, p.y);

/** Wall styling shared by the table's structural boundary. */
const WALL: SurfaceOptions = { restitution: 0.45, friction: 0.04 };
/**
 * Smooth curved rails: the dome and the orbit guides. A ball riding a curve
 * makes many shallow contacts per second, so these keep restitution high and
 * friction near zero. Otherwise an orbit shot arrives at the top with almost
 * nothing left.
 */
const RAIL: SurfaceOptions = { restitution: 0.72, friction: 0.002 };
const RUBBER: SurfaceOptions = { restitution: 0.62, friction: 0.04, radius: 5 };

/**
 * Chain of segments through `points`. `side` picks which way the normals face:
 * 'right' is the normal produced by walking the points in order, 'left' is the
 * opposite. Every wall in the table is built from this, so a mis-facing wall is
 * a one-word fix rather than a hunt through individual segments.
 */
function polyline(
  id: string,
  points: readonly Vec2[],
  side: 'left' | 'right',
  o: SurfaceOptions = WALL,
): Collider[] {
  const out: Collider[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    out.push(side === 'right' ? segment(id, a, b, o) : segmentFlipped(id, a, b, o));
  }
  return out;
}

/**
 * The largest circle that fits inside triangle `a`-`b`-`c`, as a collider.
 *
 * Used to fill the inside of a body built from thin edges, so that a ball that
 * somehow ends up within it is pushed back out rather than kept.
 */
function incircle(id: string, a: Vec2, b: Vec2, c: Vec2): Collider {
  const la = distance(b, c);
  const lb = distance(a, c);
  const lc = distance(a, b);
  const perimeter = la + lb + lc;
  const center = vec(
    (la * a.x + lb * b.x + lc * c.x) / perimeter,
    (la * a.y + lb * b.y + lc * c.y) / perimeter,
  );
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  const radius = area / (perimeter / 2);
  return circle(id, center, radius, { restitution: 0.2, friction: 0.4 });
}

export interface BumperSpec {
  id: string;
  center: Vec2;
  radius: number;
}

export interface TargetSpec {
  id: string;
  a: Vec2;
  b: Vec2;
  collider: Collider;
}

export interface SlingshotSpec {
  id: string;
  a: Vec2;
  b: Vec2;
  c: Vec2;
  /**
   * The kicking face. The rule layer disarms it briefly after it fires: the
   * two slingshots point at each other, and one that can re-fire instantly
   * keeps a ball rallying between them for as long as the game runs.
   */
  face: Collider[];
}

export interface Table {
  colliders: Collider[];
  sensors: Sensor[];
  flippers: Flipper[];
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  bumpers: BumperSpec[];
  dropTargets: TargetSpec[];
  standupTargets: TargetSpec[];
  slingshots: SlingshotSpec[];
  posts: BumperSpec[];
  saucer: { center: Vec2; radius: number };
  /** Path a captured ball follows along the habitrail, entry first. */
  rampPath: Vec2[];
  /**
   * The other side of the diverter: the short fork that drops out of the
   * habitrail and into the saucer, entry first.
   *
   * It shares the ramp's mouth and its climb, so the two paths are identical
   * until the fork and the rule layer only has to pick one of them.
   */
  warpPath: Vec2[];
  /** Where the habitrail splits, so the diverter blade can be drawn on it. */
  warpFork: Vec2;
  /**
   * Index of the fork in both paths. Everything before it is the same wire,
   * which is what lets the renderer draw one trunk and two branches instead of
   * two whole rails stacked on each other.
   */
  warpForkIndex: number;
  rollovers: Vec2[];
  /** Insert lamps showing how many missions have been completed. */
  missionLamps: Vec2[];
  plunger: { x: number; y: number };
  /** The gate at the top of the shooter lane, held for rendering. */
  laneGate: Collider;
}

/** Positions of the three pop bumpers. */
const BUMPER_POSITIONS: Vec2[] = [
  { x: 214, y: 246 },
  { x: 342, y: 246 },
  { x: 278, y: 146 },
];

const BUMPER_RADIUS = 26;

/** Build the complete playfield. */
export function buildTable(): Table {
  const colliders: Collider[] = [];
  const sensors: Sensor[] = [];

  /* --- Outer boundary ------------------------------------------------ */

  // The dome spans the whole table width and contains the ball from above.
  colliders.push(arc('wall', DOME_CENTER, DOME_RADIUS, deg(180), deg(360), RAIL));

  // Left wall, straight down the side of the play area, ending in an apron
  // that funnels the outlane into the same drain as the middle.
  colliders.push(
    ...polyline('wall', [vec(PLAY_LEFT, LANE_TOP), vec(PLAY_LEFT, 898), vec(96, 972)], 'right'),
  );

  // The shooter lane divider doubles as the right edge of the play area, and
  // gets the mirrored apron on its playfield side.
  colliders.push(
    // The divider stops below the gate so it cannot catch a ball rolling off
    // it: poking up through the gate turns that junction into a pocket.
    ...polyline('wall', [vec(LANE_LEFT, LANE_FLOOR), vec(LANE_LEFT, LANE_TOP + 18)], 'right'),
    ...polyline('wall', [vec(LANE_LEFT, 898), vec(MIRROR - 96, 972)], 'left'),
  );

  // Outer wall of the shooter lane, and its floor.
  colliders.push(
    ...polyline(
      'wall',
      [vec(LANE_RIGHT, LANE_TOP), vec(LANE_RIGHT, LANE_FLOOR), vec(LANE_LEFT, LANE_FLOOR)],
      'left',
    ),
  );

  // One-way gate at the top of the shooter lane. Its normal faces up, so it
  // only exists for a ball coming down from the dome: a launched ball passes
  // straight through, and nothing ever falls back into the lane.
  //
  // It slopes down towards the playfield on purpose. Level, it is a ledge in
  // the middle of the dome, and a weak launch leaves the ball parked on top of
  // it with nowhere to go.
  const laneGate = segment(
    'gate',
    vec(LANE_LEFT - 12, LANE_TOP + 12),
    vec(LANE_RIGHT, LANE_TOP - 14),
    { restitution: 0.2, oneWay: true, radius: 2 },
  );
  colliders.push(laneGate);

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
  colliders.push(
    segment('gate', vec(PLAY_LEFT, 598), vec(96, 668), {
      restitution: 0.45,
      friction: 0.02,
      oneWay: true,
      radius: 3,
    }),
  );

  // Orbit return. Without it the right-hand channel is a clear run from the
  // top of the table into the outlane, and every launch drains.
  colliders.push(...polyline('guide', [vec(LANE_LEFT, 424), vec(468, 502)], 'left', RAIL));

  /* --- Pop bumpers ---------------------------------------------------- */

  const bumpers: BumperSpec[] = BUMPER_POSITIONS.map((center, i) => ({
    id: `bumper-${i}`,
    center,
    radius: BUMPER_RADIUS,
  }));
  for (const b of bumpers) {
    colliders.push(
      circle(b.id, b.center, b.radius, {
        restitution: 0.5,
        friction: 0,
        kick: 720,
      }),
    );
  }

  /* --- Target banks ---------------------------------------------------- */

  /** Split a line into `count` collinear target faces with gaps between them. */
  function bank(
    prefix: string,
    a: Vec2,
    b: Vec2,
    count: number,
    side: 'left' | 'right',
    o: SurfaceOptions,
  ): TargetSpec[] {
    const out: TargetSpec[] = [];
    const gap = 0.06;
    const span = (1 - gap * (count - 1)) / count;
    for (let i = 0; i < count; i += 1) {
      const t0 = i * (span + gap);
      const pa = lerp(a, b, t0);
      const pb = lerp(a, b, t0 + span);
      const id = `${prefix}-${i}`;
      const collider =
        side === 'right' ? segment(id, pa, pb, o) : segmentFlipped(id, pa, pb, o);
      out.push({ id, a: pa, b: pb, collider });
    }
    return out;
  }

  const dropTargets = bank('drop', vec(112, 528), vec(170, 452), 3, 'left', {
    restitution: 0.3,
    friction: 0.1,
    radius: 4,
  });
  const standupTargets = bank(
    'target',
    mirrorPoint(vec(112, 528)),
    mirrorPoint(vec(170, 452)),
    3,
    'right',
    { restitution: 0.45, friction: 0.1, radius: 4 },
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
  for (const [i, x] of [200, MIRROR - 200].entries()) {
    const id = `target-${3 + i}`;
    const outward = i === 0 ? -1 : 1;
    const a = vec(x - 18 * outward, 640);
    const b = vec(x + 18 * outward, 658);
    const collider = segmentFlipped(id, a, b, {
      restitution: 0.45,
      friction: 0.1,
      radius: 4,
    });
    standupTargets.push({ id, a, b, collider });
  }

  for (const t of [...dropTargets, ...standupTargets]) colliders.push(t.collider);

  /* --- Saucer ---------------------------------------------------------- */

  // A cup open at the bottom: the ball is shot up into it and cannot roll out
  // on its own, so the rule layer decides when to kick it free.
  // Offset from the centre line on purpose: sitting dead centre it intercepted
  // every shot heading for the bumpers, which made the most important feature
  // on the table almost unreachable.
  const saucerCenter = vec(240, 392);
  const saucerRadius = 34;
  colliders.push(
    // A 120 degree mouth at the bottom. Narrower than this and the shot that
    // gates every mission on the table is close to unmakeable.
    arc('saucer-wall', saucerCenter, saucerRadius, deg(150), deg(390), {
      restitution: 0.12,
      friction: 0.5,
    }),
  );
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
  const posts: BumperSpec[] = [
    { id: 'post', center: vec(148, 606), radius: 9 },
    // Kept close to the shooter-lane divider. Nearer the middle of the right
    // channel it leaves a gap of about 26 units on either side of it, and a
    // 27 unit ball wedges in a gap it cannot pass through: that one post was
    // the last real trap on the table.
    { id: 'post', center: vec(492, 560), radius: 9 },
    // The pair that used to guard the mouth of the bumper nest is gone. They
    // narrowed the only corridor into it, and the bumpers are the feature that
    // most wants traffic.
  ];
  for (const p of posts) {
    colliders.push(circle(p.id, p.center, p.radius, { restitution: 0.7, radius: 0 }));
  }

  /* --- Lower third: lanes, slingshots, flippers -------------------------- */

  // Divider between outlane and inlane, one per side.
  const dividerTop = vec(62, 654);
  const dividerBottom = vec(62, 872);
  colliders.push(
    ...polyline('guide', [dividerTop, dividerBottom], 'right', {
      ...WALL,
      radius: 5,
    }),
    ...polyline('guide', [mirrorPoint(dividerTop), mirrorPoint(dividerBottom)], 'left', {
      ...WALL,
      radius: 5,
    }),
  );

  // Slingshot bodies. The hypotenuse faces up the playfield and does the work.
  const slingA = vec(100, 672);
  const slingB = vec(100, 792);
  const slingC = vec(182, 806);
  const slingshots: SlingshotSpec[] = [
    { id: 'sling-left', a: slingA, b: slingB, c: slingC, face: [] },
    {
      id: 'sling-right',
      a: mirrorPoint(slingA),
      b: mirrorPoint(slingB),
      c: mirrorPoint(slingC),
      face: [],
    },
  ];
  for (const s of slingshots) {
    const kicking: SurfaceOptions = {
      restitution: 0.48,
      friction: 0.06,
      kick: SLINGSHOT_KICK,
      radius: 5,
    };
    const side = s.id === 'sling-left' ? 'right' : 'left';
    const inner = side === 'right' ? 'left' : 'right';
    s.face.push(...polyline(s.id, [s.a, s.c], side, kicking));
    colliders.push(
      ...s.face,
      ...polyline('wall', [s.c, s.b], inner, { ...WALL, radius: 5 }),
      ...polyline('wall', [s.b, s.a], inner, { ...WALL, radius: 5 }),
      // Plug the hollow inside the triangle.
      //
      // Three thin edges leave an interior the ball has no way out of, and the
      // kicking face makes it worse: from the inside its normal points further
      // in, so the thing meant to eject the ball drives it deeper. A ball has
      // no business in here, but "cannot happen" is not the same as cannot,
      // and a solid core costs nothing. It is never drawn and never scores,
      // because nothing outside the body can touch it.
      incircle('shim', s.a, s.b, s.c),
    );
  }

  // Rubber-tipped guides that funnel the inlane onto the flipper.
  colliders.push(
    ...polyline('guide', [vec(100, 806), vec(150, 852)], 'right', RUBBER),
    ...polyline(
      'guide',
      [mirrorPoint(vec(100, 806)), mirrorPoint(vec(150, 852))],
      'left',
      RUBBER,
    ),
  );

  /* --- Flippers ---------------------------------------------------------- */

  // Pivot separation sets the drain gap, which is the whole point of the
  // lower playfield: tips 68 units of reach apart leave a clear gap of
  // (separation - 2 * reach - 2 * bat radius). At 168 that came out at 9
  // units against a 27 unit ball, so nothing could ever drain down the middle
  // and a ball rolling into it simply sat on the two tips.
  const leftFlipper = new Flipper({
    id: 'flipper-left',
    pivot: vec(177, 838),
    length: 76,
    pivotRadius: 13,
    tipRadius: 9,
    restAngle: deg(26),
    activeAngle: deg(-26),
    upSpeed: 30,
    downSpeed: 17,
  });
  const rightFlipper = new Flipper({
    id: 'flipper-right',
    pivot: mirrorPoint(vec(177, 838)),
    length: 76,
    pivotRadius: 13,
    tipRadius: 9,
    restAngle: deg(180 - 26),
    activeAngle: deg(180 + 26),
    upSpeed: 30,
    downSpeed: 17,
  });

  /* --- Sensors ----------------------------------------------------------- */

  sensors.push(
    sensorRect('drain', 92, DRAIN_Y, MIRROR - 184, TABLE_H - DRAIN_Y),
    // The outlane switches sit high enough to catch a ball on its way down,
    // which is what gives the kickback time to fire.
    sensorRect('outlane-left', PLAY_LEFT, 770, 38, 150),
    sensorRect('outlane-right', MIRROR - PLAY_LEFT - 38, 770, 38, 150),
    sensorRect('inlane-left', 64, 820, 34, 60),
    sensorRect('inlane-right', MIRROR - 98, 820, 34, 60),
    sensorRect('lane-exit', LANE_LEFT, LANE_TOP - 30, LANE_RIGHT - LANE_LEFT, 30),
    sensorRect('spinner', PLAY_LEFT + 2, 548, 54, 40),
  );

  // Sat on the orbit path itself, at the radius a ball actually rides, rather
  // than at the very top of the dome where nothing passes.
  const missionLamps: Vec2[] = [0, 1, 2, 3, 4].map((i) => vec(220 + i * 29, 596));

  const rollovers: Vec2[] = [
    vec(300 + Math.cos(deg(255)) * 235, 300 + Math.sin(deg(255)) * 235),
    vec(300, 300 - 235),
    vec(300 + Math.cos(deg(285)) * 235, 300 + Math.sin(deg(285)) * 235),
  ];
  rollovers.forEach((p, i) => sensors.push(sensorCircle(`rollover-${i}`, p, 27)));

  return {
    colliders,
    sensors,
    flippers: [leftFlipper, rightFlipper],
    leftFlipper,
    rightFlipper,
    bumpers,
    dropTargets,
    standupTargets,
    slingshots,
    posts,
    saucer: { center: saucerCenter, radius: saucerRadius },
    rampPath,
    warpPath,
    warpFork,
    warpForkIndex,
    rollovers,
    missionLamps,
    plunger: {
      x: LANE_CENTER,
      y: LANE_FLOOR - BALL_RADIUS - 2 - PLUNGER_TRAVEL,
    },
    laneGate,
  };
}
