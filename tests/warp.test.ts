import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import { DEFAULT_MACHINE } from '../src/game/machines/index.js';
import { MISSION_SECONDS, SPINS_TO_ARM_WARP } from '../src/game/rules.js';

/** Run the game forward at a steady 60 frames per second. */
function run(game: Game, seconds: number, intents: Intents = noIntents()): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) game.update(1 / 60, intents);
}

/**
 * Sweep the ball up through the spinner and then park it out of the way.
 *
 * The sensor fires once per entry, so the ball has to leave the lane between
 * passes or the second pass never registers.
 */
function crossSpinner(game: Game): void {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball to place');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(51, 600);
  entry.ball.vel = vec(0, -900);
  game.update(1 / 60, noIntents());
  entry.ball.pos = vec(278, 700);
  entry.ball.vel = vec(0, 0);
  game.update(1 / 60, noIntents());
}

/** Fire the ball into the ramp mouth hard enough for the funnel to take it. */
function shootRamp(game: Game): void {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball to place');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(404, 600);
  entry.ball.vel = vec(0, -900);
  entry.ball.idleTime = 0;
  game.update(1 / 60, noIntents());
}

/** Send the live ball down the middle and let the next one be served. */
function drain(game: Game): void {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball to place');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(278, 900);
  entry.ball.vel = vec(0, 600);
  game.ballSaveTimer = 0;
  run(game, 5);
}

function playing(): Game {
  const game = new Game();
  game.startGame();
  game.phase = 'playing';
  return game;
}

describe('the warp gate', () => {
  it('starts each ball closed', () => {
    const game = playing();
    expect(game.warpLit).toBe(false);
    expect(game.spinsToWarp).toBe(0);
  });

  it('is armed by working the spinner', () => {
    const game = playing();
    for (let i = 0; i < SPINS_TO_ARM_WARP - 1; i += 1) crossSpinner(game);
    expect(game.warpLit).toBe(false);

    crossSpinner(game);
    expect(game.warpLit).toBe(true);
  });

  it('sends an unarmed ramp shot round to the left inlane as before', () => {
    const game = playing();
    shootRamp(game);
    const entry = game.balls[0];
    expect(entry?.mode).toBe('rail');
    expect(entry?.railPath).toBe('ramp');

    // The habitrail ends above the left inlane, on the far side of the table
    // from the mouth it was shot into.
    run(game, 2);
    expect(entry?.mode).toBe('play');
    expect(entry?.ball.pos.x).toBeLessThan(140);
  });

  it('diverts an armed ramp shot down the fork and into the saucer', () => {
    const game = playing();
    for (let i = 0; i < SPINS_TO_ARM_WARP; i += 1) crossSpinner(game);

    shootRamp(game);
    const entry = game.balls[0];
    expect(entry?.railPath).toBe('warp');
    // Arming is spent by the shot that uses it.
    expect(game.warpLit).toBe(false);
    expect(game.spinsToWarp).toBe(0);

    // The fork is short, so the ball is in the cup well inside the ride the
    // long way round would have taken.
    run(game, 1);
    expect(entry?.mode).toBe('saucer');
  });

  it('cannot be stockpiled by spinning on past the threshold', () => {
    const game = playing();
    for (let i = 0; i < SPINS_TO_ARM_WARP * 2; i += 1) crossSpinner(game);
    expect(game.warpLit).toBe(true);

    shootRamp(game);
    expect(game.balls[0]?.railPath).toBe('warp');

    // One arming, one warp. The second ramp shot takes the normal route.
    run(game, 4);
    shootRamp(game);
    expect(game.balls[0]?.railPath).toBe('ramp');
  });

  it('still counts as a ramp shot on the way past', () => {
    const game = playing();
    for (let i = 0; i < SPINS_TO_ARM_WARP; i += 1) crossSpinner(game);

    // MISSIONS[3] is Ramp Rush, which wants two ramp shots. A warped shot
    // scores the ramp on entry and banks a saucer step on arrival, so one of
    // them finishes the mission. If the fork stopped counting as a ramp, this
    // would stall at a single step.
    game.activeMission = 3;
    game.missionProgress = 0;
    game.missionTimer = MISSION_SECONDS;
    shootRamp(game);
    run(game, 1.2);
    expect(game.missionsCompleted).toBe(1);
  });

  it('survives a drain, because a ball cannot bank enough on its own', () => {
    const game = playing();
    for (let i = 0; i < SPINS_TO_ARM_WARP; i += 1) crossSpinner(game);
    expect(game.warpLit).toBe(true);

    drain(game);
    expect(game.ballNumber).toBe(2);
    // A ball delivers the spinner three times and no more, so anything reset
    // with the ball can never reach a six pass threshold. Banking it across
    // the game is what makes the shot reachable at all.
    expect(game.warpLit).toBe(true);
  });

  it('keeps part-banked progress across a drain', () => {
    const game = playing();
    for (let i = 0; i < 3; i += 1) crossSpinner(game);
    expect(game.spinsToWarp).toBe(3);

    drain(game);
    expect(game.spinsToWarp).toBe(3);

    for (let i = 0; i < 3; i += 1) crossSpinner(game);
    expect(game.warpLit).toBe(true);
  });

  it('starts a new game closed', () => {
    const game = playing();
    for (let i = 0; i < SPINS_TO_ARM_WARP; i += 1) crossSpinner(game);
    expect(game.warpLit).toBe(true);

    game.startGame();
    expect(game.warpLit).toBe(false);
    expect(game.spinsToWarp).toBe(0);
  });
});

