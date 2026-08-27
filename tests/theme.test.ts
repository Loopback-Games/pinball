import { describe, expect, it } from 'vitest';
import {
  MOLTEN_THEME,
  ORBIT_THEME,
  TIDE_THEME,
  seeded,
  shade,
  withAlpha,
} from '../src/render/theme.js';
import type { Theme } from '../src/render/theme.js';

const THEMES: [string, Theme][] = [
  ['orbit', ORBIT_THEME],
  ['molten', MOLTEN_THEME],
  ['tide', TIDE_THEME],
];

describe('withAlpha', () => {
  it('keeps the colour and applies the alpha', () => {
    expect(withAlpha('#3ce0ff', 0.5)).toBe('rgba(60, 224, 255, 0.5)');
    expect(withAlpha('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(withAlpha('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
  });

  it('hands back anything it cannot parse rather than emitting NaN', () => {
    // A colour that came out as `rgba(NaN, ...)` would silently draw nothing,
    // which is the worst way for a theme mistake to present.
    expect(withAlpha('not-a-colour', 0.5)).toBe('not-a-colour');
  });
});

describe('shade', () => {
  it('leaves a colour alone at a factor of one', () => {
    expect(shade('#3ce0ff', 1)).toBe('rgb(60, 224, 255)');
  });

  it('goes to black at zero and clamps at white', () => {
    expect(shade('#3ce0ff', 0)).toBe('rgb(0, 0, 0)');
    // Every channel has to stop at 255; overflowing wraps to nonsense.
    expect(shade('#3ce0ff', 99)).toBe('rgb(255, 255, 255)');
  });

  it('hands back anything it cannot parse', () => {
    expect(shade('rgb(1,2,3)', 2)).toBe('rgb(1,2,3)');
  });
});

describe('seeded', () => {
  it('is the same sequence for the same seed', () => {
    const a = seeded(0x5eed);
    const b = seeded(0x5eed);
    expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b));
  });

  it('is a different sequence for a different seed', () => {
    const a = seeded(1);
    const b = seeded(2);
    expect(Array.from({ length: 20 }, a)).not.toEqual(Array.from({ length: 20 }, b));
  });

  it('stays inside zero and one', () => {
    const rand = seeded(12345);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('every theme', () => {
  for (const [name, theme] of THEMES) {
    it(`${name} defines every colour as a usable value`, () => {
      for (const [key, value] of Object.entries(theme)) {
        expect(typeof value, key).toBe('string');
        expect(value, key).not.toBe('');
        // Everything is a hex literal, because withAlpha and shade both parse
        // as hex and hand back anything else untouched — a theme entry written
        // as `rgb(...)` would silently ignore every alpha and shade applied
        // to it.
        expect(value, `${name}.${key} is not a hex colour`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  }

  it('gives each machine its own accents', () => {
    const accents = THEMES.map(([, t]) => [t.primary, t.secondary, t.feature].join());
    expect(new Set(accents).size).toBe(THEMES.length);
  });
});
