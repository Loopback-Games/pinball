import type { ArtSpec } from '../render/art.js';
import type { Theme } from '../render/theme.js';
import type { MissionSpec } from './rules.js';
import type { Table } from './table.js';

/**
 * A machine: one playfield, one set of art, one campaign.
 *
 * This is the unit the player picks and the unit the tests iterate over. The
 * rule engine is shared — bumpers, targets, combos, missions, multiball all
 * behave the same everywhere — and what a machine chooses is its geometry, its
 * colours and the ladder its campaign climbs.
 */
export interface Machine {
  /** Storage key, URL parameter and test label. Stable: scores hang off it. */
  id: string;
  name: string;
  /** One line, shown under the name in the picker. */
  tagline: string;
  theme: Theme;
  /**
   * The machine's visual forms, as distinct from its colours.
   *
   * Required, and may be `{}`. A registry looked up by id would let a new
   * machine silently inherit the default art, which is the exact bug this
   * exists to fix; a required field makes forgetting it a compile error.
   */
  art: ArtSpec;
  /** Six rungs, from the rank a new player starts at to the last one. */
  ranks: readonly string[];
  /**
   * The campaign, easiest first.
   *
   * Written against the features the machine actually has: a machine with no
   * habitrail has no ramp mission, because a mission nobody can finish stalls
   * the whole ladder behind it.
   */
  missions: readonly MissionSpec[];
  buildTable: () => Table;
}

export const rankFor = (machine: Machine, missionsCompleted: number): string =>
  machine.ranks[Math.min(missionsCompleted, machine.ranks.length - 1)] ??
  machine.ranks[0] ??
  '';
