import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import { MACHINES, machineById } from '../src/game/machines/index.js';
import { FRENZY_MULTIPLIER } from '../src/game/rules.js';

const MOLTEN = machineById('molten-core');

function run(game: Game, seconds: number, intents: Intents = noIntents()): void {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) game.update(1 / 60, intents);
}

function playing(machine = MOLTEN): Game {
  const game = new Game(0x5eed, machine);
  game.startGame();
  game.phase = 'playing';
  return game;
}

/**
 * Drive the ball through exactly one bumper.
 *
 * Fired at the bumper from below rather than placed on it, because the rule
 * layer debounces a resting ball. Stopped at the first registered hit and
 * parked, because the whole point of a packed diamond is that a ball rattles
 * through it: left running, one strike sets off three bumpers and there is no
 * way to test what a partial sweep does.
 */
function strike(game: Game, index: number): void {
  const bumper = game.table.bumpers[index];
  const entry = game.balls[0];
  if (!bumper || !entry) throw new Error(`no bumper ${index} to strike`);
  entry.mode = 'play';
  entry.ball.active = true;
  entry.ball.pos = vec(bumper.center.x, bumper.center.y + bumper.radius + 30);
  entry.ball.vel = vec(0, -1400);
  entry.ball.idleTime = 0;

  const previous = game.onSound;
  let struck = false;
  game.onSound = (name, intensity) => {
    if (name === 'bumper') struck = true;
    previous(name, intensity);
  };
  for (let i = 0; i < 30 && !struck; i += 1) game.update(1 / 60, noIntents());
  game.onSound = previous;
  if (!struck) throw new Error(`the ball never reached bumper ${index}`);
  park(game);
}

/** Park the ball somewhere it cannot touch anything. */
function park(game: Game): void {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball');
  entry.ball.pos = vec(278, 700);
  entry.ball.vel = vec(0, 0);
}

describe('the eruption', () => {
  it('is declared by the machine, not assumed by the rules', () => {
    const withVent = MACHINES.filter((m) => m.buildTable().eruption !== undefined);
    expect(withVent.map((m) => m.id)).toEqual(['molten-core']);
  });

  it('goes off when every bumper is swept inside the window', () => {
    const game = playing();
    expect(game.eruptionTimer).toBe(0);

    for (let i = 0; i < game.table.bumpers.length; i += 1) {
      strike(game, i);
    }

    expect(game.eruptionTimer).toBeGreaterThan(0);
    // It lights the frenzy the standup bank already uses rather than a second
    // doubling that would have to be reconciled with it.
    expect(game.frenzyTimer).toBeGreaterThan(0);
    expect(game.shotMultiplier).toBeGreaterThanOrEqual(FRENZY_MULTIPLIER);
  });

  it('does not go off when the window lapses part way through', () => {
    const game = playing();
    const spec = game.table.eruption;
    if (!spec) throw new Error('the forge has no vent');

    for (let i = 0; i < game.table.bumpers.length - 1; i += 1) {
      strike(game, i);
    }
    expect(game.eruptionTimer).toBe(0);

    // Let the set lapse, then finish it. Hitting every bumper eventually is
    // not the shot; hitting them together is.
    park(game);
    run(game, spec.window + 0.5);
    strike(game, game.table.bumpers.length - 1);
    expect(game.eruptionTimer).toBe(0);
  });

  it('spits a ball out of the crucible while the vent is open', () => {
    const quiet = playing();
    quiet.balls[0]!.mode = 'idle';
    const calm = ejectSpeed(playing());

    const erupting = playing();
    for (let i = 0; i < erupting.table.bumpers.length; i += 1) {
      strike(erupting, i);
    }
    expect(erupting.eruptionTimer).toBeGreaterThan(0);
    expect(ejectSpeed(erupting)).toBeGreaterThan(calm * 1.5);
  });

  it('closes when the ball drains', () => {
    const game = playing();
    for (let i = 0; i < game.table.bumpers.length; i += 1) {
      strike(game, i);
    }
    expect(game.eruptionTimer).toBeGreaterThan(0);

    const entry = game.balls[0];
    if (!entry) throw new Error('the game has no ball');
    entry.mode = 'play';
    entry.ball.active = true;
    entry.ball.pos = vec(278, 900);
    entry.ball.vel = vec(0, 600);
    game.ballSaveTimer = 0;
    run(game, 5);

    expect(game.ballNumber).toBe(2);
    expect(game.eruptionTimer).toBe(0);
  });
});

/** How fast the saucer throws a ball back out, in this game's current state. */
function ejectSpeed(game: Game): number {
  const entry = game.balls[0];
  if (!entry) throw new Error('the game has no ball');
  entry.mode = 'saucer';
  entry.ball.active = false;
  entry.ball.pos = game.table.saucer.center;
  entry.timer = 0.01;
  run(game, 0.1);
  return Math.hypot(entry.ball.vel.x, entry.ball.vel.y);
}