describe('the warp fork geometry', () => {
  const built = DEFAULT_MACHINE.buildTable();
  // Orbit Cadet is the machine with the diverter, so this suite asserts the
  // fork exists before measuring it. A machine without one is a different
  // shape, not a broken one.
  const rampPath = built.rampPath;
  const warpPath = built.warpPath;
  const warpFork = built.warpFork;
  const warpForkIndex = built.warpForkIndex;
  if (!rampPath || !warpPath || !warpFork || warpForkIndex === undefined) {
    throw new Error('the default machine has no diverter to measure');
  }
  const table = { ...built, rampPath, warpPath, warpFork, warpForkIndex };

  it('shares the ramp mouth and ends in the saucer', () => {
    const rampStart = table.rampPath[0];
    const warpStart = table.warpPath[0];
    expect(warpStart).toEqual(rampStart);

    const end = table.warpPath[table.warpPath.length - 1];
    expect(end).toBeDefined();
    expect(
      Math.hypot(end!.x - table.saucer.center.x, end!.y - table.saucer.center.y),
    ).toBeLessThan(4);
  });

  it('is the short way round', () => {
    const length = (path: readonly { x: number; y: number }[]): number => {
      let total = 0;
      for (let i = 1; i < path.length; i += 1) {
        const a = path[i - 1]!;
        const b = path[i]!;
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return total;
    };
    expect(length(table.warpPath)).toBeLessThan(length(table.rampPath) * 0.75);
  });

  it('runs clear of the pop bumpers, so it never hides one', () => {
    for (const p of table.warpPath) {
      for (const b of table.bumpers) {
        expect(Math.hypot(p.x - b.center.x, p.y - b.center.y)).toBeGreaterThan(b.radius + 6);
      }
    }
  });

  it('splits from the ramp at the fork and never rejoins it', () => {
    const fork = table.warpFork;
    const nearest = (path: readonly { x: number; y: number }[], q: { x: number; y: number }) =>
      Math.min(...path.map((p) => Math.hypot(p.x - q.x, p.y - q.y)));
    expect(nearest(table.rampPath, fork)).toBeLessThan(8);

    // Both branches climb the same wire, so the split has to be measured along
    // the path rather than by height: the mouth is lower than the fork.
    const forkIndex = table.warpPath.reduce(
      (best, p, i) =>
        Math.hypot(p.x - fork.x, p.y - fork.y) <
        Math.hypot(table.warpPath[best]!.x - fork.x, table.warpPath[best]!.y - fork.y)
          ? i
          : best,
      0,
    );
    // Up to the fork the two read as one wire. Not bit-identical: the spline
    // segment arriving at the fork takes its tangent from the control point
    // after it, which is where the branches differ, so the last stretch of the
    // trunk bows apart, by 4.3 units at its worst. Against a 27 unit ball that
    // is a sixth of its width, and it is what makes the split look like a wire
    // bent apart rather than one cut in two.
    for (let i = 0; i < forkIndex; i += 1) {
      expect(nearest(table.rampPath, table.warpPath[i]!)).toBeLessThan(6);
    }

    // Past it they diverge and stay apart, which is what makes the split
    // readable rather than a wire drawn over another wire.
    const after = table.warpPath.slice(forkIndex + 6);
    expect(after.length).toBeGreaterThan(4);
    for (const p of after) expect(nearest(table.rampPath, p)).toBeGreaterThan(16);
  });
});
