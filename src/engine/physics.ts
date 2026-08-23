import type { Collider } from './shapes.js';
import { overlap, sweep } from './shapes.js';
import type { Vec2 } from './vec2.js';
import { vec } from './vec2.js';

export interface Ball {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  /** Visual only: accumulated rotation, used to spin the highlight. */
  spin: number;
  /** Balls are pooled; an inactive ball is skipped by every system. */
  active: boolean;
  /** Seconds this ball has spent below the "is it stuck?" speed threshold. */
  idleTime: number;
}

export function createBall(pos: Vec2, radius: number): Ball {
  return { pos, vel: vec(0, 0), radius, spin: 0, active: true, idleTime: 0 };
}

/**
 * A body whose colliders move under their own power. The solver treats them as
 * static within a substep but accounts for their surface velocity, which is
 * what lets a flipper transfer energy into the ball.
 */
export interface MovingBody {
  readonly colliders: readonly Collider[];
  /** Velocity of the body's surface at a world-space point. */
  surfaceVelocityAt(point: Vec2): Vec2;
}

export interface Collision {
  /** The collider's id, so the rule layer can tell what was hit. */
  id: string;
  point: Vec2;
  normal: Vec2;
  /** Closing speed along the normal at the moment of impact. */
  impactSpeed: number;
  ball: Ball;
}

export interface WorldConfig {
  /** Downhill acceleration in table units per second squared. */
  gravity: number;
  /** Fraction of speed shed per second to rolling resistance. */
  drag: number;
  /** Hard ceiling on ball speed, to keep the solver well conditioned. */
  maxSpeed: number;
  /** Bounces slower than this are killed, which stops resting balls jittering. */
  bounceThreshold: number;
}

export const DEFAULT_WORLD: WorldConfig = {
  gravity: 1750,
  drag: 0.18,
  maxSpeed: 4200,
  bounceThreshold: 22,
};

/** Substeps per second. High enough that a ball cannot cross a wall unseen. */
export const SUBSTEP_HZ = 480;
const SUBSTEP_DT = 1 / SUBSTEP_HZ;

/** Maximum collision resolutions within a single substep. */
const MAX_ITERATIONS = 8;

/** Depenetration passes per substep, so pushing out of one wall into another
 * still resolves. */
const SEPARATION_PASSES = 2;

/** Nudged back off a surface by this much, so the next sweep starts clear. */
const SKIN = 0.05;

/**
 * Contacts gentler than this do not produce an event. A ball resting on a
 * surface generates a contact every substep; reporting them all would let the
 * rule layer score a stationary ball hundreds of times a second.
 */
const EVENT_THRESHOLD = 2;

export class World {
  readonly config: WorldConfig;
  statics: Collider[] = [];
  movers: MovingBody[] = [];
  /** Sideways acceleration from a nudge, decayed by the game layer. */
  nudge: Vec2 = vec(0, 0);

  private accumulator = 0;

  constructor(config: WorldConfig = DEFAULT_WORLD) {
    this.config = { ...config };
  }

  /**
   * Advance the simulation by `dt` real seconds using fixed-size substeps, so
   * behaviour does not change with framerate. `onSubstep` runs before each
   * substep, which is where kinematic bodies update themselves.
   */
  step(
    dt: number,
    balls: readonly Ball[],
    onSubstep: (h: number) => void,
  ): Collision[] {
    const collisions: Collision[] = [];
    // Clamp the catch-up window; a backgrounded tab must not spiral.
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    while (this.accumulator >= SUBSTEP_DT) {
      this.accumulator -= SUBSTEP_DT;
      onSubstep(SUBSTEP_DT);
      for (const ball of balls) {
        if (!ball.active) continue;
        this.substep(ball, SUBSTEP_DT, collisions);
      }
    }
    return collisions;
  }

