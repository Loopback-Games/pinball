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

const KEY = 'loopback-pinball-scores';
/** The single value the game stored before the board existed. */
const LEGACY_KEY = 'loopback-pinball-high-score';

/** Longest rank string worth keeping, so a doctored entry cannot bloat the UI. */
const MAX_RANK = 24;

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
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null;
  const rank = typeof record['rank'] === 'string' ? record['rank'] : '';
  const date = typeof record['date'] === 'string' ? record['date'] : '';
  return {
    score: Math.floor(score),
    rank: rank.slice(0, MAX_RANK),
    date: date.slice(0, 10),
  };
}

const byScore = (a: ScoreEntry, b: ScoreEntry): number => b.score - a.score;

/** Every score this browser has kept, best first. */
export function readScoreboard(): ScoreEntry[] {
  const storage = globalThis.localStorage;
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(parseEntry)
        .filter((e): e is ScoreEntry => e !== null)
        .sort(byScore)
        .slice(0, SCOREBOARD_SIZE);
    }
    // No board yet: carry over the single high score kept by older versions so
    // nobody loses the one number the game used to remember.
    const legacy = Number.parseInt(storage.getItem(LEGACY_KEY) ?? '', 10);
    if (Number.isFinite(legacy) && legacy > 0) {
      return [{ score: legacy, rank: '', date: '' }];
    }
    return [];
  } catch {
    // Private browsing, blocked storage, or something that is not JSON at all.
    return [];
  }
}

function writeScoreboard(entries: readonly ScoreEntry[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Ignore: the board simply will not persist.
  }
}

/**
 * Add `entry` to the stored board and hand back the new board along with the
 * place it took, or -1 if it did not make the cut.
 */
export function recordScore(entry: ScoreEntry): {
  board: ScoreEntry[];
  position: number;
} {
  const board = readScoreboard();
  if (entry.score <= 0) return { board, position: -1 };
  const merged = [...board, entry].sort(byScore).slice(0, SCOREBOARD_SIZE);
  const position = merged.indexOf(entry);
  if (position >= 0) writeScoreboard(merged);
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
