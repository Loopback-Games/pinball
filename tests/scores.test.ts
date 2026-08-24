import { beforeEach, describe, expect, it } from 'vitest';
import { SCOREBOARD_SIZE, readScoreboard, recordScore } from '../src/game/scores.js';

/** The machine these boards belong to. */
const M = 'orbit-cadet';

/** A stand-in for the browser's localStorage, so the tests can drive it. */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

const KEY = 'loopback-pinball-scores';

beforeEach(() => storage.clear());

describe('the local scoreboard', () => {
  it('starts empty', () => {
    expect(readScoreboard(M)).toEqual([]);
  });

  it('keeps scores best first', () => {
    for (const score of [400, 900, 100]) {
      recordScore(M, { score, rank: 'Cadet', date: '2026-08-24' });
    }
    expect(readScoreboard(M).map((e) => e.score)).toEqual([900, 400, 100]);
  });

  it('keeps only the top places and reports where a score landed', () => {
    for (let i = 1; i <= SCOREBOARD_SIZE + 3; i += 1) {
      recordScore(M, { score: i * 1000, rank: 'Cadet', date: '' });
    }
    const board = readScoreboard(M);
    expect(board).toHaveLength(SCOREBOARD_SIZE);

    const best = recordScore(M, { score: 999_999, rank: 'Admiral', date: '' });
    expect(best.position).toBe(0);

    const nowhere = recordScore(M, { score: 1, rank: 'Cadet', date: '' });
    expect(nowhere.position).toBe(-1);
    // A score that missed the cut must not have displaced anything.
    expect(readScoreboard(M).map((e) => e.score)).toEqual(best.board.map((e) => e.score));
  });

  it('carries over the single high score kept by older versions', () => {
    storage.setItem('loopback-pinball-high-score', '123456');
    expect(readScoreboard(M).map((e) => e.score)).toEqual([123456]);
  });

  it('survives stored data that has been tampered with', () => {
    // The board is editable by anyone with the developer tools open, so it is
    // parsed as untrusted input rather than trusted because we wrote it.
    for (const junk of [
      'not json at all',
      '{"score":1}',
      '[null, 42, "x"]',
      '[{"score":"1e9"},{"score":-5},{"nope":true}]',
    ]) {
      storage.setItem(KEY, junk);
      expect(readScoreboard(M)).toEqual([]);
    }

    storage.setItem(
      KEY,
      JSON.stringify([{ score: 500, rank: 'x'.repeat(400), date: 'x'.repeat(400) }]),
    );
    const [entry] = readScoreboard(M);
    expect(entry?.score).toBe(500);
    expect(entry?.rank.length).toBeLessThanOrEqual(24);
    expect(entry?.date.length).toBeLessThanOrEqual(10);
  });

  it('does not throw when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
    });
    expect(readScoreboard(M)).toEqual([]);
    expect(() => recordScore(M, { score: 10, rank: '', date: '' })).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
    });
  });
});

const GOOD = { score: 1000, rank: 'Cadet', date: '2026-08-24' };

describe('a doctored board', () => {
  it('drops a score too large to be real', () => {
    storage.setItem(
      'loopback-pinball-scores',
      JSON.stringify([{ score: 1e30, rank: 'Admiral', date: '2026-08-24' }, GOOD]),
    );
    expect(readScoreboard(M)).toEqual([GOOD]);
  });

  it('drops a date that is not a date', () => {
    storage.setItem(
      'loopback-pinball-scores',
      JSON.stringify([{ score: 500, rank: 'Cadet', date: 'see http://example.com for more' }]),
    );
    expect(readScoreboard(M)).toEqual([{ score: 500, rank: 'Cadet', date: '' }]);
  });

  it('does not sort a million entries to keep five', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      score: i + 1,
      rank: 'Cadet',
      date: '2026-08-24',
    }));
    storage.setItem('loopback-pinball-scores', JSON.stringify(many));
    const board = readScoreboard(M);
    expect(board).toHaveLength(5);
    // Only the first hundred are looked at, so the best of those wins rather
    // than the best of all five thousand.
    expect(board[0]?.score).toBe(100);
  });

  it('does not migrate a legacy high score that is out of range', () => {
    storage.setItem('loopback-pinball-high-score', '999999999999999999999');
    expect(readScoreboard(M)).toEqual([]);
  });
});
