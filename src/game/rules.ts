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
export const EXTRA_BALL_AT = 900_000;
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
 * They are ordered by how often the table actually gives you the shot, easiest
 * first, measured from bot play rather than guessed. A player always meets the
 * first one first, so if the early ones are hard nobody ever sees the rest of
 * the rules, multiball included.
 */
export const MISSIONS: readonly MissionSpec[] = [
  {
    id: 'lock',
    name: 'Target Lock',
    brief: 'Hit three standup targets',
    target: 3,
  },
  {
    id: 'fuel',
    name: 'Fuel Cells',
    brief: 'Drop all three fuel targets',
    target: 3,
  },
  {
    id: 'sweep',
    name: 'Bumper Sweep',
    brief: 'Strike the pop bumpers 5 times',
    target: 5,
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

/* ------------------------------------------------------------------ *
 * Dynamic scoring
 * ------------------------------------------------------------------ */

/** Seconds after a ball reaches the playfield during which a drain is refunded. */
export const BALL_SAVE_SECONDS = 8;

/** How long a combo stays alive between shots. */
export const COMBO_SECONDS = 4;
/** Each link adds this much to the shot multiplier. */
export const COMBO_STEP = 0.35;
export const COMBO_MAX = 4;

/** Seconds after launch during which the lit lane pays the skill shot. */
export const SKILL_SHOT_SECONDS = 12;
export const SCORE_SKILL_SHOT = 25_000;

/** Multiball jackpot, and how much each bumper hit adds to it. */
export const JACKPOT_BASE = 40_000;
export const JACKPOT_PER_BUMPER = 1_500;
export const JACKPOT_MAX = 250_000;

/** Bumpers get more valuable the more they are hit, resetting each ball. */
export const BUMPER_STEP = 20;
export const BUMPER_VALUE_MAX = 1_600;

/** A spinner kept moving pays more each pass, decaying when it stops. */
export const SPINNER_STEP = 60;
export const SPINNER_VALUE_MAX = 1_400;

/** Every score is doubled while a frenzy runs. */
export const FRENZY_SECONDS = 18;
export const FRENZY_MULTIPLIER = 2;

/** Hits on the drop bank needed to relight the outlane kickback. */
export const SCORE_KICKBACK = 5_000;

/** Outward impulse a slingshot imparts, in table units per second. */
export const SLINGSHOT_KICK = 560;
/**
 * How long a slingshot stays dead after firing.
 *
 * The two face each other. Without this, a ball rallies between them
 * indefinitely: each kick replaces the energy the bounce lost, the player never
 * gets the ball back, and the game cannot end.
 */
export const SLINGSHOT_REARM_SECONDS = 0.6;
