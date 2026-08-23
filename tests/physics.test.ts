import { describe, expect, it } from 'vitest';
import { Flipper } from '../src/engine/flipper.js';
import { createBall, World, DEFAULT_WORLD } from '../src/engine/physics.js';
import type { Collision } from '../src/engine/physics.js';
import { circle, segment, segmentFlipped } from '../src/engine/shapes.js';
import { vec } from '../src/engine/vec2.js';

/** A closed box with normals facing inward, for containment tests. */
function box(w: number, h: number) {
  return [
    segment('top', vec(0, 0), vec(w, 0), { restitution: 0.5 }),
    segment('right', vec(w, 0), vec(w, h), { restitution: 0.5 }),
    segment('bottom', vec(w, h), vec(0, h), { restitution: 0.5 }),
    segment('left', vec(0, h), vec(0, 0), { restitution: 0.5 }),
  ];
}

const H = 1 / 480;

function run(world: World, ball: ReturnType<typeof createBall>, seconds: number) {
  const events: Collision[] = [];
  const steps = Math.round(seconds / H);
  for (let i = 0; i < steps; i += 1) {
    world.substep(ball, H, events);
  }
  return events;
}

describe('containment', () => {
  it('keeps a ball inside a box at extreme speed', () => {
    const world = new World({ ...DEFAULT_WORLD, drag: 0, gravity: 0 });
    world.statics = box(600, 1000);
    const ball = createBall(vec(300, 500), 13.5);
    // Far faster than the plunger can ever launch, on an irrational heading so
    // it does not settle into a symmetric path that never probes the corners.
    ball.vel = vec(3900, 2731);
    run(world, ball, 4);

    expect(ball.pos.x).toBeGreaterThan(0);
    expect(ball.pos.x).toBeLessThan(600);
    expect(ball.pos.y).toBeGreaterThan(0);
    expect(ball.pos.y).toBeLessThan(1000);
  });

  it('does not let a ball escape through a corner', () => {
    const world = new World({ ...DEFAULT_WORLD, drag: 0, gravity: 0 });
    world.statics = box(400, 400);
    const ball = createBall(vec(200, 200), 12);
    ball.vel = vec(4000, 4000); // aimed exactly at the corner
    run(world, ball, 3);

    expect(ball.pos.x).toBeGreaterThan(0);
    expect(ball.pos.y).toBeGreaterThan(0);
    expect(ball.pos.x).toBeLessThan(400);
    expect(ball.pos.y).toBeLessThan(400);
  });
});

describe('gravity and restitution', () => {
  it('accelerates a free ball downhill at the configured rate', () => {
    const world = new World({ ...DEFAULT_WORLD, drag: 0 });
    const ball = createBall(vec(0, 0), 10);
    run(world, ball, 1);
    expect(ball.vel.y).toBeCloseTo(DEFAULT_WORLD.gravity, 0);
  });

  it('returns the configured fraction of speed on a bounce', () => {
    const world = new World({ ...DEFAULT_WORLD, gravity: 0, drag: 0 });
    world.statics = [
      segmentFlipped('floor', vec(0, 100), vec(500, 100), { restitution: 0.5, friction: 0 }),
    ];
    const ball = createBall(vec(250, 50), 10);
    ball.vel = vec(0, 600);
    run(world, ball, 0.4);
    expect(ball.vel.y).toBeCloseTo(-300, -1);
  });

  it('kills bounces below the threshold so resting balls do not jitter', () => {
    const world = new World({ ...DEFAULT_WORLD, drag: 0 });
    world.statics = [
      segmentFlipped('floor', vec(0, 300), vec(500, 300), { restitution: 0.5 }),
    ];
    const ball = createBall(vec(250, 100), 10);
    run(world, ball, 6);
    expect(Math.abs(ball.vel.y)).toBeLessThan(60);
    expect(ball.pos.y).toBeCloseTo(300 - 10, 0);
  });
});

describe('kickers', () => {
  it('throws the ball outward with the configured kick', () => {
    const world = new World({ ...DEFAULT_WORLD, gravity: 0, drag: 0 });
    world.statics = [
      circle('bumper', vec(250, 250), 20, { restitution: 0.3, kick: 900 }),
    ];
    const ball = createBall(vec(250, 100), 10);
    ball.vel = vec(0, 400);
    run(world, ball, 0.5);
    // It came in at 400 and must leave faster than it arrived.
    expect(ball.vel.y).toBeLessThan(-400);
  });
});

describe('flippers', () => {
  it('adds energy to a resting ball when raised', () => {
    const world = new World({ ...DEFAULT_WORLD, gravity: 0, drag: 0 });
    const flipper = new Flipper({
      id: 'left',
      pivot: vec(200, 400),
      length: 70,
      pivotRadius: 12,
      tipRadius: 8,
      restAngle: 0.5,
      activeAngle: -0.5,
    });
    world.movers = [flipper];

    // Rest the ball just above the middle of the bat.
    const ball = createBall(vec(232, 405), 13.5);
    flipper.pressed = true;

    const events: Collision[] = [];
    const h = 1 / 480;
    for (let i = 0; i < 240; i += 1) {
      flipper.step(h);
      world.substep(ball, h, events);
    }

    expect(events.some((e) => e.id === 'left')).toBe(true);
    // Struck from below, the ball must end up travelling up the table.
    expect(ball.vel.y).toBeLessThan(-100);
  });

  it('holds a ball up rather than letting it pass through', () => {
    const world = new World(DEFAULT_WORLD);
    const flipper = new Flipper({
      id: 'left',
      pivot: vec(200, 400),
      length: 70,
      pivotRadius: 12,
      tipRadius: 8,
      restAngle: 0.5,
      activeAngle: -0.5,
    });
    world.movers = [flipper];
    const ball = createBall(vec(230, 340), 13.5);
    ball.vel = vec(0, 1800); // dropped hard onto a held flipper
    flipper.pressed = true;

    const events: Collision[] = [];
    const h = 1 / 480;
    for (let i = 0; i < 480; i += 1) {
      flipper.step(h);
      world.substep(ball, h, events);
    }
    expect(ball.pos.y).toBeLessThan(420);
  });
});
