/**
 * Scoring values and progression rules, kept apart from the machinery that
 * applies them so both are easy to read and to tune.
 */

export const SCORE = {
  bumper: 130,
  slingshot: 60,
  dropTarget: 750,
  dropBankComplete: 6500,
  standupTarget: 420,
  standupBankComplete: 4000,
  spinner: 190,
  rollover: 300,
  rolloverSetComplete: 5000,
  rampBase: 2400,
  rampIncrement: 800,
  orbit: 3000,
  saucerBase: 5000,
  missionStep: 2500,
  missionComplete: 30000,
  bonusPerUnit: 1200,
} as const;

export const BALLS_PER_GAME = 3;
/** Nudges tolerated before the table tilts. */
export const TILT_LIMIT = 3;
/** Seconds a mission runs before it expires. */
export const MISSION_SECONDS = 50;
/** Score at which a one-off extra ball is awarded. */
export const EXTRA_BALL_AT = 350_000;
/** Missions completed before the multiball round is lit. */
export const MISSIONS_FOR_MULTIBALL = 2;

export interface MissionSpec {
  id: string;
  name: string;
  /** Shown on the display while the mission runs. */
  brief: string;
  /** How many of the tracked event the player must produce. */
  target: number;
}

/**
 * The mission list doubles as the rank ladder: each completion promotes the
 * player one step, in the spirit of Space Cadet's rank progression.
 *
 * They are ordered by difficulty, easiest first. A player always meets the
 * first one first, so if that one is hard nobody ever sees the rest of the
 * table's rules, multiball included.
 */
export const MISSIONS: readonly MissionSpec[] = [
  {
    id: 'lock',
    name: 'Target Lock',
    brief: 'Hit three standup targets',
    target: 3,
  },
  {
    id: 'sweep',
    name: 'Bumper Sweep',
    brief: 'Strike the pop bumpers 6 times',
    target: 6,
  },
  {
    id: 'fuel',
    name: 'Fuel Cells',
    brief: 'Drop all three fuel targets',
    target: 3,
  },
  {
    id: 'ramp',
    name: 'Ramp Rush',
    brief: 'Make two ramp shots',
    target: 2,
  },
  {
    id: 'orbit',
    name: 'Orbit Run',
    brief: 'Complete a full orbit',
    target: 1,
  },
];

export const RANKS: readonly string[] = [
  'Cadet',
  'Ensign',
  'Lieutenant',
  'Commander',
  'Captain',
  'Admiral',
];

export const rankFor = (missionsCompleted: number): string =>
  RANKS[Math.min(missionsCompleted, RANKS.length - 1)] ?? 'Cadet';
