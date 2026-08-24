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
  eruption: 15_000,
  spinner: 190,
  rollover: 300,
  rolloverSetComplete: 5000,
  rampBase: 2400,
  rampIncrement: 800,
  warp: 12_000,
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

/*
 * The mission list and the rank ladder now live on each machine, because they
 * describe a particular playfield: a campaign that asks for a ramp shot is
 * unfinishable on a machine with no ramp, and a mission nobody can finish
 * stalls every rank behind it. What stays here is the shape they take and the
 * rules that govern all of them.
 */

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

/**
 * Spinner passes needed to arm the warp gate on the habitrail.
 *
 * The spinner sits in the left orbit lane and the ramp mouth is on the right,
 * so arming and spending the warp are opposite shots. That is the point: it
 * gives the table a two-shot rhythm that crosses it, and it hands the spinner
 * a purpose beyond its own climbing value, which was the only thing on the
 * table that paid well and led nowhere.
 *
 * The switch fires once per pass, not once per revolution of the blade, so
 * this is six separate trips up the lane. Measured over thirty bot games a
 * ball delivers exactly three and never a fourth, which is why the count is
 * banked across the game rather than reset with the ball: per ball, six is
 * not a hard target, it is an impossible one.
 */
export const SPINS_TO_ARM_WARP = 6;

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
