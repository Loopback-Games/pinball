import { Flipper } from '../engine/flipper.js';
import type { Collider } from '../engine/shapes.js';
import { arc, circle, segment, segmentFlipped } from '../engine/shapes.js';
import type { SurfaceOptions } from '../engine/shapes.js';
import type { Vec2 } from '../engine/vec2.js';
import { lerp, vec } from '../engine/vec2.js';
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

/** Everything below this line, inside the play area, is lost. */
export const DRAIN_Y = 938;

const deg = (d: number): number => (d * Math.PI) / 180;
const mirrorPoint = (p: Vec2): Vec2 => vec(MIRROR - p.x, p.y);

/** Wall styling shared by the table's structural boundary. */
const WALL: SurfaceOptions = { restitution: 0.45, friction: 0.04 };
/**
 * Smooth curved rails: the dome and the orbit guides. A ball riding a curve
 * makes many shallow contacts per second, so these keep restitution high and
 * friction near zero. Otherwise an orbit shot arrives at the top with almost
 * nothing left.
 */
const RAIL: SurfaceOptions = { restitution: 0.62, friction: 0.005 };
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
    out.push(
      side === 'right' ? segment(id, a, b, o) : segmentFlipped(id, a, b, o),
    );
  }
  return out;
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
  rollovers: Vec2[];
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
  colliders.push(
    arc('wall', DOME_CENTER, DOME_RADIUS, deg(180), deg(360), RAIL),
  );

  // Left wall, straight down the side of the play area.
  colliders.push(...polyline('wall', [vec(PLAY_LEFT, LANE_TOP), vec(PLAY_LEFT, 980)], 'right'));

  // The shooter lane divider doubles as the right edge of the play area.
  colliders.push(
    ...polyline('wall', [vec(LANE_LEFT, 980), vec(LANE_LEFT, LANE_TOP)], 'right'),
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
  const laneGate = segment(
    'gate',
    vec(LANE_LEFT, LANE_TOP),
    vec(LANE_RIGHT, LANE_TOP),
    { restitution: 0.2, oneWay: true },
  );
  colliders.push(laneGate);

  /* --- Orbit guides --------------------------------------------------- */

  // Two arcs inside the dome forming the orbit lanes. A ball with enough speed
  // rides the channel between guide and dome all the way over the top.
  colliders.push(
    arc('guide', DOME_CENTER, 222, deg(180), deg(252), RAIL),
    arc('guide', DOME_CENTER, 222, deg(288), deg(360), RAIL),
  );

  // Straight continuations that turn each guide into a lane wall lower down.
  colliders.push(...polyline('guide', [vec(78, LANE_TOP), vec(78, 566)], 'left', RAIL));

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

  const dropTargets = bank(
    'drop',
    vec(112, 434),
    vec(172, 356),
    3,
    'left',
    { restitution: 0.3, friction: 0.1, radius: 4 },
  );
  const standupTargets = bank(
    'target',
    mirrorPoint(vec(112, 434)),
    mirrorPoint(vec(172, 356)),
    3,
    'right',
    { restitution: 0.45, friction: 0.1, radius: 4 },
  );
  for (const t of [...dropTargets, ...standupTargets]) colliders.push(t.collider);

  /* --- Saucer ---------------------------------------------------------- */

  // A cup open at the bottom: the ball is shot up into it and cannot roll out
  // on its own, so the rule layer decides when to kick it free.
  const saucerCenter = vec(200, 486);
  const saucerRadius = 36;
  colliders.push(
    arc('saucer-wall', saucerCenter, saucerRadius, deg(135), deg(405), {
      restitution: 0.12,
      friction: 0.5,
    }),
  );
  sensors.push(sensorCircle('saucer', saucerCenter, 20));

  /* --- Habitrail ramp --------------------------------------------------- */

  // Entry funnel on the right, feeding a wire ramp that returns the ball to the
  // left inlane. The ramp itself is a path the rule layer walks the ball along.
  const rampEntry = vec(404, 520);
  colliders.push(
    ...polyline('guide', [vec(372, 566), vec(384, 500)], 'right'),
    ...polyline('guide', [vec(436, 566), vec(424, 500)], 'left'),
  );
  sensors.push(sensorCircle('ramp-entry', rampEntry, 22));
  const rampPath: Vec2[] = [
    rampEntry,
    vec(420, 430),
    vec(400, 330),
    vec(330, 268),
    vec(230, 268),
    vec(140, 330),
    vec(104, 440),
    vec(96, 560),
    vec(84, 660),
  ];

  /* --- Posts ------------------------------------------------------------ */

  const posts: BumperSpec[] = [
    { id: 'post', center: vec(146, 616), radius: 9 },
    { id: 'post', center: mirrorPoint(vec(146, 616)), radius: 9 },
    { id: 'post', center: vec(278, 596), radius: 9 },
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
    ...polyline(
      'guide',
      [mirrorPoint(dividerTop), mirrorPoint(dividerBottom)],
      'left',
      { ...WALL, radius: 5 },
    ),
  );

  // Slingshot bodies. The hypotenuse faces up the playfield and does the work.
  const slingA = vec(100, 672);
  const slingB = vec(100, 792);
  const slingC = vec(182, 806);
  const slingshots: SlingshotSpec[] = [
    { id: 'sling-left', a: slingA, b: slingB, c: slingC },
    {
      id: 'sling-right',
      a: mirrorPoint(slingA),
      b: mirrorPoint(slingB),
      c: mirrorPoint(slingC),
    },
  ];
  for (const s of slingshots) {
    const kicking: SurfaceOptions = {
      restitution: 0.5,
      friction: 0.05,
      kick: 620,
      radius: 5,
    };
    const side = s.id === 'sling-left' ? 'right' : 'left';
    const inner = side === 'right' ? 'left' : 'right';
    colliders.push(
      ...polyline(s.id, [s.a, s.c], side, kicking),
      ...polyline('wall', [s.c, s.b], inner, { ...WALL, radius: 5 }),
      ...polyline('wall', [s.b, s.a], inner, { ...WALL, radius: 5 }),
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

  const leftFlipper = new Flipper({
    id: 'flipper-left',
    pivot: vec(194, 838),
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
    pivot: mirrorPoint(vec(194, 838)),
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
    sensorRect('drain', PLAY_LEFT, DRAIN_Y, PLAY_RIGHT - PLAY_LEFT, TABLE_H - DRAIN_Y),
    sensorRect('outlane-left', PLAY_LEFT, 820, 38, 80),
    sensorRect('outlane-right', MIRROR - PLAY_LEFT - 38, 820, 38, 80),
    sensorRect('inlane-left', 64, 820, 34, 60),
    sensorRect('inlane-right', MIRROR - 98, 820, 34, 60),
    sensorRect('lane-exit', LANE_LEFT, LANE_TOP - 30, LANE_RIGHT - LANE_LEFT, 30),
    sensorRect('spinner', PLAY_LEFT + 2, 560, 50, 26),
  );

  const rollovers: Vec2[] = [
    vec(238, 58),
    vec(300, 42),
    vec(362, 58),
  ];
  rollovers.forEach((p, i) => sensors.push(sensorCircle(`rollover-${i}`, p, 22)));

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
    rollovers,
    plunger: { x: LANE_CENTER, y: LANE_FLOOR - BALL_RADIUS - 2 },
    laneGate,
  };
}
