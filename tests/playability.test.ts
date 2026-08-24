import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import { mulberry32 } from '../src/engine/random.js';
import type { Intents, SoundName } from '../src/game/game.js';
import { vec } from '../src/engine/vec2.js';
import type { Machine } from '../src/game/machine.js';
import { MACHINES } from '../src/game/machines/index.js';
import { overlap } from '../src/engine/shapes.js';
import type { Table } from '../src/game/table.js';
import { BALL_RADIUS, DRAIN_Y } from '../src/game/table.js';

/** True if a ball placed here would start inside solid geometry. */
const insideSolid = (table: Table, x: number, y: number): boolean =>
  table.colliders.some((c) => overlap(c, vec(x, y), BALL_RADIUS) !== null);

/**
 * Which features a shot from a flipper has to be able to find.
 *
 * Derived from the table rather than listed, because machines differ: one has
 * no drop bank, another has two spinners. Asserting a fixed list would mean
 * either failing a machine for a feature it deliberately does not have, or
 * quietly letting a real one go unreached.
 */
function reachableFeatures(table: Table): SoundName[] {
  const out: SoundName[] = ['bumper', 'sling', 'saucer'];
  if (table.dropTargets.length) out.push('drop');
  if (table.standupTargets.length) out.push('target');
  if (table.spinners.length) out.push('spinner');
  if (table.rampPath) out.push('ramp');
  return out;
}

/**
 * Fan shots out from a flipper across every angle and speed, and record what
 * each one reaches.
 *
 * This measures the table's geometry rather than anyone's aim. A feature that
 * no shot can reach is decorative, and the usual cause is a post or a guide
 * standing in a lane, which is easy to introduce and invisible in a
 * screenshot.
 */
function sweepFrom(machine: Machine, origin: { x: number; y: number }): Map<SoundName, number> {
  const reached = new Map<SoundName, number>();
  for (let degrees = 200; degrees <= 340; degrees += 4) {
    for (const speed of [1600, 2200, 2800]) {
      const game = new Game(0x5eed, machine);
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
      // The midpoint of the two pivots, not a fixed column: a machine may
      // move its flippers, and a hardcoded centre line would quietly send
      // every ball to the wrong bat.
      const middle = (game.table.leftFlipper.pivot.x + game.table.rightFlipper.pivot.x) / 2;
      if (x < middle) intents.leftFlipper = true;
      else intents.rightFlipper = true;
    }
    return intents;
  };
}

/**
 * A bot that only swings when the ball is near a flipper tip and falling,
 * which is roughly what a player who can aim does. The busy bot above flips at
 * anything low on the table, which is a useful stress test and a poor model of
 * a person.
 */
function playToTheTip(
  machine: Machine,
  seed: number,
): { missions: number; multiballs: number; score: number } {
  const random = mulberry32(seed);
  const game = new Game(seed, machine);
  game.startGame();
  const holdFrames = Math.round((0.3 + random() * 0.7) * 60);
  let held = 0;
  let multiballs = 0;
  for (let i = 0; i < 60 * 300; i += 1) {
    if (game.phase === 'gameOver') break;
    const intents = noIntents();
    if (game.phase === 'ready') {
      held += 1;
      intents.plunger = held % (holdFrames + 20) < holdFrames;
    } else {
      held = 0;
    }
    for (const entry of game.balls) {
      if (entry.mode !== 'play' || entry.ball.vel.y < 0) continue;
      for (const f of game.table.flippers) {
        const tipX = f.pivot.x + Math.cos(f.restAngle) * f.length;
        const tipY = f.pivot.y + Math.sin(f.restAngle) * f.length;
        if (Math.hypot(entry.ball.pos.x - tipX, entry.ball.pos.y - tipY) > 55) continue;
        if (f.id === 'flipper-left') intents.leftFlipper = true;
        else intents.rightFlipper = true;
      }
    }
    const was = game.multiballActive;
    game.update(1 / 60, intents);
    if (game.multiballActive && !was) multiballs += 1;
  }
  return { missions: game.missionsCompleted, multiballs, score: game.score };
}

