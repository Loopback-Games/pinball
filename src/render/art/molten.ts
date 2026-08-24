import { TABLE_H, TABLE_W } from '../../game/table.js';
import type { ArtSpec } from '../art.js';
import { drawMotes, gates, motes, saucerLabel } from '../art.js';
import { alongWalls, glow, strokeWalls } from '../paint.js';
import { seeded, shade, withAlpha } from '../theme.js';

/**
 * Cracks in the basalt, widening towards the heat at the bottom.
 *
 * Authored once from a seed and drawn into the cached layer: a crack that
 * moved between frames would be a fissure, not a floor.
 */
const CRACKS = (() => {
  const rand = seeded(0x1a7a);
  return Array.from({ length: 22 }, () => {
    const x = rand() * TABLE_W;
    const y = 320 + rand() * (TABLE_H - 320);
    const steps = 3 + Math.floor(rand() * 4);
    const points = [{ x, y }];
    let cx = x;
    let cy = y;
    for (let i = 0; i < steps; i += 1) {
      cx += (rand() - 0.5) * 120;
      cy += (rand() - 0.35) * 90;
      points.push({ x: cx, y: cy });
    }
    return { points, width: 0.6 + rand() * 1.6 };
  });
})();

/** Embers, which rise. */
const EMBERS = motes(0xe3be, 48);

/**
 * Molten Core: a forge.
 *
 * The light comes from below. Everything else on this table follows from
 * that: the glow is at the drain end rather than the dome, the rock is lit
 * from underneath, and the bumpers are vents with fire in them rather than
 * planets with rings round them.
 */
