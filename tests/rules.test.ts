import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import { BALLS_PER_GAME, TILT_LIMIT } from '../src/game/rules.js';

/** Run the game forward at a steady 60 frames per second. */
function run(game: Game, seconds: number, intents: Intents = noIntents()): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) game.update(1 / 60, intents);
}

/** Put the single live ball somewhere specific, in play. */
function placeBall(game: Game, x: number, y: number, vx = 0, vy = 0): void {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball to place');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(x, y);
  entry.ball.vel = vec(vx, vy);
  entry.ball.idleTime = 0;
}

describe('scoring', () => {
  it('scores a target once per hit, not once per frame', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    // Drop the ball straight onto a standup target and let it settle there.
    placeBall(game, 228, 600, 0, 200);
    run(game, 3);

    // It must still score for the hit, just not once per frame. Without switch
    // debouncing this reached seventy thousand in three seconds.
    expect(game.score).toBeGreaterThan(0);
    expect(game.score).toBeLessThan(8000);
  });

  it('keeps the bonus payout bounded however long a ball survives', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    placeBall(game, 278, 300, 140, 260);
    run(game, 20);
    expect(game.bonusUnits).toBeLessThan(400);
  });
});

describe('ball lifecycle', () => {
  it('serves a ball into the shooter lane at the start of a game', () => {
    const game = new Game();
    game.startGame();
    expect(game.phase).toBe('ready');
    expect(game.ballsRemaining).toBe(BALLS_PER_GAME);
    const entry = game.balls[0];
    expect(entry?.mode).toBe('lane');
  });

  it('launches the ball when the plunger is released', () => {
    const game = new Game();
    game.startGame();
    const held: Intents = { ...noIntents(), plunger: true };
    run(game, 0.6, held);
    expect(game.plungerPower).toBeGreaterThan(0.5);
    run(game, 0.2, noIntents());
    expect(game.phase).toBe('playing');
    expect(game.balls[0]?.mode).toBe('play');
    expect(game.balls[0]?.ball.vel.y).toBeLessThan(-1000);
  });

  it('ends the ball when it drains and serves the next one', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    placeBall(game, 278, 900, 0, 600);
    run(game, 5);
    expect(game.ballNumber).toBe(2);
    expect(game.ballsRemaining).toBe(BALLS_PER_GAME - 1);
    expect(game.phase).toBe('ready');
  });

  it('ends the game after the last ball drains', () => {
    const game = new Game();
    game.startGame();
    for (let ball = 0; ball < BALLS_PER_GAME; ball += 1) {
      game.phase = 'playing';
      placeBall(game, 278, 900, 0, 600);
      run(game, 5);
    }
    expect(game.phase).toBe('gameOver');
  });
});

describe('tilt', () => {
  it('warns before tilting, then kills the flippers', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    placeBall(game, 278, 400);

    const nudge: Intents = { ...noIntents(), nudgeLeft: true };
    for (let i = 0; i <= TILT_LIMIT; i += 1) {
      run(game, 0.02, nudge);
      run(game, 0.4, noIntents());
    }
    expect(game.tilted).toBe(true);

    // A tilted table ignores the flipper buttons.
    run(game, 0.3, { ...noIntents(), leftFlipper: true });
    expect(game.table.leftFlipper.pressed).toBe(false);
  });
});

describe('missions', () => {
  it('starts a mission when the ball reaches the saucer', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    const saucer = game.table.saucer.center;
    placeBall(game, saucer.x, saucer.y + 30, 0, -260);
    run(game, 1.5);
    expect(game.activeMission).toBeGreaterThanOrEqual(0);
    expect(game.missionTimer).toBeGreaterThan(0);
  });

  it('expires a mission that runs out of time', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    const saucer = game.table.saucer.center;
    placeBall(game, saucer.x, saucer.y + 30, 0, -260);
    run(game, 1.5);
    expect(game.activeMission).toBeGreaterThanOrEqual(0);
    game.missionTimer = 0.1;
    run(game, 0.5);
    expect(game.activeMission).toBe(-1);
  });
});
