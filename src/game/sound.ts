/**
 * How a machine sounds.
 *
 * Every effect and every bar of the score is synthesised from the same handful
 * of oscillators, so one shared set of waveforms and one shared key made all
 * three tables sound identical however different they looked. Rather than
 * rewrite twenty-five effects per machine, a palette reshapes the lot: what
 * key it is in, what the layers are made of, how bright the filtering is and
 * how long anything rings for.
 */
export interface SoundPalette {
  /** Shifts the whole machine up or down, in semitones. */
  transpose: number;
  /** The chord loop, as semitone offsets from the root. */
  progression: readonly (readonly number[])[];
  padWave: OscillatorType;
  bassWave: OscillatorType;
  arpWave: OscillatorType;
  /**
   * Multiplies every filter cutoff. Below one is muffled and heavy; above one
   * is open and glassy.
   */
  brightness: number;
  /** Multiplies every duration. Below one is dry and clipped; above one rings. */
  sustain: number;
  /** Multiplies the tempo of every mood. */
  tempo: number;
}

/** Deep space: bright, square-edged and in A minor. */
export const ORBIT_SOUND: SoundPalette = {
  transpose: 0,
  progression: [
    [0, 3, 7], // Am
    [-4, 0, 3], // F
    [3, 7, 10], // C
    [-2, 2, 5], // G
  ],
  padWave: 'sawtooth',
  bassWave: 'sawtooth',
  arpWave: 'triangle',
  brightness: 1,
  sustain: 1,
  tempo: 1,
};

/**
 * A forge: low, dry and driving.
 *
 * Dropped a fourth and filtered down hard, so it sits under the table rather
 * than over it, and the progression leans on the flattened second that makes
 * a Phrygian line sound like something heavy being worked.
 */
export const MOLTEN_SOUND: SoundPalette = {
  transpose: -5,
  progression: [
    [0, 3, 7], // Em
    [1, 5, 8], // F, the flat second
    [0, 3, 7], // Em
    [-2, 1, 5], // D
  ],
  padWave: 'sawtooth',
  bassWave: 'square',
  arpWave: 'square',
  brightness: 0.6,
  sustain: 0.85,
  tempo: 1.12,
};

/**
 * Deep water: slow, soft and washy.
 *
 * Sine and triangle throughout, because water has no edges, and everything
 * rings well past where it would on the other two. The suspended chords never
 * quite resolve, which is the point.
 */
export const TIDE_SOUND: SoundPalette = {
  transpose: 2,
  progression: [
    [0, 5, 7], // sus4
    [-3, 2, 4], // relative, suspended
    [2, 7, 9],
    [-5, 0, 2],
  ],
  padWave: 'sine',
  bassWave: 'triangle',
  arpWave: 'sine',
  brightness: 0.8,
  sustain: 1.7,
  tempo: 0.88,
};
