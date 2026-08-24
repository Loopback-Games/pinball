/**
 * A small deterministic pseudo-random generator.
 *
 * The simulation must be reproducible: the same seed and the same inputs have
 * to produce the same game, or a failing playtest cannot be replayed and a
 * flaky test cannot be told apart from a real regression. `Math.random()` is
 * seeded by the host and makes that impossible.
 *
 * mulberry32: 32 bits of state, a full 2^32 period, and it passes gjrand's
 * small-state suite. More than enough to shake a wedged ball loose.
 */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
