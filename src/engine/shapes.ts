import type { Vec2 } from './vec2.js';
import { closestPointOnSegment, normalize, perp, sub, vec } from './vec2.js';

/**
 * Surface properties shared by every collider.
 *
 * `kick` is an impulse added along the surface normal after the bounce is
 * resolved. It is what makes bumpers and slingshots throw the ball rather than
 * merely reflect it.
 */
export interface Surface {
  /** Identifier used by the rule layer to recognise what was hit. */
  readonly id: string;
  /** Fraction of normal velocity retained on bounce. 0 = dead, 1 = perfect. */
  restitution: number;
  /** Fraction of tangential velocity removed on contact. */
  friction: number;
  /** Extra outward speed added on contact, in units per second. */
  kick: number;
  /** Disabled colliders are skipped entirely (dropped targets, open gates). */
  enabled: boolean;
  /**
   * A one-way surface only blocks a ball approaching against its normal from
   * the outside; balls travelling with the normal pass straight through.
   */
  oneWay: boolean;
}

/**
 * A line with an optional thickness, which makes it a capsule.
 *
 * A capsule is the right primitive for anything the ball might end up inside,
 * such as a flipper: every point has an unambiguous nearest surface, so a ball
 * that somehow gets in is always pushed straight back out. Built from two flat
 * faces and two end circles instead, the interior is a trap.
 *
 * `radius` 0 is an ordinary infinitely thin wall.
 */
export interface SegmentCollider extends Surface {
  readonly kind: 'segment';
  a: Vec2;
  b: Vec2;
  /** Thickness of the capsule around the line. 0 for a plain wall. */
  radius: number;
  /** Unit normal, pointing towards the side the ball is expected to be on. */
  normal: Vec2;
}

export interface CircleCollider extends Surface {
  readonly kind: 'circle';
  center: Vec2;
  radius: number;
}

/**
 * A section of a circle, treated as a thin curved wall that is solid from both
 * sides. Angles are in radians, measured with atan2, and the arc runs from `a0`
 * upwards through increasing angle to `a1`.
 *
 * Which side the ball bounces off is decided by where the ball actually is, not
 * by a declared facing. The orbit guides have balls on both sides at once, so a
 * single-sided arc would let one of them through.
 */
export interface ArcCollider extends Surface {
  readonly kind: 'arc';
  center: Vec2;
  radius: number;
  a0: number;
  a1: number;
}

export type Collider = SegmentCollider | CircleCollider | ArcCollider;

export interface SurfaceOptions {
  restitution?: number;
  friction?: number;
  kick?: number;
  enabled?: boolean;
  oneWay?: boolean;
  /** Thickness, for segments only. Turns the wall into a capsule. */
  radius?: number;
}

const surfaceDefaults = (id: string, o: SurfaceOptions = {}): Surface => ({
  id,
  restitution: o.restitution ?? 0.42,
  friction: o.friction ?? 0.02,
  kick: o.kick ?? 0,
  enabled: o.enabled ?? true,
  oneWay: o.oneWay ?? false,
});

/**
 * Build a segment. The normal is the left-hand perpendicular of a->b, so
 * winding the table walls consistently puts every normal on the playfield side.
 */
export function segment(
  id: string,
  a: Vec2,
  b: Vec2,
  o: SurfaceOptions = {},
): SegmentCollider {
  return {
    ...surfaceDefaults(id, o),
    kind: 'segment',
    a,
    b,
    radius: o.radius ?? 0,
    normal: normalize(perp(sub(b, a))),
  };
}

/** Build a segment whose normal is flipped relative to `segment`. */
export function segmentFlipped(
  id: string,
  a: Vec2,
  b: Vec2,
  o: SurfaceOptions = {},
): SegmentCollider {
  const s = segment(id, a, b, o);
  s.normal = vec(-s.normal.x, -s.normal.y);
  return s;
}

export function circle(
  id: string,
  center: Vec2,
  radius: number,
  o: SurfaceOptions = {},
): CircleCollider {
  return { ...surfaceDefaults(id, o), kind: 'circle', center, radius };
}

export function arc(
  id: string,
  center: Vec2,
  radius: number,
  a0: number,
  a1: number,
  o: SurfaceOptions = {},
): ArcCollider {
  return { ...surfaceDefaults(id, o), kind: 'arc', center, radius, a0, a1 };
}

const TAU = Math.PI * 2;

