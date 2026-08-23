import type { Ball, Collision } from '../engine/physics.js';
import { createBall, World, DEFAULT_WORLD } from '../engine/physics.js';
import type { Vec2 } from '../engine/vec2.js';
import { clamp, distance, lerp, vec } from '../engine/vec2.js';
import { SensorField } from './sensors.js';
import type { Table } from './table.js';
import {
  BALL_RADIUS,
  DOME_CENTER,
  DOME_RADIUS,
  LANE_RIGHT,
  PLAY_LEFT,
  TABLE_H,
  buildTable,
} from './table.js';
import {
  BALLS_PER_GAME,
  EXTRA_BALL_AT,
  MISSIONS,
  MISSIONS_FOR_MULTIBALL,
  MISSION_SECONDS,
  SCORE,
  TILT_LIMIT,
  rankFor,
} from './rules.js';

export type Phase = 'attract' | 'ready' | 'playing' | 'ballOver' | 'gameOver';

/** What the player is asking for this frame, whatever device it came from. */
export interface Intents {
  leftFlipper: boolean;
  rightFlipper: boolean;
  plunger: boolean;
  nudgeLeft: boolean;
  nudgeRight: boolean;
  start: boolean;
}

export const noIntents = (): Intents => ({
  leftFlipper: false,
  rightFlipper: false,
  plunger: false,
  nudgeLeft: false,
  nudgeRight: false,
  start: false,
});

/** A transient visual: a score popup, a hit flash, a burst of sparks. */
export interface Effect {
  kind: 'score' | 'burst';
  at: Vec2;
  text: string;
  life: number;
  maxLife: number;
  hue: number;
}

export type SoundName =
  | 'flipper'
  | 'bumper'
  | 'sling'
  | 'target'
  | 'drop'
  | 'spinner'
  | 'rollover'
  | 'ramp'
  | 'saucer'
  | 'launch'
  | 'drain'
  | 'wall'
  | 'mission'
  | 'complete'
  | 'tilt'
  | 'extraBall'
  | 'gameOver';

type BallMode = 'idle' | 'lane' | 'play' | 'saucer' | 'rail';

interface BallEntry {
  ball: Ball;
  mode: BallMode;
  /** Counts down while held in the saucer, or up while riding the rail. */
  timer: number;
  railT: number;
}

/** Message shown on the display, with the time it has left. */
interface Banner {
  text: string;
  sub: string;
  life: number;
}

const MAX_BALLS = 3;

export class Game {
  readonly table: Table;
  readonly world: World;
  private readonly entries: BallEntry[] = [];
  private readonly sensorField: SensorField;

  phase: Phase = 'attract';
  score = 0;
  highScore = 0;
  ballNumber = 1;
  ballsRemaining = BALLS_PER_GAME;

  /** Bonus units banked during this ball, paid out when it drains. */
  bonusUnits = 0;
  bonusMultiplier = 1;
  missionsCompleted = 0;
  extraBallAwarded = false;

  tiltWarnings = 0;
  tilted = false;

  /** Index into MISSIONS, or -1 when no mission is running. */
  activeMission = -1;
  missionProgress = 0;
  missionTimer = 0;

  multiballActive = false;

  /** Plunger pull, 0 released to 1 fully drawn back. */
  plungerPower = 0;
  private plungerHeld = false;

  /** Lamp id to brightness, 0..1. Rendered as inserts and glows. */
  readonly lamps = new Map<string, number>();
  readonly effects: Effect[] = [];
  banner: Banner | null = null;

  private dropsDown = new Set<string>();
  private standupsHit = new Set<string>();
  private rolloversLit = new Set<string>();
  private bumperHits = 0;
  private orbitCount = 0;
  private rampCount = 0;
  private rampValue = SCORE.rampBase;
  /**
   * Time left before each collider may score again.
   *
   * A ball resting against a target produces a contact every substep. Real
   * machines debounce their switches for exactly this reason; without it a
   * settled ball racks up thousands of points a second.
   */
  private readonly switchCooldown = new Map<string, number>();
  private nudgeCooldown = 0;
  private tiltDecay = 0;
  private attractTimer = 0;

  onSound: (name: SoundName, intensity: number) => void = () => {};

