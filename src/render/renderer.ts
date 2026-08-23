import type { Game } from '../game/game.js';
import { pointAlong } from '../game/game.js';
import type { Table } from '../game/table.js';
import {
  BALL_RADIUS,
  DOME_CENTER,
  LANE_CENTER,
  LANE_FLOOR,
  LANE_LEFT,
  LANE_RIGHT,
  PLAY_CENTER,
  PLAY_LEFT,
  PLAY_RIGHT,
  TABLE_H,
  TABLE_W,
} from '../game/table.js';
import { MISSIONS } from '../game/rules.js';
import type { Vec2 } from '../engine/vec2.js';
import { PALETTE, seeded } from './palette.js';

interface Layout {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Screen-space box for the score panel. */
  hud: { x: number; y: number; w: number; h: number; vertical: boolean };
}

/**
 * Paints the table.
 *
 * The playfield art never changes, so it is drawn once into an offscreen canvas
 * at the current display resolution and blitted each frame. Only the ball,
 * flippers, lamps and effects are drawn live, which is what keeps this cheap
 * enough for a phone.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement | null = null;
  private layout: Layout = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    hud: { x: 0, y: 0, w: 0, h: 0, vertical: false },
  };

  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.ctx = ctx;
  }

  /** Match the canvas to the viewport and rebuild the static art. */
  resize(table: Table): void {
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    const cssWidth = this.canvas.clientWidth || window.innerWidth;
    const cssHeight = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.width = cssWidth;
    this.height = cssHeight;

    // Wide screens get the score panel beside the table; tall ones above it.
    const sidePanel = cssWidth > cssHeight * 0.95;
    const panelWidth = sidePanel ? Math.min(320, cssWidth * 0.3) : 0;
    const topPanel = sidePanel ? 0 : Math.min(150, cssHeight * 0.17);

    const availW = cssWidth - panelWidth - 16;
    const availH = cssHeight - topPanel - 16;
    const scale = Math.min(availW / TABLE_W, availH / TABLE_H);

    this.layout = {
      scale,
      offsetX: panelWidth + (availW - TABLE_W * scale) / 2 + 8,
      offsetY: topPanel + (availH - TABLE_H * scale) / 2 + 8,
      hud: sidePanel
        ? { x: 12, y: 16, w: panelWidth - 20, h: cssHeight - 32, vertical: true }
        : { x: 12, y: 8, w: cssWidth - 24, h: topPanel - 8, vertical: false },
    };

    this.buildStaticLayer(table);
  }

  /* ------------------------------------------------------------------ */

  private buildStaticLayer(table: Table): void {
    const w = Math.max(1, Math.round(TABLE_W * this.layout.scale * this.dpr));
    const h = Math.max(1, Math.round(TABLE_H * this.layout.scale * this.dpr));
    const layer = document.createElement('canvas');
    layer.width = w;
    layer.height = h;
    const g = layer.getContext('2d');
    if (!g) return;
    g.scale(w / TABLE_W, h / TABLE_H);

    this.paintPlayfield(g);
    this.paintDecor(g, table);
    this.paintWalls(g, table);
    this.staticLayer = layer;
  }

  private paintPlayfield(g: CanvasRenderingContext2D): void {
    const base = g.createLinearGradient(0, 0, 0, TABLE_H);
    base.addColorStop(0, PALETTE.playfieldTop);
    base.addColorStop(0.55, '#0a1229');
    base.addColorStop(1, PALETTE.playfieldBottom);
    g.fillStyle = base;
    g.fillRect(0, 0, TABLE_W, TABLE_H);

    // A field of stars, fixed by seed so the art is the same every load.
    const rand = seeded(0x5eed);
    for (let i = 0; i < 420; i += 1) {
      const x = rand() * TABLE_W;
      const y = rand() * TABLE_H;
      const r = rand() * 1.1 + 0.25;
      g.globalAlpha = 0.15 + rand() * 0.6;
      g.fillStyle = rand() > 0.85 ? PALETTE.cyan : '#ffffff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // A nebula behind the bumper cluster, to give the top some depth.
    const neb = g.createRadialGradient(278, 210, 10, 278, 210, 280);
    neb.addColorStop(0, 'rgba(90, 60, 200, 0.4)');
    neb.addColorStop(0.5, 'rgba(40, 90, 190, 0.16)');
    neb.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, TABLE_W, 620);

    // Vignette towards the drain, so the eye is drawn down the table.
    const vig = g.createRadialGradient(
      PLAY_CENTER,
      420,
      120,
      PLAY_CENTER,
      620,
      680,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = vig;
    g.fillRect(0, 0, TABLE_W, TABLE_H);
  }

  private paintDecor(g: CanvasRenderingContext2D, table: Table): void {
    // Concentric rings echoing the dome, as playfield printing.
    g.strokeStyle = 'rgba(120, 180, 255, 0.10)';
    for (let r = 96; r < 260; r += 34) {
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(DOME_CENTER.x, DOME_CENTER.y, r, Math.PI, Math.PI * 2);
      g.stroke();
    }

    // Lane arrows pointing up the inlanes and outlanes.
    for (const x of [43, 81, PLAY_RIGHT - 43, PLAY_RIGHT - 81]) {
      g.save();
      g.globalAlpha = 0.35;
      g.strokeStyle = PALETTE.cyan;
      g.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        const y = 792 + i * 22;
        g.beginPath();
        g.moveTo(x - 8, y + 8);
        g.lineTo(x, y);
        g.lineTo(x + 8, y + 8);
        g.stroke();
      }
      g.restore();
    }

    // The ramp, drawn as a wire habitrail under everything else.
    g.save();
    g.strokeStyle = 'rgba(180, 210, 255, 0.30)';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    const path = table.rampPath;
    const first = path[0];
    if (first) {
      g.moveTo(first.x, first.y);
      for (const p of path.slice(1)) g.lineTo(p.x, p.y);
    }
    g.stroke();
    g.strokeStyle = 'rgba(60, 224, 255, 0.22)';
    g.lineWidth = 3;
    g.stroke();
    g.restore();

    // Shooter lane floor markings.
    g.save();
    g.globalAlpha = 0.3;
    g.strokeStyle = PALETTE.amber;
    g.lineWidth = 1.5;
    g.setLineDash([6, 10]);
    g.beginPath();
    g.moveTo(LANE_CENTER, LANE_FLOOR - 20);
    g.lineTo(LANE_CENTER, 320);
    g.stroke();
    g.restore();

    // Slingshot bodies: solid plastics with a lit edge.
    for (const s of table.slingshots) {
      g.beginPath();
      g.moveTo(s.a.x, s.a.y);
      g.lineTo(s.b.x, s.b.y);
      g.lineTo(s.c.x, s.c.y);
      g.closePath();
      const grad = g.createLinearGradient(s.a.x, s.a.y, s.c.x, s.c.y);
      grad.addColorStop(0, '#232f4e');
      grad.addColorStop(1, '#131b30');
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = 'rgba(140, 170, 220, 0.45)';
      g.lineWidth = 2;
      g.stroke();
    }
  }

  private paintWalls(g: CanvasRenderingContext2D, table: Table): void {
    // Structural rails first, then a bright inner line so they read as metal.
    for (const pass of [
      { width: 11, style: PALETTE.railDark },
      { width: 7, style: PALETTE.railMid },
      { width: 2.5, style: PALETTE.railLight },
    ]) {
      g.strokeStyle = pass.style;
      g.lineWidth = pass.width;
      g.lineCap = 'round';
      for (const c of table.colliders) {
        if (c.id !== 'wall' && c.id !== 'guide') continue;
        g.beginPath();
        if (c.kind === 'segment') {
          g.moveTo(c.a.x, c.a.y);
          g.lineTo(c.b.x, c.b.y);
        } else if (c.kind === 'arc') {
          g.arc(c.center.x, c.center.y, c.radius, c.a0, c.a1);
        } else {
          g.arc(c.center.x, c.center.y, c.radius, 0, Math.PI * 2);
        }
        g.stroke();
      }
    }

    // The lane gate, in brass.
    g.strokeStyle = PALETTE.amber;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(LANE_LEFT + 3, 300);
    g.lineTo(LANE_RIGHT - 3, 300);
    g.stroke();

    // Saucer cup.
    const s = table.saucer;
    g.beginPath();
    g.arc(s.center.x, s.center.y, s.radius, Math.PI * 0.75, Math.PI * 2.25);
    g.strokeStyle = PALETTE.railMid;
    g.lineWidth = 8;
    g.stroke();
    const hole = g.createRadialGradient(
      s.center.x,
      s.center.y,
      2,
      s.center.x,
      s.center.y,
      s.radius,
    );
    hole.addColorStop(0, '#000000');
    hole.addColorStop(1, 'rgba(0,0,0,0.05)');
    g.fillStyle = hole;
    g.beginPath();
    g.arc(s.center.x, s.center.y, s.radius - 4, 0, Math.PI * 2);
    g.fill();

    // Posts.
    for (const p of table.posts) {
      const grad = g.createRadialGradient(
        p.center.x - 3,
        p.center.y - 3,
        1,
        p.center.x,
        p.center.y,
        p.radius,
      );
      grad.addColorStop(0, PALETTE.railLight);
      grad.addColorStop(1, PALETTE.railDark);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.center.x, p.center.y, p.radius, 0, Math.PI * 2);
      g.fill();
    }
  }

  /* ------------------------------------------------------------------ */

  draw(game: Game, time: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, PALETTE.voidTop);
    bg.addColorStop(1, PALETTE.voidBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    const { scale, offsetX, offsetY } = this.layout;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    if (this.staticLayer) {
      ctx.drawImage(this.staticLayer, 0, 0, TABLE_W, TABLE_H);
    }

    this.drawInserts(ctx, game);
    this.drawTargets(ctx, game);
    this.drawBumpers(ctx, game, time);
    this.drawSlingshotFlash(ctx, game);
    this.drawFlippers(ctx, game);
    this.drawPlunger(ctx, game);
    this.drawBalls(ctx, game);
    this.drawEffects(ctx, game);
    ctx.restore();

    this.drawHud(ctx, game, time);
    ctx.restore();
  }

  private drawInserts(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const [i, p] of game.table.rollovers.entries()) {
      const lit = game.lamps.get(`rollover-${i}`) ?? 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = lit > 0 ? PALETTE.amber : 'rgba(255, 180, 60, 0.16)';
      ctx.globalAlpha = lit > 0 ? 0.35 + lit * 0.65 : 1;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 220, 160, 0.5)';
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (lit > 0) this.glow(ctx, 0, 0, 30 * lit, PALETTE.amber, lit * 0.5);
      ctx.restore();
    }
  }

  private drawTargets(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const t of game.table.dropTargets) {
      const lit = game.lamps.get(t.id) ?? 0;
      if (!t.collider.enabled) {
        // A dropped target leaves its slot showing.
        ctx.strokeStyle = 'rgba(255, 90, 216, 0.25)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(t.a.x, t.a.y);
        ctx.lineTo(t.b.x, t.b.y);
        ctx.stroke();
        continue;
      }
      this.drawTargetFace(ctx, t.a, t.b, PALETTE.magenta, lit);
    }
    for (const t of game.table.standupTargets) {
      const lit = game.lamps.get(t.id) ?? 0;
      this.drawTargetFace(ctx, t.a, t.b, PALETTE.green, lit);
    }
  }

  private drawTargetFace(
    ctx: CanvasRenderingContext2D,
    a: Vec2,
    b: Vec2,
    color: string,
    lit: number,
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 14, 26, 0.9)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55 + lit * 0.45;
    ctx.lineWidth = 7;
    ctx.stroke();
    if (lit > 0) {
      this.glow(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, 34 * lit, color, lit * 0.6);
    }
    ctx.restore();
  }

  private drawBumpers(
    ctx: CanvasRenderingContext2D,
    game: Game,
    time: number,
  ): void {
    for (const b of game.table.bumpers) {
      const lit = game.lamps.get(b.id) ?? 0;
      const r = b.radius * (1 + lit * 0.09);
      ctx.save();
      ctx.translate(b.center.x, b.center.y);

      // Skirt.
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(12, 20, 40, 0.85)';
      ctx.fill();
      ctx.strokeStyle = PALETTE.railMid;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Cap.
      const cap = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
      cap.addColorStop(0, lit > 0 ? '#ffffff' : '#7ad9f2');
      cap.addColorStop(0.5, PALETTE.cyan);
      cap.addColorStop(1, '#0d4f6e');
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = cap;
      ctx.fill();

      // Rotating ring, so an idle table still has motion.
      ctx.rotate(time * 0.6);
      ctx.strokeStyle = `rgba(255,255,255,${0.18 + lit * 0.6})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, r - 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (lit > 0) this.glow(ctx, 0, 0, r * 2.4 * lit, PALETTE.cyan, lit * 0.7);
      ctx.restore();
    }
  }

  private drawSlingshotFlash(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const s of game.table.slingshots) {
      const lit = game.lamps.get(s.id) ?? 0;
      if (lit <= 0) continue;
      ctx.save();
      ctx.strokeStyle = PALETTE.amber;
      ctx.globalAlpha = lit;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.c.x, s.c.y);
      ctx.stroke();
      this.glow(ctx, (s.a.x + s.c.x) / 2, (s.a.y + s.c.y) / 2, 46 * lit, PALETTE.amber, lit * 0.6);
      ctx.restore();
    }
  }

  private drawFlippers(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const f of game.table.flippers) {
      const tip = f.tip;
      ctx.save();
      ctx.lineCap = 'round';
      // Shadow bat.
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = f.pivotRadius * 2 + 4;
      ctx.beginPath();
      ctx.moveTo(f.pivot.x, f.pivot.y + 3);
      ctx.lineTo(tip.x, tip.y + 3);
      ctx.stroke();

      const grad = ctx.createLinearGradient(f.pivot.x, f.pivot.y, tip.x, tip.y);
      const hot = game.tilted ? PALETTE.railDark : PALETTE.magenta;
      grad.addColorStop(0, hot);
      grad.addColorStop(1, '#5a1f52');
      ctx.strokeStyle = grad;
      ctx.lineWidth = f.pivotRadius * 2;
      ctx.beginPath();
      ctx.moveTo(f.pivot.x, f.pivot.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();

      // Highlight along the top of the bat.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(f.pivot.x, f.pivot.y - f.pivotRadius * 0.4);
      ctx.lineTo(tip.x, tip.y - f.tipRadius * 0.4);
      ctx.stroke();

      // Pivot boss.
      ctx.fillStyle = PALETTE.railLight;
      ctx.beginPath();
      ctx.arc(f.pivot.x, f.pivot.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlunger(ctx: CanvasRenderingContext2D, game: Game): void {
    const pull = game.plungerPower * 46;
    const topY = LANE_FLOOR - 10 + pull;
    ctx.save();
    ctx.strokeStyle = PALETTE.railMid;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(LANE_CENTER, topY);
    ctx.lineTo(LANE_CENTER, LANE_FLOOR + 26);
    ctx.stroke();
    ctx.fillStyle = game.plungerPower > 0 ? PALETTE.amber : PALETTE.railLight;
    ctx.beginPath();
    ctx.ellipse(LANE_CENTER, topY, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Power gauge beside the lane.
    if (game.plungerPower > 0) {
      const h = 120 * game.plungerPower;
      ctx.fillStyle = PALETTE.amber;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(LANE_RIGHT - 8, LANE_FLOOR - 40 - h, 4, h);
    }
    ctx.restore();
  }

  private drawBalls(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const entry of game.balls) {
      if (entry.mode === 'idle') continue;
      let p = entry.ball.pos;
      if (entry.mode === 'rail') {
        p = pointAlong(game.table.rampPath, entry.railT);
      }
      const speed = Math.hypot(entry.ball.vel.x, entry.ball.vel.y);

      ctx.save();
      // Motion smear, so a fast ball reads as fast.
      if (speed > 400 && entry.ball.active) {
        const len = Math.min(speed * 0.012, 30);
        const nx = entry.ball.vel.x / speed;
        const ny = entry.ball.vel.y / speed;
        ctx.strokeStyle = 'rgba(200, 220, 255, 0.22)';
        ctx.lineWidth = BALL_RADIUS * 1.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - nx * len, p.y - ny * len);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.ellipse(p.x + 3, p.y + 5, BALL_RADIUS, BALL_RADIUS * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();

      const hx = Math.cos(entry.ball.spin) * 3.5;
      const hy = Math.sin(entry.ball.spin) * 3.5;
      const grad = ctx.createRadialGradient(
        p.x - 4 + hx,
        p.y - 5 + hy,
        1,
        p.x,
        p.y,
        BALL_RADIUS,
      );
      grad.addColorStop(0, PALETTE.ballLight);
      grad.addColorStop(0.45, PALETTE.ballMid);
      grad.addColorStop(1, PALETTE.ballDark);
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 22px ui-monospace, "SF Mono", Menlo, monospace';
    for (const e of game.effects) {
      const t = e.life / e.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.fillStyle = `hsl(${e.hue} 100% 72%)`;
      ctx.shadowColor = `hsl(${e.hue} 100% 60%)`;
      ctx.shadowBlur = 12;
      ctx.fillText(e.text, e.at.x, e.at.y - (1 - t) * 42);
    }
    ctx.restore();
  }

  private glow(
    ctx: CanvasRenderingContext2D,
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

  /* ------------------------------------------------------------------ */

  private drawHud(
    ctx: CanvasRenderingContext2D,
    game: Game,
    time: number,
  ): void {
    const { hud } = this.layout;
    ctx.save();
    ctx.textBaseline = 'top';

    const mono = (size: number, weight = 600): string =>
      `${weight} ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

    if (hud.vertical) {
      ctx.fillStyle = 'rgba(10, 16, 34, 0.72)';
      roundRect(ctx, hud.x, hud.y, hud.w, hud.h, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 130, 200, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      let y = hud.y + 22;
      const x = hud.x + 18;
      ctx.fillStyle = PALETTE.cyan;
      ctx.font = mono(14, 700);
      ctx.fillText('LOOPBACK PINBALL', x, y);
      y += 34;

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = mono(11);
      ctx.fillText('SCORE', x, y);
      y += 16;
      ctx.fillStyle = PALETTE.text;
      ctx.font = mono(30, 700);
      ctx.fillText(game.score.toLocaleString(), x, y);
      y += 42;

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = mono(11);
      ctx.fillText('HIGH', x, y);
      ctx.fillText('BALL', x + 130, y);
      y += 16;
      ctx.fillStyle = PALETTE.text;
      ctx.font = mono(16);
      ctx.fillText(game.highScore.toLocaleString(), x, y);
      ctx.fillText(`${game.ballNumber} / ${game.ballsRemaining}`, x + 130, y);
      y += 34;

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = mono(11);
      ctx.fillText('RANK', x, y);
      y += 16;
      ctx.fillStyle = PALETTE.amber;
      ctx.font = mono(18, 700);
      ctx.fillText(game.rank.toUpperCase(), x, y);
      y += 34;

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = mono(11);
      ctx.fillText(`BONUS x${game.bonusMultiplier}`, x, y);
      ctx.fillText(`UNITS ${game.bonusUnits}`, x + 130, y);
      y += 30;

      y = this.drawMissionPanel(ctx, game, x, y, hud.w - 36, mono);
      this.drawControls(ctx, x, hud.y + hud.h - 132, mono);
    } else {
      ctx.fillStyle = PALETTE.text;
      ctx.font = mono(Math.min(34, hud.h * 0.42), 700);
      ctx.fillText(game.score.toLocaleString(), hud.x + 4, hud.y + 4);

      ctx.font = mono(12);
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(
        `HIGH ${game.highScore.toLocaleString()}`,
        hud.x + 4,
        hud.y + hud.h - 34,
      );
      ctx.textAlign = 'right';
      ctx.fillStyle = PALETTE.amber;
      ctx.font = mono(15, 700);
      ctx.fillText(game.rank.toUpperCase(), hud.x + hud.w - 4, hud.y + 6);
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = mono(12);
      ctx.fillText(
        `BALL ${game.ballNumber}  x${game.bonusMultiplier}`,
        hud.x + hud.w - 4,
        hud.y + 28,
      );
      ctx.textAlign = 'left';
      this.drawMissionPanel(ctx, game, hud.x + 4, hud.y + hud.h - 16, hud.w - 8, mono);
    }
    ctx.restore();

    this.drawBanner(ctx, game, time);
    if (game.phase === 'attract' || game.phase === 'gameOver') {
      this.drawAttract(ctx, game, time);
    }
    if (game.tilted) this.drawTilt(ctx, time);
  }

  private drawMissionPanel(
    ctx: CanvasRenderingContext2D,
    game: Game,
    x: number,
    y: number,
    w: number,
    mono: (size: number, weight?: number) => string,
  ): number {
    if (game.activeMission < 0) return y;
    const spec = MISSIONS[game.activeMission];
    if (!spec) return y;
    ctx.fillStyle = PALETTE.violet;
    ctx.font = mono(13, 700);
    ctx.fillText(spec.name.toUpperCase(), x, y);
    const barY = y + 20;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, barY, w, 6);
    ctx.fillStyle = PALETTE.violet;
    ctx.fillRect(x, barY, w * missionFraction(game, spec.target), 6);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = mono(11);
    ctx.fillText(`${Math.ceil(game.missionTimer)}s  ${spec.brief}`, x, barY + 12);
    return barY + 32;
  }

  private drawControls(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    mono: (size: number, weight?: number) => string,
  ): void {
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = mono(11);
    const lines = [
      'Z / ←      left flipper',
      '/ / →      right flipper',
      'SPACE     plunger',
      'X  .      nudge',
      'ENTER     new game',
    ];
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * 16));
  }

  private drawBanner(
    ctx: CanvasRenderingContext2D,
    game: Game,
    time: number,
  ): void {
    const banner = game.banner;
    if (!banner) return;
    const { offsetX, offsetY, scale } = this.layout;
    const cx = offsetX + PLAY_CENTER * scale;
    const cy = offsetY + 620 * scale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, banner.life * 2);
    ctx.fillStyle = PALETTE.text;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 18;
    ctx.font = `700 ${Math.round(30 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(banner.text.toUpperCase(), cx, cy + Math.sin(time * 6) * 2);
    if (banner.sub) {
      ctx.shadowBlur = 8;
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = `500 ${Math.round(15 * scale)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(banner.sub, cx, cy + 34 * scale);
    }
    ctx.restore();
  }

  private drawAttract(
    ctx: CanvasRenderingContext2D,
    game: Game,
    time: number,
  ): void {
    const { offsetX, offsetY, scale } = this.layout;
    const cx = offsetX + PLAY_CENTER * scale;
    const cy = offsetY + 430 * scale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(4, 8, 20, 0.72)';
    roundRect(
      ctx,
      offsetX + (PLAY_LEFT + 20) * scale,
      cy - 120 * scale,
      (PLAY_RIGHT - PLAY_LEFT - 40) * scale,
      260 * scale,
      16,
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(60, 224, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = PALETTE.cyan;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 22;
    ctx.font = `700 ${Math.round(40 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('LOOPBACK', cx, cy - 82 * scale);
    ctx.fillText('PINBALL', cx, cy - 38 * scale);
    ctx.shadowBlur = 0;

    if (game.phase === 'gameOver') {
      ctx.fillStyle = PALETTE.amber;
      ctx.font = `700 ${Math.round(20 * scale)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`FINAL ${game.score.toLocaleString()}`, cx, cy + 4 * scale);
    }

    ctx.fillStyle = PALETTE.text;
    ctx.globalAlpha = 0.6 + Math.sin(time * 3) * 0.4;
    ctx.font = `600 ${Math.round(18 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('TAP OR PRESS ENTER', cx, cy + 44 * scale);
    ctx.globalAlpha = 1;

    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `500 ${Math.round(13 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('Tap left / right to flip', cx, cy + 84 * scale);
    ctx.fillText('Hold to draw the plunger', cx, cy + 104 * scale);
    ctx.restore();
  }

  private drawTilt(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(time * 12) * 0.2;
    ctx.fillStyle = '#ff2d55';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 48px ui-monospace, Menlo, monospace';
    ctx.fillText('TILT', this.width / 2, this.height / 2 - 24);
    ctx.restore();
  }
}

function missionFraction(game: Game, target: number): number {
  const done = game.missionProgress;
  return Math.max(0, Math.min(1, done / target));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
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
