import { describe, expect, it } from 'vitest';
import { createBall, World, DEFAULT_WORLD } from '../src/engine/physics.js';
import type { Collision } from '../src/engine/physics.js';
import { overlap } from '../src/engine/shapes.js';
import type { Collider } from '../src/engine/shapes.js';
import type { Vec2 } from '../src/engine/vec2.js';
import { vec } from '../src/engine/vec2.js';
import {
  BALL_RADIUS,
  DOME_CENTER,
  DOME_RADIUS,
  DRAIN_Y,
  LANE_RIGHT,
  PLAY_LEFT,
  PLAY_CENTER,
  PLAY_RIGHT,
  TABLE_H,
  buildTable,
} from '../src/game/table.js';

/** Deterministic PRNG, so a failure is always reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const H = 1 / 480;

/**
 * A spawn point is legal only if a ball could actually be there: under the
 * dome, inside the play area, and not embedded in any collider. Being clear of
 * every wall is not enough on its own, since the whole region outside the dome
 * is also clear of walls and is not on the table.
 */
function isPlayable(colliders: readonly Collider[], p: Vec2): boolean {
  const fromDome = Math.hypot(p.x - DOME_CENTER.x, p.y - DOME_CENTER.y);
  if (fromDome > DOME_RADIUS - BALL_RADIUS - 4) return false;
  if (p.x < PLAY_LEFT + BALL_RADIUS + 4) return false;
  if (p.x > PLAY_RIGHT - BALL_RADIUS - 4) return false;
  for (const c of colliders) {
    if (overlap(c, p, BALL_RADIUS + 2)) return false;
  }
  return true;
}

describe('table geometry', () => {
  it('builds without degenerate colliders', () => {
    const table = buildTable();
    expect(table.colliders.length).toBeGreaterThan(20);
    for (const c of table.colliders) {
      if (c.kind === 'segment') {
        expect(Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y)).toBeGreaterThan(1e-6);
        expect(Math.hypot(c.normal.x, c.normal.y)).toBeCloseTo(1, 6);
      } else {
        expect(c.radius).toBeGreaterThan(0);
      }
    }
  });

  it('never lets a ball leave the table, from anywhere at any speed', () => {
    const table = buildTable();
    const random = rng(20260823);
    const escapes: string[] = [];

    for (let trial = 0; trial < 240; trial += 1) {
      const world = new World(DEFAULT_WORLD);
      world.statics = table.colliders;
      world.movers = table.flippers;

      // Start somewhere in the play area that a ball could actually occupy.
      // Points outside the dome are off the table, and a ball started inside a
      // wall proves nothing.
      let start = vec(PLAY_CENTER, 600);
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const candidate = vec(50 + random() * 460, 50 + random() * 820);
        if (isPlayable(table.colliders, candidate)) {
          start = candidate;
          break;
        }
      }
      const ball = createBall(start, BALL_RADIUS);
      const angle = random() * Math.PI * 2;
      const speed = 1200 + random() * 2600;
      ball.vel = vec(Math.cos(angle) * speed, Math.sin(angle) * speed);

      const events: Collision[] = [];
      for (let i = 0; i < 480 * 6; i += 1) {
        for (const f of table.flippers) f.step(H);
        const prev = ball.pos;
        const prevSpeed = Math.hypot(ball.vel.x, ball.vel.y);
        world.substep(ball, H, events);
        // A ball may only travel about as far as its speed allows. Anything
        // more means a collider yanked it somewhere, which is how a badly
        // bounded surface shows itself.
        const moved = Math.hypot(ball.pos.x - prev.x, ball.pos.y - prev.y);
        // The slack covers legitimate depenetration, which can move a ball by
        // up to its own radius in a single step.
        const allowed =
          Math.max(prevSpeed, Math.hypot(ball.vel.x, ball.vel.y)) * H +
          BALL_RADIUS +
          6;
        if (moved > allowed) {
          escapes.push(
            `trial ${trial}: jumped ${moved.toFixed(0)} units in one step, ` +
              `${prev.x.toFixed(0)},${prev.y.toFixed(0)} -> ` +
              `${ball.pos.x.toFixed(0)},${ball.pos.y.toFixed(0)}`,
          );
          break;
        }
        if (ball.pos.y > DRAIN_Y) break; // drained, which is legal
        const outside =
          ball.pos.x < PLAY_LEFT - BALL_RADIUS ||
          ball.pos.x > LANE_RIGHT + BALL_RADIUS ||
          ball.pos.y < -BALL_RADIUS ||
          ball.pos.y > TABLE_H;
        if (outside) {
          escapes.push(
            `trial ${trial}: escaped to ${ball.pos.x.toFixed(0)},${ball.pos.y.toFixed(0)}`,
          );
          break;
        }
      }
    }

    expect(escapes).toEqual([]);
  });

  it('sends a launched ball out of the shooter lane and into play', () => {
    const table = buildTable();
    const world = new World(DEFAULT_WORLD);
    world.statics = table.colliders;
    world.movers = table.flippers;

    const ball = createBall(vec(table.plunger.x, table.plunger.y), BALL_RADIUS);
    ball.vel = vec(0, -2600);

    const events: Collision[] = [];
    let reachedDome = false;
    for (let i = 0; i < 480 * 4; i += 1) {
      world.substep(ball, H, events);
      if (ball.pos.y < 200) reachedDome = true;
      if (reachedDome && ball.pos.x < 480) break;
    }
    expect(reachedDome).toBe(true);
    // Having gone round the dome it must end up in the play area, not stuck
    // back in the lane.
    expect(ball.pos.x).toBeLessThan(500);
  });
});
