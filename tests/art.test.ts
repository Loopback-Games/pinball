import { describe, expect, it } from 'vitest';
import {
  AMBIENT_MAX,
  moteAt,
  motes,
  resolveArt,
  DEFAULT_CACHED,
  DEFAULT_LIVE,
} from '../src/render/art.js';
import type { LiveContext, PaintContext } from '../src/render/art.js';
import { MACHINES } from '../src/game/machines/index.js';
import { TABLE_H, TABLE_W } from '../src/game/table.js';
import {
  badStops,
  badStyles,
  fakeContext,
  names,
  nonFiniteCalls,
  painted,
} from './helpers/fake-context.js';

describe('motes', () => {
  it('never exceeds the budget, however many are asked for', () => {
    // The budget is the whole reason this is a closed form: sixty radial
    // gradients a frame is the one thing here that would actually cost.
    expect(motes(1, 500)).toHaveLength(AMBIENT_MAX);
    expect(motes(1, 10)).toHaveLength(10);
  });

  it('is the same field every load', () => {
    expect(motes(0xabc, 20)).toEqual(motes(0xabc, 20));
    expect(motes(0xabc, 20)).not.toEqual(motes(0xdef, 20));
  });

  it('starts every mote on the table', () => {
    for (const m of motes(7, AMBIENT_MAX)) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThan(TABLE_W);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThan(TABLE_H);
      expect(m.size).toBeGreaterThan(0);
      expect(m.speed).toBeGreaterThan(0);
    }
  });

  it('keeps them on the table for ever, in both directions', () => {
    // The wrap is what lets the position be a function of the clock with no
    // per-frame state. If it leaked, motes would drift off and never return,
    // and a tab left open would slowly empty.
    const field = motes(3, 24);
    for (const dir of [-1, 1]) {
      for (const time of [0, 0.5, 61, 3600, 86_400]) {
        for (const m of field) {
          const p = moteAt(m, time, dir);
          expect(Number.isFinite(p.x)).toBe(true);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(TABLE_H);
        }
      }
    }
  });
});

describe('resolveArt', () => {
  it('fills in every slot a machine did not author', () => {
    const art = resolveArt({});
    expect(art.cached.backdrop).toBe(DEFAULT_CACHED.backdrop);
    expect(art.live.bumper).toBe(DEFAULT_LIVE.bumper);
    expect(art.live.ambient).toBe(DEFAULT_LIVE.ambient);
  });

  it('takes only the slots that were authored', () => {
    const bumper = DEFAULT_LIVE.bumper;
    const mine: typeof bumper = () => {};
    const art = resolveArt({ live: { bumper: mine } });
    expect(art.live.bumper).toBe(mine);
    // The five it did not name are still the defaults, which is the whole
    // point of composing rather than making every machine restate everything.
    expect(art.live.target).toBe(DEFAULT_LIVE.target);
    expect(art.cached.rails).toBe(DEFAULT_CACHED.rails);
  });

  it('does not mutate the defaults it composes over', () => {
    const before = DEFAULT_LIVE.bumper;
    resolveArt({ live: { bumper: () => {} } });
    expect(DEFAULT_LIVE.bumper).toBe(before);
  });
});

/**
 * Drive every painter on every machine against a recording context.
 *
 * None of this could run before: the art modules were imported by the machine
 * registry and therefore loaded by most of the suite, but no test ever called
 * one, so a thousand-odd lines sat at zero while looking reachable.
 */
describe('every machine paints', () => {
  for (const machine of MACHINES) {
    const table = machine.buildTable();
    const paint: PaintContext = { theme: machine.theme, table };
    const live = (time: number): LiveContext => ({ ...paint, time });
    const art = resolveArt(machine.art);

    const slots: [string, (ctx: CanvasRenderingContext2D) => void][] = [
      ['backdrop', (c) => art.cached.backdrop(c, paint)],
      ['rails', (c) => art.cached.rails(c, paint)],
      ['saucer', (c) => art.cached.saucer(c, paint)],
      ['bumper lit', (c) => art.live.bumper(c, live(1.5), table.bumpers[0]!, 1)],
      ['bumper unlit', (c) => art.live.bumper(c, live(1.5), table.bumpers[0]!, 0)],
      [
        'target',
        (c) =>
          art.live.target(
            c,
            live(1.5),
            table.standupTargets[0]!.a,
            table.standupTargets[0]!.b,
            machine.theme.success,
            0.5,
          ),
      ],
      ['ambient', (c) => art.live.ambient(c, live(2.25))],
    ];
    if (table.current) {
      const current = table.current;
      slots.push(['current', (c) => art.live.current(c, live(2.25), current, 1)]);
      slots.push(['current turning', (c) => art.live.current(c, live(2.25), current, 0.04)]);
    }

    describe(machine.name, () => {
      for (const [slot, paintIt] of slots) {
        it(`paints ${slot} cleanly`, () => {
          const { ctx, recording } = fakeContext();
          expect(() => paintIt(ctx)).not.toThrow();

          // A painter that saves without restoring corrupts everything drawn
          // after it, and the damage shows up somewhere else entirely.
          expect(recording.depth, 'unbalanced save/restore').toBe(0);
          // A NaN coordinate draws nothing at all, in silence.
          expect(nonFiniteCalls(recording).map((c) => c.name)).toEqual([]);
          expect(badStyles(recording), 'undefined or NaN in a colour').toEqual([]);
          expect(badStops(recording), 'gradient stop outside 0..1').toEqual([]);
        });
      }

      it('actually puts something on the canvas', () => {
        const { ctx, recording } = fakeContext();
        art.cached.backdrop(ctx, paint);
        art.cached.rails(ctx, paint);
        expect(painted(recording)).toBe(true);
      });
    });
  }
});

describe('the machines do not share a look', () => {
  const call = (machine: (typeof MACHINES)[number]) => {
    const table = machine.buildTable();
    const art = resolveArt(machine.art);
    const { ctx, recording } = fakeContext();
    art.live.bumper(ctx, { theme: machine.theme, table, time: 1 }, table.bumpers[0]!, 0);
    return recording;
  };

  it('gives the orbital ring to the space table and nobody else', () => {
    // A dashed ring spinning round a sphere is the strongest space cue on the
    // playfield, and the whole point of per-machine art was that the forge and
    // the wreck stopped wearing it. Nothing else checks that it stayed gone.
    const withRing = MACHINES.filter((m) => names(call(m)).includes('setLineDash'));
    expect(withRing.map((m) => m.id)).toEqual(['orbit-cadet']);
  });

  it('draws every bumper differently from every other', () => {
    const shapes = MACHINES.map((m) => names(call(m)).join(','));
    expect(new Set(shapes).size).toBe(MACHINES.length);
  });
});