  /** Run one fixed step directly. Used by the tests and by the substep loop. */
  substep(ball: Ball, h: number, out: Collision[]): void {
    const { gravity, drag, maxSpeed } = this.config;

    ball.vel = vec(
      ball.vel.x + this.nudge.x * h,
      ball.vel.y + (gravity + this.nudge.y) * h,
    );

    this.separate(ball, out);

    let remaining = h;
    let clear = false;
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      if (remaining <= 1e-9) {
        clear = true;
        break;
      }
      const hit = this.firstHit(ball, remaining);
      if (!hit) {
        clear = true;
        break;
      }
      ball.pos = vec(
        ball.pos.x + ball.vel.x * hit.t,
        ball.pos.y + ball.vel.y * hit.t,
      );
      remaining -= hit.t;
      this.resolve(ball, hit.collider, hit.normal, hit.point, hit.body, out);
      // Lift off the surface so the next sweep does not start in contact.
      ball.pos = vec(
        ball.pos.x + hit.normal.x * SKIN,
        ball.pos.y + hit.normal.y * SKIN,
      );
    }
    // Only coast through the leftover time if the sweep proved the path is
    // clear. A ball that used up its iterations is wedged in a corner, and
    // moving it blindly is exactly how it ends up on the wrong side of a wall.
    if (clear && remaining > 0) {
      ball.pos = vec(
        ball.pos.x + ball.vel.x * remaining,
        ball.pos.y + ball.vel.y * remaining,
      );
    }

    const damping = Math.max(0, 1 - drag * h);
    ball.vel = vec(ball.vel.x * damping, ball.vel.y * damping);

    const speed = Math.hypot(ball.vel.x, ball.vel.y);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      ball.vel = vec(ball.vel.x * s, ball.vel.y * s);
    }
    ball.spin += speed * h * 0.02;
    ball.idleTime = speed < 40 ? ball.idleTime + h : 0;
  }

  /** Push the ball out of anything it is already inside and bounce it off. */
  private separate(ball: Ball, out: Collision[]): void {
    for (let pass = 0; pass < SEPARATION_PASSES; pass += 1) {
      this.separationPass(ball, out);
    }
  }

  private separationPass(ball: Ball, out: Collision[]): void {
    for (const c of this.statics) {
      const contact = overlap(c, ball.pos, ball.radius);
      if (!contact) continue;
      ball.pos = vec(
        ball.pos.x + contact.normal.x * (contact.depth + SKIN),
        ball.pos.y + contact.normal.y * (contact.depth + SKIN),
      );
      this.resolve(ball, c, contact.normal, contact.point, null, out);
    }
    for (const body of this.movers) {
      for (const c of body.colliders) {
        const contact = overlap(c, ball.pos, ball.radius);
        if (!contact) continue;
        ball.pos = vec(
          ball.pos.x + contact.normal.x * (contact.depth + SKIN),
          ball.pos.y + contact.normal.y * (contact.depth + SKIN),
        );
        this.resolve(ball, c, contact.normal, contact.point, body, out);
      }
    }
  }

  private firstHit(
    ball: Ball,
    maxT: number,
  ): {
    t: number;
    normal: Vec2;
    point: Vec2;
    collider: Collider;
    body: MovingBody | null;
  } | null {
    let best: {
      t: number;
      normal: Vec2;
      point: Vec2;
      collider: Collider;
      body: MovingBody | null;
    } | null = null;
    let bestT = maxT;

    for (const c of this.statics) {
      const s = sweep(c, ball.pos, ball.vel, ball.radius, bestT);
      if (!s) continue;
      bestT = s.t;
      best = { t: s.t, normal: s.normal, point: s.point, collider: c, body: null };
    }
    for (const body of this.movers) {
      for (const c of body.colliders) {
        const s = sweep(c, ball.pos, ball.vel, ball.radius, bestT);
        if (!s) continue;
        bestT = s.t;
        best = { t: s.t, normal: s.normal, point: s.point, collider: c, body };
      }
    }
    return best;
  }

  private resolve(
    ball: Ball,
    c: Collider,
    normal: Vec2,
    point: Vec2,
    body: MovingBody | null,
    out: Collision[],
  ): void {
    const surface = body ? body.surfaceVelocityAt(point) : vec(0, 0);
    const relX = ball.vel.x - surface.x;
    const relY = ball.vel.y - surface.y;
    const vn = relX * normal.x + relY * normal.y;
    if (vn > 0) return; // already separating

    const tx = relX - normal.x * vn;
    const ty = relY - normal.y * vn;

    let newVn = -vn * c.restitution;
    if (newVn < this.config.bounceThreshold) newVn = 0;
    const keep = 1 - c.friction;

    ball.vel = vec(
      tx * keep + normal.x * newVn + surface.x + normal.x * c.kick,
      ty * keep + normal.y * newVn + surface.y + normal.y * c.kick,
    );

    if (-vn >= EVENT_THRESHOLD) {
      out.push({ id: c.id, point, normal, impactSpeed: -vn, ball });
    }
  }
}
