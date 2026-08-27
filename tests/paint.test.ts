import { describe, expect, it } from 'vitest';
import {
  alongWalls,
  glow,
  offsetPath,
  railRibbon,
  roundRect,
  strokeWalls,
  structural,
  traceCollider,
} from '../src/render/paint.js';
import { arc, circle, segment } from '../src/engine/shapes.js';
import { vec } from '../src/engine/vec2.js';
import { MACHINES } from '../src/game/machines/index.js';
import { fakeContext, names, nonFiniteCalls } from './helpers/fake-context.js';

const straight = [vec(0, 0), vec(100, 0), vec(200, 0)];

describe('offsetPath', () => {
  it('offsets perpendicular to the direction of travel', () => {
    // A path running right offsets along +y for a positive distance — down the
    // screen, since canvas y grows downward. The two rail edges are this
    // called twice with opposite signs, so what matters is that they are
    // perpendicular and opposed, not which one is called left.
    const side = offsetPath(straight, 10, 0);
    expect(side.map((p) => Math.round(p.y))).toEqual([10, 10, 10]);
    expect(side.map((p) => Math.round(p.x))).toEqual([0, 100, 200]);
  });

  it('mirrors for a negative distance and shifts for dy', () => {
    expect(offsetPath(straight, -10, 0).map((p) => Math.round(p.y))).toEqual([-10, -10, -10]);
    expect(offsetPath(straight, 0, 7).map((p) => Math.round(p.y))).toEqual([7, 7, 7]);
  });

  it('survives a path that cannot define a direction', () => {
    // A single point, or a repeated one, has no tangent. Dividing by its
    // length would put NaN into every coordinate downstream, and a NaN
    // coordinate draws nothing at all without complaining.
    for (const path of [[vec(5, 5)], [vec(5, 5), vec(5, 5)], []]) {
      for (const p of offsetPath(path, 10, 0)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});

describe('structural', () => {
  for (const machine of MACHINES) {
    it(`picks out ${machine.name}'s walls and guides and nothing else`, () => {
      const table = machine.buildTable();
      const walls = structural(table);
      expect(walls.length).toBeGreaterThan(0);
      expect(new Set(walls.map((c) => c.id))).toEqual(new Set(['wall', 'guide']));
      // Gates, bumpers, targets, posts and the slingshot shims are all
      // colliders too, and none of them is structure.
      expect(walls.length).toBeLessThan(table.colliders.length);
    });
  }
});

describe('traceCollider', () => {
  it('draws a segment as a line', () => {
    const { ctx, recording } = fakeContext();
    traceCollider(ctx, segment('wall', vec(0, 0), vec(10, 10)));
    expect(names(recording)).toEqual(['beginPath', 'moveTo', 'lineTo']);
  });

  it('draws an arc as an arc between its own angles', () => {
    const { ctx, recording } = fakeContext();
    traceCollider(ctx, arc('wall', vec(50, 50), 20, 1, 2));
    expect(names(recording)).toEqual(['beginPath', 'arc']);
    expect(recording.calls[1]?.args).toEqual([50, 50, 20, 1, 2]);
  });

  it('draws a circle as a whole turn', () => {
    const { ctx, recording } = fakeContext();
    traceCollider(ctx, circle('post', vec(5, 5), 9));
    expect(recording.calls[1]?.args).toEqual([5, 5, 9, 0, Math.PI * 2]);
  });
});

describe('strokeWalls', () => {
  it('lays every pass over every wall, and balances its state', () => {
    const table = MACHINES[0]!.buildTable();
    const { ctx, recording } = fakeContext();
    strokeWalls(ctx, table, [
      { width: 10, style: '#fff' },
      { width: 4, style: '#000' },
    ]);
    const walls = structural(table).length;
    expect(names(recording).filter((n) => n === 'stroke')).toHaveLength(walls * 2);
    expect(recording.depth).toBe(0);
  });

  it('clears a dash it set, so the next pass is not dashed too', () => {
    const table = MACHINES[0]!.buildTable();
    const { ctx, recording } = fakeContext();
    strokeWalls(ctx, table, [
      { width: 4, style: '#fff', dash: [3, 5] },
      { width: 2, style: '#000' },
    ]);
    const dashes = recording.calls
      .filter((c) => c.name === 'setLineDash')
      .map((c) => c.args[0]);
    expect(dashes).toContainEqual([3, 5]);
    expect(dashes).toContainEqual([]);
  });
});

describe('alongWalls', () => {
  for (const machine of MACHINES) {
    it(`walks ${machine.name} with unit tangents and finite points`, () => {
      const table = machine.buildTable();
      let count = 0;
      alongWalls(table, 30, (p, tangent) => {
        count += 1;
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 6);
      });
      expect(count).toBeGreaterThan(10);
    });
  }

  it('walks more often at a finer spacing', () => {
    const table = MACHINES[0]!.buildTable();
    const at = (spacing: number) => {
      let n = 0;
      alongWalls(table, spacing, () => {
        n += 1;
      });
      return n;
    };
    expect(at(10)).toBeGreaterThan(at(40));
  });

  it('does not loop for ever on a zero-length collider', () => {
    // The 1e-6 guards exist for this. Without them a degenerate wall is an
    // infinite loop rather than a wrong picture.
    const table = MACHINES[0]!.buildTable();
    const degenerate = {
      ...table,
      colliders: [segment('wall', vec(5, 5), vec(5, 5)), arc('guide', vec(0, 0), 0, 0, 1)],
    };
    let n = 0;
    alongWalls(degenerate, 10, () => {
      n += 1;
    });
    expect(n).toBe(0);
  });
});

describe('the shared primitives', () => {
  it('glow builds a radial gradient and restores what it changed', () => {
    const { ctx, recording } = fakeContext();
    glow(ctx, 10, 20, 30, '#fff', 0.5);
    expect(recording.gradients).toHaveLength(1);
    expect(recording.gradients[0]?.kind).toBe('radial');
    expect(recording.depth).toBe(0);
    expect(names(recording)).toContain('fill');
  });

  it('glow draws nothing at all at zero radius', () => {
    // Called with a radius scaled by a lamp that is off, which happens every
    // frame for most of the table.
    const { ctx, recording } = fakeContext();
    glow(ctx, 10, 20, 0, '#fff', 0.5);
    expect(recording.calls).toHaveLength(0);
  });

  it('roundRect closes its own path', () => {
    const { ctx, recording } = fakeContext();
    roundRect(ctx, 0, 0, 100, 50, 8);
    expect(names(recording)[0]).toBe('beginPath');
    expect(names(recording).at(-1)).toBe('closePath');
    expect(nonFiniteCalls(recording)).toEqual([]);
  });

  it('railRibbon traces one closed outline down both sides', () => {
    const { ctx, recording } = fakeContext();
    railRibbon(ctx, straight, 11, 0);
    const called = names(recording);
    expect(called[0]).toBe('beginPath');
    expect(called.at(-1)).toBe('closePath');
    // Down one side and back up the other: one moveTo, the rest lineTo.
    expect(called.filter((n) => n === 'moveTo')).toHaveLength(1);
    expect(called.filter((n) => n === 'lineTo')).toHaveLength(straight.length * 2 - 1);
  });
});
