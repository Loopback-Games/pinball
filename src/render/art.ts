import type { Vec2 } from '../engine/vec2.js';
import type { BumperSpec, CurrentSpec, Table } from '../game/table.js';
import { PLAY_CENTER, TABLE_H, TABLE_W } from '../game/table.js';
import { glow, railRibbon, strokeWalls } from './paint.js';
import type { Theme } from './theme.js';
import { seeded, shade, withAlpha } from './theme.js';

/**
 * A machine's visual vocabulary: the shapes, not the colours.
 *
 * `Theme` proves that colour works as data, because colour is genuinely one
 * axis. Form is not. "Caustic light shafts", "magma glow from below" and "a
 * field of stars" share no parameterisation, and any spec that covered all
 * three would be a worse drawing language than a function that draws them. So
 * form is code, cut along the seams the renderer already has.
 *
 * A painter is never handed the `Game`. It receives the table, the theme, the
 * clock, and whatever the renderer has already worked out — so art cannot
 * reach into the simulation even by accident, and render-only randomness can
 * never feed back into a game state that is tested for determinism.
 *
 * An art module may not touch `document`, `window` or `devicePixelRatio`, at
 * module scope or anywhere else: the node test suites import every machine,
 * and therefore every art module, with no DOM in sight.
 */

type Ctx = CanvasRenderingContext2D;

/** What a painter is allowed to see. */
export interface PaintContext {
  readonly theme: Theme;
  readonly table: Table;
}

/** ...plus the clock, for anything drawn per frame. */
export interface LiveContext extends PaintContext {
  /** Seconds since the page loaded. */
  readonly time: number;
}

/** Painted once into the cached layer, and again when the machine changes. */
export interface CachedArt {
  /** Everything behind the playfield furniture. */
  backdrop(g: Ctx, c: PaintContext): void;
  /** The structural walls and guides: what the cabinet is built from. */
  rails(g: Ctx, c: PaintContext): void;
  /** The kickout hole the missions run through. */
  saucer(g: Ctx, c: PaintContext): void;
}

/** Painted every frame. */
export interface LiveArt {
  bumper(g: Ctx, c: LiveContext, b: BumperSpec, lit: number): void;
  target(g: Ctx, c: LiveContext, a: Vec2, b: Vec2, color: string, lit: number): void;
  /** Motes drifting over the table. Cheap: see the budget below. */
  ambient(g: Ctx, c: LiveContext): void;
  /** Only called on a machine whose table declares a current. */
  current(g: Ctx, c: LiveContext, spec: CurrentSpec, flow: number): void;
}

export interface MachineArt {
  readonly cached: CachedArt;
  readonly live: LiveArt;
}

/** What a machine authors: any subset of the slots. */
export interface ArtSpec {
  cached?: Partial<CachedArt>;
  live?: Partial<LiveArt>;
}

/* ------------------------------------------------------------------ *
 * Ambient particles
 *
 * A closed form of `time` with no per-frame state at all: particle i has a
 * seeded origin and speed, and its position is computed from the clock. No
 * allocation in the hot loop, no drift when a tab is backgrounded, no RNG per
 * frame, and an art bug reproduces from a timestamp.
 *
 * The budget, sized against the smoke test's 60fps floor at four viewports:
 * at most this many motes, drawn as a handful of batched fills, and never one
 * `glow()` apiece — sixty radial gradients a frame is the one thing here that
 * would actually cost.
 * ------------------------------------------------------------------ */

export const AMBIENT_MAX = 60;

export interface Mote {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
  sway: number;
}

/** A fixed field of motes, identical on every load. */
export function motes(seed: number, count: number): Mote[] {
  const rand = seeded(seed);
  return Array.from({ length: Math.min(count, AMBIENT_MAX) }, () => ({
    x: rand() * TABLE_W,
    y: rand() * TABLE_H,
    size: 0.8 + rand() * 1.9,
    speed: 12 + rand() * 34,
    phase: rand() * Math.PI * 2,
    sway: 4 + rand() * 14,
  }));
}

