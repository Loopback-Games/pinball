import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents, SoundName } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';

/**
 * Fan shots out from a flipper across every angle and speed, and record what
 * each one reaches.
 *
 * This measures the table's geometry rather than anyone's aim. A feature that
 * no shot can reach is decorative, and the usual cause is a post or a guide
 * standing in a lane, which is easy to introduce and invisible in a
 * screenshot.
 */
function sweepFrom(origin: { x: number; y: number }): Map<SoundName, number> {
  const reached = new Map<SoundName, number>();
  for (let degrees = 200; degrees <= 340; degrees += 4) {
    for (const speed of [1600, 2200, 2800]) {
      const game = new Game();
      game.onSound = (name) => reached.set(name, (reached.get(name) ?? 0) + 1);
      game.startGame();
      game.phase = 'playing';
      const entry = game.balls[0];
      if (!entry) throw new Error('the game has no ball to launch');
      entry.mode = 'play';
      entry.ball.active = true;
      entry.ball.pos = vec(origin.x, origin.y);
      const radians = (degrees * Math.PI) / 180;
      entry.ball.vel = vec(Math.cos(radians) * speed, Math.sin(radians) * speed);
      for (let i = 0; i < 60 * 6; i += 1) game.update(1 / 60, noIntents());
    }
  }
  return reached;
}

/** A bot that flips whenever a ball falls into range. Not skilled, just busy. */
function botIntents(game: Game): Intents {
  const intents = noIntents();
  if (game.phase === 'ready') intents.plunger = true;
  for (const entry of game.balls) {
    if (entry.mode !== 'play') continue;
    const { x, y } = entry.ball.pos;
    if (entry.ball.vel.y < -50 || y < 760 || y > 900) continue;
    if (x < 278) intents.leftFlipper = true;
    else intents.rightFlipper = true;
  }
  return intents;
}

describe('shot reachability', () => {
  // Every feature a flipper shot should be able to find. The rollover lanes
  // sit at the top of the orbit and are checked against the launch instead,
  // because that is how a player normally reaches them.
  const flipperFeatures: SoundName[] = [
    'bumper',
    'sling',
    'target',
    'drop',
    'spinner',
    'saucer',
    'ramp',
  ];

  for (const [label, origin] of [
    ['the left flipper', { x: 252, y: 806 }],
    ['the right flipper', { x: 304, y: 806 }],
  ] as const) {
    it(`can reach every feature from ${label}`, () => {
      const reached = sweepFrom(origin);
      const unreachable = flipperFeatures.filter((f) => (reached.get(f) ?? 0) < 3);
      expect(unreachable).toEqual([]);
    });
  }

  it('runs the ball round the orbit and through the rollover lanes on launch', () => {
    let rollovers = 0;
    for (const hold of [0.35, 0.6, 0.9]) {
      const game = new Game();
      game.onSound = (name) => {
        if (name === 'rollover') rollovers += 1;
      };
      game.startGame();
      for (let i = 0; i < Math.round(hold * 60); i += 1) {
        game.update(1 / 60, { ...noIntents(), plunger: true });
      }
      for (let i = 0; i < 60 * 6; i += 1) game.update(1 / 60, noIntents());
    }
    // A full-power launch should sweep all three lanes on the way round.
    expect(rollovers).toBeGreaterThanOrEqual(3);
  });
});

describe('endurance', () => {
  it('never leaves a ball wedged for the rest of the game', () => {
    const game = new Game();
    game.startGame();
    let longestStall = 0;
    for (let i = 0; i < 60 * 180; i += 1) {
      if (game.phase === 'gameOver') break;
      game.update(1 / 60, botIntents(game));
      for (const entry of game.balls) {
        if (entry.mode === 'play') {
          longestStall = Math.max(longestStall, entry.ball.idleTime);
        }
      }
    }
    // The stuck-ball recovery shoves any ball idle for six seconds, so nothing
    // should ever exceed that by much.
    expect(longestStall).toBeLessThan(7);
  });
});

describe('a game always ends', () => {
  it('reaches game over even if the player never touches a flipper', () => {
    const game = new Game();
    game.startGame();

    // Hold the plunger only, so every ball is launched and then abandoned.
    const launchOnly: Intents = { ...noIntents(), plunger: true };
    let seconds = 0;
    for (let i = 0; i < 60 * 240; i += 1) {
      if (game.phase === 'gameOver') break;
      seconds = i / 60;
      const intents = game.phase === 'ready' && i % 90 < 60 ? launchOnly : noIntents();
      game.update(1 / 60, intents);
    }

    // The two slingshots face each other. Before they were made to go dead for
    // a moment after firing, a ball could rally between them indefinitely: it
    // never came back down to the flippers and the game ran forever.
    expect(game.phase, `still playing after ${seconds.toFixed(0)}s`).toBe('gameOver');
  });
});