  constructor() {
    this.table = buildTable();
    this.world = new World(DEFAULT_WORLD);
    this.world.statics = this.table.colliders;
    this.world.movers = this.table.flippers;
    this.sensorField = new SensorField(this.table.sensors);

    for (let i = 0; i < MAX_BALLS; i += 1) {
      const ball = createBall(vec(this.table.plunger.x, this.table.plunger.y), BALL_RADIUS);
      ball.active = false;
      this.entries.push({ ball, mode: 'idle', timer: 0, railT: 0 });
    }
    this.highScore = readHighScore();
  }

  get balls(): readonly BallEntry[] {
    return this.entries;
  }

  get rank(): string {
    return rankFor(this.missionsCompleted);
  }

  get ballsInPlay(): number {
    return this.entries.filter((e) => e.mode !== 'idle').length;
  }

  /* ---------------------------------------------------------------- */

  startGame(): void {
    this.score = 0;
    this.ballNumber = 1;
    this.ballsRemaining = BALLS_PER_GAME;
    this.missionsCompleted = 0;
    this.extraBallAwarded = false;
    this.multiballActive = false;
    this.bonusMultiplier = 1;
    this.resetTableState();
    for (const e of this.entries) {
      e.mode = 'idle';
      e.ball.active = false;
    }
    this.serveBall();
    this.setBanner('Launch when ready', 'Pull the plunger');
  }

  private resetTableState(): void {
    this.bonusUnits = 0;
    this.tiltWarnings = 0;
    this.tilted = false;
    this.activeMission = -1;
    this.missionProgress = 0;
    this.dropsDown.clear();
    this.standupsHit.clear();
    this.rolloversLit.clear();
    this.switchCooldown.clear();
    this.bumperHits = 0;
    this.orbitCount = 0;
    this.rampCount = 0;
    this.rampValue = SCORE.rampBase;
    for (const t of this.table.dropTargets) t.collider.enabled = true;
    this.lamps.clear();
  }

  /** Put a fresh ball in the shooter lane. */
  private serveBall(): void {
    const entry = this.entries.find((e) => e.mode === 'idle');
    if (!entry) return;
    entry.mode = 'lane';
    entry.timer = 0;
    entry.ball.active = false;
    entry.ball.pos = vec(this.table.plunger.x, this.table.plunger.y);
    entry.ball.vel = vec(0, 0);
    entry.ball.idleTime = 0;
    this.phase = 'ready';
    this.plungerPower = 0;
  }

  /* ---------------------------------------------------------------- */

  update(dt: number, intents: Intents): void {
    const step = Math.min(dt, 0.05);
    this.tickSwitches(step);
    this.decayLamps(step);
    this.decayEffects(step);
    if (this.banner) {
      this.banner.life -= step;
      if (this.banner.life <= 0) this.banner = null;
    }

    if (this.phase === 'attract') {
      this.attractTimer += step;
      if (intents.start) this.startGame();
      return;
    }
    if (this.phase === 'gameOver') {
      this.attractTimer += step;
      if (intents.start) this.startGame();
      else if (this.attractTimer > 8) this.phase = 'attract';
      return;
    }

    this.updateFlippers(intents);
    this.updatePlunger(step, intents);
    this.updateNudge(step, intents);

    const active = this.entries.filter((e) => e.ball.active).map((e) => e.ball);
    const collisions = this.world.step(step, active, (h) => {
      for (const f of this.table.flippers) f.step(h);
    });
    for (const c of collisions) this.onCollision(c);

    for (const hit of this.sensorField.update(active)) {
      this.onSensor(hit.id, hit.ball);
    }

    this.updateHeldBalls(step);
    this.updateMission(step);
    this.recoverStrandedBalls(step);

    if (this.phase === 'playing' && this.ballsInPlay === 0) this.endBall();
    if (this.phase === 'ballOver') {
      this.entries[0]!.timer -= step;
      if (this.entries[0]!.timer <= 0) this.nextBall();
    }
  }

  /* ---------------------------------------------------------------- */

  private updateFlippers(intents: Intents): void {
    const live = !this.tilted;
    const left = live && intents.leftFlipper;
    const right = live && intents.rightFlipper;
    if (left !== this.table.leftFlipper.pressed && left) {
      this.onSound('flipper', 0.5);
    }
    if (right !== this.table.rightFlipper.pressed && right) {
      this.onSound('flipper', 0.5);
    }
    this.table.leftFlipper.pressed = left;
    this.table.rightFlipper.pressed = right;
  }

