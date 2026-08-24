import { Flipper } from '../engine/flipper.js';
import type { WorldConfig } from '../engine/physics.js';
import { DEFAULT_WORLD, World } from '../engine/physics.js';
import type { Collider } from '../engine/shapes.js';
import { arc, circle, segment, segmentFlipped } from '../engine/shapes.js';
import type { SurfaceOptions } from '../engine/shapes.js';
import type { Vec2 } from '../engine/vec2.js';
import { distance, lerp, vec } from '../engine/vec2.js';
import { SLINGSHOT_KICK } from './rules.js';
import type { Sensor } from './sensors.js';
import { sensorRect } from './sensors.js';

/* ------------------------------------------------------------------ *
 * Table dimensions.
 *
 * One unit is roughly one millimetre of a real playfield, which keeps the
 * physics constants in a range that behaves like the real thing. The shooter
 * lane sits outside the play area on the right, so the play area is not
 * centred on the table: the dome spans the full width, the flippers do not.
 *
 * Every machine shares these, and shares the chassis built from them. The
 * lower third of a real pinball table is near-universal, and the parts of this
 * one are the parts that took the most care to get right: the drain gap falls
 * out of pivot separation, flipper reach and bat radius, and the apron, the
 * lane gate and the shooter divider each exist to close a specific pocket that
 * used to trap balls. What varies between machines is everything above the
 * flippers.
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

export const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * Sample a Catmull-Rom spline through `points`, producing a dense polyline.
 *
 * A habitrail is authored as a handful of control points; drawing or walking
 * a ball along those directly shows every kink. Sampling a spline through them
 * gives a curve that looks and feels like bent wire.
 */
