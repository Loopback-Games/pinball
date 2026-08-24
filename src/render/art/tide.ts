import { TABLE_H, TABLE_W } from '../../game/table.js';
import type { ArtSpec } from '../art.js';
import { cupWall, drawMotes, gates, motes, saucerLabel, vignette } from '../art.js';
import { alongWalls, glow, strokeWalls } from '../paint.js';
import { seeded, shade, withAlpha } from '../theme.js';

/**
 * Shafts of light coming down through the water.
 *
 * The geometry is fixed and lives in the cached layer; only the alpha moves
 * per frame. Regenerating these every frame would be five gradients a frame
 * for something the eye reads as a slow shimmer.
 */
const SHAFTS = (() => {
  const rand = seeded(0x7ab1);
  return Array.from({ length: 6 }, (_, i) => ({
    x: 40 + (i * TABLE_W) / 6 + rand() * 40,
    width: 34 + rand() * 46,
    lean: (rand() - 0.5) * 90,
    phase: rand() * Math.PI * 2,
  }));
})();

/** Silt, which sinks, and bubbles, which do not. */
const SILT = motes(0x51a7, 34);
const BUBBLES = motes(0xb0b1, 20);

/**
 * Tidewreck: a drowned ship.
 *
 * The light comes from above and arrives broken. Nothing here glows of its
 * own accord the way the space table does — things are lit, or they are
 * silhouettes, and the water sits between them and the player.
 */
