import { describe, expect, it } from 'vitest';
import { Game, noIntents, CONFINED_SECONDS } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import { MACHINES, machineById } from '../src/game/machines/index.js';
import { createWorld, flowAt } from '../src/game/table.js';

const TIDE = machineById('tidewreck');

function run(game: Game, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) game.update(1 / 60, noIntents());
}

function playing(): Game {
  const game = new Game(0x5eed, TIDE);
  game.startGame();
  game.phase = 'playing';
  return game;
}

/** Drop the ball at rest somewhere and report how far sideways it drifted. */
function driftAt(game: Game, x: number, y: number, seconds: number): number {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball');
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(x, y);
  entry.ball.vel = vec(0, 0);
  entry.ball.idleTime = 0;
  const from = entry.ball.pos.x;
  run(game, seconds);
  return entry.ball.pos.x - from;
}

describe('the flow shape', () => {
  const period = 3.4;
  const turn = 0.6;

  it('holds, turns, and holds the other way', () => {
    // Mid-hold in each direction, rather than at the edges where it is easing.
    expect(flowAt(period / 2, period, turn)).toBeCloseTo(1, 5);
    expect(flowAt(period + turn + period / 2, period, turn)).toBeCloseTo(-1, 5);
  });

  it('passes through zero rather than snapping', () => {
    expect(flowAt(period + turn / 2, period, turn)).toBeCloseTo(0, 5);
  });

  it('averages out to nothing over a full cycle', () => {
    // A current that netted a push in one direction would pump energy into a
    // rally the way a slingshot does, which is what the slingshot rearm exists
    // to stop.
    const cycle = (period + turn) * 2;
    let sum = 0;
    const steps = 2000;
    for (let i = 0; i < steps; i += 1) sum += flowAt((i / steps) * cycle, period, turn);
    expect(Math.abs(sum / steps)).toBeLessThan(0.01);
  });

  it('repeats', () => {
    const cycle = (period + turn) * 2;
    for (const t of [0.3, 1.7, 3.9, 5.2]) {
      expect(flowAt(t + cycle, period, turn)).toBeCloseTo(flowAt(t, period, turn), 6);
    }
  });
});

describe('the current', () => {
  it('belongs to the machine that declares it, and no other', () => {
    const withCurrent = MACHINES.filter((m) => m.buildTable().current !== undefined);
    expect(withCurrent.map((m) => m.id)).toEqual(['tidewreck']);
    for (const m of MACHINES) {
      const table = m.buildTable();
      expect(createWorld(table).fields).toHaveLength(table.current ? 1 : 0);
    }
  });

  it('pushes a ball that is inside it', () => {
    const game = playing();
    const spec = game.table.current;
    if (!spec) throw new Error('the wreck has no current');
    const middle = { x: spec.region.x + spec.region.w / 2, y: spec.region.y + 20 };

    const drift = driftAt(game, middle.x, middle.y, 0.5);
    expect(Math.abs(drift)).toBeGreaterThan(8);
    // It runs the way the flow says it does.
    expect(Math.sign(drift)).toBe(Math.sign(spec.push * game.currentFlow));
  });

  it('leaves a ball outside it alone', () => {
    const game = playing();
    const spec = game.table.current;
    if (!spec) throw new Error('the wreck has no current');

    // Well below the band, in the clear run above the flippers.
    const drift = driftAt(game, 278, spec.region.y + spec.region.h + 160, 0.5);
    expect(Math.abs(drift)).toBeLessThan(3);
  });

  it('turns, so it cannot hold a ball against anything indefinitely', () => {
    const game = playing();
    const spec = game.table.current;
    if (!spec) throw new Error('the wreck has no current');

    const flows: number[] = [];
    for (let i = 0; i < 60 * 8; i += 1) {
      game.update(1 / 60, noIntents());
      flows.push(game.currentFlow);
    }
    expect(Math.max(...flows)).toBeGreaterThan(0.9);
    expect(Math.min(...flows)).toBeLessThan(-0.9);
  });

  it('completes a cycle inside the window the trap detection allows', () => {
    const spec = TIDE.buildTable().current;
    if (!spec) throw new Error('the wreck has no current');
    // This coupling is the safety argument for the whole mechanic: a
    // horizontal current can still pin a ball against a guide, and the
    // reversal is the only thing that frees it. If a cycle outlasted the trap
    // window, a pinned ball would read as a wedged table.
    expect(spec.period + spec.turn).toBeLessThan(CONFINED_SECONDS);
  });

  it('never pushes as hard as the table pulls', () => {
    const spec = TIDE.buildTable().current;
    if (!spec) throw new Error('the wreck has no current');
    const gravity = TIDE.physics?.gravity ?? 1750;
    // Steering, not carrying.
    expect(Math.abs(spec.push)).toBeLessThan(gravity);
  });

  it('starts every ball with the tide in the same place', () => {
    const game = playing();
    run(game, 2.5);
    const midBall = game.currentFlow;

    const entry = game.balls[0];
    if (!entry) throw new Error('the game has no ball');
    entry.mode = 'play';
    entry.ball.active = true;
    entry.ball.pos = vec(278, 900);
    entry.ball.vel = vec(0, 600);
    game.ballSaveTimer = 0;
    run(game, 5);

    expect(game.ballNumber).toBe(2);
    expect(game.currentFlow).not.toBeCloseTo(midBall, 3);
  });

  it('replays exactly from a seed', () => {
    const a = new Game(99, TIDE);
    const b = new Game(99, TIDE);
    for (const g of [a, b]) {
      g.startGame();
      g.phase = 'playing';
    }
    run(a, 6);
    run(b, 6);
    expect(a.currentFlow).toBe(b.currentFlow);
    expect(a.score).toBe(b.score);
  });
});