  private updatePlunger(dt: number, intents: Intents): void {
    const waiting = this.entries.find((e) => e.mode === 'lane');
    if (!waiting) {
      this.plungerPower = 0;
      this.plungerHeld = false;
      return;
    }
    // Hold the ball on the plunger tip while it is drawn back.
    waiting.ball.pos = vec(
      this.table.plunger.x,
      this.table.plunger.y + this.plungerPower * 46,
    );
    waiting.ball.vel = vec(0, 0);

    if (intents.plunger) {
      this.plungerHeld = true;
      this.plungerPower = clamp(this.plungerPower + dt * 1.35, 0, 1);
      return;
    }
    if (!this.plungerHeld) return;

    // Released: fire, with a floor so a tap still gets the ball into play.
    const power = Math.max(this.plungerPower, 0.28);
    waiting.mode = 'play';
    waiting.ball.active = true;
    waiting.ball.vel = vec(0, -(1500 + power * 1700));
    this.plungerHeld = false;
    this.plungerPower = 0;
    this.phase = 'playing';
    this.onSound('launch', power);
  }

  private updateNudge(dt: number, intents: Intents): void {
    this.nudgeCooldown = Math.max(0, this.nudgeCooldown - dt);
    this.tiltDecay = Math.max(0, this.tiltDecay - dt);
    if (this.tiltDecay === 0 && this.tiltWarnings > 0 && !this.tilted) {
      this.tiltWarnings -= 1;
      this.tiltDecay = 6;
    }

    // The nudge impulse decays quickly, so it is a shove rather than a tilt of
    // the whole table.
    this.world.nudge = vec(this.world.nudge.x * 0.86, this.world.nudge.y * 0.86);
    if (Math.abs(this.world.nudge.x) < 1) this.world.nudge = vec(0, this.world.nudge.y);

    if (this.tilted || this.nudgeCooldown > 0) return;
    const dir = (intents.nudgeLeft ? -1 : 0) + (intents.nudgeRight ? 1 : 0);
    if (dir === 0) return;

    this.world.nudge = vec(dir * 2600, -700);
    this.nudgeCooldown = 0.32;
    this.tiltWarnings += 1;
    this.tiltDecay = 6;
    if (this.tiltWarnings > TILT_LIMIT) {
      this.tilted = true;
      this.onSound('tilt', 1);
      this.setBanner('TILT', 'Flippers dead until the ball drains');
    } else {
      this.setBanner('Careful', `Tilt warning ${this.tiltWarnings}`);
    }
  }

  /* ---------------------------------------------------------------- */

  /**
   * True if this collider has already scored recently, in which case the hit
   * is ignored. Bumpers rearm fastest because rapid repeat hits are the point
   * of them.
   */
  private debounced(id: string, seconds: number): boolean {
    if ((this.switchCooldown.get(id) ?? 0) > 0) return true;
    this.switchCooldown.set(id, seconds);
    return false;
  }

  private tickSwitches(dt: number): void {
    for (const [id, remaining] of this.switchCooldown) {
      const next = remaining - dt;
      if (next <= 0) this.switchCooldown.delete(id);
      else this.switchCooldown.set(id, next);
    }
  }

  private onCollision(c: Collision): void {
    const id = c.id;
    if (id.startsWith('bumper-')) {
      if (this.debounced(id, 0.09)) return;
      this.lamps.set(id, 1);
      this.bumperHits += 1;
      this.award(SCORE.bumper, c.point, 'bumper');
      this.onSound('bumper', clamp(c.impactSpeed / 900, 0.25, 1));
      this.bonusUnits += 1;
      if (this.activeMission >= 0 && MISSIONS[this.activeMission]?.id === 'sweep') {
        this.advanceMission(1);
      }
      return;
    }
    if (id.startsWith('sling-')) {
      if (this.debounced(id, 0.14)) return;
      this.lamps.set(id, 1);
      this.award(SCORE.slingshot, c.point, 'sling');
      this.onSound('sling', 0.6);
      return;
    }
    if (id.startsWith('drop-')) {
      if (this.debounced(id, 0.3)) return;
      if (this.dropsDown.has(id)) return;
      this.dropsDown.add(id);
      const target = this.table.dropTargets.find((t) => t.id === id);
      if (target) target.collider.enabled = false;
      this.lamps.set(id, 1);
      this.award(SCORE.dropTarget, c.point, 'drop');
      this.onSound('drop', 0.8);
      this.bonusUnits += 2;
      if (this.activeMission >= 0 && MISSIONS[this.activeMission]?.id === 'fuel') {
        this.advanceMission(1);
      }
      if (this.dropsDown.size === this.table.dropTargets.length) {
        this.award(SCORE.dropBankComplete, c.point, 'complete');
        this.onSound('complete', 1);
        this.setBanner('Fuel bank cleared', `+${SCORE.dropBankComplete.toLocaleString()}`);
        this.bonusMultiplier = Math.min(this.bonusMultiplier + 1, 8);
        this.dropsDown.clear();
        for (const t of this.table.dropTargets) t.collider.enabled = true;
      }
      return;
    }
    if (id.startsWith('target-')) {
      if (this.debounced(id, 0.35)) return;
      this.lamps.set(id, 1);
      this.award(SCORE.standupTarget, c.point, 'target');
      this.onSound('target', 0.6);
      this.bonusUnits += 1;
      if (!this.standupsHit.has(id)) {
        this.standupsHit.add(id);
        if (this.activeMission >= 0 && MISSIONS[this.activeMission]?.id === 'lock') {
          this.advanceMission(1);
        }
        if (this.standupsHit.size === this.table.standupTargets.length) {
          this.award(SCORE.standupBankComplete, c.point, 'complete');
          this.onSound('complete', 1);
          this.setBanner('Targets locked', 'Saucer lit');
          this.standupsHit.clear();
        }
      }
      return;
    }
    if (id === 'wall' || id === 'guide' || id === 'post' || id === 'gate') {
      if (c.impactSpeed > 700) this.onSound('wall', clamp(c.impactSpeed / 2600, 0.1, 0.7));
      return;
    }
    if (id.startsWith('flipper-')) {
      if (c.impactSpeed > 500) this.onSound('wall', 0.25);
    }
  }

