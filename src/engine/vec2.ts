/** An immutable 2D vector. Every helper returns a new object. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const ZERO: Vec2 = { x: 0, y: 0 };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** The 2D analogue of a cross product: the z component of a x b. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const lengthSq = (a: Vec2): number => a.x * a.x + a.y * a.y;

export const length = (a: Vec2): number => Math.hypot(a.x, a.y);

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Rotate 90 degrees counter-clockwise in screen space (y pointing down). */
export const perp = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });

export function normalize(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (len < 1e-12) return ZERO;
  return { x: a.x / len, y: a.y / len };
}

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const fromAngle = (radians: number, len = 1): Vec2 => ({
  x: Math.cos(radians) * len,
  y: Math.sin(radians) * len,
});

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

/** Rotate `a` about the origin by `radians`. */
export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Rotate `a` about `pivot` by `radians`. */
export function rotateAround(a: Vec2, pivot: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const dx = a.x - pivot.x;
  const dy = a.y - pivot.y;
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
}

/** Closest point to `p` on the segment `a`-`b`. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return a;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
