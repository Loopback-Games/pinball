import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import {
  BALLS_PER_GAME,
  MISSIONS,
  MISSIONS_FOR_MULTIBALL,
  RANKS,
  SCORE_SKILL_SHOT,
  TILT_LIMIT,
} from '../src/game/rules.js';
import { BALL_RADIUS, LANE_CENTER, LANE_FLOOR } from '../src/game/table.js';

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

describe('the shooter lane', () => {
  it('launches harder the further the plunger is drawn', () => {
    const speeds: number[] = [];
    for (const hold of [0.05, 0.9]) {
      const game = new Game();
      game.startGame();
      run(game, hold, { ...noIntents(), plunger: true });
      run(game, 1 / 30, noIntents());
      speeds.push(-(game.balls[0]?.ball.vel.y ?? 0));
    }
    const [soft, hard] = speeds;
    expect(soft).toBeGreaterThan(0);
    // The plunger drove the ball through the lane floor and out of the world,
    // where a fixed-speed recovery relaunched it, so pull made no difference.
    expect(hard).toBeGreaterThan((soft ?? 0) + 200);
  });

  it('never pushes the ball through the lane floor', () => {
    const game = new Game();
    game.startGame();
    run(game, 2, { ...noIntents(), plunger: true });
    const ball = game.balls[0]?.ball;
    expect(ball).toBeDefined();
    expect(ball!.pos.y).toBeLessThan(LANE_FLOOR - BALL_RADIUS);
  });

  it('puts a ball that dribbles back into the lane onto the plunger', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    // A weak launch that falls back down the lane must not strand the ball.
    placeBall(game, LANE_CENTER, 500, 0, 60);
    run(game, 4);
    expect(game.balls[0]?.mode).toBe('lane');
    expect(game.phase).toBe('ready');
  });

  it('frees a ball that gets wedged instead of leaving it there', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    placeBall(game, 300, 320, 0, 0);
    // Pin it in place the way a pocket would, then let the game notice.
    for (let i = 0; i < 60 * 12; i += 1) {
      if (i < 60 * 10) {
        const ball = game.balls[0]?.ball;
        if (ball) ball.vel = vec(0, 0);
      }
      game.update(1 / 60, noIntents());
    }
    const moved = game.balls[0]?.ball.pos.y ?? 320;
    expect(moved).not.toBe(320);
  });
});

describe('the rank ladder', () => {
  /** Drop the live ball into the saucer, then let the game react. */
  function shootSaucer(game: Game): void {
    const entry = game.balls.find((e) => e.mode === 'play') ?? game.balls[0];
    if (!entry) throw new Error('the game has no ball to place');
    entry.mode = 'play';
    entry.ball.active = true;
    entry.ball.pos = vec(240, 392);
    entry.ball.vel = vec(0, 0);
    entry.ball.idleTime = 0;
  }

  it('runs all the way to the top rank', () => {
    // Multiball used to be gated on "two or more missions completed", which is
    // true forever once it is true. Every saucer shot after the second mission
    // restarted multiball instead of starting the next mission, so three of
    // the five missions and the top three ranks were unreachable: the game
    // stopped dead at Lieutenant however well it was played.
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    for (let shot = 0; shot < 40 && game.missionsCompleted < MISSIONS.length; shot += 1) {
      shootSaucer(game);
      run(game, 2.2);
    }
    expect(game.missionsCompleted).toBeGreaterThanOrEqual(MISSIONS.length);
    expect(game.rank).toBe(RANKS[RANKS.length - 1]);
  });

  it('lights multiball, spends it, and carries on with the campaign', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    let litAt = -1;
    let startedAt = -1;
    for (let shot = 0; shot < 40; shot += 1) {
      shootSaucer(game);
      run(game, 2.2);
      if (litAt < 0 && game.multiballLit) litAt = shot;
      if (startedAt < 0 && game.multiballActive) startedAt = shot;
    }
    expect(litAt).toBeGreaterThanOrEqual(0);
    // Lit first, then collected at the saucer rather than starting itself.
    expect(startedAt).toBeGreaterThan(litAt);
    // And the campaign kept going past the rank that lit it.
    expect(game.missionsCompleted).toBeGreaterThan(MISSIONS_FOR_MULTIBALL);
  });
});

