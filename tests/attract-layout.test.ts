import { describe, expect, it } from 'vitest';
import { SCOREBOARD_SIZE } from '../src/game/scores.js';
import { attractLayout, inkExtent } from '../src/render/attract-layout.js';
import type { AttractLine } from '../src/render/attract-layout.js';

/** Every shape of card the game can put on screen. */
const CASES = [false, true].flatMap((gameOver) =>
  Array.from({ length: SCOREBOARD_SIZE + 1 }, (_, boardRows) => ({ gameOver, boardRows })),
);

const label = (l: AttractLine): string => `${l.kind}@${l.y}`;

describe('the attract card', () => {
  for (const c of CASES) {
    const name = `${c.gameOver ? 'game over' : 'attract'}, ${c.boardRows} score(s)`;

    it(`never draws two lines through each other: ${name}`, () => {
      const { lines } = attractLayout(c);
      const collisions: string[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const a = lines[i];
          const b = lines[j];
          if (!a || !b) continue;
          const ea = inkExtent(a);
          const eb = inkExtent(b);
          if (ea.top < eb.bottom && eb.top < ea.bottom) {
            collisions.push(`${label(a)} over ${label(b)}`);
          }
        }
      }
      // The bug this guards: the final score sat ten units above the machine
      // name while both were about twenty units tall, so on the game over
      // screen the table's name was drawn straight through the score.
      expect(collisions).toEqual([]);
    });

    it(`fits every line inside the card: ${name}`, () => {
      const { lines, top, height } = attractLayout(c);
      const bottom = top + height;
      for (const line of lines) {
        const ink = inkExtent(line);
        expect(ink.top, `${label(line)} above the card`).toBeGreaterThan(top);
        expect(ink.bottom, `${label(line)} below the card`).toBeLessThanOrEqual(bottom);
      }
    });
  }

  it('gives the final score room rather than taking it from the name', () => {
    const attract = attractLayout({ gameOver: false, boardRows: 3 });
    const over = attractLayout({ gameOver: true, boardRows: 3 });

    expect(attract.lines.some((l) => l.kind === 'final')).toBe(false);
    expect(over.lines.some((l) => l.kind === 'final')).toBe(true);
    // The card grows to hold the extra line; it does not overlap its way in.
    expect(over.height).toBeGreaterThan(attract.height);
    expect(over.pickerY).toBeGreaterThan(attract.pickerY);
  });

  it('would have caught the overlap it was written for', () => {
    // The exact geometry that shipped: FINAL on a baseline ten units above the
    // machine name, both of them about twenty units tall. A detector that does
    // not flag this pair is not measuring anything.
    const shipped: AttractLine[] = [
      { kind: 'final', y: 4, size: 20 },
      { kind: 'machine', y: 14, size: 19 },
    ];
    const [a, b] = shipped;
    if (!a || !b) throw new Error('the fixture is missing a line');
    const ea = inkExtent(a);
    const eb = inkExtent(b);
    expect(ea.top < eb.bottom && eb.top < ea.bottom).toBe(true);
  });

  it('grows with the scoreboard', () => {
    const empty = attractLayout({ gameOver: false, boardRows: 0 });
    const full = attractLayout({ gameOver: false, boardRows: SCOREBOARD_SIZE });
    expect(full.height).toBeGreaterThan(empty.height);
    // A board of zero rows draws no heading at all, so a fresh browser gets a
    // compact title card rather than a panel of blanks.
    expect(empty.lines.some((l) => l.kind === 'board-head')).toBe(false);
    expect(full.lines.filter((l) => l.kind === 'board-row')).toHaveLength(SCOREBOARD_SIZE);
  });
});