  private onSensor(id: string, ball: Ball): void {
    const entry = this.entries.find((e) => e.ball === ball);
    if (!entry) return;

    if (id === 'drain') {
      this.drainBall(entry);
      return;
    }
    if (id === 'saucer' && entry.mode === 'play') {
      entry.mode = 'saucer';
      entry.ball.active = false;
      entry.ball.pos = this.table.saucer.center;
      entry.ball.vel = vec(0, 0);
      entry.timer = 1.6;
      this.onSound('saucer', 1);
      this.onSaucer();
      return;
    }
    if (id === 'ramp-entry' && entry.mode === 'play') {
      // Only a shot with real speed behind it makes the ramp.
      if (ball.vel.y > -420) return;
      entry.mode = 'rail';
      entry.railT = 0;
      entry.ball.active = false;
      this.rampCount += 1;
      this.award(this.rampValue, ball.pos, 'ramp');
      this.rampValue += SCORE.rampIncrement;
      this.bonusUnits += 3;
      this.onSound('ramp', 1);
      this.setBanner('Ramp', `+${this.rampValue.toLocaleString()} next`);
      if (this.activeMission >= 0 && MISSIONS[this.activeMission]?.id === 'ramp') {
        this.advanceMission(1);
      }
      return;
    }
    if (id === 'spinner') {
      const speed = Math.hypot(ball.vel.x, ball.vel.y);
      if (speed < 200) return;
      this.award(Math.round(SCORE.spinner * clamp(speed / 800, 0.5, 3)), ball.pos, 'spin');
      this.onSound('spinner', clamp(speed / 1600, 0.3, 1));
      this.bonusUnits += 1;
      return;
    }
    if (id.startsWith('rollover-')) {
      this.lamps.set(id, 1);
      this.award(SCORE.rollover, ball.pos, 'lane');
      this.onSound('rollover', 0.5);
      this.rolloversLit.add(id);
      this.bonusUnits += 1;
      // The centre rollover taken at speed means the ball came round the dome.
      if (id === 'rollover-1' && Math.abs(ball.vel.x) > 520) {
        this.orbitCount += 1;
        this.award(SCORE.orbit, ball.pos, 'orbit');
        this.setBanner('Orbit', `${this.orbitCount} complete`);
        if (this.activeMission >= 0 && MISSIONS[this.activeMission]?.id === 'orbit') {
          this.advanceMission(1);
        }
      }
      if (this.rolloversLit.size >= 3) {
        this.rolloversLit.clear();
        this.bonusMultiplier = Math.min(this.bonusMultiplier + 1, 8);
        this.award(SCORE.rolloverSetComplete, ball.pos, 'complete');
        this.onSound('complete', 1);
        this.setBanner('Lanes complete', `Bonus x${this.bonusMultiplier}`);
      }
      return;
    }
    if (id === 'outlane-left' || id === 'outlane-right') {
      this.lamps.set(id, 1);
      this.bonusUnits += 2;
      return;
    }
    if (id === 'inlane-left' || id === 'inlane-right') {
      this.lamps.set(id, 1);
      this.bonusUnits += 1;
      return;
    }
  }

