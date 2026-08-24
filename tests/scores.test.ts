import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCOREBOARD_SIZE,
  readScoreboard,
  recordScore,
} from '../src/game/scores.js';

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
    expect(readScoreboard()).toEqual([]);
  });

  it('keeps scores best first', () => {
    for (const score of [400, 900, 100]) {
      recordScore({ score, rank: 'Cadet', date: '2026-08-24' });
    }
    expect(readScoreboard().map((e) => e.score)).toEqual([900, 400, 100]);
  });

  it('keeps only the top places and reports where a score landed', () => {
    for (let i = 1; i <= SCOREBOARD_SIZE + 3; i += 1) {
      recordScore({ score: i * 1000, rank: 'Cadet', date: '' });
    }
    const board = readScoreboard();
    expect(board).toHaveLength(SCOREBOARD_SIZE);

    const best = recordScore({ score: 999_999, rank: 'Admiral', date: '' });
    expect(best.position).toBe(0);

    const nowhere = recordScore({ score: 1, rank: 'Cadet', date: '' });
    expect(nowhere.position).toBe(-1);
    // A score that missed the cut must not have displaced anything.
    expect(readScoreboard().map((e) => e.score)).toEqual(
      best.board.map((e) => e.score),
    );
  });

  it('carries over the single high score kept by older versions', () => {
    storage.setItem('loopback-pinball-high-score', '123456');
    expect(readScoreboard().map((e) => e.score)).toEqual([123456]);
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
      expect(readScoreboard()).toEqual([]);
    }

    storage.setItem(
      KEY,
      JSON.stringify([{ score: 500, rank: 'x'.repeat(400), date: 'x'.repeat(400) }]),
    );
    const [entry] = readScoreboard();
    expect(entry?.score).toBe(500);
    expect(entry?.rank.length).toBeLessThanOrEqual(24);
    expect(entry?.date.length).toBeLessThanOrEqual(10);
  });

  it('does not throw when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
    });
    expect(readScoreboard()).toEqual([]);
    expect(() => recordScore({ score: 10, rank: '', date: '' })).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
    });
  });
});
