import type { Collider } from '../engine/shapes.js';
import type { Vec2 } from '../engine/vec2.js';
import { vec } from '../engine/vec2.js';
import type { Table } from '../game/table.js';

/**
 * Painting primitives shared by the renderer and by every machine's art.
 *
 * Free functions with no state: each one is handed the canvas it draws on.
 * That is what lets a machine's art module be imported by the node test suites
 * — which have no DOM — without any of it running at import time.
 */

type Ctx = CanvasRenderingContext2D;

/** An additive bloom, which is how everything lit on the table reads as lit. */
export function glow(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  if (radius <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Offset copy of `path`, `d` units to its left, shifted down by `dy`. */
export function offsetPath(path: readonly Vec2[], d: number, dy: number): Vec2[] {
  return path.map((p, i) => {
    const prev = path[Math.max(0, i - 1)] ?? p;
    const next = path[Math.min(path.length - 1, i + 1)] ?? p;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    return { x: p.x + (-ty / len) * d, y: p.y + (tx / len) * d + dy };
  });
}

/** Trace the closed outline of a rail `d` units wide, shifted down by `dy`. */
export function railRibbon(ctx: Ctx, path: readonly Vec2[], d: number, dy: number): void {
  const a = offsetPath(path, d, dy);
  const b = offsetPath(path, -d, dy);
  ctx.beginPath();
  a.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  for (let i = b.length - 1; i >= 0; i -= 1) {
    const p = b[i];
    if (p) ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/** Every structural wall and guide on the table. */
export const structural = (table: Table): Collider[] =>
  table.colliders.filter((c) => c.id === 'wall' || c.id === 'guide');

/** Trace one collider's centre line, whatever kind it is. */
export function traceCollider(ctx: Ctx, c: Collider): void {
  ctx.beginPath();
  if (c.kind === 'segment') {
    ctx.moveTo(c.a.x, c.a.y);
    ctx.lineTo(c.b.x, c.b.y);
  } else if (c.kind === 'arc') {
    ctx.arc(c.center.x, c.center.y, c.radius, c.a0, c.a1);
  } else {
    ctx.arc(c.center.x, c.center.y, c.radius, 0, Math.PI * 2);
  }
}

/** One stroke laid over the whole structure, in a single width and colour. */
export interface WallPass {
  width: number;
  style: string;
  dash?: readonly number[];
}

/**
 * Stroke every wall and guide, once per pass.
 *
 * The passes are what give a machine's structure its material. Three of them,
 * wide-to-narrow and dark-to-bright, read as a lit neon tube; the same three
 * kept dark and dull read as cast iron.
 */
export function strokeWalls(ctx: Ctx, table: Table, passes: readonly WallPass[]): void {
  const walls = structural(table);
  ctx.save();
  ctx.lineCap = 'round';
  for (const pass of passes) {
    ctx.strokeStyle = pass.style;
    ctx.lineWidth = pass.width;
    ctx.setLineDash(pass.dash ? [...pass.dash] : []);
    for (const c of walls) {
      traceCollider(ctx, c);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Walk every wall and guide at a fixed spacing, calling `fn` at each step with
 * the point and the unit tangent there.
 *
 * Rivets on cast iron, barnacles on a rope and ticks along a neon tube are the
 * same traversal with a different callback, which is the only reason this is
 * worth having: three parallel walks of the collider list would drift apart.
 */
export function alongWalls(
  table: Table,
  spacing: number,
  fn: (p: Vec2, tangent: Vec2, index: number) => void,
): void {
  let index = 0;
  for (const c of structural(table)) {
    if (c.kind === 'segment') {
      const dx = c.b.x - c.a.x;
      const dy = c.b.y - c.a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const t = vec(dx / len, dy / len);
      for (let d = spacing / 2; d < len; d += spacing) {
        fn(vec(c.a.x + t.x * d, c.a.y + t.y * d), t, index);
        index += 1;
      }
    } else if (c.kind === 'arc' || c.kind === 'circle') {
      const a0 = c.kind === 'arc' ? c.a0 : 0;
      const a1 = c.kind === 'arc' ? c.a1 : Math.PI * 2;
      const span = Math.abs(a1 - a0) * c.radius;
      if (span < 1e-6) continue;
      const step = spacing / c.radius;
      const dir = a1 >= a0 ? 1 : -1;
      for (let a = a0 + dir * step * 0.5; dir * (a1 - a) > 0; a += dir * step) {
        fn(
          vec(c.center.x + Math.cos(a) * c.radius, c.center.y + Math.sin(a) * c.radius),
          vec(-Math.sin(a) * dir, Math.cos(a) * dir),
          index,
        );
        index += 1;
      }
    }
  }
}
