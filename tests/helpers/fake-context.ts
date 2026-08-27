/**
 * A `CanvasRenderingContext2D` that records instead of painting.
 *
 * `art.ts` states the invariant this relies on: an art module may not touch
 * `document`, `window` or `devicePixelRatio`, and takes a 2D context as a
 * *type* only. That makes every painter drivable from node — but only against
 * something that answers the whole API surface, including the gradient objects
 * the art asks for and then immediately calls back into. A stub returning
 * `undefined` from `createRadialGradient` fails on the next line, inside the
 * fake, for a reason that has nothing to do with the art.
 *
 * What this can prove: that a painter runs, balances its state, never emits a
 * NaN coordinate or an undefined colour, and draws the shapes its machine is
 * supposed to draw. What it cannot prove: that the result looks right. The
 * browser suite and the smoke test are for that.
 */

/** One call a painter made, in order. */
export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface Stop {
  readonly offset: number;
  readonly color: string;
}

export interface RecordedGradient {
  readonly kind: 'linear' | 'radial' | 'conic';
  readonly stops: readonly Stop[];
}

export interface Recording {
  readonly calls: Call[];
  readonly gradients: RecordedGradient[];
  /** Save depth left at the end. Anything but zero and a painter leaked state. */
  depth: number;
}

/** Properties a painter assigns to and may read back. */
const PROPERTIES = new Set([
  'fillStyle',
  'strokeStyle',
  'globalAlpha',
  'globalCompositeOperation',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'lineDashOffset',
  'font',
  'textAlign',
  'textBaseline',
  'direction',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'filter',
  'imageSmoothingEnabled',
]);

export function fakeContext(
  width = 600,
  height = 1000,
): {
  ctx: CanvasRenderingContext2D;
  recording: Recording;
} {
  const recording: Recording = { calls: [], gradients: [], depth: 0 };
  const props = new Map<string, unknown>();

  const gradient = (kind: RecordedGradient['kind']): CanvasGradient => {
    const stops: Stop[] = [];
    recording.gradients.push({ kind, stops });
    return {
      addColorStop(offset: number, color: string) {
        stops.push({ offset, color });
      },
    } as CanvasGradient;
  };

  const specials: Record<string, (...args: never[]) => unknown> = {
    createLinearGradient: () => gradient('linear'),
    createRadialGradient: () => gradient('radial'),
    createConicGradient: () => gradient('conic'),
    // null is a legal return, and nothing here uses patterns.
    createPattern: () => null,
    measureText: (...args: never[]) => ({ width: String(args[0] ?? '').length * 6 }),
    getImageData: (...args: never[]) => ({
      width: Number(args[2] ?? 0),
      height: Number(args[3] ?? 0),
      data: new Uint8ClampedArray(Number(args[2] ?? 0) * Number(args[3] ?? 0) * 4),
    }),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };

  const handler: ProxyHandler<object> = {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (key === 'canvas') return { width, height };
      if (PROPERTIES.has(key)) return props.get(key);
      return (...args: unknown[]) => {
        recording.calls.push({ name: key, args });
        if (key === 'save') recording.depth += 1;
        if (key === 'restore') recording.depth -= 1;
        const special = specials[key];
        return special ? (special as (...a: unknown[]) => unknown)(...args) : undefined;
      };
    },
    set(_target, key, value) {
      if (typeof key === 'string') {
        recording.calls.push({ name: `set ${key}`, args: [value] });
        props.set(key, value);
      }
      return true;
    },
  };

  // The one cast, at the boundary where a test double meets the DOM type it
  // stands in for. Nothing inside is untyped.
  const ctx = new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
  return { ctx, recording };
}

/** Every call a painter made, by name. */
export const names = (r: Recording): string[] => r.calls.map((c) => c.name);

/** True if the painter ever put anything on the canvas. */
export const painted = (r: Recording): boolean =>
  r.calls.some((c) =>
    ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText'].includes(c.name),
  );

/** Numeric arguments that are not finite — a NaN coordinate draws nothing, silently. */
export function nonFiniteCalls(r: Recording): Call[] {
  return r.calls.filter(
    (c) =>
      c.name.startsWith('set ') === false &&
      c.args.some((a) => typeof a === 'number' && !Number.isFinite(a)),
  );
}

/** Colours that are missing or contain a stringified mistake. */
export function badStyles(r: Recording): unknown[] {
  const suspect = (v: unknown): boolean =>
    v === undefined ||
    v === null ||
    (typeof v === 'string' && (v.includes('NaN') || v.includes('undefined')));
  const assigned = r.calls
    .filter((c) => c.name === 'set fillStyle' || c.name === 'set strokeStyle')
    .map((c) => c.args[0])
    .filter(suspect);
  const stops = r.gradients
    .flatMap((g) => g.stops)
    .map((s) => s.color)
    .filter(suspect);
  return [...assigned, ...stops];
}

/** Gradient stops outside the range a canvas will accept. */
export function badStops(r: Recording): Stop[] {
  return r.gradients
    .flatMap((g) => g.stops)
    .filter((s) => !Number.isFinite(s.offset) || s.offset < 0 || s.offset > 1);
}
