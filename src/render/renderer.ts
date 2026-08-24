import type { Game } from '../game/game.js';
import { pointAlong } from '../game/game.js';
import type { DecalColor, SpinnerSpec, Table } from '../game/table.js';
import {
  BALL_RADIUS,
  LANE_CENTER,
  LANE_FLOOR,
  LANE_RIGHT,
  MIRROR,
  PLUNGER_TRAVEL,
  PLAY_CENTER,
  PLAY_LEFT,
  PLAY_RIGHT,
  TABLE_H,
  TABLE_W,
} from '../game/table.js';
import { SCORE, SPINNER_VALUE_MAX, SPINS_TO_ARM_WARP } from '../game/rules.js';
import type { Vec2 } from '../engine/vec2.js';
import { clamp } from '../engine/vec2.js';
import type { Theme } from './theme.js';
import { ORBIT_THEME, seeded, withAlpha } from './theme.js';

/** Width the audio buttons occupy in the top-right corner, in CSS pixels. */
const AUDIO_BUTTON_SPAN = 96;

/** An on-screen control, in CSS pixels relative to the canvas. */
interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which audio buses are currently on, so the buttons can show their state. */
export interface AudioSettings {
  sfx: boolean;
  music: boolean;
  /** Whether audio is actually able to make a sound yet. */
  running: boolean;
}

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
  private buttons: Button[] = [];
  /**
   * The colour scheme of the machine being drawn.
   *
   * Held rather than imported, because it changes when the player picks a
   * different machine and the cached static layer has to be repainted in the
   * new colours.
   */
  private theme: Theme = ORBIT_THEME;
  /**
   * Which machine the cached static layer was painted for.
   *
   * The renderer notices the swap itself rather than being told, so switching
   * machines is one new Game in the caller and nothing else: a stale layer
   * would otherwise leave the old table painted under the new one.
   */
  private paintedMachine = '';
  /** Blade position at the habitrail fork, 0 on the ramp, 1 on the warp. */
  private diverter = 0;
  private diverterTime = 0;

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
    const topPanel = sidePanel ? 0 : Math.min(104, cssHeight * 0.12);

    const gap = sidePanel ? 20 : 0;
    const availW = cssWidth - panelWidth - gap - 16;
    const availH = cssHeight - topPanel - 16;
    const scale = Math.min(availW / TABLE_W, availH / TABLE_H);

    const tableW = TABLE_W * scale;
    const tableH = TABLE_H * scale;

    // Keep the score panel beside the table rather than pinned to the window
    // edge: the pair is centred as one group, so they read as one machine.
    const offsetX = sidePanel
      ? (cssWidth - (panelWidth + gap + tableW)) / 2 + panelWidth + gap
      : (cssWidth - tableW) / 2;

    // Portrait screens are taller than the table's aspect ratio allows, so the
    // slack goes above it: the flippers stay in easy thumb reach at the bottom
    // and the score gets the room it frees up.
    const offsetY = sidePanel ? topPanel + (availH - tableH) / 2 + 8 : cssHeight - tableH - 8;

    this.layout = {
      scale,
      offsetX,
      offsetY,
      hud: sidePanel
        ? {
            x: offsetX - gap - panelWidth,
            y: offsetY,
            w: panelWidth,
            h: tableH,
            vertical: true,
          }
        : { x: 14, y: 10, w: cssWidth - 28, h: Math.max(70, offsetY - 18), vertical: false },
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
    base.addColorStop(0, this.theme.playfieldTop);
    base.addColorStop(0.55, this.theme.playfieldMid);
    base.addColorStop(1, this.theme.playfieldBottom);
    g.fillStyle = base;
    g.fillRect(0, 0, TABLE_W, TABLE_H);

    // Flecks over the whole playfield, fixed by seed so the art is the same
    // every load: stars in space, embers over a forge, silt in deep water.
    const rand = seeded(0x5eed);
    for (let i = 0; i < 420; i += 1) {
      const x = rand() * TABLE_W;
      const y = rand() * TABLE_H;
      const r = rand() * 1.1 + 0.25;
      g.globalAlpha = 0.15 + rand() * 0.6;
      g.fillStyle = rand() > 0.85 ? this.theme.primary : this.theme.fleck;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // A wash behind the upper playfield, to give the top some depth.
    const neb = g.createRadialGradient(278, 210, 10, 278, 210, 280);
    neb.addColorStop(0, withAlpha(this.theme.wash, 0.4));
    neb.addColorStop(0.5, withAlpha(this.theme.wash, 0.16));
    neb.addColorStop(1, withAlpha(this.theme.wash, 0));
    g.fillStyle = neb;
    g.fillRect(0, 0, TABLE_W, 620);

    // Vignette towards the drain, so the eye is drawn down the table.
    const vig = g.createRadialGradient(PLAY_CENTER, 420, 120, PLAY_CENTER, 620, 680);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = vig;
    g.fillRect(0, 0, TABLE_W, TABLE_H);
  }

  /**
   * Playfield printing, painted from the table's own decal list.
   *
   * This used to be drawing code with the space table's coordinates written
   * into it, which meant the art could only ever describe one layout. Each
   * machine now authors its decals beside the geometry they annotate.
   */
  private paintDecor(g: CanvasRenderingContext2D, table: Table): void {
    for (const d of table.decals) {
      const color = this.decalColor(d.color);
      g.save();
      switch (d.kind) {
        case 'ring':
          g.strokeStyle = withAlpha(color, 0.1);
          g.lineWidth = 1.4;
          g.beginPath();
          g.arc(d.at.x, d.at.y, d.radius, Math.PI, Math.PI * 2);
          g.stroke();
          break;
        case 'arrow':
          g.translate(d.at.x, d.at.y);
          g.rotate(d.angle);
          g.globalAlpha = 0.5;
          g.fillStyle = color;
          g.beginPath();
          g.moveTo(0, -13);
          g.lineTo(10, 6);
          g.lineTo(0, 1);
          g.lineTo(-10, 6);
          g.closePath();
          g.fill();
          break;
        case 'label':
          g.textAlign = 'center';
          g.fillStyle = withAlpha(color, 0.55);
          g.font = `700 ${d.size ?? 9}px ui-monospace, Menlo, monospace`;
          g.fillText(d.text, d.at.x, d.at.y);
          break;
        case 'chevrons':
          g.globalAlpha = 0.35;
          g.strokeStyle = color;
          g.lineWidth = 2;
          for (let i = 0; i < d.count; i += 1) {
            const y = d.at.y + i * 22;
            g.beginPath();
            g.moveTo(d.at.x - 8, y + 8);
            g.lineTo(d.at.x, y);
            g.lineTo(d.at.x + 8, y + 8);
            g.stroke();
          }
          break;
        case 'dashes':
          g.globalAlpha = 0.3;
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.setLineDash([6, 10]);
          g.beginPath();
          g.moveTo(d.from.x, d.from.y);
          g.lineTo(d.to.x, d.to.y);
          g.stroke();
          break;
      }
      g.restore();
    }

    // Bases for the mission lamps: unlit sockets, so the row reads as a row
    // even before any of it is earned.
    for (const p of table.missionLamps) {
      g.beginPath();
      g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.fillStyle = withAlpha(this.theme.playfieldBottom, 0.85);
      g.fill();
      g.strokeStyle = withAlpha(this.theme.feature, 0.4);
      g.lineWidth = 1.5;
      g.stroke();
    }

    // The well each spinner hangs in. The blade itself is drawn every frame
    // instead, because it turns: painted into the cached layer, the one part of
    // the table whose whole point is that it moves was the only part that never
    // did.
    for (const sp of table.spinners) {
      g.save();
      g.translate(sp.center.x, sp.center.y);
      const well = g.createLinearGradient(0, -sp.h / 2, 0, sp.h / 2);
      well.addColorStop(0, withAlpha(this.theme.voidTop, 0.9));
      well.addColorStop(1, withAlpha(this.theme.playfieldTop, 0.75));
      g.fillStyle = well;
      g.fillRect(-sp.w / 2, -sp.h / 2, sp.w, sp.h);
      g.strokeStyle = withAlpha(this.theme.primary, 0.55);
      g.lineWidth = 2;
      g.strokeRect(-sp.w / 2, -sp.h / 2, sp.w, sp.h);
      // Posts the blade hangs between.
      g.fillStyle = this.theme.railMid;
      g.fillRect(-sp.w / 2 - 1, -sp.h / 2 - 1, 3, sp.h + 2);
      g.fillRect(sp.w / 2 - 2, -sp.h / 2 - 1, 3, sp.h + 2);
      g.restore();
    }

    // Slingshot bodies: solid plastics with a lit edge.
    for (const s of table.slingshots) {
      g.beginPath();
      g.moveTo(s.a.x, s.a.y);
      g.lineTo(s.b.x, s.b.y);
      g.lineTo(s.c.x, s.c.y);
      g.closePath();
      const grad = g.createLinearGradient(s.a.x, s.a.y, s.c.x, s.c.y);
      grad.addColorStop(0, this.theme.slingTop);
      grad.addColorStop(1, this.theme.slingBottom);
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = withAlpha(this.theme.railMid, 0.45);
      g.lineWidth = 2;
      g.stroke();
    }
  }

  /** Resolve a decal's theme role to the colour it is painted in. */
  private decalColor(role: DecalColor): string {
    switch (role) {
      case 'primary':
        return this.theme.primary;
      case 'secondary':
        return this.theme.secondary;
      case 'highlight':
        return this.theme.highlight;
      case 'success':
        return this.theme.success;
      case 'feature':
        return this.theme.feature;
      case 'print':
        return this.theme.print;
    }
  }

  private paintWalls(g: CanvasRenderingContext2D, table: Table): void {
    // Structural rails first, then a bright inner line so they read as metal.
    for (const pass of [
      { width: 11, style: this.theme.railDark },
      { width: 7, style: this.theme.railMid },
      { width: 2.5, style: this.theme.railLight },
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

    // Every one-way gate, in brass, drawn from the collider itself so a gate
    // can never exist in the physics without appearing on the playfield.
    for (const c of table.colliders) {
      if (c.id !== 'gate' || c.kind !== 'segment') continue;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(c.a.x, c.a.y + 2);
      g.lineTo(c.b.x, c.b.y + 2);
      g.stroke();
      g.strokeStyle = this.theme.highlight;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(c.a.x, c.a.y);
      g.lineTo(c.b.x, c.b.y);
      g.stroke();
      // Hinge pips, so it reads as a gate rather than a wall.
      g.fillStyle = this.theme.railLight;
      for (const end of [c.a, c.b]) {
        g.beginPath();
        g.arc(end.x, end.y, 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Saucer: a kickout hole with a lit collar, so it reads as a target rather
    // than a smudge on the playfield.
    const s = table.saucer;
    g.save();
    g.translate(s.center.x, s.center.y);

    const collar = g.createRadialGradient(0, 0, s.radius - 12, 0, 0, s.radius + 12);
    collar.addColorStop(0, withAlpha(this.theme.feature, 0.45));
    collar.addColorStop(1, withAlpha(this.theme.feature, 0));
    g.fillStyle = collar;
    g.beginPath();
    g.arc(0, 0, s.radius + 12, 0, Math.PI * 2);
    g.fill();

    const hole = g.createRadialGradient(0, -4, 2, 0, 0, s.radius - 2);
    hole.addColorStop(0, '#000000');
    hole.addColorStop(0.7, this.theme.holeMid);
    hole.addColorStop(1, this.theme.holeRim);
    g.fillStyle = hole;
    g.beginPath();
    g.arc(0, 0, s.radius - 3, 0, Math.PI * 2);
    g.fill();

    // The cup wall, open at the bottom where the ball enters.
    g.beginPath();
    g.arc(0, 0, s.radius, Math.PI * 0.75, Math.PI * 2.25);
    g.strokeStyle = this.theme.railMid;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, s.radius, Math.PI * 0.75, Math.PI * 2.25);
    g.strokeStyle = this.theme.railLight;
    g.lineWidth = 2;
    g.stroke();

    g.fillStyle = this.theme.feature;
    g.font = '700 11px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.fillText(table.saucerLabel, 0, s.radius + 20);
    g.restore();

    // Posts, each wearing a rubber ring so it reads as a post rather than a
    // stray ball.
    for (const p of table.posts) {
      g.beginPath();
      g.arc(p.center.x, p.center.y, p.radius + 4, 0, Math.PI * 2);
      g.strokeStyle = withAlpha(this.theme.secondary, 0.55);
      g.lineWidth = 4;
      g.stroke();
      const grad = g.createRadialGradient(
        p.center.x - 3,
        p.center.y - 3,
        1,
        p.center.x,
        p.center.y,
        p.radius,
      );
      grad.addColorStop(0, this.theme.railLight);
      grad.addColorStop(1, this.theme.railDark);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.center.x, p.center.y, p.radius, 0, Math.PI * 2);
      g.fill();
    }
  }

  /* ------------------------------------------------------------------ */

  /** The button at these canvas coordinates, if any. */
  hitButton(x: number, y: number): string | null {
    for (const b of this.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  draw(game: Game, time: number, audio: AudioSettings): void {
    const ctx = this.ctx;
    // Hit targets are rebuilt every frame, because which of them exist depends
    // on what is on screen: the machine picker is only there while the attract
    // card is.
    this.buttons = [];
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, this.theme.voidTop);
    bg.addColorStop(1, this.theme.voidBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.paintedMachine !== game.machine.id) {
      this.paintedMachine = game.machine.id;
      this.theme = game.machine.theme;
      this.buildStaticLayer(game.table);
    }

    const { scale, offsetX, offsetY } = this.layout;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    if (this.staticLayer) {
      ctx.drawImage(this.staticLayer, 0, 0, TABLE_W, TABLE_H);
    }

    this.drawInserts(ctx, game, time);
    this.drawSpinner(ctx, game, time);
    this.drawTargets(ctx, game);
    this.drawBumpers(ctx, game, time);
    this.drawSlingshotFlash(ctx, game);
    this.drawFlippers(ctx, game);
    this.drawPlunger(ctx, game);
    // Balls on the playfield pass under the raised habitrail; the one riding
    // it goes over the top.
    this.drawBalls(ctx, game, false);
    this.drawRamp(ctx, game, time);
    this.drawBalls(ctx, game, true);
    this.drawEffects(ctx, game);
    ctx.restore();

    this.drawHud(ctx, game, time);
    this.drawAudioButtons(ctx, audio);
    ctx.restore();
  }

  /**
   * Mute controls for effects and music, drawn as their own buttons.
   *
   * They sit above every play zone in the input's hit order, so reaching for
   * them can never nudge the table by accident.
   */
  private drawAudioButtons(ctx: CanvasRenderingContext2D, audio: AudioSettings): void {
    const size = 38;
    const gap = 8;
    const margin = 12;
    // Keep this in step with AUDIO_BUTTON_SPAN, which reserves the room.
    // Appended rather than assigned: the machine picker registers its arrows
    // earlier in the same frame, and replacing the list here left them drawn
    // on screen but dead to the touch.
    const audioButtons: Button[] = [
      { id: 'music', x: this.width - margin - size, y: margin, w: size, h: size },
      {
        id: 'sfx',
        x: this.width - margin - size * 2 - gap,
        y: margin,
        w: size,
        h: size,
      },
    ];
    this.buttons.push(...audioButtons);

    for (const b of audioButtons) {
      const wanted = b.id === 'sfx' ? audio.sfx : audio.music;
      // Browsers only let audio start from a gesture, so a bus can be switched
      // on and still be silent. Showing it as fully on would be a lie, and a
      // player hearing nothing reasonably concludes the control is broken.
      const audible = wanted && audio.running;
      const on = wanted;
      ctx.save();
      ctx.fillStyle = audible ? 'rgba(24, 40, 78, 0.85)' : 'rgba(14, 18, 32, 0.8)';
      roundRect(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.strokeStyle = audible ? 'rgba(60, 224, 255, 0.6)' : 'rgba(120, 140, 180, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      ctx.strokeStyle = audible ? this.theme.primary : this.theme.textDim;
      ctx.fillStyle = audible ? this.theme.primary : this.theme.textDim;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';

      if (b.id === 'music') {
        // A quaver: stem, flag and note head.
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 6);
        ctx.lineTo(cx - 3, cy - 8);
        ctx.lineTo(cx + 6, cy - 11);
        ctx.lineTo(cx + 6, cy + 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx - 6, cy + 6, 3.4, 2.6, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + 3, cy + 3, 3.4, 2.6, -0.3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A speaker cone with two waves.
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy - 3);
        ctx.lineTo(cx - 5, cy - 3);
        ctx.lineTo(cx - 1, cy - 8);
        ctx.lineTo(cx - 1, cy + 8);
        ctx.lineTo(cx - 5, cy + 3);
        ctx.lineTo(cx - 9, cy + 3);
        ctx.closePath();
        ctx.fill();
        for (const r of [4, 7.5]) {
          ctx.beginPath();
          ctx.arc(cx + 1, cy, r, -0.9, 0.9);
          ctx.stroke();
        }
      }

      if (!on) {
        // A slash through it, the universal "off".
        ctx.strokeStyle = '#ff5a6e';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(b.x + 9, b.y + 9);
        ctx.lineTo(b.x + b.w - 9, b.y + b.h - 9);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawInserts(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    // A lit multiball waits at the saucer until the player goes and gets it,
    // so the saucer has to say so for as long as it is waiting. The banner
    // that announces it is gone in three seconds.
    if (game.multiballLit && !game.multiballActive) {
      const s = game.table.saucer;
      const pulse = 0.55 + Math.sin(time * 5) * 0.35;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = this.theme.primary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.center.x, s.center.y, s.radius + 9, 0, Math.PI * 2);
      ctx.stroke();
      this.glow(ctx, s.center.x, s.center.y, s.radius + 30, this.theme.primary, 0.4 * pulse);
      ctx.globalAlpha = Math.min(1, pulse + 0.2);
      ctx.fillStyle = this.theme.primary;
      ctx.font = '700 11px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MULTIBALL', s.center.x, s.center.y - s.radius - 14);
      ctx.restore();
    }

    // Mission lamps: one lights per rank earned, so progress is visible on the
    // playfield rather than only in the score panel.
    for (const [i, p] of game.table.missionLamps.entries()) {
      const done = i < game.missionsCompleted;
      const current = i === game.missionsCompleted && game.activeMission >= 0;
      if (!done && !current) continue;
      ctx.save();
      const color = done ? this.theme.feature : this.theme.highlight;
      ctx.fillStyle = color;
      ctx.globalAlpha = done ? 0.95 : 0.5 + Math.sin(game.missionTimer * 6) * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      this.glow(ctx, p.x, p.y, 22, color, 0.5);
      ctx.restore();
    }

    for (const [i, p] of game.table.rollovers.entries()) {
      const flash = game.lamps.get(`rollover-${i}`) ?? 0;
      const collected = game.litLanes.has(i);
      // The skill lane flashes while the launch window is open, which is the
      // cue for lane change: the flipper buttons move it under the ball.
      const skill = game.skillShotTimer > 0 && i === game.skillLane;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2);
      const pulse = 0.5 + Math.sin(game.skillShotTimer * 9) * 0.5;
      ctx.fillStyle = skill
        ? this.theme.primary
        : collected
          ? this.theme.highlight
          : 'rgba(255, 190, 90, 0.28)';
      ctx.globalAlpha = skill ? 0.4 + pulse * 0.6 : collected ? 1 : 1;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 230, 180, 0.8)';
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (skill) this.glow(ctx, 0, 0, 40, this.theme.primary, 0.35 + pulse * 0.4);
      else if (collected || flash > 0) {
        this.glow(ctx, 0, 0, 30 * Math.max(flash, 0.5), this.theme.highlight, 0.4);
      }
      ctx.restore();
    }

    // Kickback lamp, in the left outlane it protects.
    if (game.kickbackLit) {
      ctx.save();
      ctx.translate(MIRROR - 43, 856);
      const pulse = 0.6 + Math.sin(time * 6) * 0.4;
      ctx.fillStyle = this.theme.success;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(9, 6);
      ctx.lineTo(0, 1);
      ctx.lineTo(-9, 6);
      ctx.closePath();
      ctx.fill();
      this.glow(ctx, 0, 0, 34, this.theme.success, pulse * 0.5);
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
      this.drawTargetFace(ctx, t.a, t.b, this.theme.secondary, lit);
    }
    for (const t of game.table.standupTargets) {
      const lit = game.lamps.get(t.id) ?? 0;
      this.drawTargetFace(ctx, t.a, t.b, this.theme.success, lit);
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
    // Shadow, then a dark base plate, then the coloured face on top.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(a.x + 2, a.y + 4);
    ctx.lineTo(b.x + 2, b.y + 4);
    ctx.stroke();
    ctx.strokeStyle = '#1a2340';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65 + lit * 0.35;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 2);
    ctx.lineTo(b.x, b.y - 2);
    ctx.stroke();
    if (lit > 0) {
      this.glow(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, 34 * lit, color, lit * 0.6);
    }
    ctx.restore();
  }

  private drawBumpers(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
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
      ctx.strokeStyle = this.theme.railMid;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Cap.
      const cap = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
      cap.addColorStop(0, lit > 0 ? '#ffffff' : '#7ad9f2');
      cap.addColorStop(0.5, this.theme.primary);
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

      if (lit > 0) this.glow(ctx, 0, 0, r * 2.4 * lit, this.theme.primary, lit * 0.7);
      ctx.restore();
    }
  }

  private drawSlingshotFlash(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const s of game.table.slingshots) {
      const lit = game.lamps.get(s.id) ?? 0;
      if (lit <= 0) continue;
      ctx.save();
      ctx.strokeStyle = this.theme.highlight;
      ctx.globalAlpha = lit;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.c.x, s.c.y);
      ctx.stroke();
      this.glow(
        ctx,
        (s.a.x + s.c.x) / 2,
        (s.a.y + s.c.y) / 2,
        46 * lit,
        this.theme.highlight,
        lit * 0.6,
      );
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
      const hot = game.tilted ? this.theme.railDark : this.theme.secondary;
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
      ctx.fillStyle = this.theme.railLight;
      ctx.beginPath();
      ctx.arc(f.pivot.x, f.pivot.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlunger(ctx: CanvasRenderingContext2D, game: Game): void {
    // The tip sits just under the ball wherever the pull has taken it.
    const topY = game.table.plunger.y + game.plungerPower * PLUNGER_TRAVEL + BALL_RADIUS + 2;
    ctx.save();
    ctx.strokeStyle = this.theme.railMid;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(LANE_CENTER, topY);
    ctx.lineTo(LANE_CENTER, LANE_FLOOR + 8);
    ctx.stroke();
    ctx.fillStyle = game.plungerPower > 0 ? this.theme.highlight : this.theme.railLight;
    ctx.beginPath();
    ctx.ellipse(LANE_CENTER, topY, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Power gauge beside the lane.
    if (game.plungerPower > 0) {
      const h = 120 * game.plungerPower;
      ctx.fillStyle = this.theme.highlight;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(LANE_RIGHT - 8, LANE_FLOOR - 40 - h, 4, h);
    }
    ctx.restore();
  }

  /**
   * The raised wire ramp. Drawn above the playfield with a shadow and support
   * posts so that crossing over the bumpers reads as elevation rather than as
   * a mistake.
   */
  /**
   * The habitrail and the fork that drops out of it into the saucer.
   *
   * The two branches share a trunk, so the trunk is drawn once from the ramp's
   * own path and each branch is drawn from the fork onwards. Drawing both
   * paths whole instead stacks two translucent surfaces on the shared stretch,
   * which shows up as a bright seam running the length of the climb.
   */
  private drawRamp(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const { rampPath, warpPath, warpFork, warpForkIndex } = game.table;
    if (!rampPath || rampPath.length < 2) return;
    // A machine can have a rail without a diverter, in which case there is one
    // branch to draw and no blade.
    const forked =
      warpPath !== undefined && warpFork !== undefined && warpForkIndex !== undefined;

    // Ease the blade towards where the rules have it, rather than snapping. A
    // diverter that teleports between branches reads as a drawing error; one
    // that swings reads as a mechanism.
    const dt = clamp(time - this.diverterTime, 0, 0.1);
    this.diverterTime = time;
    const target = forked && game.warpLit ? 1 : 0;
    this.diverter += (target - this.diverter) * (1 - Math.pow(0.0002, dt));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Shadows for both branches first, so neither lands on top of the other's
    // surface and darkens it.
    this.railShadow(ctx, rampPath);
    const forkTail =
      forked && warpPath && warpForkIndex !== undefined
        ? warpPath.slice(Math.max(0, warpForkIndex - 1))
        : [];
    if (forkTail.length) this.railShadow(ctx, forkTail);

    // The long way round: open plastic, the ramp that has always been there.
    this.railSurface(ctx, rampPath, {
      from: 'rgba(150, 205, 255, 0.30)',
      to: 'rgba(110, 160, 235, 0.16)',
      width: 11,
    });

    // The fork: an enclosed tube rather than an open ramp, so at a glance the
    // player can tell which of the two the ball is about to take.
    //
    // It stops short of the saucer rather than running into it. Drawn all the
    // way to the path's end the tube lies across the cup, and the saucer is
    // the shot the entire campaign is gated on: a wireform that hides it is
    // the same mistake the ramp is routed around the bumpers to avoid. Ending
    // it above the rim also gives the ball a visible drop out of the tube,
    // which is what the shot actually does.
    const saucer = game.table.saucer;
    const fork = forkTail.filter(
      (p) => Math.hypot(p.x - saucer.center.x, p.y - saucer.center.y) > saucer.radius + 10,
    );
    ctx.save();
    // A closed diverter leaves this branch dead, so it sits back as structure
    // until the gate is thrown.
    ctx.globalAlpha = 0.4 + 0.6 * this.diverter;
    this.railSurface(ctx, fork, {
      from: 'rgba(190, 150, 255, 0.34)',
      to: 'rgba(140, 105, 235, 0.20)',
      width: 12,
    });
    this.railRibs(ctx, fork, 12);
    // Open end, so the tube reads as something the ball falls out of.
    const spout = fork[fork.length - 1];
    const before = fork[fork.length - 2];
    if (spout && before) {
      const angle = Math.atan2(spout.y - before.y, spout.x - before.x);
      ctx.save();
      ctx.translate(spout.x, spout.y);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(10, 14, 28, 0.8)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.theme.feature;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // A chase of light down whichever branch is live, so the armed state is
    // visible from the flippers without reading the display.
    if (this.diverter > 0.05) {
      this.railChase(ctx, fork, time, this.theme.feature, this.diverter);
    }

    if (forked && warpFork && warpPath && warpForkIndex !== undefined) {
      this.drawDiverter(ctx, warpFork, rampPath, warpPath, warpForkIndex);
    }

    // Entry mouth and exit flare, so both ends read as openings.
    const entry = rampPath[0];
    if (entry) {
      // Violet either way, matching the arrow printed on the playfield under
      // it. Arming is carried by the pulse and the legend, not by a change of
      // colour that would leave the mouth and the arrow disagreeing.
      const armed = forked && this.diverter > 0.5;
      const pulse = armed ? 0.5 + Math.sin(time * 7) * 0.3 : 0.45;
      this.glow(ctx, entry.x, entry.y, armed ? 44 : 36, this.theme.feature, pulse);
      ctx.strokeStyle = this.theme.feature;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(entry.x, entry.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      if (armed) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, pulse + 0.35);
        ctx.fillStyle = this.theme.feature;
        ctx.font = '700 11px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('WARP', entry.x, entry.y + 40);
        ctx.restore();
      }
    }
    const exit = rampPath[rampPath.length - 1];
    if (exit) {
      ctx.fillStyle = 'rgba(198, 224, 255, 0.5)';
      ctx.beginPath();
      ctx.ellipse(exit.x, exit.y, 13, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Offset copy of `path`, `d` units to its left, shifted down by `dy`. */
  private static offsetPath(path: readonly Vec2[], d: number, dy: number): Vec2[] {
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
  private railRibbon(
    ctx: CanvasRenderingContext2D,
    path: readonly Vec2[],
    d: number,
    dy: number,
  ): void {
    const a = Renderer.offsetPath(path, d, dy);
    const b = Renderer.offsetPath(path, -d, dy);
    ctx.beginPath();
    a.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    for (let i = b.length - 1; i >= 0; i -= 1) {
      const p = b[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  private railShadow(ctx: CanvasRenderingContext2D, path: readonly Vec2[]): void {
    if (path.length < 2) return;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.railRibbon(ctx, path, 11, 20);
    ctx.fill();
  }

  private railSurface(
    ctx: CanvasRenderingContext2D,
    path: readonly Vec2[],
    o: { from: string; to: string; width: number },
  ): void {
    if (path.length < 2) return;
    const surface = ctx.createLinearGradient(0, 160, 0, 700);
    surface.addColorStop(0, o.from);
    surface.addColorStop(1, o.to);
    ctx.fillStyle = surface;
    this.railRibbon(ctx, path, o.width, 0);
    ctx.fill();

    // Raised edges either side.
    for (const d of [-o.width, o.width]) {
      const edge = Renderer.offsetPath(path, d, 0);
      ctx.beginPath();
      edge.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = 'rgba(20, 30, 52, 0.85)';
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(198, 224, 255, 0.9)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // A highlight running down the middle of the surface.
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  /** Hoops across a rail, which is what makes it read as a tube not a trough. */
  private railRibs(ctx: CanvasRenderingContext2D, path: readonly Vec2[], width: number): void {
    const left = Renderer.offsetPath(path, width, 0);
    const right = Renderer.offsetPath(path, -width, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(210, 190, 255, 0.30)';
    ctx.lineWidth = 1.4;
    for (let i = 2; i < path.length - 1; i += 3) {
      const a = left[i];
      const b = right[i];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A short bright run travelling along a rail, repeating. */
  private railChase(
    ctx: CanvasRenderingContext2D,
    path: readonly Vec2[],
    time: number,
    color: string,
    strength: number,
  ): void {
    if (path.length < 4) return;
    const head = (time * 0.75) % 1;
    const span = 0.28;
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 1; i < path.length; i += 1) {
      const t = i / (path.length - 1);
      // Distance behind the head, wrapped, so the run loops without a seam.
      const behind = (head - t + 1) % 1;
      if (behind > span) continue;
      const a = path[i - 1];
      const b = path[i];
      if (!a || !b) continue;
      ctx.globalAlpha = strength * (1 - behind / span);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The blade at the fork, swung between the two branches.
   *
   * It is aimed by taking the direction of each branch a little past the
   * junction and interpolating between them, so it always lies along whichever
   * wire the ball is about to be given and needs no angles of its own.
   */
  private drawDiverter(
    ctx: CanvasRenderingContext2D,
    fork: Vec2,
    rampPath: readonly Vec2[],
    warpPath: readonly Vec2[],
    forkIndex: number,
  ): void {
    const aim = (path: readonly Vec2[]): number => {
      const ahead = path[Math.min(path.length - 1, forkIndex + 5)] ?? fork;
      return Math.atan2(ahead.y - fork.y, ahead.x - fork.x);
    };
    const a = aim(rampPath);
    let b = aim(warpPath);
    // Take the short way round, so the blade never swings the long way about.
    while (b - a > Math.PI) b -= Math.PI * 2;
    while (a - b > Math.PI) b += Math.PI * 2;
    const angle = a + (b - a) * this.diverter;

    ctx.save();
    ctx.translate(fork.x, fork.y);
    // Pivot post.
    ctx.fillStyle = this.theme.railDark;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);
    const lit = this.diverter > 0.5;
    ctx.fillStyle = lit ? this.theme.feature : this.theme.railLight;
    ctx.strokeStyle = 'rgba(10, 14, 28, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, -4);
    ctx.lineTo(22, -2.5);
    ctx.lineTo(22, 2.5);
    ctx.lineTo(-2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (lit) this.glow(ctx, fork.x, fork.y, 26, this.theme.feature, 0.35 * this.diverter);
  }

  /**
   * The spinner blade, turning under its own momentum.
   *
   * Drawn edge-on as a rectangle whose width follows the cosine of its angle,
   * which is all a flat vane seen from above ever is, and it costs nothing
   * next to projecting a real one.
   */
  private drawSpinner(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    for (const [i, spec] of game.table.spinners.entries()) {
      this.drawSpinnerBlade(ctx, game, time, i, spec);
    }
  }

  private drawSpinnerBlade(
    ctx: CanvasRenderingContext2D,
    game: Game,
    time: number,
    index: number,
    spec: SpinnerSpec,
  ): void {
    const { x, y } = spec.center;
    // Only a machine with a diverter has anything for the spinner to arm, so
    // on the rest the blade is just a blade and there are no pips under it.
    const arms = game.table.warpFork !== undefined;
    const armed = arms && game.warpLit;
    const progress = arms ? game.spinsToWarp / SPINS_TO_ARM_WARP : 0;
    const angle = game.spinnerAngle[index] ?? 0;
    const rate = game.spinnerRate[index] ?? 0;
    const half1 = spec.h / 2;

    ctx.save();
    ctx.translate(x, y);

    // Hot when the value has climbed, cool when it has decayed back.
    const heat = clamp(
      (game.spinnerValue - SCORE.spinner) / (SPINNER_VALUE_MAX - SCORE.spinner),
      0,
      1,
    );
    const color = armed
      ? this.theme.feature
      : heat > 0.35
        ? this.theme.highlight
        : this.theme.primary;

    const face = Math.cos(angle);
    const half = Math.abs(face) * (spec.w / 2 - 7) + 1.5;
    // Edge-on the vane is a bright line; face-on it is a lit plate.
    const grad = ctx.createLinearGradient(-half, 0, half, 0);
    grad.addColorStop(0, 'rgba(20, 30, 52, 0.95)');
    grad.addColorStop(
      0.5,
      face >= 0 ? 'rgba(226, 238, 255, 0.95)' : 'rgba(150, 170, 205, 0.9)',
    );
    grad.addColorStop(1, 'rgba(20, 30, 52, 0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(-half, -half1 + 3, half * 2, spec.h - 6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-half, -half1 + 3, half * 2, spec.h - 6);

    // Spindle.
    ctx.strokeStyle = withAlpha(this.theme.railLight, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -half1 - 1);
    ctx.lineTo(0, half1 + 1);
    ctx.stroke();

    if (Math.abs(rate) > 1) {
      this.glow(ctx, 0, 0, 30, color, clamp(Math.abs(rate) / 34, 0.15, 0.6));
    }
    ctx.restore();

    if (!arms) return;

    // Arming pips beneath the spinner, one per banked pass. They sit in the
    // lane the ball has just come up, which is where the player is looking.
    ctx.save();
    for (let i = 0; i < SPINS_TO_ARM_WARP; i += 1) {
      const px = x - 18 + (i * 36) / (SPINS_TO_ARM_WARP - 1);
      const filled = armed || i < Math.round(progress * SPINS_TO_ARM_WARP);
      ctx.beginPath();
      ctx.arc(px, y + half1 + 8, 2.6, 0, Math.PI * 2);
      if (filled) {
        ctx.fillStyle = armed ? this.theme.feature : this.theme.primary;
        ctx.globalAlpha = armed ? 0.6 + Math.sin(time * 6 - i * 0.5) * 0.4 : 0.9;
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = 'rgba(125, 141, 176, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawBalls(ctx: CanvasRenderingContext2D, game: Game, onRail: boolean): void {
    for (const entry of game.balls) {
      if (entry.mode === 'idle') continue;
      if ((entry.mode === 'rail') !== onRail) continue;
      let p = entry.ball.pos;
      if (entry.mode === 'rail') {
        const path = entry.railPath === 'warp' ? game.table.warpPath : game.table.rampPath;
        if (path) p = pointAlong(path, entry.railT);
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
      grad.addColorStop(0, this.theme.ballLight);
      grad.addColorStop(0.45, this.theme.ballMid);
      grad.addColorStop(1, this.theme.ballDark);
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

  private drawHud(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
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
      ctx.fillStyle = this.theme.primary;
      ctx.font = mono(14, 700);
      ctx.fillText('LOOPBACK PINBALL', x, y);
      y += 34;

      ctx.fillStyle = this.theme.textDim;
      ctx.font = mono(11);
      ctx.fillText('SCORE', x, y);
      y += 16;
      ctx.fillStyle = this.theme.text;
      ctx.font = mono(30, 700);
      ctx.fillText(game.score.toLocaleString(), x, y);
      y += 42;

      ctx.fillStyle = this.theme.textDim;
      ctx.font = mono(11);
      ctx.fillText('HIGH', x, y);
      y += 16;
      ctx.fillStyle = this.theme.text;
      ctx.font = mono(16);
      ctx.fillText(game.highScore.toLocaleString(), x, y);
      y += 30;

      ctx.fillStyle = this.theme.textDim;
      ctx.font = mono(11);
      ctx.fillText(`BALL ${game.ballNumber}`, x, y);
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        ctx.arc(x + 82 + i * 15, y + 5, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = i < game.ballsRemaining ? this.theme.success : 'rgba(255,255,255,0.14)';
        ctx.fill();
      }
      y += 34;

      ctx.fillStyle = this.theme.textDim;
      ctx.font = mono(11);
      ctx.fillText('RANK', x, y);
      y += 16;
      ctx.fillStyle = this.theme.highlight;
      ctx.font = mono(18, 700);
      ctx.fillText(game.rank.toUpperCase(), x, y);
      y += 34;

      ctx.fillStyle = this.theme.textDim;
      ctx.font = mono(11);
      ctx.fillText(`BONUS x${game.bonusMultiplier}`, x, y);
      ctx.fillText(`UNITS ${game.bonusUnits}`, x + 130, y);
      y += 30;

      y = this.drawStatusChips(ctx, game, x, y, hud.w - 36, mono);
      y = this.drawMissionPanel(ctx, game, x, y, hud.w - 36, mono);
      this.drawMissionList(ctx, game, x, y + 10, mono);
      this.drawControls(ctx, x, hud.y + hud.h - 108, mono);
    } else {
      this.drawBackglass(ctx, game, mono);
    }
    ctx.restore();

    this.drawBanner(ctx, game, time);
    if (game.phase === 'attract' || game.phase === 'gameOver') {
      this.drawAttract(ctx, game, time);
    }
    if (game.tilted) this.drawTilt(ctx, time);
  }

  /**
   * The score display above the table on portrait screens.
   *
   * A phone is taller than the table's aspect ratio, so fitting the playfield
   * by width always leaves a band spare. Rather than pad it, the band becomes
   * the backbox the space would occupy on a real machine.
   */
  private drawBackglass(
    ctx: CanvasRenderingContext2D,
    game: Game,
    mono: (size: number, weight?: number) => string,
  ): void {
    const { hud } = this.layout;
    const { x, y, w, h } = hud;

    const panel = ctx.createLinearGradient(x, y, x, y + h);
    panel.addColorStop(0, withAlpha(this.theme.playfieldTop, 0.92));
    panel.addColorStop(1, withAlpha(this.theme.playfieldBottom, 0.92));
    ctx.fillStyle = panel;
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = withAlpha(this.theme.railMid, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Title bar.
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 14);
    ctx.clip();
    const glow = ctx.createRadialGradient(x + w / 2, y, 4, x + w / 2, y, w * 0.7);
    glow.addColorStop(0, withAlpha(this.theme.primary, 0.22));
    glow.addColorStop(1, withAlpha(this.theme.primary, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    const pad = 16;
    const compact = h < 130;
    let cursor = y + pad;

    ctx.textAlign = 'left';
    ctx.fillStyle = this.theme.primary;
    ctx.font = mono(compact ? 11 : 13, 700);
    ctx.fillText('LOOPBACK PINBALL', x + pad, cursor);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.theme.highlight;
    ctx.font = mono(compact ? 11 : 13, 700);
    // The audio buttons live in this corner, so the rank keeps clear of them.
    ctx.fillText(game.rank.toUpperCase(), x + w - pad - AUDIO_BUTTON_SPAN, cursor);
    cursor += compact ? 18 : 22;

    // Score, sized to the space available.
    ctx.textAlign = 'left';
    ctx.fillStyle = this.theme.text;
    const scoreSize = Math.min(w / 8.5, compact ? 30 : 44);
    ctx.font = mono(scoreSize, 700);
    ctx.fillText(game.score.toLocaleString(), x + pad, cursor);
    cursor += scoreSize + 8;

    // Ball indicator lamps, one per ball left.
    ctx.textAlign = 'right';
    ctx.fillStyle = this.theme.textDim;
    ctx.font = mono(11);
    ctx.fillText(
      `HIGH ${game.highScore.toLocaleString()}`,
      x + w - pad,
      cursor - scoreSize + 4,
    );
    ctx.textAlign = 'left';

    ctx.fillStyle = this.theme.textDim;
    ctx.font = mono(11);
    ctx.fillText('BALL', x + pad, cursor);
    for (let i = 0; i < 5; i += 1) {
      const cx = x + pad + 48 + i * 15;
      ctx.beginPath();
      ctx.arc(cx, cursor + 5, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = i < game.ballsRemaining ? this.theme.success : 'rgba(255,255,255,0.14)';
      ctx.fill();
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = this.theme.textDim;
    ctx.fillText(
      `BONUS x${game.bonusMultiplier}   UNITS ${game.bonusUnits}`,
      x + w - pad,
      cursor,
    );
    ctx.textAlign = 'left';
    cursor += 22;

    cursor = this.drawStatusChips(ctx, game, x + pad, cursor, w - pad * 2, mono);
    if (!compact) {
      this.drawMissionPanel(ctx, game, x + pad, cursor, w - pad * 2, mono);
    }
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
    const spec = game.machine.missions[game.activeMission];
    if (!spec) return y;
    ctx.fillStyle = this.theme.feature;
    ctx.font = mono(13, 700);
    ctx.fillText(spec.name.toUpperCase(), x, y);
    const barY = y + 20;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, barY, w, 6);
    ctx.fillStyle = this.theme.feature;
    ctx.fillRect(x, barY, w * missionFraction(game, spec.target), 6);
    ctx.fillStyle = this.theme.textDim;
    ctx.font = mono(11);
    ctx.fillText(`${Math.ceil(game.missionTimer)}s  ${spec.brief}`, x, barY + 12);
    return barY + 32;
  }

  /** The rank ladder, with everything earned so far ticked off. */
  private drawMissionList(
    ctx: CanvasRenderingContext2D,
    game: Game,
    x: number,
    y: number,
    mono: (size: number, weight?: number) => string,
  ): void {
    ctx.fillStyle = this.theme.textDim;
    ctx.font = mono(11);
    ctx.fillText('MISSIONS', x, y);
    game.machine.missions.forEach((spec, i) => {
      const row = y + 20 + i * 22;
      const done = i < game.missionsCompleted;
      const running = i === game.activeMission;
      ctx.beginPath();
      ctx.arc(x + 5, row + 5, 5, 0, Math.PI * 2);
      ctx.fillStyle = done
        ? this.theme.feature
        : running
          ? this.theme.highlight
          : 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.fillStyle = done || running ? this.theme.text : this.theme.textDim;
      ctx.font = mono(12, done || running ? 700 : 500);
      ctx.fillText(spec.name, x + 18, row);
    });
  }

  /**
   * Small pills for whatever modifier is currently running.
   *
   * These are all timed or conditional, so the player needs to see at a glance
   * what is live without reading the banner that just flashed past.
   */
  private drawStatusChips(
    ctx: CanvasRenderingContext2D,
    game: Game,
    x: number,
    y: number,
    maxWidth: number,
    mono: (size: number, weight?: number) => string,
  ): number {
    const chips: { text: string; color: string }[] = [];
    if (game.ballSaveTimer > 0) {
      chips.push({ text: `SAVE ${Math.ceil(game.ballSaveTimer)}s`, color: this.theme.success });
    }
    if (game.comboCount >= 2) {
      chips.push({ text: `COMBO ${game.comboCount}x`, color: this.theme.highlight });
    }
    if (game.frenzyTimer > 0) {
      chips.push({
        text: `FRENZY ${Math.ceil(game.frenzyTimer)}s`,
        color: this.theme.secondary,
      });
    }
    if (game.multiballActive) {
      chips.push({
        text: `JACKPOT ${Math.round(game.jackpotValue / 1000)}K`,
        color: this.theme.primary,
      });
    } else if (game.multiballLit) {
      chips.push({ text: 'MULTIBALL READY', color: this.theme.primary });
    }
    if (game.kickbackLit) {
      chips.push({ text: 'KICKBACK', color: this.theme.success });
    }
    if (game.skillShotTimer > 0) {
      chips.push({ text: 'SKILL LANE', color: this.theme.primary });
    }
    if (chips.length === 0) return y;

    ctx.save();
    ctx.font = mono(10, 700);
    ctx.textBaseline = 'top';
    let cx = x;
    let cy = y;
    for (const chip of chips) {
      const w = ctx.measureText(chip.text).width + 14;
      if (cx + w > x + maxWidth) {
        cx = x;
        cy += 20;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, cx, cy, w, 16, 8);
      ctx.fill();
      ctx.strokeStyle = chip.color;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = chip.color;
      ctx.fillText(chip.text, cx + 7, cy + 3);
      cx += w + 6;
    }
    ctx.restore();
    return cy + 24;
  }

  private drawControls(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    mono: (size: number, weight?: number) => string,
  ): void {
    ctx.fillStyle = this.theme.textDim;
    ctx.font = mono(11);
    const lines = [
      'Z / ←      left flipper',
      '/ / →      right flipper',
      'SPACE     plunger',
      'X  .      nudge',
      'ENTER     new game',
      'S  M      sound / music',
    ];
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * 16));
  }

  private drawBanner(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const banner = game.banner;
    if (!banner) return;
    const { offsetX, offsetY, scale } = this.layout;
    const cx = offsetX + PLAY_CENTER * scale;
    const cy = offsetY + 726 * scale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, banner.life * 2);
    ctx.fillStyle = this.theme.text;
    ctx.shadowColor = this.theme.primary;
    ctx.shadowBlur = 18;
    ctx.font = `700 ${Math.round(30 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(banner.text.toUpperCase(), cx, cy + Math.sin(time * 6) * 2);
    if (banner.sub) {
      ctx.shadowBlur = 8;
      ctx.fillStyle = this.theme.textDim;
      ctx.font = `500 ${Math.round(15 * scale)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(banner.sub, cx, cy + 34 * scale);
    }
    ctx.restore();
  }

  private drawAttract(ctx: CanvasRenderingContext2D, game: Game, time: number): void {
    const { offsetX, offsetY, scale } = this.layout;
    const cx = offsetX + PLAY_CENTER * scale;
    const cy = offsetY + 430 * scale;
    const board = game.scoreboard;
    // The card grows to fit however many scores the board is holding, so a
    // fresh browser gets a compact title card rather than a panel of blanks.
    const boardHeight = board.length > 0 ? 34 + board.length * 22 : 0;
    const top = cy - 120 * scale;
    const height = (302 + boardHeight) * scale;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = withAlpha(this.theme.voidTop, 0.94);
    roundRect(
      ctx,
      offsetX + (PLAY_LEFT + 20) * scale,
      top,
      (PLAY_RIGHT - PLAY_LEFT - 40) * scale,
      height,
      16,
    );
    ctx.fill();
    ctx.strokeStyle = withAlpha(this.theme.primary, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = this.theme.primary;
    ctx.shadowColor = this.theme.primary;
    ctx.shadowBlur = 22;
    ctx.font = `700 ${Math.round(40 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('LOOPBACK', cx, cy - 82 * scale);
    ctx.fillText('PINBALL', cx, cy - 38 * scale);
    ctx.shadowBlur = 0;

    if (game.phase === 'gameOver') {
      ctx.fillStyle = this.theme.highlight;
      ctx.font = `700 ${Math.round(20 * scale)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`FINAL ${game.score.toLocaleString()}`, cx, cy + 4 * scale);
    }

    // The machine picker. It uses the button hit-test, which sits above every
    // play zone in the input's hit order, so choosing a table can never launch
    // a ball or nudge the cabinet by accident.
    const pickerY = cy + 14 * scale;
    const arrowSpan = (PLAY_RIGHT - PLAY_LEFT - 40) * scale * 0.42;
    ctx.fillStyle = this.theme.feature;
    ctx.font = `700 ${Math.round(19 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(game.machine.name.toUpperCase(), cx, pickerY);
    ctx.fillStyle = this.theme.textDim;
    // Kept small and the taglines kept short: the arrows take the outer 16% of
    // the card on each side, and a line that reaches them is a line that
    // collides with them on a narrow screen.
    ctx.font = `500 ${Math.round(10 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(game.machine.tagline, cx, pickerY + 18 * scale);

    for (const [id, dx, glyph] of [
      ['machine-prev', -arrowSpan, '\u2039'],
      ['machine-next', arrowSpan, '\u203a'],
    ] as const) {
      const bx = cx + dx;
      const size = 30 * scale;
      this.buttons.push({ id, x: bx - size / 2, y: pickerY - size * 0.72, w: size, h: size });
      ctx.strokeStyle = withAlpha(this.theme.primary, 0.5);
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx - size / 2, pickerY - size * 0.72, size, size, 8);
      ctx.stroke();
      ctx.fillStyle = this.theme.primary;
      ctx.font = `700 ${Math.round(20 * scale)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(glyph, bx, pickerY - size * 0.06);
    }

    ctx.fillStyle = this.theme.text;
    ctx.globalAlpha = 0.6 + Math.sin(time * 3) * 0.4;
    ctx.font = `600 ${Math.round(18 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('TAP OR PRESS ENTER', cx, cy + 66 * scale);
    ctx.globalAlpha = 1;

    let cursor = cy + 106 * scale;
    if (board.length > 0) {
      cursor = this.drawScoreboard(ctx, game, cx, cursor, scale);
    }

    ctx.fillStyle = this.theme.textDim;
    ctx.textAlign = 'center';
    ctx.font = `500 ${Math.round(13 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('Tap left / right to flip', cx, cursor);
    ctx.fillText('Hold to draw the plunger', cx, cursor + 20 * scale);
    ctx.fillText('Buttons top right mute sound', cx, cursor + 40 * scale);
    ctx.fillText('1 / 2 / 3 pick a machine', cx, cursor + 60 * scale);
    ctx.restore();
  }

  /**
   * The local scoreboard, best first.
   *
   * Kept on this machine and nowhere else, which is why it says so: a board on
   * a web page usually implies everyone else's scores are on it too.
   */
  private drawScoreboard(
    ctx: CanvasRenderingContext2D,
    game: Game,
    cx: number,
    y: number,
    scale: number,
  ): number {
    const board = game.scoreboard;
    const width = (PLAY_RIGHT - PLAY_LEFT - 96) * scale;
    const left = cx - width / 2;
    const right = cx + width / 2;
    let cursor = y;

    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.textDim;
    ctx.font = `600 ${Math.round(11 * scale)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('THIS BROWSER', cx, cursor);
    cursor += 16 * scale;

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, cursor);
    ctx.lineTo(right, cursor);
    ctx.stroke();
    cursor += 15 * scale;

    const rowFont = `600 ${Math.round(13 * scale)}px ui-monospace, Menlo, monospace`;
    for (const [i, entry] of board.entries()) {
      // The game just played is picked out, so a new placing is obvious
      // without having to remember what the board looked like before.
      const fresh = game.phase === 'gameOver' && i === game.scoreboardPosition;
      ctx.font = rowFont;
      ctx.fillStyle = fresh ? this.theme.highlight : this.theme.text;
      ctx.globalAlpha = fresh ? 1 : 0.85;

      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}`, left, cursor);
      ctx.fillText(entry.score.toLocaleString(), left + 20 * scale, cursor);

      ctx.textAlign = 'right';
      ctx.fillStyle = fresh ? this.theme.highlight : this.theme.textDim;
      ctx.font = `500 ${Math.round(11 * scale)}px ui-monospace, Menlo, monospace`;
      const detail = [entry.rank, entry.date].filter(Boolean).join('  ');
      if (detail) ctx.fillText(detail, right, cursor);

      ctx.globalAlpha = 1;
      cursor += 22 * scale;
    }
    return cursor + 10 * scale;
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