export const TIDE_ART: ArtSpec = {
  cached: {
    backdrop(g, { theme }) {
      // Deep water: lighter at the surface, black towards the bottom.
      const base = g.createLinearGradient(0, 0, 0, TABLE_H);
      base.addColorStop(0, theme.playfieldTop);
      base.addColorStop(0.5, theme.playfieldMid);
      base.addColorStop(1, theme.playfieldBottom);
      g.fillStyle = base;
      g.fillRect(0, 0, TABLE_W, TABLE_H);

      // Caustics, falling from the surface and fading out with depth.
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const s of SHAFTS) {
        const grad = g.createLinearGradient(s.x, 0, s.x + s.lean, TABLE_H * 0.8);
        grad.addColorStop(0, withAlpha(theme.wash, 0.16));
        grad.addColorStop(0.5, withAlpha(theme.wash, 0.05));
        grad.addColorStop(1, withAlpha(theme.wash, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(s.x - s.width / 2, 0);
        g.lineTo(s.x + s.width / 2, 0);
        g.lineTo(s.x + s.lean + s.width * 1.5, TABLE_H * 0.8);
        g.lineTo(s.x + s.lean - s.width * 0.4, TABLE_H * 0.8);
        g.closePath();
        g.fill();
      }
      g.restore();

      vignette(g);
    },

    rails(g, { theme, table }) {
      // Wire under rope and growth: a dull core, wrapped.
      strokeWalls(g, table, [
        { width: 11, style: shade(theme.railDark, 0.8) },
        { width: 7, style: theme.railMid },
        // The wrapping. A dashed pass over the top reads as binding turns
        // round the wire rather than as a lit tube down the middle of it.
        { width: 7, style: withAlpha(theme.railLight, 0.5), dash: [3, 5] },
      ]);

      // Barnacles, clustered rather than evenly spaced: growth is patchy.
      g.save();
      g.fillStyle = withAlpha(theme.railLight, 0.55);
      g.beginPath();
      alongWalls(table, 15, (p, _t, i) => {
        if (i % 3 === 0) return;
        const r = 1.1 + ((i * 7) % 5) * 0.5;
        g.moveTo(p.x + r, p.y);
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
      });
      g.fill();
      g.restore();

      gates(g, theme, table);
    },

    saucer(g, { theme, table }) {
      const s = table.saucer;
      g.save();
      g.translate(s.center.x, s.center.y);

      // A hole in the hull with the water turning over it.
      const hole = g.createRadialGradient(0, -4, 2, 0, 0, s.radius - 2);
      hole.addColorStop(0, shade(theme.holeMid, 0));
      hole.addColorStop(0.65, theme.holeMid);
      hole.addColorStop(1, theme.holeRim);
      g.fillStyle = hole;
      g.beginPath();
      g.arc(0, 0, s.radius - 3, 0, Math.PI * 2);
      g.fill();

      // A whirlpool: arcs winding in, so the eye is pulled to the middle.
      g.strokeStyle = withAlpha(theme.primary, 0.5);
      g.lineWidth = 1.6;
      for (let i = 0; i < 4; i += 1) {
        const r = s.radius - 6 - i * 6;
        const a = i * 1.1;
        g.beginPath();
        g.arc(0, 0, r, a, a + Math.PI * 1.25);
        g.stroke();
      }

      cupWall(g, theme, s.radius);
      saucerLabel(g, theme, table, s.radius);
      g.restore();
    },
  },

  live: {
    bumper(g, { theme, time }, b, lit) {
      const r = b.radius * (1 + lit * 0.09);
      g.save();
      g.translate(b.center.x, b.center.y);

      // An anemone: a holdfast on the deck, a crown of tentacles that sway,
      // and a bulb in the middle. No orbiting ring anywhere.
      g.beginPath();
      g.arc(0, 0, r + 6, 0, Math.PI * 2);
      g.fillStyle = withAlpha(theme.playfieldBottom, 0.9);
      g.fill();
      g.strokeStyle = withAlpha(theme.railMid, 0.8);
      g.lineWidth = 2;
      g.stroke();

      g.strokeStyle = withAlpha(theme.secondary, 0.75 + lit * 0.25);
      g.lineWidth = 2.6;
      g.lineCap = 'round';
      // The whole crown is one path with eight subpaths, not eight strokes.
      // On a weak device the cost is in the state changes, not the curves.
      g.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        // Each tentacle waves on its own phase, so the crown never looks
        // like a cog turning.
        const wave = Math.sin(time * 1.6 + i * 0.9 + b.center.x * 0.05) * 0.22;
        const reach = r + 5 + Math.sin(time * 2.1 + i) * 2;
        g.moveTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
        g.quadraticCurveTo(
          Math.cos(a + wave) * r * 0.9,
          Math.sin(a + wave) * r * 0.9,
          Math.cos(a + wave * 2.2) * reach,
          Math.sin(a + wave * 2.2) * reach,
        );
      }
      g.stroke();

      const bulb = g.createRadialGradient(-r * 0.2, -r * 0.25, 1, 0, 0, r * 0.6);
      bulb.addColorStop(0, lit > 0 ? theme.ballLight : shade(theme.primary, 1.3));
      bulb.addColorStop(1, shade(theme.primary, 0.4));
      g.beginPath();
      g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      g.fillStyle = bulb;
      g.fill();

      if (lit > 0) glow(g, 0, 0, r * 2.4 * lit, theme.primary, lit * 0.6);
      g.restore();
    },

    target(g, { theme }, a, b, color, lit) {
      // Cargo: a crate end, banded, sitting proud of the deck.
      g.save();
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      g.lineWidth = 15;
      g.beginPath();
      g.moveTo(a.x + 2, a.y + 4);
      g.lineTo(b.x + 2, b.y + 4);
      g.stroke();
      g.strokeStyle = shade(theme.railDark, 1.1);
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.strokeStyle = color;
      g.globalAlpha = 0.6 + lit * 0.4;
      g.lineWidth = 9;
      g.stroke();
      g.globalAlpha = 1;
      // Two bands across the crate.
      g.strokeStyle = withAlpha(theme.railLight, 0.5);
      g.lineWidth = 1.6;
      for (const t of [0.33, 0.67]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        g.beginPath();
        g.moveTo(x + (nx / len) * 6, y + (ny / len) * 6);
        g.lineTo(x - (nx / len) * 6, y - (ny / len) * 6);
        g.stroke();
      }
      if (lit > 0) glow(g, (a.x + b.x) / 2, (a.y + b.y) / 2, 30 * lit, color, lit * 0.5);
      g.restore();
    },

    current(g, { theme, time }, spec, flow) {
      // Water moving, drawn as streaks that lean the way it is running and
      // fade as it turns. A current the player cannot see is a table that
      // cheats, so this has to be legible at a glance without becoming a
      // second playfield drawn over the first.
      const { x, y, w, h } = spec.region;
      const strength = Math.abs(flow);
      if (strength < 0.02) return;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = withAlpha(theme.primary, 0.06 + strength * 0.16);
      g.lineCap = 'round';
      // One path for the whole band, and fewer streaks in it. Twenty-seven
      // strokes a frame bought no more legibility than twelve.
      g.lineWidth = 1.4 + strength * 1.6;
      g.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const ly = y + ((i + 0.5) / 6) * h;
        // Each streak runs at its own rate, so the band shears rather than
        // sliding as one sheet.
        const speed = 60 + (i % 3) * 34;
        const offset = ((time * speed * Math.sign(flow)) % (w + 120)) - 60;
        const len = 26 + strength * 52;
        for (const k of [0, 1]) {
          const sx = x + ((offset + (k * (w + 120)) / 2 + w + 120) % (w + 120)) - 30;
          g.moveTo(Math.max(x, sx), ly);
          g.lineTo(Math.min(x + w, sx + len * Math.sign(flow || 1)), ly);
        }
      }
      g.stroke();
      g.restore();
    },

    ambient(g, { theme, time }) {
      // Silt sinks, bubbles rise, and the shafts breathe over both.
      g.save();
      g.globalCompositeOperation = 'lighter';
      // Three shafts breathe, not five, and they share a flat wash rather
      // than a gradient apiece. A fresh linear gradient per shaft per frame
      // was the most expensive thing on this table, for a shimmer the eye
      // reads as nothing more than a change in brightness.
      for (const [i, s] of SHAFTS.slice(0, 3).entries()) {
        const strength = 0.02 + 0.025 * (0.5 + 0.5 * Math.sin(time * 0.7 + s.phase + i));
        g.fillStyle = withAlpha(theme.wash, strength);
        const drift = Math.sin(time * 0.35 + s.phase) * 10;
        g.beginPath();
        g.moveTo(s.x - s.width / 2 + drift, 0);
        g.lineTo(s.x + s.width / 2 + drift, 0);
        g.lineTo(s.x + s.lean + s.width * 1.5 + drift, TABLE_H * 0.8);
        g.lineTo(s.x + s.lean - s.width * 0.4 + drift, TABLE_H * 0.8);
        g.closePath();
        g.fill();
      }
      g.restore();

      drawMotes(g, SILT, time, 1, theme.fleck, [0.22, 0.14, 0.08]);
      drawMotes(g, BUBBLES, time, -1, theme.railLight, [0.34, 0.2]);
    },
  },
};
