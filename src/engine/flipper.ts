import type { MovingBody } from './physics.js';
import type { Collider, SegmentCollider } from './shapes.js';
import { segment } from './shapes.js';
import type { Vec2 } from './vec2.js';
import { clamp, vec } from './vec2.js';

export interface FlipperOptions {
  id: string;
  pivot: Vec2;
  /** Distance from pivot centre to tip centre. */
  length: number;
  /** Radius at the pivot end. Drawn, and averaged into the collision radius. */
  pivotRadius: number;
  /** Radius at the tip. Smaller than the pivot radius gives the classic taper. */
  tipRadius: number;
  /** Angle when idle, in radians (atan2 convention, y down). */
  restAngle: number;
  /** Angle when the button is held. */
  activeAngle: number;
  /** Angular speed on the up-stroke, radians per second. */
  upSpeed?: number;
  /** Angular speed returning to rest, radians per second. */
  downSpeed?: number;
  restitution?: number;
}

/**
 * A kinematic flipper: a capsule that rotates about its pivot between two fixed
 * angles.
 *
 * The solver never integrates a flipper. Instead the flipper reports the
 * velocity of its own surface, and the ball bounces off it in that moving
 * frame. That is what converts flipper rotation into ball speed, and it means a
 * ball resting on a raised flipper cannot be pushed through it.
 *
 * Collision uses a single uniform-thickness capsule while the bat is drawn with
 * the usual taper. A capsule has an unambiguous nearest surface at every point,
 * so there is no interior a ball can get wedged inside; the couple of units of
 * difference at the tip are invisible in play.
 */
export class Flipper implements MovingBody {
  readonly id: string;
  readonly pivot: Vec2;
  readonly length: number;
  readonly pivotRadius: number;
  readonly tipRadius: number;
  readonly restAngle: number;
  readonly activeAngle: number;
  readonly upSpeed: number;
  readonly downSpeed: number;

  angle: number;
  /** Radians per second, derived from actual movement in the last substep. */
  angularVelocity = 0;
  pressed = false;

  private readonly bat: SegmentCollider;
  readonly colliders: readonly Collider[];

  constructor(o: FlipperOptions) {
    this.id = o.id;
    this.pivot = o.pivot;
    this.length = o.length;
    this.pivotRadius = o.pivotRadius;
    this.tipRadius = o.tipRadius;
    this.restAngle = o.restAngle;
    this.activeAngle = o.activeAngle;
    this.upSpeed = o.upSpeed ?? 26;
    this.downSpeed = o.downSpeed ?? 15;
    this.angle = o.restAngle;

    this.bat = segment(o.id, o.pivot, o.pivot, {
      restitution: o.restitution ?? 0.34,
      friction: 0.12,
      radius: (o.pivotRadius + o.tipRadius) / 2,
    });
    this.colliders = [this.bat];
    this.refresh();
  }

  /** Where the tip centre currently sits. */
  get tip(): Vec2 {
    return vec(
      this.pivot.x + Math.cos(this.angle) * this.length,
      this.pivot.y + Math.sin(this.angle) * this.length,
    );
  }

  /** How far through its stroke the flipper is, 0 at rest and 1 fully raised. */
  get travel(): number {
    const span = this.activeAngle - this.restAngle;
    if (Math.abs(span) < 1e-9) return 0;
    return clamp((this.angle - this.restAngle) / span, 0, 1);
  }

  step(h: number): void {
    const target = this.pressed ? this.activeAngle : this.restAngle;
    const speed = this.pressed ? this.upSpeed : this.downSpeed;
    const delta = target - this.angle;
    const maxStep = speed * h;
    const applied = Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;
    this.angle += applied;
    this.angularVelocity = h > 0 ? applied / h : 0;
    this.refresh();
  }

  surfaceVelocityAt(point: Vec2): Vec2 {
    const w = this.angularVelocity;
    if (w === 0) return vec(0, 0);
    // v = w x r, which in 2D with y pointing down is w * (-ry, rx).
    return vec(-(point.y - this.pivot.y) * w, (point.x - this.pivot.x) * w);
  }

  private refresh(): void {
    this.bat.a = this.pivot;
    this.bat.b = this.tip;
    // Points to the side the bat sweeps towards, which is where a ball resting
    // on it sits. Only used to break ties dead on the axis.
    const up = this.activeAngle < this.restAngle ? -1 : 1;
    this.bat.normal = vec(-Math.sin(this.angle) * up, Math.cos(this.angle) * up);
  }
}