  /* ---------------------------------------------------------------- */

  private onSaucer(): void {
    if (this.activeMission >= 0) {
      // Landing in the saucer mid-mission banks a step of progress.
      this.advanceMission(1);
      this.award(SCORE.saucerBase, this.table.saucer.center, 'saucer');
      return;
    }
    if (
      this.missionsCompleted >= MISSIONS_FOR_MULTIBALL &&
      !this.multiballActive &&
      this.ballsInPlay === 1
    ) {
      this.startMultiball();
      return;
    }
    const next = this.missionsCompleted % MISSIONS.length;
    this.activeMission = next;
    this.missionProgress = 0;
    this.missionTimer = MISSION_SECONDS;
    const spec = MISSIONS[next];
    this.award(SCORE.saucerBase, this.table.saucer.center, 'saucer');
    this.onSound('mission', 1);
    if (spec) this.setBanner(spec.name, spec.brief, 4);
  }

  private advanceMission(amount: number): void {
    if (this.activeMission < 0) return;
    const spec = MISSIONS[this.activeMission];
    if (!spec) return;
    this.missionProgress += amount;
    this.award(SCORE.missionStep, this.table.saucer.center, 'mission');
    if (this.missionProgress < spec.target) return;

    this.missionsCompleted += 1;
    this.activeMission = -1;
    this.missionProgress = 0;
    this.bonusUnits += 10;
    this.award(SCORE.missionComplete, this.table.saucer.center, 'complete');
    this.onSound('complete', 1);
    this.setBanner(`${spec.name} complete`, `Promoted to ${this.rank}`, 4);
  }

  private updateMission(dt: number): void {
    if (this.activeMission < 0) return;
    this.missionTimer -= dt;
    if (this.missionTimer > 0) return;
    const spec = MISSIONS[this.activeMission];
    this.activeMission = -1;
    this.missionProgress = 0;
    if (spec) this.setBanner('Mission expired', spec.name, 3);
  }

  private startMultiball(): void {
    this.multiballActive = true;
    let released = 0;
    for (const e of this.entries) {
      if (e.mode !== 'idle' || released >= 2) continue;
      e.mode = 'play';
      e.ball.active = true;
      e.ball.pos = vec(this.table.saucer.center.x, this.table.saucer.center.y + 30);
      e.ball.vel = vec((released === 0 ? -1 : 1) * 420, 620);
      e.ball.idleTime = 0;
      released += 1;
    }
    this.onSound('complete', 1);
    this.setBanner('MULTIBALL', 'Keep them alive', 4);
  }

  /* ---------------------------------------------------------------- */

  private updateHeldBalls(dt: number): void {
    for (const e of this.entries) {
      if (e.mode === 'saucer') {
        e.timer -= dt;
        e.ball.pos = this.table.saucer.center;
        if (e.timer <= 0) {
          e.mode = 'play';
          e.ball.active = true;
          e.ball.pos = vec(this.table.saucer.center.x, this.table.saucer.center.y + 24);
          e.ball.vel = vec(120, 900);
          e.ball.idleTime = 0;
        }
        continue;
      }
      if (e.mode === 'rail') {
        // Walk the ball along the habitrail at a constant speed.
        const path = this.table.rampPath;
        e.railT += dt * 0.55;
        if (e.railT >= 1) {
          const exit = path[path.length - 1] ?? this.table.plunger;
          e.mode = 'play';
          e.ball.active = true;
          e.ball.pos = exit;
          e.ball.vel = vec(30, 620);
          e.ball.idleTime = 0;
          continue;
        }
        e.ball.pos = pointAlong(path, e.railT);
      }
    }
  }

  /**
   * Nothing should be able to strand a ball. A ball that has sat still too
   * long gets a shove, and one that has somehow left the table is put back in
   * the shooter lane rather than silently lost.
   */
  private recoverStrandedBalls(dt: number): void {
    for (const e of this.entries) {
      if (e.mode !== 'play') continue;
      const p = e.ball.pos;
      // The dome only closes the top of the table; below its centre line the
      // playfield is a rectangle, so the radial check applies up there only.
      const offTable =
        p.x < PLAY_LEFT - 40 ||
        p.x > LANE_RIGHT + 40 ||
        p.y < -40 ||
        p.y > TABLE_H + 60 ||
        (p.y < DOME_CENTER.y && distance(p, DOME_CENTER) > DOME_RADIUS + 40);
      if (offTable) {
        e.ball.pos = vec(this.table.plunger.x, this.table.plunger.y);
        e.ball.vel = vec(0, -1900);
        e.ball.idleTime = 0;
        continue;
      }
      if (e.ball.idleTime > 6) {
        e.ball.vel = vec((Math.random() - 0.5) * 600, -500);
        e.ball.idleTime = 0;
      }
      void dt;
    }
  }

