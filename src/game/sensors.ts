import type { Ball } from '../engine/physics.js';
import type { Vec2 } from '../engine/vec2.js';
import { closestPointOnSegment } from '../engine/vec2.js';

/**
 * A region that notices balls rather than blocking them.
 *
 * Rollovers, lane switches, the drain and the saucer are all sensors. Making
 * them regions rather than colliders keeps them out of the solver entirely, so
 * they cannot perturb the ball while detecting it.
 */
export type Sensor =
  | { kind: 'circle'; id: string; center: Vec2; radius: number }
  | { kind: 'rect'; id: string; x: number; y: number; w: number; h: number };

export const sensorCircle = (id: string, center: Vec2, radius: number): Sensor => ({
  kind: 'circle',
  id,
  center,
  radius,
});

export const sensorRect = (id: string, x: number, y: number, w: number, h: number): Sensor => ({
  kind: 'rect',
  id,
  x,
  y,
  w,
  h,
});

export function sensorContains(s: Sensor, p: Vec2): boolean {
  if (s.kind === 'circle') {
    return Math.hypot(p.x - s.center.x, p.y - s.center.y) <= s.radius;
  }
  return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
}

/**
 * True if the ball touched `s` anywhere between `from` and `to`.
 *
 * Sampling the ball's position once a frame is not enough. A ball leaves the
 * plunger at around two thousand units a second, which is thirty-odd units per
 * frame at sixty hertz and twice that at thirty; the lane exit switch is
 * thirty units tall and the ramp mouth under fifty across. Point sampling
 * misses those outright on a slow device, so a phone drops ramp shots a
 * desktop makes — and, occasionally, misses the drain itself.
 *
 * Sweeping the segment the ball actually travelled makes detection independent
 * of frame rate, which is the only way the same shot can score the same on
 * every device.
 */
export function sensorCrossed(s: Sensor, from: Vec2, to: Vec2): boolean {
  if (s.kind === 'circle') {
    const q = closestPointOnSegment(s.center, from, to);
    return Math.hypot(q.x - s.center.x, q.y - s.center.y) <= s.radius;
  }
  return segmentHitsRect(s.x, s.y, s.x + s.w, s.y + s.h, from, to);
}

/** Liang-Barsky: does the segment `from`-`to` meet the axis-aligned box? */
function segmentHitsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  from: Vec2,
  to: Vec2,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let exit = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, from.x - x0],
    [dx, x1 - from.x],
    [-dy, from.y - y0],
    [dy, y1 - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this pair of edges: outside them means no crossing at all.
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > exit) return false;
      if (r > enter) enter = r;
    } else {
      if (r < enter) return false;
      if (r < exit) exit = r;
    }
  }
  return true;
}

export interface SensorHit {
  id: string;
  ball: Ball;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Fires each sensor once per entry rather than once per frame, so a ball
 * loitering in a rollover does not score forever.
 *
 * Occupancy is keyed by the ball itself. Keying it by position in the array
 * looked equivalent and was not: the caller passes only the active balls, so
 * every drain and every multiball release renumbered them underneath, and a
 * ball inherited whatever the ball previously at its index had been sitting
 * in.
 */
export class SensorField {
  private inside = new Map<Ball, ReadonlySet<string>>();

  constructor(readonly sensors: readonly Sensor[]) {}

  /**
   * Ids of sensors newly entered since the previous call. `previous[i]` is
   * where `balls[i]` was before this frame's physics ran; the span between
   * the two is what gets tested.
   */
  update(balls: readonly Ball[], previous: readonly Vec2[] = []): SensorHit[] {
    const hits: SensorHit[] = [];
    const next = new Map<Ball, ReadonlySet<string>>();
    for (let i = 0; i < balls.length; i += 1) {
      const ball = balls[i];
      if (!ball || !ball.active) continue;
      const was = this.inside.get(ball) ?? NONE;
      const now = new Set<string>();
      const from = previous[i] ?? ball.pos;
      for (const s of this.sensors) {
        if (!sensorCrossed(s, from, ball.pos)) continue;
        now.add(s.id);
        if (!was.has(s.id)) hits.push({ id: s.id, ball });
      }
      next.set(ball, now);
    }
    this.inside = next;
    return hits;
  }
}
