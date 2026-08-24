/**
 * The local scoreboard.
 *
 * Everything lives in this browser: there is no server to send a score to, and
 * nothing about a game leaves the machine it was played on.
 */

export interface ScoreEntry {
  score: number;
  /** Rank reached, so the board records how the game went and not just a number. */
  rank: string;
  /** ISO day the score was set, for the date column. */
  date: string;
}

/** How many places the board keeps. */
export const SCOREBOARD_SIZE = 5;

/**
 * Where a machine's board lives.
 *
 * Keyed per machine, because a score is only meaningful against the layout it
 * was set on: the tables differ in how many features they have and how much
 * they pay, so one shared board would rank a good game on one against a lucky
 * one on another.
 */
const keyFor = (machineId: string): string => `loopback-pinball-scores:${machineId}`;
/** The board every machine shared before there was more than one. */
const SHARED_KEY = 'loopback-pinball-scores';
/** The single value the game stored before the board existed. */
const LEGACY_KEY = 'loopback-pinball-high-score';

/** Longest rank string worth keeping, so a doctored entry cannot bloat the UI. */
const MAX_RANK = 24;
/**
 * Highest score worth believing. Past this the number stops being exact in a
 * double and starts being wide enough to run off the side of the board.
 */
const MAX_SCORE = Number.MAX_SAFE_INTEGER;
/**
 * Most stored entries to even look at. The board keeps five; anything longer
 * than this was not written by the game, and there is no reason to sort a
 * million of them before finding that out.
 */
const MAX_STORED = 100;

/** An ISO day and nothing else, so the date column cannot be made to say anything. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse one stored entry.
 *
 * Local storage is editable by anyone with the developer tools open, so this
 * treats what it finds as untrusted: anything that is not a sane entry is
 * dropped rather than being allowed to reach the renderer.
 */
function parseEntry(value: unknown): ScoreEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const score = record['score'];
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score <= 0 || score > MAX_SCORE) return null;
  const rank = typeof record['rank'] === 'string' ? record['rank'] : '';
  const date = typeof record['date'] === 'string' ? record['date'] : '';
  return {
    score: Math.floor(score),
    rank: rank.slice(0, MAX_RANK),
    date: ISO_DAY.test(date) ? date : '',
  };
}

const byScore = (a: ScoreEntry, b: ScoreEntry): number => b.score - a.score;

/** Every score this browser has kept for `machineId`, best first. */
export function readScoreboard(machineId: string): ScoreEntry[] {
  const storage = globalThis.localStorage;
  if (!storage) return [];
  try {
    // A board saved before machines existed belongs to the machine that was
    // the only one at the time, so it is read as that machine's and nobody
    // loses the games they have already played.
    const raw = storage.getItem(keyFor(machineId)) ?? legacyRaw(storage, machineId);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .slice(0, MAX_STORED)
        .map(parseEntry)
        .filter((e): e is ScoreEntry => e !== null)
        .sort(byScore)
        .slice(0, SCOREBOARD_SIZE);
    }
    // No board yet: carry over the single high score kept by older versions so
    // nobody loses the one number the game used to remember.
    if (machineId !== LEGACY_MACHINE) return [];
    const legacy = parseEntry({
      score: Number.parseInt(storage.getItem(LEGACY_KEY) ?? '', 10),
      rank: '',
      date: '',
    });
    return legacy ? [legacy] : [];
  } catch {
    // Private browsing, blocked storage, or something that is not JSON at all.
    return [];
  }
}

/** The pre-machines board, but only for the machine that predates the rest. */
function legacyRaw(storage: Storage, machineId: string): string | null {
  return machineId === LEGACY_MACHINE ? storage.getItem(SHARED_KEY) : null;
}

/** The machine that was the only one when the shared board was written. */
const LEGACY_MACHINE = 'orbit-cadet';

function writeScoreboard(machineId: string, entries: readonly ScoreEntry[]): void {
  try {
    globalThis.localStorage?.setItem(keyFor(machineId), JSON.stringify(entries));
  } catch {
    // Ignore: the board simply will not persist.
  }
}

/**
 * Add `entry` to the stored board and hand back the new board along with the
 * place it took, or -1 if it did not make the cut.
 */
export function recordScore(
  machineId: string,
  entry: ScoreEntry,
): {
  board: ScoreEntry[];
  position: number;
} {
  const board = readScoreboard(machineId);
  if (entry.score <= 0) return { board, position: -1 };
  const merged = [...board, entry].sort(byScore).slice(0, SCOREBOARD_SIZE);
  const position = merged.indexOf(entry);
  if (position >= 0) writeScoreboard(machineId, merged);
  return { board: merged, position };
}

/** Today as an ISO day, or an empty string if the clock is unavailable. */
export function today(): string {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch {
    return '';
  }
}