/** True if `angle` lies within the arc's angular span. */
export function arcContainsAngle(a: ArcCollider, angle: number): boolean {
  const span = a.a1 - a.a0;
  if (span >= TAU) return true;
  let rel = (angle - a.a0) % TAU;
  if (rel < 0) rel += TAU;
  return rel <= span;
}

/** A resolved contact between the ball and a collider. */
export interface Contact {
  /** Unit normal pointing from the surface towards the ball. */
  normal: Vec2;
  /** World-space point of contact on the surface. */
  point: Vec2;
  /** How far the ball has penetrated the surface, in units. Never negative. */
  depth: number;
}

/**
 * Test a stationary ball against a collider. Returns the contact if the ball
 * overlaps the surface, otherwise null.
 *
 * This is the fallback path: it catches balls that a moving surface (a flipper)
 * has pushed into, which no amount of sweeping the ball would find.
 */
export function overlap(c: Collider, p: Vec2, r: number): Contact | null {
  if (!c.enabled) return null;
  switch (c.kind) {
    case 'segment': {
      const q = closestPointOnSegment(p, c.a, c.b);
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dist = Math.hypot(dx, dy);
      const sum = r + c.radius;
      if (dist >= sum) return null;
      // On the wrong side of a one-way surface, there is nothing to collide with.
      const side = dx * c.normal.x + dy * c.normal.y;
      if (c.oneWay && side < 0) return null;
      // Dead centre of a capsule has no defined direction; push along the
      // declared normal so the ball still gets out.
      const n = dist > 1e-9 ? vec(dx / dist, dy / dist) : c.normal;
      return {
        normal: n,
        point: vec(q.x + n.x * c.radius, q.y + n.y * c.radius),
        depth: sum - dist,
      };
    }
    case 'circle': {
      const dx = p.x - c.center.x;
      const dy = p.y - c.center.y;
      const dist = Math.hypot(dx, dy);
      const sum = r + c.radius;
      if (dist >= sum) return null;
      const n = dist > 1e-9 ? vec(dx / dist, dy / dist) : vec(0, -1);
      return {
        normal: n,
        point: vec(c.center.x + n.x * c.radius, c.center.y + n.y * c.radius),
        depth: sum - dist,
      };
    }
    case 'arc': {
      const dx = p.x - c.center.x;
      const dy = p.y - c.center.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-9) return null;
      // Signed distance from the wall itself, positive outside the circle.
      const d = dist - c.radius;
      if (Math.abs(d) >= r) return null;
      if (!arcContainsAngle(c, Math.atan2(dy, dx))) return null;
      const side = d >= 0 ? 1 : -1;
      const radial = vec(dx / dist, dy / dist);
      return {
        normal: vec(radial.x * side, radial.y * side),
        point: vec(
          c.center.x + radial.x * c.radius,
          c.center.y + radial.y * c.radius,
        ),
        depth: r - Math.abs(d),
      };
    }
  }
}

export interface Sweep {
  /** Time of impact, in the same units as the velocity's time base. */
  t: number;
  normal: Vec2;
  point: Vec2;
}

/** Smallest non-negative root of at^2 + bt + c, or null if there is none. */
function firstRoot(a: number, b: number, c: number, maxT: number): number | null {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return null;
    const t = -c / b;
    return t >= 0 && t <= maxT ? t : null;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  if (lo >= 0 && lo <= maxT) return lo;
  if (hi >= 0 && hi <= maxT) return hi;
  return null;
}

/** Time at which a moving ball first touches a static circle of radius `rad`. */
function sweepCircle(
  p: Vec2,
  v: Vec2,
  r: number,
  center: Vec2,
  rad: number,
  maxT: number,
): number | null {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const sum = r + rad;
  const a = v.x * v.x + v.y * v.y;
  const b = 2 * (dx * v.x + dy * v.y);
  const c = dx * dx + dy * dy - sum * sum;
  if (c < 0) return null; // already overlapping; the overlap pass handles it
  if (b >= 0) return null; // moving away
  return firstRoot(a, b, c, maxT);
}

/**
 * Advance a ball of radius `r` from `p` along `v` and report the first contact
 * with `c` within `maxT`, or null if there is none.
 */