for (const machine of MACHINES) {
  const table = machine.buildTable();

  describe(`${machine.name}: shot reachability`, () => {
    // Every feature a flipper shot should be able to find. The rollover lanes
    // sit at the top of the orbit and are checked against the launch instead,
    // because that is how a player normally reaches them.
    const flipperFeatures = reachableFeatures(table);

    for (const [label, origin] of [
      // Derived from the bats rather than written down, so a machine that
      // moves its flippers is still swept from where its flippers are.
      ['the left flipper', { x: table.leftFlipper.tip.x + 7, y: table.leftFlipper.tip.y - 65 }],
      [
        'the right flipper',
        { x: table.rightFlipper.tip.x - 7, y: table.rightFlipper.tip.y - 65 },
      ],
    ] as const) {
      it(`can reach every feature from ${label}`, () => {
        const reached = sweepFrom(machine, origin);
        const unreachable = flipperFeatures.filter((f) => (reached.get(f) ?? 0) < 3);
        expect(unreachable).toEqual([]);
      });
    }

    it('runs the ball round the orbit and through the rollover lanes on launch', () => {
      let rollovers = 0;
      for (const hold of [0.35, 0.6, 0.9]) {
        const game = new Game(0x5eed, machine);
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

  describe(`${machine.name}: endurance`, () => {
    it('never leaves a ball wedged for the rest of the game', () => {
      const game = new Game(0x5eed, machine);
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

  describe(`${machine.name}: the warp gate`, () => {
    // Only a machine with a diverter has a warp to arm. On the rest the
    // spinner banks nothing, which is a different shape rather than a fault.
    const forked = table.warpFork !== undefined;

    it.skipIf(!forked)('arms itself within a game of unskilled play', () => {
      // The warp is armed by the spinner, and the spinner sits in the left orbit
      // lane where a busy player who never aims at it still sends the ball. If
      // an unskilled game cannot arm it once, the fork, the diverter and the
      // saucer feed behind them are content nobody ever sees.
      //
      // Measured across thirty seeds: every game arms it, none more than once.
      // That is the shape the threshold is tuned for — a resource that comes
      // round about once a game for a player who ignores it, and faster for one
      // who works the orbit.
      const missed: number[] = [];
      for (let seed = 1; seed <= 8; seed += 1) {
        const game = new Game(seed, machine);
        const bot = makeBot();
        game.startGame();
        let armed = false;
        for (let i = 0; i < 60 * 240; i += 1) {
          if (game.phase === 'gameOver') break;
          game.update(1 / 60, bot(game));
          armed = armed || game.warpLit;
        }
        if (!armed) missed.push(seed);
      }
      expect(missed).toEqual([]);
    });
  });

  describe(`${machine.name}: a game always ends`, () => {
    it('reaches game over even if the player never touches a flipper', () => {
      const game = new Game(0x5eed, machine);
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

  describe(`${machine.name}: ball traps`, () => {
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
          if (insideSolid(table, x, y)) continue;
          for (const degrees of [0, 90, 180, 270]) {
            launches += 1;
            const game = new Game(0x5eed, machine);
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
              trapped.push(
                `(${x},${y}) @${degrees}deg -> (${p.x.toFixed(0)},${p.y.toFixed(0)})`,
              );
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

  describe(`${machine.name}: the rules are reachable`, () => {
    it('shows a player who can aim the missions, the ranks and multiball', () => {
      // The rank ladder, the five missions, the jackpots and multiball are most
      // of the rulebook. They were all behind one shot at the saucer, which
      // unskilled play found 0.06 times a ball: fifty-seven games in sixty
      // finished without a single mission, so almost none of it was ever seen.
      // This is the guard on that, and it is deliberately measured from play
      // rather than from a unit test of the rule in isolation.
      const games = Array.from({ length: 12 }, (_, i) => playToTheTip(machine, i + 1));
      const withMission = games.filter((g) => g.missions > 0).length;
      const multiballs = games.reduce((a, g) => a + g.multiballs, 0);
      const detail = games.map((g) => `${g.missions}m/${g.multiballs}mb`).join(' ');

      expect(
        games.every((g) => g.score > 0),
        detail,
      ).toBe(true);
      expect(withMission, `games reaching a mission: ${detail}`).toBeGreaterThanOrEqual(8);
      expect(multiballs, `multiballs started: ${detail}`).toBeGreaterThanOrEqual(1);
    }, 120_000);
  });
}
