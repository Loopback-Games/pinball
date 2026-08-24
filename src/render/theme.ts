/**
 * A machine's colour scheme.
 *
 * Every colour the renderer draws comes from here, so a new machine is a new
 * set of values rather than a hunt through the drawing code. The accent names
 * are roles, not hues: `primary` is the ember orange on the forge table and
 * the cyan on the space one, and code that reaches for it wants "this
 * machine's main accent" in both cases.
 */
export interface Theme {
  /** Behind the table, top and bottom of the surround gradient. */
  voidTop: string;
  voidBottom: string;
  /** The playfield itself, top and bottom of its gradient. */
  playfieldTop: string;
  playfieldBottom: string;
  /** Metal: the bright edge, the body, and the shadowed side of every rail. */
  railLight: string;
  railMid: string;
  railDark: string;
  /** Lanes, rollovers, bumper caps — the machine's signature accent. */
  primary: string;
  /** Drop targets, flipper bats, frenzy: the contrast against `primary`. */
  secondary: string;
  /** Gates, rank, the skill lane. Warm and attention-seeking. */
  highlight: string;
  /** Ball save, kickback, standup targets. Reads as good news. */
  success: string;
  /** The big shots: saucer, habitrail, missions. */
  feature: string;
  ballLight: string;
  ballMid: string;
  ballDark: string;
  text: string;
  textDim: string;
  /** Slingshot plastics, top and bottom of their gradient. */
  slingTop: string;
  slingBottom: string;
  /** Inside a kickout hole: the dark centre and the lit rim beyond it. */
  holeMid: string;
  holeRim: string;
  /** Faint printing on the playfield — guide rings and the like. */
  print: string;
}

/**
 * `hex` at `alpha`.
 *
 * The art is mostly translucent washes over a dark playfield, and spelling
 * those out per theme would mean a hundred more values to keep in step. This
 * derives them from the handful that matter.
 */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deep space: the machine this game started as. */
export const ORBIT_THEME: Theme = {
  voidTop: '#04060e',
  voidBottom: '#0a1024',
  playfieldTop: '#101c3a',
  playfieldBottom: '#060a18',
  railLight: '#dbe4f4',
  railMid: '#8d9ab6',
  railDark: '#3c465e',
  primary: '#3ce0ff',
  secondary: '#ff5ad8',
  highlight: '#ffb43c',
  success: '#5dff9e',
  feature: '#a67bff',
  ballLight: '#ffffff',
  ballMid: '#b9c4d6',
  ballDark: '#2b3346',
  text: '#e8f0ff',
  textDim: '#7d8db0',
  slingTop: '#232f4e',
  slingBottom: '#131b30',
  holeMid: '#05070f',
  holeRim: '#121a30',
  print: '#78b4ff',
};

/**
 * A forge: ember orange and raw steel on scorched iron.
 *
 * The steel `secondary` is the point of the palette — the flippers and the
 * drop targets read as unheated metal against everything else glowing, which
 * is what stops a table this warm turning into one orange smear.
 */
export const MOLTEN_THEME: Theme = {
  voidTop: '#0d0603',
  voidBottom: '#1d0a04',
  playfieldTop: '#2c1108',
  playfieldBottom: '#120603',
  railLight: '#ffe8cf',
  railMid: '#c08a5e',
  railDark: '#5c3320',
  primary: '#ff8a2b',
  secondary: '#c9d4e0',
  highlight: '#ffd447',
  success: '#4de0c0',
  feature: '#ff2f6d',
  ballLight: '#ffffff',
  ballMid: '#d6c3b3',
  ballDark: '#3a2418',
  text: '#fff2e4',
  textDim: '#b08a72',
  slingTop: '#4a2415',
  slingBottom: '#2a1209',
  holeMid: '#0a0402',
  holeRim: '#3a1608',
  print: '#ff8a2b',
};

/** A drowned wreck: teal water, coral growth and brass lanterns. */
export const TIDE_THEME: Theme = {
  voidTop: '#01090c',
  voidBottom: '#04191c',
  playfieldTop: '#0a2b30',
  playfieldBottom: '#031114',
  railLight: '#d8f4f0',
  railMid: '#6fa8a2',
  railDark: '#274a4a',
  primary: '#2fd9c8',
  secondary: '#ff7a5c',
  highlight: '#ffcf5c',
  success: '#7cff9e',
  feature: '#c46bff',
  ballLight: '#ffffff',
  ballMid: '#bcd6d2',
  ballDark: '#1e3634',
  text: '#e6fbf8',
  textDim: '#79a8a4',
  slingTop: '#134a4a',
  slingBottom: '#082628',
  holeMid: '#010708',
  holeRim: '#0d3236',
  print: '#2fd9c8',
};

/** Deterministic pseudo-randomness, so the decorative art never shifts. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
