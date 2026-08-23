import type { Ball } from '../engine/physics.js';
import type { Vec2 } from '../engine/vec2.js';

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

export const sensorRect = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Sensor => ({ kind: 'rect', id, x, y, w, h });

export function sensorContains(s: Sensor, p: Vec2): boolean {
  if (s.kind === 'circle') {
    return Math.hypot(p.x - s.center.x, p.y - s.center.y) <= s.radius;
  }
  return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
}

export interface SensorHit {
  id: string;
  ball: Ball;
}

/**
 * Fires each sensor once per entry rather than once per frame, so a ball
 * loitering in a rollover does not score forever.
 */
export class SensorField {
  private readonly inside = new Set<string>();

  constructor(readonly sensors: readonly Sensor[]) {}

  /** Ids of sensors newly entered since the previous call. */
  update(balls: readonly Ball[]): SensorHit[] {
    const hits: SensorHit[] = [];
    const stillInside = new Set<string>();
    for (let i = 0; i < balls.length; i += 1) {
      const ball = balls[i];
      if (!ball || !ball.active) continue;
      for (const s of this.sensors) {
        if (!sensorContains(s, ball.pos)) continue;
        const key = `${s.id}:${i}`;
        stillInside.add(key);
        if (!this.inside.has(key)) hits.push({ id: s.id, ball });
      }
    }
    this.inside.clear();
    for (const key of stillInside) this.inside.add(key);
    return hits;
  }
}
