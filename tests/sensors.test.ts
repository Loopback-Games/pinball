import { describe, expect, it } from 'vitest';
import { createBall } from '../src/engine/physics.js';
import { vec } from '../src/engine/vec2.js';
import {
  SensorField,
  sensorCircle,
  sensorCrossed,
  sensorRect,
} from '../src/game/sensors.js';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { BALL_RADIUS } from '../src/game/table.js';

describe('swept sensor detection', () => {
  const lane = sensorRect('lane', 100, 200, 40, 30);
  const rollover = sensorCircle('rollover', vec(300, 100), 24);

  it('notices a ball that crosses a region between two frames', () => {
    // A launched ball covers thirty-odd units a frame at sixty hertz and twice
    // that at thirty. Sampling only where it lands steps clean over a switch
    // this size, so the same shot scores on a desktop and not on a phone.
    expect(sensorCrossed(lane, vec(120, 120), vec(120, 320))).toBe(true);
    expect(sensorCrossed(rollover, vec(200, 100), vec(400, 100))).toBe(true);
  });

  it('leaves a ball that passes wide alone', () => {
    expect(sensorCrossed(lane, vec(20, 120), vec(20, 320))).toBe(false);
    expect(sensorCrossed(rollover, vec(200, 400), vec(400, 400))).toBe(false);
  });

  it('still reports a ball sitting inside the region', () => {
    expect(sensorCrossed(lane, vec(120, 210), vec(120, 210))).toBe(true);
    expect(sensorCrossed(rollover, vec(300, 100), vec(300, 100))).toBe(true);
  });

  it('fires once per entry, not once per frame', () => {
    const field = new SensorField([rollover]);
    const ball = createBall(vec(300, 100), BALL_RADIUS);
    expect(field.update([ball], [vec(300, 100)])).toHaveLength(1);
    expect(field.update([ball], [vec(300, 100)])).toHaveLength(0);
    // Leaving: the span still clips the region on the way out, so it counts
    // as staying inside for that frame.
    ball.pos = vec(300, 400);
    expect(field.update([ball], [vec(300, 100)])).toHaveLength(0);
    // Now clear of it altogether.
    expect(field.update([ball], [vec(300, 400)])).toHaveLength(0);
    // And back in, in a single frame-sized jump.
    ball.pos = vec(300, 100);
    expect(field.update([ball], [vec(300, 400)])).toHaveLength(1);
  });

  it('tracks occupancy per ball, not per slot in the array', () => {
    // The caller passes only the live balls, so a drain or a multiball release
    // renumbers them. Keyed by index, a ball inherited whatever the ball
    // previously in its slot had been sitting in.
    const field = new SensorField([rollover]);
    const parked = createBall(vec(300, 100), BALL_RADIUS);
    const arriving = createBall(vec(300, 100), BALL_RADIUS);
    expect(field.update([parked], [vec(300, 100)])).toHaveLength(1);
    // `parked` has not moved and must not fire again; `arriving` is new to the
    // region and must, even though it now occupies index zero.
    const hits = field.update([arriving, parked], [vec(300, 400), vec(300, 100)]);
    expect(hits.map((h) => h.ball)).toEqual([arriving]);
  });
});

describe('detection does not depend on the frame rate', () => {
  /** Launch a ball and count what it reaches, stepping at `fps`. */
  function launchAt(fps: number): Map<string, number> {
    const reached = new Map<string, number>();
    const game = new Game();
    game.onSound = (name) => reached.set(name, (reached.get(name) ?? 0) + 1);
    game.startGame();
    const hold: Intents = { ...noIntents(), plunger: true };
    for (let i = 0; i < Math.round(0.9 * fps); i += 1) game.update(1 / fps, hold);
    for (let i = 0; i < fps * 6; i += 1) game.update(1 / fps, noIntents());
    return reached;
  }

  it('sweeps the same rollover lanes on a slow device as on a fast one', () => {
    const fast = launchAt(60).get('rollover') ?? 0;
    const slow = launchAt(30).get('rollover') ?? 0;
    expect(fast).toBeGreaterThanOrEqual(3);
    expect(slow).toBeGreaterThanOrEqual(3);
  });
});