export function sweep(
  c: Collider,
  p: Vec2,
  v: Vec2,
  r: number,
  maxT: number,
): Sweep | null {
  if (!c.enabled) return null;
  switch (c.kind) {
    case 'segment':
      return sweepSegment(c, p, v, r, maxT);
    case 'circle': {
      const t = sweepCircle(p, v, r, c.center, c.radius, maxT);
      if (t === null) return null;
      const hit = vec(p.x + v.x * t, p.y + v.y * t);
      const n = normalize(sub(hit, c.center));
      return {
        t,
        normal: n,
        point: vec(c.center.x + n.x * c.radius, c.center.y + n.y * c.radius),
      };
    }
    case 'arc':
      return sweepArc(c, p, v, r, maxT);
  }
}

function sweepSegment(
  c: SegmentCollider,
  p: Vec2,
  v: Vec2,
  r: number,
  maxT: number,
): Sweep | null {
  const n = c.normal;
  const rr = r + c.radius; // Minkowski radius: ball inflated by capsule thickness
  const d0 = (p.x - c.a.x) * n.x + (p.y - c.a.y) * n.y;
  const vn = v.x * n.x + v.y * n.y;
  let best: Sweep | null = null;

  // The two flat faces of the capsule. A one-way surface only has the face on
  // its normal side.
  const sides: number[] = c.oneWay ? [1] : d0 >= 0 ? [1, -1] : [-1, 1];
  for (const s of sides) {
    if (s > 0 && d0 < 0) continue;
    if (s < 0 && d0 > 0) continue;
    if (Math.abs(vn) < 1e-12) continue;
    const t = (s * rr - d0) / vn;
    if (t < 0 || t > maxT) continue;
    // Must be approaching the face, not leaving it.
    if (s * vn >= 0) continue;
    const hx = p.x + v.x * t;
    const hy = p.y + v.y * t;
    const cx = hx - n.x * s * rr;
    const cy = hy - n.y * s * rr;
    const abx = c.b.x - c.a.x;
    const aby = c.b.y - c.a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq < 1e-12) continue;
    const u = ((cx - c.a.x) * abx + (cy - c.a.y) * aby) / lenSq;
    if (u < 0 || u > 1) continue;
    best = {
      t,
      normal: vec(n.x * s, n.y * s),
      point: vec(cx + n.x * s * c.radius, cy + n.y * s * c.radius),
    };
    break;
  }

  // The rounded caps at each end.
  if (!c.oneWay) {
    for (const end of [c.a, c.b]) {
      const t = sweepCircle(p, v, r, end, c.radius, best?.t ?? maxT);
      if (t === null) continue;
      const hit = vec(p.x + v.x * t, p.y + v.y * t);
      const nn = normalize(sub(hit, end));
      best = {
        t,
        normal: nn,
        point: vec(end.x + nn.x * c.radius, end.y + nn.y * c.radius),
      };
    }
  }
  return best;
}

function sweepArc(
  c: ArcCollider,
  p: Vec2,
  v: Vec2,
  r: number,
  maxT: number,
): Sweep | null {
  const dx = p.x - c.center.x;
  const dy = p.y - c.center.y;
  const a = v.x * v.x + v.y * v.y;
  if (a < 1e-12) return null;

  // The ball approaches whichever face of the wall it is currently on.
  const distSq = dx * dx + dy * dy;
  const outside = distSq >= c.radius * c.radius;
  const k = outside ? c.radius + r : c.radius - r;
  if (k <= 0) return null;
  const b = 2 * (dx * v.x + dy * v.y);
  const cc = distSq - k * k;

  let t: number | null;
  if (outside) {
    if (cc < 0) return null; // already within the band; overlap handles it
    if (b >= 0) return null; // moving away
    t = firstRoot(a, b, cc, maxT);
  } else {
    // Inside: the contact is where the ball crosses outwards.
    if (cc > 0) return null;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const root = (-b + Math.sqrt(disc)) / (2 * a);
    t = root >= 0 && root <= maxT ? root : null;
  }
  if (t === null) return null;

  const hx = p.x + v.x * t;
  const hy = p.y + v.y * t;
  const ang = Math.atan2(hy - c.center.y, hx - c.center.x);
  if (!arcContainsAngle(c, ang)) return null;

  const nx = Math.cos(ang);
  const ny = Math.sin(ang);
  const sign = outside ? 1 : -1;
  return {
    t,
    normal: vec(nx * sign, ny * sign),
    point: vec(c.center.x + nx * c.radius, c.center.y + ny * c.radius),
  };
}
