import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents, SoundName } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import { overlap } from '../src/engine/shapes.js';
import { BALL_RADIUS, DRAIN_Y, buildTable } from '../src/game/table.js';

const table = buildTable();
/** True if a ball placed here would start inside solid geometry. */
const insideSolid = (x: number, y: number): boolean =>
  table.colliders.some((c) => overlap(c, vec(x, y), BALL_RADIUS) !== null);

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

/**
 * A bot that flips whenever a ball falls into range. Not skilled, just busy.
 *
 * It has to let go of the plunger. Holding it forever leaves the game parked
 * in `ready` with the ball still on the shooter tip, which every test driving
 * this bot will happily pass without a ball ever reaching the playfield.
 */
function makeBot(): (game: Game) => Intents {
  let held = 0;
  return (game: Game): Intents => {
    const intents = noIntents();
    if (game.phase === 'ready') {
      held += 1;
      // Draw for two thirds of a second, release, and start over if the ball
      // is somehow still sitting there.
      intents.plunger = held % 54 < 40;
    } else {
      held = 0;
    }
    for (const entry of game.balls) {
      if (entry.mode !== 'play') continue;
      const { x, y } = entry.ball.pos;
      if (entry.ball.vel.y < -50 || y < 760 || y > 900) continue;
      if (x < 278) intents.leftFlipper = true;
      else intents.rightFlipper = true;
    }
    return intents;
  };
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
    const bot = makeBot();
    game.startGame();
    let longestStall = 0;
    let framesInPlay = 0;
    for (let i = 0; i < 60 * 180; i += 1) {
      if (game.phase === 'gameOver') break;
      game.update(1 / 60, bot(game));
      for (const entry of game.balls) {
        if (entry.mode === 'play') {
          framesInPlay += 1;
          longestStall = Math.max(longestStall, entry.ball.idleTime);
        }
      }
    }
    // Prove the bot actually played before trusting what it measured. This
    // test spent its whole life green while the bot held the plunger down for
    // all three minutes and no ball ever left the shooter lane.
    expect(framesInPlay).toBeGreaterThan(60 * 20);
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

describe('ball traps', () => {
  it('has nowhere on the playfield that keeps hold of the ball', () => {
    // Seed a ball across the playfield in four directions and let it settle
    // with the flippers down. Anything still circling the same seventy units
    // after eight seconds is wedged in the geometry: the stuck-ball recovery
    // would eventually throw it clear, but the player has spent those seconds
    // watching a dead table.
    //
    // Written against three real traps, all of them a gap a shade under one
    // ball wide: a standup mirrored into the foot of the ramp funnel, the slot
    // between that funnel and the standup bank, and a post sitting mid-channel
    // with twenty-six units either side of it.
    const trapped: string[] = [];
    let launches = 0;
    for (let x = 60; x <= 500; x += 25) {
      for (let y = 300; y <= 760; y += 25) {
        if (insideSolid(x, y)) continue;
        for (const degrees of [0, 90, 180, 270]) {
          launches += 1;
          const game = new Game();
          game.startGame();
          game.phase = 'playing';
          const entry = game.balls[0];
          if (!entry) throw new Error('the game has no ball to place');
          entry.mode = 'play';
          entry.ball.active = true;
          entry.ball.pos = vec(x, y);
          const radians = (degrees * Math.PI) / 180;
          entry.ball.vel = vec(Math.cos(radians) * 700, Math.sin(radians) * 700);
          entry.ball.idleTime = 0;
          entry.confinedTime = 0;
          entry.anchor = entry.ball.pos;

          let worst = 0;
          for (let i = 0; i < 60 * 8; i += 1) {
            game.update(1 / 60, noIntents());
            if (entry.mode !== 'play' || entry.ball.pos.y > DRAIN_Y) break;
            worst = Math.max(worst, entry.confinedTime);
          }
          if (worst > 5 && entry.mode === 'play') {
            const p = entry.ball.pos;
            trapped.push(`(${x},${y}) @${degrees}deg -> (${p.x.toFixed(0)},${p.y.toFixed(0)})`);
          }
        }
      }
    }
    // Never zero: a ball can balance on the crown of the saucer or sit on a
    // flipper nobody is flipping, and neither is a fault in the table. The
    // budget is there to catch a notch coming back, and the three that were
    // taken out put this at fifty-plus on the same sweep.
    expect(
      trapped.length,
      `${trapped.length}/${launches} trapped:\n${trapped.slice(0, 12).join('\n')}`,
    ).toBeLessThan(launches * 0.015);
  }, 60_000);
});
