import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/random.js';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';

describe('the generator', () => {
  it('repeats exactly for a seed and differs between seeds', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const first = Array.from({ length: 8 }, () => a());
    const second = Array.from({ length: 8 }, () => b());
    const other = Array.from({ length: 8 }, () => c());
    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('stays inside the unit interval', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 5000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

/** Nudge the ball into the state the stranded-ball recovery reacts to. */
function shoveVelocity(seed: number): number {
  const game = new Game(seed);
  game.startGame();
  game.phase = 'playing';
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(300, 500);
  entry.ball.vel = vec(0, 0);
  entry.anchor = entry.ball.pos;
  entry.confinedTime = 5.99;
  game.update(1 / 60, noIntents());
  return entry.ball.vel.x;
}

describe('a game is reproducible', () => {
  it('shakes a wedged ball loose the same way for the same seed', () => {
    expect(shoveVelocity(1)).toBe(shoveVelocity(1));
    // If the seed did not actually reach the shove, this would pass by
    // accident and the generator would be decorative.
    expect(shoveVelocity(1)).not.toBe(shoveVelocity(2));
  });

  it('plays two identical games from one seed', () => {
    const script = (i: number): Intents => ({
      ...noIntents(),
      plunger: i < 40,
      leftFlipper: i > 60 && i % 37 < 8,
      rightFlipper: i > 60 && i % 53 < 8,
    });
    const run = (): { score: number; positions: number[] } => {
      const game = new Game(4242);
      game.startGame();
      for (let i = 0; i < 60 * 45; i += 1) game.update(1 / 60, script(i));
      return {
        score: game.score,
        positions: game.balls.flatMap((e) => [e.ball.pos.x, e.ball.pos.y]),
      };
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    // A game that scored nothing would make the comparison meaningless.
    expect(first.score).toBeGreaterThan(0);
  });
});
