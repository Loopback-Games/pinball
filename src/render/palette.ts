/** The table's colour scheme, in one place so the art stays coherent. */
export const PALETTE = {
  voidTop: '#04060e',
  voidBottom: '#0a1024',
  playfieldTop: '#101c3a',
  playfieldBottom: '#060a18',
  railLight: '#dbe4f4',
  railMid: '#8d9ab6',
  railDark: '#3c465e',
  cyan: '#3ce0ff',
  magenta: '#ff5ad8',
  amber: '#ffb43c',
  green: '#5dff9e',
  violet: '#a67bff',
  ballLight: '#ffffff',
  ballMid: '#b9c4d6',
  ballDark: '#2b3346',
  text: '#e8f0ff',
  textDim: '#7d8db0',
} as const;

/** Deterministic pseudo-randomness, so the decorative art never shifts. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
