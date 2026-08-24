import { describe, expect, it } from 'vitest';
import { Game, noIntents } from '../src/game/game.js';
import type { Intents } from '../src/game/game.js';
import { mulberry32 } from '../src/engine/random.js';

/**
 * Things that must hold no matter what the player does.
 *
 * The other suites drive the table towards a particular feature and check what
 * it paid. This one does the opposite: it flails — random flips, random
 * nudges, random plunger — and only asserts the properties that can never be
 * false. That is what catches the states nobody thought to aim at, and it is
 * cheap now that the simulation takes a seed and replays exactly.
 */
describe('whatever the player does', () => {
  it('never breaks a rule of the machine', () => {
    const breaches: string[] = [];
    const note = (m: string): void => {
      if (breaches.length < 20) breaches.push(m);
    };

    for (let seed = 1; seed <= 24; seed += 1) {
      const random = mulberry32(seed);
      const game = new Game(seed);
      game.startGame();
      let score = 0;
      let held = 0;
      const holdFrames = Math.round((0.2 + random() * 0.9) * 60);

      for (let i = 0; i < 60 * 150; i += 1) {
        if (game.phase === 'gameOver') break;
        const intents: Intents = noIntents();
        if (game.phase === 'ready') {
          held += 1;
          intents.plunger = held % (holdFrames + 15) < holdFrames;
        } else {
          held = 0;
        }
        if (random() < 0.25) intents.leftFlipper = true;
        if (random() < 0.25) intents.rightFlipper = true;
        if (random() < 0.01) intents.nudgeLeft = true;
        if (random() < 0.01) intents.nudgeRight = true;
        game.update(1 / 60, intents);

        const where = `seed ${seed} frame ${i}`;
        if (game.score < score) note(`${where}: score fell ${score} -> ${game.score}`);
        score = game.score;
        for (const e of game.balls) {
          const { x, y } = e.ball.pos;
          const { x: vx, y: vy } = e.ball.vel;
          if (!Number.isFinite(x) || !Number.isFinite(y))
            note(`${where}: position is not a number`);
          if (!Number.isFinite(vx) || !Number.isFinite(vy))
            note(`${where}: velocity is not a number`);
          // The plunger tops out near 2000 and the shove at 1400. Anything
          // past this is the solver having pushed a ball out of a wall.
          const speed = Math.hypot(vx, vy);
          if (speed > 6000) note(`${where}: ball doing ${speed.toFixed(0)}`);
        }
        if (game.ballsInPlay > 3) note(`${where}: ${game.ballsInPlay} balls on the table`);
        if (game.bonusMultiplier < 1 || game.bonusMultiplier > 8) {
          note(`${where}: bonus multiplier ${game.bonusMultiplier}`);
        }
        if (game.ballsRemaining < 0) note(`${where}: ${game.ballsRemaining} balls left`);
        if (game.missionProgress < 0)
          note(`${where}: mission progress ${game.missionProgress}`);
        if (game.multiballActive && game.ballsInPlay === 0) {
          note(`${where}: multiball running with an empty table`);
        }
      }
      // Prove the flailing actually played, so a silent no-op cannot pass.
      expect(score, `seed ${seed} scored nothing`).toBeGreaterThan(0);
    }

    expect(breaches).toEqual([]);
  }, 120_000);
});