/** Where mote `m` is at `time`, drifting `dir` (-1 up, 1 down) and swaying. */
export function moteAt(m: Mote, time: number, dir: number): Vec2 {
  const travel = (((m.y + dir * m.speed * time) % TABLE_H) + TABLE_H) % TABLE_H;
  return { x: m.x + Math.sin(time * 0.6 + m.phase) * m.sway, y: travel };
}

/**
 * Draw a field of motes in three alpha buckets.
 *
 * Batched deliberately: state changes cost, individual arcs do not, so this is
 * three fills rather than sixty.
 */
export function drawMotes(
  g: Ctx,
  field: readonly Mote[],
  time: number,
  dir: number,
  color: string,
  alphas: readonly number[],
): void {
  g.save();
  for (const [bucket, alpha] of alphas.entries()) {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    for (let i = bucket; i < field.length; i += alphas.length) {
      const m = field[i];
      if (!m) continue;
      const p = moteAt(m, time, dir);
      g.moveTo(p.x + m.size, p.y);
      g.arc(p.x, p.y, m.size, 0, Math.PI * 2);
    }
    g.fill();
  }
  g.restore();
}

/* ------------------------------------------------------------------ *
 * Defaults
 *
 * Generic pinball hardware with no theme of its own. A machine that overrides
 * nothing still gets a coherent table; the space motifs that used to live here
 * — the starfield, the nebula, the orbital ring, the black-hole portal — are
 * Orbit Cadet's art now, not everybody's.
 * ------------------------------------------------------------------ */

export const DEFAULT_CACHED: CachedArt = {
  backdrop(g, { theme }) {
    const base = g.createLinearGradient(0, 0, 0, TABLE_H);
    base.addColorStop(0, theme.playfieldTop);
    base.addColorStop(0.55, theme.playfieldMid);
    base.addColorStop(1, theme.playfieldBottom);
    g.fillStyle = base;
    g.fillRect(0, 0, TABLE_W, TABLE_H);
    vignette(g);
  },

  rails(g, { theme, table }) {
    strokeWalls(g, table, [
      { width: 11, style: theme.railDark },
      { width: 7, style: theme.railMid },
      { width: 2.5, style: theme.railLight },
    ]);
    gates(g, theme, table);
  },

  saucer(g, { theme, table }) {
    const s = table.saucer;
    g.save();
    g.translate(s.center.x, s.center.y);
    const hole = g.createRadialGradient(0, -4, 2, 0, 0, s.radius - 2);
    hole.addColorStop(0, shade(theme.holeMid, 0));
    hole.addColorStop(0.7, theme.holeMid);
    hole.addColorStop(1, theme.holeRim);
    g.fillStyle = hole;
    g.beginPath();
    g.arc(0, 0, s.radius - 3, 0, Math.PI * 2);
    g.fill();
    cupWall(g, theme, s.radius);
    saucerLabel(g, theme, table, s.radius);
    g.restore();
  },
};

export const DEFAULT_LIVE: LiveArt = {
  bumper(g, { theme }, b, lit) {
    const r = b.radius * (1 + lit * 0.09);
    g.save();
    g.translate(b.center.x, b.center.y);
    bumperSkirt(g, theme, r);
    bumperCap(g, theme, r, lit);
    if (lit > 0) glow(g, 0, 0, r * 2.4 * lit, theme.primary, lit * 0.7);
    g.restore();
  },

  target(g, { theme }, a, b, color, lit) {
    g.save();
    g.lineCap = 'round';
    // Shadow, then a dark base plate, then the coloured face on top.
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(a.x + 2, a.y + 4);
    g.lineTo(b.x + 2, b.y + 4);
    g.stroke();
    g.strokeStyle = shade(theme.playfieldTop, 1.15);
    g.lineWidth = 13;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.strokeStyle = color;
    g.globalAlpha = 0.65 + lit * 0.35;
    g.lineWidth = 8;
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(a.x, a.y - 2);
    g.lineTo(b.x, b.y - 2);
    g.stroke();
    if (lit > 0) glow(g, (a.x + b.x) / 2, (a.y + b.y) / 2, 34 * lit, color, lit * 0.6);
    g.restore();
  },

  ambient() {
    // Nothing drifts on a table that has not said what drifts on it.
  },

  current() {
    // Only reached on a machine that declares one, and such a machine is
    // expected to draw its own.
  },
};

