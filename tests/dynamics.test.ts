import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import {
  BALL_SAVE_SECONDS,
  COMBO_MAX,
  COMBO_SECONDS,
  COMBO_STEP,
  FRENZY_MULTIPLIER,
  JACKPOT_BASE,
  JACKPOT_PER_BUMPER,
} from '../src/game/rules.js';

function run(game: Game, seconds: number, intents: Intents = noIntents()): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) game.update(1 / 60, intents);
}

function placeBall(game: Game, x: number, y: number, vx = 0, vy = 0): void {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball to place');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(x, y);
  entry.ball.vel = vec(vx, vy);
  entry.ball.idleTime = 0;
}

/** Start a game and get the ball onto the playfield. */
function launched(): Game {
  const game = new Game();
  game.startGame();
  run(game, 0.5, { ...noIntents(), plunger: true });
  run(game, 0.2, noIntents());
  return game;
}

describe('ball save', () => {
  it('is armed by the launch and returns a ball lost inside the window', () => {
    const game = launched();
    expect(game.ballSaveTimer).toBeGreaterThan(0);
    expect(game.ballNumber).toBe(1);

    placeBall(game, 278, 900, 0, 900);
    run(game, 1.5);

    // The ball came back rather than the ball number moving on.
    expect(game.ballNumber).toBe(1);
    expect(game.phase).toBe('playing');
    expect(game.ballSaveTimer).toBe(0);
  });

  it('lets the ball go once the window has closed', () => {
    const game = launched();
    run(game, BALL_SAVE_SECONDS + 0.5);
    expect(game.ballSaveTimer).toBe(0);

    placeBall(game, 278, 900, 0, 900);
    run(game, 4);
    expect(game.ballNumber).toBe(2);
  });
});

describe('combos', () => {
  it('raises the shot multiplier as the chain grows, then lapses', () => {
    const game = launched();
    expect(game.shotMultiplier).toBeCloseTo(1, 5);

    // Three ramp shots inside the combo window.
    for (let i = 0; i < 3; i += 1) {
      placeBall(game, 404, 600, 0, -900);
      run(game, 0.5);
    }
    expect(game.comboCount).toBeGreaterThanOrEqual(3);
    expect(game.shotMultiplier).toBeCloseTo(1 + game.comboCount * COMBO_STEP, 5);

    // Take the ball off the table so nothing else extends the chain.
    const entry = game.balls[0]!;
    entry.mode = 'idle';
    entry.ball.active = false;
    run(game, COMBO_SECONDS + 0.5);
    expect(game.comboCount).toBe(0);
    expect(game.shotMultiplier).toBeCloseTo(1, 5);
  });

  it('caps the multiplier however long the chain runs', () => {
    const game = launched();
    for (let i = 0; i < COMBO_MAX + 6; i += 1) {
      placeBall(game, 404, 600, 0, -900);
      run(game, 0.4);
    }
    expect(game.shotMultiplier).toBeLessThanOrEqual(1 + COMBO_MAX * COMBO_STEP);
  });
});

describe('frenzy', () => {
  /** Score of a single bumper hit, on a table set up by `prepare`. */
  function bumperHit(prepare: (game: Game) => void): number {
    const game = launched();
    prepare(game);
    const bumper = game.table.bumpers[1];
    if (!bumper) throw new Error('the table has no bumpers');
    const before = game.score;
    placeBall(game, bumper.center.x, bumper.center.y - 60, 0, 500);
    run(game, 0.4);
    return game.score - before;
  }

  it('doubles the value of a shot while it runs', () => {
    const plain = bumperHit(() => {});
    const frenzied = bumperHit((game) => {
      game.frenzyTimer = 5;
    });
    expect(plain).toBeGreaterThan(0);
    expect(frenzied).toBeCloseTo(plain * FRENZY_MULTIPLIER, -1);
  });

  it('reports the doubled multiplier', () => {
    const game = launched();
    game.frenzyTimer = 5;
    expect(game.shotMultiplier).toBeCloseTo(FRENZY_MULTIPLIER, 5);
  });
});

describe('lane change', () => {
  it('moves the lit lanes and the skill lane with the flipper buttons', () => {
    const game = launched();
    const lanes = game.table.rollovers.length;
    game.litLanes.clear();
    game.litLanes.add(0);
    const before = game.skillLane;

    run(game, 1 / 60, { ...noIntents(), rightFlipper: true });
    expect(game.skillLane).toBe((before + 1) % lanes);
    expect(game.litLanes.has(1 % lanes)).toBe(true);

    run(game, 0.2, noIntents());
    run(game, 1 / 60, { ...noIntents(), leftFlipper: true });
    expect(game.skillLane).toBe(before);
    expect(game.litLanes.has(0)).toBe(true);
  });
});

describe('skill shot', () => {
  it('pays only for the flashing lane, and only once', () => {
    const game = launched();
    expect(game.skillShotTimer).toBeGreaterThan(0);
    const lane = game.table.rollovers[game.skillLane];
    expect(lane).toBeDefined();

    const before = game.score;
    placeBall(game, lane!.x, lane!.y + 40, 0, -500);
    run(game, 0.5);
    const gained = game.score - before;

    expect(gained).toBeGreaterThan(20_000);
    expect(game.skillShotTimer).toBe(0);
  });

  it('pays nothing once the launch window has passed', () => {
    const game = launched();
    game.skillShotTimer = 0;
    const lane = game.table.rollovers[game.skillLane]!;

    const before = game.score;
    placeBall(game, lane.x, lane.y + 40, 0, -500);
    run(game, 0.5);
    expect(game.score - before).toBeLessThan(20_000);
  });
});

describe('kickback', () => {
  it('saves a ball from the right outlane once, then needs relighting', () => {
    const game = launched();
    expect(game.kickbackLit).toBe(true);

    const ballNumber = game.ballNumber;
    placeBall(game, 512, 800, 0, 700);
    run(game, 0.4);
    expect(game.kickbackLit).toBe(false);
    // Thrown back into play rather than lost.
    expect(game.ballNumber).toBe(ballNumber);
    expect(game.balls[0]?.mode).toBe('play');
    game.ballSaveTimer = 0;
    placeBall(game, 512, 800, 0, 700);
    run(game, 4);
    expect(game.ballNumber).toBe(ballNumber + 1);
  });
});

describe('multiball jackpots', () => {
  it('grows the jackpot with bumper hits', () => {
    const game = launched();
    game.multiballActive = true;
    expect(game.jackpotValue).toBe(JACKPOT_BASE);

    const bumper = game.table.bumpers[1]!;
    placeBall(game, bumper.center.x, bumper.center.y - 60, 0, 500);
    run(game, 1.5);
    expect(game.jackpotValue).toBeGreaterThanOrEqual(
      JACKPOT_BASE + JACKPOT_PER_BUMPER,
    );
  });
});

describe('music', () => {
  it('follows what is happening on the table', () => {
    const game = new Game();
    expect(game.musicMood).toBe('attract');
    game.startGame();
    expect(game.musicMood).toBe('play');
    game.frenzyTimer = 5;
    expect(game.musicMood).toBe('mission');
    game.frenzyTimer = 0;
    game.multiballActive = true;
    expect(game.musicMood).toBe('multiball');
  });
});
