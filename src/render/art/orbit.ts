import { TABLE_H, TABLE_W } from '../../game/table.js';
import type { ArtSpec } from '../art.js';
import {
  bumperSkirt,
  cupWall,
  gates,
  motes,
  saucerCollar,
  saucerLabel,
  vignette,
} from '../art.js';
import { glow, strokeWalls } from '../paint.js';
import { seeded, shade, withAlpha } from '../theme.js';

/** Stars, fixed by seed so the sky is the same every load. */
const STARS = (() => {
  const rand = seeded(0x5eed);
  return Array.from({ length: 420 }, () => ({
    x: rand() * TABLE_W,
    y: rand() * TABLE_H,
    r: rand() * 1.1 + 0.25,
    alpha: 0.15 + rand() * 0.6,
    tinted: rand() > 0.85,
  }));
})();

/** A handful of the stars twinkle, which is all the motion deep space needs. */
const TWINKLE = motes(0x51a2, 24);

/**
 * Orbit Cadet: deep space.
 *
 * Everything here used to be everybody's — the starfield, the nebula, the
 * orbital ring round each bumper, the black-hole saucer. They are one
 * machine's motifs, and the forge and the wreck are better for not wearing
 * them.
 */
export const ORBIT_ART: ArtSpec = {
  cached: {
    backdrop(g, { theme }) {
      const base = g.createLinearGradient(0, 0, 0, TABLE_H);
      base.addColorStop(0, theme.playfieldTop);
      base.addColorStop(0.55, theme.playfieldMid);
      base.addColorStop(1, theme.playfieldBottom);
      g.fillStyle = base;
      g.fillRect(0, 0, TABLE_W, TABLE_H);

      for (const s of STARS) {
        g.globalAlpha = s.alpha;
        g.fillStyle = s.tinted ? theme.primary : theme.fleck;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;

      // A nebula behind the bumper cluster, to give the top some depth.
      const neb = g.createRadialGradient(278, 210, 10, 278, 210, 280);
      neb.addColorStop(0, withAlpha(theme.wash, 0.4));
      neb.addColorStop(0.5, withAlpha(theme.wash, 0.16));
      neb.addColorStop(1, withAlpha(theme.wash, 0));
      g.fillStyle = neb;
      g.fillRect(0, 0, TABLE_W, 620);

      vignette(g);
    },

    rails(g, { theme, table }) {
      // Lit tubing: wide and dark, then narrower and brighter, so the edge
      // reads as a glowing core rather than a painted line.
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
      saucerCollar(g, theme, s.radius);
      // A hole with nothing at the bottom of it.
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
  },

  live: {
    bumper(g, { theme, time }, b, lit) {
      const r = b.radius * (1 + lit * 0.09);
      g.save();
      g.translate(b.center.x, b.center.y);
      bumperSkirt(g, theme, r);

      // A lit sphere, shaded from a highlight up and to the left.
      const cap = g.createRadialGradient(-r * 0.3, -r * 0.35, 2, 0, 0, r);
      cap.addColorStop(0, lit > 0 ? theme.ballLight : shade(theme.primary, 1.35));
      cap.addColorStop(0.5, theme.primary);
      cap.addColorStop(1, shade(theme.primary, 0.32));
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fillStyle = cap;
      g.fill();

      // The orbital ring, so an idle table still has motion. This is the
      // strongest space cue on the machine and belongs to this one alone.
      g.rotate(time * 0.6);
      g.strokeStyle = `rgba(255,255,255,${0.18 + lit * 0.6})`;
      g.lineWidth = 2;
      g.setLineDash([5, 7]);
      g.beginPath();
      g.arc(0, 0, r - 5, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);

      if (lit > 0) glow(g, 0, 0, r * 2.4 * lit, theme.primary, lit * 0.7);
      g.restore();
    },

    ambient(g, { theme, time }) {
      // Stars do not drift, so this is a slow shimmer over a few of them
      // rather than a field of moving motes.
      g.save();
      g.fillStyle = theme.fleck;
      for (const [i, m] of TWINKLE.entries()) {
        const pulse = 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(time * 1.7 + i));
        g.globalAlpha = pulse;
        g.beginPath();
        g.arc(m.x, m.y, m.size * 0.7, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },
  },
};