/* --- pieces the machines reuse -------------------------------------- */

/** Draws the eye down the table towards the drain. */
export function vignette(g: Ctx): void {
  const vig = g.createRadialGradient(PLAY_CENTER, 420, 120, PLAY_CENTER, 620, 680);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = vig;
  g.fillRect(0, 0, TABLE_W, TABLE_H);
}

/**
 * Every one-way gate, drawn from the collider itself so a gate can never exist
 * in the physics without appearing on the playfield.
 */
export function gates(g: Ctx, theme: Theme, table: Table): void {
  for (const c of table.colliders) {
    if (c.id !== 'gate' || c.kind !== 'segment') continue;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(c.a.x, c.a.y + 2);
    g.lineTo(c.b.x, c.b.y + 2);
    g.stroke();
    g.strokeStyle = theme.highlight;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(c.a.x, c.a.y);
    g.lineTo(c.b.x, c.b.y);
    g.stroke();
    // Hinge pips, so it reads as a gate rather than a wall.
    g.fillStyle = theme.railLight;
    for (const end of [c.a, c.b]) {
      g.beginPath();
      g.arc(end.x, end.y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** The cup wall, open at the bottom where the ball enters. */
export function cupWall(g: Ctx, theme: Theme, radius: number): void {
  for (const pass of [
    { width: 7, style: theme.railMid },
    { width: 2, style: theme.railLight },
  ]) {
    g.beginPath();
    g.arc(0, 0, radius, Math.PI * 0.75, Math.PI * 2.25);
    g.strokeStyle = pass.style;
    g.lineWidth = pass.width;
    g.lineCap = 'round';
    g.stroke();
  }
}

export function saucerLabel(g: Ctx, theme: Theme, table: Table, radius: number): void {
  g.fillStyle = theme.feature;
  g.font = '700 11px ui-monospace, Menlo, monospace';
  g.textAlign = 'center';
  g.fillText(table.saucerLabel, 0, radius + 20);
}

/** A collar of light around the saucer, so it reads as a target. */
export function saucerCollar(g: Ctx, theme: Theme, radius: number): void {
  const collar = g.createRadialGradient(0, 0, radius - 12, 0, 0, radius + 12);
  collar.addColorStop(0, withAlpha(theme.feature, 0.45));
  collar.addColorStop(1, withAlpha(theme.feature, 0));
  g.fillStyle = collar;
  g.beginPath();
  g.arc(0, 0, radius + 12, 0, Math.PI * 2);
  g.fill();
}

export function bumperSkirt(g: Ctx, theme: Theme, r: number): void {
  g.beginPath();
  g.arc(0, 0, r + 7, 0, Math.PI * 2);
  g.fillStyle = withAlpha(theme.voidBottom, 0.85);
  g.fill();
  g.strokeStyle = theme.railMid;
  g.lineWidth = 2;
  g.stroke();
}

export function bumperCap(g: Ctx, theme: Theme, r: number, lit: number): void {
  const cap = g.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
  cap.addColorStop(0, lit > 0 ? theme.ballLight : shade(theme.primary, 1.35));
  cap.addColorStop(0.5, theme.primary);
  cap.addColorStop(1, shade(theme.primary, 0.32));
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = cap;
  g.fill();
}

export { railRibbon };

/**
 * Fill in the slots a machine did not author.
 *
 * Resolved once per machine swap rather than tested at every call site, so
 * adding a slot is a compile error in one place and never in the machines.
 */
export function resolveArt(spec: ArtSpec): MachineArt {
  return {
    cached: { ...DEFAULT_CACHED, ...spec.cached },
    live: { ...DEFAULT_LIVE, ...spec.live },
  };
}
