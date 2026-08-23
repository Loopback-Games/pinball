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
export const MISSION_SECONDS = 40;
/** Score at which a one-off extra ball is awarded. */
export const EXTRA_BALL_AT = 350_000;
/** Missions completed before the multiball round is lit. */
export const MISSIONS_FOR_MULTIBALL = 3;

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
 */
export const MISSIONS: readonly MissionSpec[] = [
  {
    id: 'fuel',
    name: 'Fuel Cells',
    brief: 'Drop all three fuel targets',
    target: 3,
  },
  {
    id: 'sweep',
    name: 'Bumper Sweep',
    brief: 'Strike the pop bumpers 20 times',
    target: 20,
  },
  {
    id: 'orbit',
    name: 'Orbit Run',
    brief: 'Complete two full orbits',
    target: 2,
  },
  {
    id: 'ramp',
    name: 'Ramp Rush',
    brief: 'Make three ramp shots',
    target: 3,
  },
  {
    id: 'lock',
    name: 'Target Lock',
    brief: 'Hit every standup target',
    target: 3,
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