export const MOLTEN_ART: ArtSpec = {
  cached: {
    backdrop(g, { theme }) {
      // Scorched rock, darkest at the top where the heat has not reached.
      const base = g.createLinearGradient(0, 0, 0, TABLE_H);
      base.addColorStop(0, theme.playfieldBottom);
      base.addColorStop(0.45, theme.playfieldMid);
      base.addColorStop(1, theme.playfieldTop);
      g.fillStyle = base;
      g.fillRect(0, 0, TABLE_W, TABLE_H);

      // The furnace under the playfield. Space puts its wash behind the
      // bumpers at the top; a forge is lit from the floor up.
      //
      // Kept well under the strength it wants to be: at full heat it washed
      // the whole lower third and the flippers and slingshots stopped reading
      // against it, which is the part of the table the player is watching.
      const forge = g.createRadialGradient(TABLE_W / 2, TABLE_H, 40, TABLE_W / 2, TABLE_H, 620);
      forge.addColorStop(0, withAlpha(theme.wash, 0.3));
      forge.addColorStop(0.4, withAlpha(theme.wash, 0.1));
      forge.addColorStop(1, withAlpha(theme.wash, 0));
      g.fillStyle = forge;
      g.fillRect(0, 0, TABLE_W, TABLE_H);

      // Cracks, glowing hotter the further down the table they run.
      for (const crack of CRACKS) {
        const first = crack.points[0];
        if (!first) continue;
        const heat = Math.min(1, Math.max(0, (first.y - 300) / 600));
        g.beginPath();
        g.moveTo(first.x, first.y);
        for (const p of crack.points.slice(1)) g.lineTo(p.x, p.y);
        g.strokeStyle = withAlpha(theme.primary, 0.1 + heat * 0.4);
        g.lineWidth = crack.width;
        g.lineCap = 'round';
        g.stroke();
      }

      // The shared vignette darkens towards the drain, which is the opposite
      // of what a table lit from below wants. This one shades the dome.
      const vig = g.createLinearGradient(0, 0, 0, TABLE_H * 0.55);
      vig.addColorStop(0, 'rgba(0,0,0,0.5)');
      vig.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = vig;
      g.fillRect(0, 0, TABLE_W, TABLE_H);
    },

    rails(g, { theme, table }) {
      // Cast iron: dull, flat and heavy, with no lit core. Three passes as
      // before, but the bright inner line that makes a tube is gone.
      strokeWalls(g, table, [
        { width: 12, style: shade(theme.railDark, 0.7) },
        { width: 8, style: theme.railDark },
        { width: 4, style: theme.railMid },
      ]);

      // Rivets down every rail, which is what says forged rather than lit.
      g.save();
      g.fillStyle = shade(theme.railMid, 1.25);
      g.beginPath();
      alongWalls(table, 26, (p) => {
        g.moveTo(p.x + 1.7, p.y);
        g.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
      });
      g.fill();
      g.restore();

      gates(g, theme, table);
    },

    saucer(g, { theme, table }) {
      const s = table.saucer;
      g.save();
      g.translate(s.center.x, s.center.y);

      // A pool of melt, brightest at the middle: the opposite of a hole.
      const pool = g.createRadialGradient(0, 0, 2, 0, 0, s.radius);
      pool.addColorStop(0, shade(theme.highlight, 1.1));
      pool.addColorStop(0.45, theme.primary);
      pool.addColorStop(1, shade(theme.primary, 0.35));
      g.fillStyle = pool;
      g.beginPath();
      g.arc(0, 0, s.radius - 3, 0, Math.PI * 2);
      g.fill();

      // Crust floating on it, drawn as broken arcs of cooled rock.
      g.strokeStyle = withAlpha(theme.playfieldBottom, 0.85);
      g.lineWidth = 4;
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath();
        g.arc(0, 0, s.radius - 9 - (i % 2) * 5, a, a + 0.75);
        g.stroke();
      }

      // The rim: a thick lip of cooled iron rather than a chrome cup.
      g.beginPath();
      g.arc(0, 0, s.radius, Math.PI * 0.75, Math.PI * 2.25);
      g.strokeStyle = shade(theme.railDark, 0.8);
      g.lineWidth = 8;
      g.lineCap = 'butt';
      g.stroke();
      g.beginPath();
      g.arc(0, 0, s.radius - 3, Math.PI * 0.75, Math.PI * 2.25);
      g.strokeStyle = withAlpha(theme.highlight, 0.55);
      g.lineWidth = 1.5;
      g.stroke();

      saucerLabel(g, theme, table, s.radius);
      g.restore();
      glow(g, s.center.x, s.center.y, s.radius * 2.1, theme.primary, 0.35);
    },
  },

  live: {
    bumper(g, { theme, time }, b, lit) {
      const r = b.radius * (1 + lit * 0.09);
      g.save();
      g.translate(b.center.x, b.center.y);

      // A vent in the rock: a dark collar of cooled crust...
      g.beginPath();
      g.arc(0, 0, r + 7, 0, Math.PI * 2);
      g.fillStyle = withAlpha(theme.playfieldBottom, 0.95);
      g.fill();
      g.strokeStyle = shade(theme.railDark, 0.85);
      g.lineWidth = 3;
      g.stroke();

      // ...with fire down it. The core breathes on its own so an idle table
      // still moves, without borrowing the other machine's orbiting ring.
      const breath = 0.82 + Math.sin(time * 2.3 + b.center.x) * 0.18 + lit * 0.35;
      const core = g.createRadialGradient(0, 0, 1, 0, 0, r * breath);
      core.addColorStop(0, lit > 0 ? theme.ballLight : shade(theme.highlight, 1.15));
      core.addColorStop(0.4, theme.primary);
      core.addColorStop(1, shade(theme.primary, 0.25));
      g.beginPath();
      g.arc(0, 0, r * breath, 0, Math.PI * 2);
      g.fillStyle = core;
      g.fill();

      // Broken crust across the mouth, so it reads as rock and not a lamp.
      g.strokeStyle = withAlpha(theme.playfieldBottom, 0.8);
      g.lineWidth = 2.5;
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2 + b.center.y;
        g.beginPath();
        g.arc(0, 0, r * 0.62, a, a + 0.9);
        g.stroke();
      }

      glow(g, 0, 0, r * (1.7 + lit * 1.2), theme.primary, 0.3 + lit * 0.5);
      g.restore();
    },

    target(g, { theme }, a, b, color, lit) {
      // Ingots: a flat billet on the deck, no specular highlight, because
      // nothing here is polished.
      g.save();
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      g.lineWidth = 15;
      g.beginPath();
      g.moveTo(a.x + 2, a.y + 5);
      g.lineTo(b.x + 2, b.y + 5);
      g.stroke();
      g.strokeStyle = shade(theme.railDark, 0.75);
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.strokeStyle = color;
      g.globalAlpha = 0.6 + lit * 0.4;
      g.lineWidth = 8;
      g.stroke();
      g.globalAlpha = 1;
      // A hot seam along the top edge instead of a shine.
      g.strokeStyle = withAlpha(theme.highlight, 0.35 + lit * 0.5);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(a.x, a.y - 3);
      g.lineTo(b.x, b.y - 3);
      g.stroke();
      if (lit > 0) glow(g, (a.x + b.x) / 2, (a.y + b.y) / 2, 34 * lit, color, lit * 0.6);
      g.restore();
    },

    ambient(g, { theme, time }) {
      // Embers rise off the floor of a forge.
      drawMotes(g, EMBERS, time, -1, theme.primary, [0.5, 0.3, 0.16]);
    },
  },
};