describe('the skill shot', () => {
  /** Send a ball through one rollover lane at speed. */
  function throughLane(game: Game, index: number): void {
    const lane = game.table.rollovers[index];
    if (!lane) throw new Error(`no rollover lane ${index}`);
    placeBall(game, lane.x, lane.y - 40, 0, 600);
    run(game, 0.15);
  }

  it('pays only when the ball takes the lane that is lit', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    game.skillShotTimer = 10;
    const before = game.score;
    throughLane(game, game.skillLane);
    expect(game.score - before).toBeGreaterThan(SCORE_SKILL_SHOT);
  });

  it('is lost on the first wrong lane rather than collected later', () => {
    // A full launch runs the orbit and sweeps all three lanes, so paying out
    // for the lit lane whenever it was crossed inside the window handed over
    // the skill shot on every ball and left lane change with nothing to
    // decide. The first lane the ball takes settles it either way.
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    game.skillShotTimer = 10;
    const wrong = (game.skillLane + 1) % game.table.rollovers.length;
    throughLane(game, wrong);
    expect(game.skillShotTimer).toBe(0);

    const after = game.score;
    throughLane(game, game.skillLane);
    expect(game.score - after).toBeLessThan(SCORE_SKILL_SHOT);
  });
});

describe('a second way into the mission system', () => {
  /**
   * Drive the ball into every target of a bank.
   *
   * Target faces are one-way, and which way each one faces depends on where it
   * sits, so the ball is fired at each from both sides of its own normal
   * rather than from a direction guessed here.
   */
  function clearBank(
    game: Game,
    targets: readonly { a: { x: number; y: number }; b: { x: number; y: number } }[],
  ): void {
    for (const t of targets) {
      const mid = { x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2 };
      const dx = t.b.x - t.a.x;
      const dy = t.b.y - t.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      for (const side of [1, -1]) {
        const away = BALL_RADIUS + 24;
        placeBall(
          game,
          mid.x + nx * side * away,
          mid.y + ny * side * away,
          -nx * side * 500,
          -ny * side * 500,
        );
        run(game, 0.4);
      }
    }
  }

  it('launches a mission when the fuel bank is cleared', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    expect(game.activeMission).toBe(-1);
    clearBank(game, game.table.dropTargets);
    expect(game.activeMission).toBeGreaterThanOrEqual(0);
  });

  it('launches a mission when the standup bank is cleared', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    clearBank(game, game.table.standupTargets);
    expect(game.activeMission).toBeGreaterThanOrEqual(0);
  });

  it('opens the door only once a ball, so the banks cannot farm missions', () => {
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    clearBank(game, game.table.dropTargets);
    const started = game.activeMission;
    expect(started).toBeGreaterThanOrEqual(0);

    // End the mission the way the clock would, without letting the ball
    // drain: a fresh ball is meant to open the door again.
    game.activeMission = -1;
    clearBank(game, game.table.dropTargets);
    expect(game.activeMission).toBe(-1);
  });

  it('leaves the saucer as the faster route', () => {
    // The saucer starts a mission whenever one is not running, with no
    // once-a-ball limit, and banks a step of progress on every later hit.
    const game = new Game();
    game.startGame();
    game.phase = 'playing';
    const saucer = game.table.saucer.center;
    placeBall(game, saucer.x, saucer.y, 0, 0);
    run(game, 2.5);
    expect(game.activeMission).toBeGreaterThanOrEqual(0);
    const progress = game.missionProgress;
    placeBall(game, saucer.x, saucer.y, 0, 0);
    run(game, 2.5);
    expect(game.missionProgress).toBeGreaterThan(progress);
  });
});