export function smoothPath(points: readonly Vec2[], perSegment = 10): Vec2[] {
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

export const mirrorPoint = (p: Vec2): Vec2 => vec(MIRROR - p.x, p.y);

/** Wall styling shared by the table's structural boundary. */
export const WALL: SurfaceOptions = { restitution: 0.45, friction: 0.04 };
/**
 * Smooth curved rails: the dome and the orbit guides. A ball riding a curve
 * makes many shallow contacts per second, so these keep restitution high and
 * friction near zero. Otherwise an orbit shot arrives at the top with almost
 * nothing left.
 */
export const RAIL: SurfaceOptions = { restitution: 0.72, friction: 0.002 };
export const RUBBER: SurfaceOptions = { restitution: 0.62, friction: 0.04, radius: 5 };

/**
 * Chain of segments through `points`. `side` picks which way the normals face:
 * 'right' is the normal produced by walking the points in order, 'left' is the
 * opposite. Every wall in every table is built from this, so a mis-facing wall
 * is a one-word fix rather than a hunt through individual segments.
 */
export function polyline(
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

/**
 * A spinner: a vane hung across a lane that the ball knocks through.
 *
 * Held as data rather than as a constant in the renderer, because a machine
 * may have none, one or two of them and the blade has to turn where the switch
 * actually is.
 */
export interface SpinnerSpec {
  id: string;
  center: Vec2;
  w: number;
  h: number;
}

/**
 * Printing on the playfield.
 *
 * This used to be drawing code with coordinate literals in it, which meant the
 * art could only ever describe one layout. Authoring it as data beside the
 * geometry it annotates is the only place it can be kept correct.
 *
 * `color` names a role in the machine's theme rather than a colour, so a decal
 * stays legible whatever palette it is painted in.
 */
export type DecalColor =
  'primary' | 'secondary' | 'highlight' | 'success' | 'feature' | 'print';

export type Decal =
  | { kind: 'arrow'; at: Vec2; angle: number; color: DecalColor }
  | { kind: 'label'; at: Vec2; text: string; color: DecalColor; size?: number }
  | { kind: 'ring'; at: Vec2; radius: number; color: DecalColor }
  /** A stack of chevrons pointing up a lane. */
  | { kind: 'chevrons'; at: Vec2; count: number; color: DecalColor }
  /** A dashed run, used for the shooter lane and for guiding the eye up a shot. */
  | { kind: 'dashes'; from: Vec2; to: Vec2; color: DecalColor };

/**
 * Strike every pop bumper inside `window` seconds and the table goes off.
 *
 * Absent on a machine whose bumpers are not meant to be swept as a set: on a
 * row of three that a ball passes straight through, hitting all of them is
 * luck rather than a shot, and rewarding luck teaches nothing.
 */
export interface EruptionSpec {
  /** Seconds each hit buys before the set lapses. Rolling, not fixed. */
  window: number;
  /** Seconds the vent stays open. */
  seconds: number;
  /** What the table calls it. */
  name: string;
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
  spinners: SpinnerSpec[];
  saucer: { center: Vec2; radius: number };
  /** What the saucer is called on this machine, printed under the cup. */
  saucerLabel: string;
  /** Sweeping every bumper sets the table off, on a machine that has this. */
  eruption?: EruptionSpec;

  /**
   * Path a captured ball follows along the habitrail, entry first.
   *
   * Absent on a machine with no rail, in which case the ramp sensor is absent
   * too and the rule layer never has a ball to walk.
   */
  rampPath?: Vec2[];
  /**
   * The other side of a diverter: a fork that drops out of the habitrail and
   * into the saucer, entry first. Only a machine with a diverter has one.
   *
   * It shares the ramp's mouth and its climb, so the two paths are identical
   * until the fork and the rule layer only has to pick one of them.
   */
  warpPath?: Vec2[];
  /** Where the habitrail splits, so the diverter blade can be drawn on it. */
  warpFork?: Vec2;
  /** What the diverter is called, printed at the ramp mouth when it is armed. */
  warpLabel?: string;
  /**
   * Index of the fork in both paths. Everything before it is the same wire,
   * which is what lets the renderer draw one trunk and two branches instead of
   * two whole rails stacked on each other.
   */
  warpForkIndex?: number;
  rollovers: Vec2[];
  /** Insert lamps showing how many missions have been completed. */
  missionLamps: Vec2[];
  decals: Decal[];
  plunger: { x: number; y: number };
  /** The gate at the top of the shooter lane, held for rendering. */
  laneGate: Collider;
}

/**
 * The parts every machine has in common: the cabinet, the shooter lane, the
 * apron and the whole lower third.
 */
export interface Chassis {
  colliders: Collider[];
  sensors: Sensor[];
  flippers: Flipper[];
  leftFlipper: Flipper;
  rightFlipper: Flipper;
  slingshots: SlingshotSpec[];
  decals: Decal[];
  laneGate: Collider;
  plunger: { x: number; y: number };
}

/** Build everything a machine does not get to choose. */
export function buildChassis(): Chassis {
  const colliders: Collider[] = [];
  const sensors: Sensor[] = [];
  const decals: Decal[] = [];

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

  // The shooter lane is on the right on every machine, and that fixes more of
  // the design than it looks like it does. A launched ball goes up the right,
  // over the dome and down the LEFT, so the left is where every ball begins
  // its playfield life. That side has to be the safe one — a lane wall and a
  // one-way gate at its foot, feeding returns to the flippers — and the live
  // outlane has to be the right.
  //
  // A machine was built as a true mirror of that, gate on the right and
  // kickback on the left, and it failed on the table rather than in principle:
  // the ball spent 31% of its life pinned in the left gutter, reached the
  // saucer zero times in twelve games, and every ball drained inside the ball
  // save. Handedness on this cabinet is a property of the target banks and the
  // shot layout, not of the orbit.
  //
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

  /* --- Lower third: lanes, slingshots, flippers -------------------------- */

  // Divider between outlane and inlane, one per side.
  const dividerTop = vec(62, 654);
  const dividerBottom = vec(62, 872);
  colliders.push(
    ...polyline('guide', [dividerTop, dividerBottom], 'right', { ...WALL, radius: 5 }),
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
  );

  // Lane arrows pointing up the inlanes and outlanes, and the shooter lane's
  // floor marking.
  for (const x of [43, 81, PLAY_RIGHT - 43, PLAY_RIGHT - 81]) {
    decals.push({ kind: 'chevrons', at: vec(x, 792), count: 3, color: 'primary' });
  }
  decals.push({
    kind: 'dashes',
    from: vec(LANE_CENTER, LANE_FLOOR - 20),
    to: vec(LANE_CENTER, 320),
    color: 'highlight',
  });

  return {
    colliders,
    sensors,
    flippers: [leftFlipper, rightFlipper],
    leftFlipper,
    rightFlipper,
    slingshots,
    decals,
    laneGate,
    plunger: {
      x: LANE_CENTER,
      y: LANE_FLOOR - BALL_RADIUS - 2 - PLUNGER_TRAVEL,
    },
  };
}

/** Split a line into `count` collinear target faces with gaps between them. */
export function bank(
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
    const collider = side === 'right' ? segment(id, pa, pb, o) : segmentFlipped(id, pa, pb, o);
    out.push({ id, a: pa, b: pb, collider });
  }
  return out;
}

export const DROP_SURFACE: SurfaceOptions = { restitution: 0.3, friction: 0.1, radius: 4 };
export const STANDUP_SURFACE: SurfaceOptions = { restitution: 0.45, friction: 0.1, radius: 4 };

/** A pop bumper, ready to push into a machine's collider list. */
export function bumper(
  id: string,
  center: Vec2,
  radius = 26,
): { spec: BumperSpec; body: Collider } {
  return {
    spec: { id, center, radius },
    body: circle(id, center, radius, { restitution: 0.5, friction: 0, kick: 720 }),
  };
}

/** A post: small, hard and round, used to shape lanes. */
export function post(center: Vec2, radius = 9): { spec: BumperSpec; body: Collider } {
  return {
    spec: { id: 'post', center, radius },
    body: circle('post', center, radius, { restitution: 0.7, radius: 0 }),
  };
}

/**
 * A one-way gate: a ball travelling one way passes straight through, one
 * coming back is caught and turned into the playfield.
 */
export function segmentGate(a: Vec2, b: Vec2): Collider {
  return segment('gate', a, b, {
    restitution: 0.45,
    friction: 0.02,
    oneWay: true,
    radius: 3,
  });
}

/**
 * A pair of low standup targets either side of the centre corridor.
 *
 * They set the width of the only lane from the flippers up the middle of the
 * table, which is why they sit on the mirror line. Sloped outward, so a ball
 * that lands on one rolls off towards the slingshot instead of sitting on it
 * like a shelf.
 */
export function lowStandups(startIndex: number, x = 200, y = 640): TargetSpec[] {
  const out: TargetSpec[] = [];
  for (const [i, cx] of [x, MIRROR - x].entries()) {
    const id = `target-${startIndex + i}`;
    const outward = i === 0 ? -1 : 1;
    const a = vec(cx - 18 * outward, y);
    const b = vec(cx + 18 * outward, y + 18);
    out.push({ id, a, b, collider: segmentFlipped(id, a, b, STANDUP_SURFACE) });
  }
  return out;
}

/**
 * A saucer: a cup open at the bottom, so the ball is shot up into it and
 * cannot roll out on its own. The rule layer decides when to kick it free.
 */
export function saucerWall(center: Vec2, radius: number): Collider {
  // A 120 degree mouth at the bottom. Narrower than this and the shot that
  // gates every mission on the table is close to unmakeable.
  return arc('saucer-wall', center, radius, deg(150), deg(390), {
    restitution: 0.12,
    friction: 0.5,
  });
}

/**
 * Build the world a table is played in.
 *
 * One place, because the geometry suites used to construct a `World`
 * themselves: the moment a machine tunes its own physics, a test that built
 * its own world would be measuring a table nobody plays.
 */
export function createWorld(table: Table, config: Partial<WorldConfig> = {}): World {
  const world = new World({ ...DEFAULT_WORLD, ...config });
  world.statics = table.colliders;
  world.movers = table.flippers;
  return world;
}