  private drainBall(entry: BallEntry): void {
    entry.mode = 'idle';
    entry.ball.active = false;
    this.onSound('drain', 0.8);
    if (this.multiballActive && this.ballsInPlay <= 1) {
      this.multiballActive = false;
      this.setBanner('Multiball over', '');
    }
  }

  private endBall(): void {
    // Pay the bonus, then hand over to the next ball.
    const bonus =
      Math.min(this.bonusUnits, 99) * SCORE.bonusPerUnit * this.bonusMultiplier;
    if (bonus > 0) {
      this.score += bonus;
      this.setBanner(
        `Bonus ${bonus.toLocaleString()}`,
        `${this.bonusUnits} x ${this.bonusMultiplier}`,
        3,
      );
    }
    this.phase = 'ballOver';
    this.entries[0]!.timer = bonus > 0 ? 2.4 : 1.2;
    this.checkExtraBall();
  }

  private nextBall(): void {
    this.ballsRemaining -= 1;
    if (this.ballsRemaining <= 0) {
      this.phase = 'gameOver';
      this.attractTimer = 0;
      this.onSound('gameOver', 1);
      if (this.score > this.highScore) {
        this.highScore = this.score;
        writeHighScore(this.score);
        this.setBanner('New high score', this.score.toLocaleString(), 6);
      } else {
        this.setBanner('Game over', `Rank: ${this.rank}`, 6);
      }
      return;
    }
    this.ballNumber += 1;
    this.resetTableState();
    this.serveBall();
  }

  private checkExtraBall(): void {
    if (this.extraBallAwarded || this.score < EXTRA_BALL_AT) return;
    this.extraBallAwarded = true;
    this.ballsRemaining += 1;
    this.onSound('extraBall', 1);
    this.setBanner('Extra ball', 'Shoot again', 4);
  }

  /* ---------------------------------------------------------------- */

  private award(points: number, at: Vec2, hueKey: string): void {
    this.score += points;
    this.effects.push({
      kind: 'score',
      at,
      text: `+${points.toLocaleString()}`,
      life: 0.9,
      maxLife: 0.9,
      hue: hueFor(hueKey),
    });
    if (this.effects.length > 40) this.effects.shift();
  }

  private setBanner(text: string, sub: string, life = 2.5): void {
    this.banner = { text, sub, life };
  }

  private decayLamps(dt: number): void {
    for (const [k, v] of this.lamps) {
      const next = v - dt * 2.4;
      if (next <= 0) this.lamps.delete(k);
      else this.lamps.set(k, next);
    }
  }

  private decayEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const e = this.effects[i];
      if (!e) continue;
      e.life -= dt;
      if (e.life <= 0) this.effects.splice(i, 1);
    }
  }
}

/** Position a fraction `t` along a polyline. */
export function pointAlong(path: readonly Vec2[], t: number): Vec2 {
  if (path.length === 0) return vec(0, 0);
  if (path.length === 1) return path[0]!;
  const clamped = clamp(t, 0, 1);
  const span = 1 / (path.length - 1);
  const index = Math.min(Math.floor(clamped / span), path.length - 2);
  const local = (clamped - index * span) / span;
  return lerp(path[index]!, path[index + 1]!, local);
}

const HUES: Record<string, number> = {
  bumper: 190,
  sling: 45,
  drop: 320,
  target: 100,
  spin: 210,
  lane: 55,
  ramp: 275,
  orbit: 195,
  saucer: 30,
  mission: 285,
  complete: 145,
};

const hueFor = (key: string): number => HUES[key] ?? 200;

const HIGH_SCORE_KEY = 'loopback-pinball-high-score';

function readHighScore(): number {
  try {
    const raw = globalThis.localStorage?.getItem(HIGH_SCORE_KEY);
    const value = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    // Private browsing and blocked storage are not worth failing over.
    return 0;
  }
}

function writeHighScore(score: number): void {
  try {
    globalThis.localStorage?.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    // Ignore: the score simply will not persist.
  }
}
