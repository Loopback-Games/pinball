import type { SoundName } from './game.js';

/**
 * How urgent the music should feel. The game sets this; the sequencer decides
 * what that means for tempo, which layers play and how hard they are driven.
 */
export type MusicMood = 'attract' | 'play' | 'mission' | 'multiball' | 'gameOver';

interface MoodSettings {
  bpm: number;
  /** Layers that play in this mood. */
  pad: boolean;
  bass: boolean;
  arp: boolean;
  kick: boolean;
  hat: boolean;
  snare: boolean;
  /** Overall level, so tense moods sit louder in the mix. */
  level: number;
}

const MOODS: Record<MusicMood, MoodSettings> = {
  attract: { bpm: 84, pad: true, bass: false, arp: true, kick: false, hat: false, snare: false, level: 0.5 },
  play: { bpm: 104, pad: true, bass: true, arp: false, kick: true, hat: true, snare: false, level: 0.7 },
  mission: { bpm: 122, pad: true, bass: true, arp: true, kick: true, hat: true, snare: true, level: 0.85 },
  multiball: { bpm: 138, pad: true, bass: true, arp: true, kick: true, hat: true, snare: true, level: 1 },
  gameOver: { bpm: 72, pad: true, bass: true, arp: false, kick: false, hat: false, snare: false, level: 0.45 },
};

/**
 * Four bars of A minor, as semitone offsets from A. The triads give the pad
 * and arpeggio something to sit on and the roots drive the bass.
 */
const PROGRESSION: readonly (readonly number[])[] = [
  [0, 3, 7], // Am
  [-4, 0, 3], // F
  [3, 7, 10], // C
  [-2, 2, 5], // G
];

const STEPS_PER_BAR = 16;
const BARS = PROGRESSION.length;
const TOTAL_STEPS = STEPS_PER_BAR * BARS;

/** Seconds of notes to keep queued ahead of the clock. */
const LOOKAHEAD = 0.25;

const SFX_KEY = 'loopback-pinball-sfx';
const MUSIC_KEY = 'loopback-pinball-music';

const semitone = (n: number): number => 220 * Math.pow(2, n / 12);

/**
 * The table's synthesiser: sound effects and a generative score, both built
 * from oscillators and one noise buffer so the game ships no audio files.
 *
 * Effects and music run through separate gain buses, so either can be silenced
 * without touching the other. The context is created on the first user gesture
 * because browsers refuse to start audio before one, and every failure path
 * leaves the game playable but silent rather than broken.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private failed = false;

  private mood: MusicMood = 'attract';
  private resumeTicks = 0;
  private step = 0;
  private nextStepTime = 0;

  sfxEnabled = true;
  musicEnabled = true;

  /** Notes the sequencer has queued. Diagnostic, so tests can see it running. */
  scheduledNotes = 0;
  /** Effect voices started. Diagnostic, so tests can tell silence from muting. */
  playedEffects = 0;

  constructor() {
    this.sfxEnabled = readFlag(SFX_KEY, true);
    this.musicEnabled = readFlag(MUSIC_KEY, true);
  }

  /**
   * Start or restart audio. Call from every user gesture, not just the first.
   *
   * Whether a browser accepts the first attempt depends on the browser and on
   * which event carried the gesture: Safari honours click and touchend but not
   * pointerdown. Trying once and giving up leaves the game permanently silent
   * while its controls claim the sound is on. It is cheap and idempotent, so
   * the fix is simply to keep trying.
   */
  resume(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const Ctor =
          globalThis.AudioContext ??
          (globalThis as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        const ctx = new Ctor();
        this.ctx = ctx;
        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = this.sfxEnabled ? 0.32 : 0;
        this.sfxBus.connect(ctx.destination);
        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = this.musicEnabled ? 0.2 : 0;
        this.musicBus.connect(ctx.destination);
        this.noiseBuffer = makeNoise(ctx);
        this.nextStepTime = ctx.currentTime + 0.1;
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      this.failed = true;
    }
  }

  /** Testing hook: put the context to sleep the way a browser might. */
  suspendForTest(): void {
    void this.ctx?.suspend();
  }

  /** Diagnostic hook: what the browser thinks the audio context is doing. */
  state(): string {
    if (this.failed) return 'failed';
    return this.ctx?.state ?? 'absent';
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    writeFlag(SFX_KEY, on);
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.02);
    }
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    writeFlag(MUSIC_KEY, on);
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, 0.05);
    }
  }

  setMood(mood: MusicMood): void {
    this.mood = mood;
  }

  /**
   * Queue any music that falls due in the next fraction of a second.
   *
   * Notes are scheduled against the audio clock rather than fired from the
   * frame loop, so the beat does not wobble when a frame runs long. Call once
   * per frame.
   */
  tick(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (this.failed || !ctx || !bus) return;
    if (ctx.state !== 'running') {
      // A browser may suspend the context at any point, not only before the
      // first gesture. Nudge it back periodically rather than waiting for the
      // player to notice the silence and go looking for a control.
      this.resumeTicks += 1;
      if (this.resumeTicks % 30 === 0) this.resume();
      return;
    }
    this.resumeTicks = 0;
    if (!this.musicEnabled) {
      // Keep the clock rolling so unmuting does not replay a backlog.
      this.nextStepTime = Math.max(this.nextStepTime, ctx.currentTime);
      return;
    }
    const settings = MOODS[this.mood];
    const stepDuration = 60 / settings.bpm / 4;

    // A long stall (a backgrounded tab) must not queue hundreds of notes.
    if (this.nextStepTime < ctx.currentTime - 1) {
      this.nextStepTime = ctx.currentTime;
    }
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextStepTime, settings);
      this.step = (this.step + 1) % TOTAL_STEPS;
      this.nextStepTime += stepDuration;
    }
  }

  private scheduleStep(step: number, at: number, s: MoodSettings): void {
    const bar = Math.floor(step / STEPS_PER_BAR) % BARS;
    const inBar = step % STEPS_PER_BAR;
    const chord = PROGRESSION[bar] ?? PROGRESSION[0]!;
    const root = chord[0] ?? 0;
    const gain = s.level;

    if (s.pad && inBar === 0) {
      // A sustained chord, filtered so it breathes rather than drones.
      for (const note of chord) {
        this.musicTone(at, 'sawtooth', semitone(note), 1.9, 0.05 * gain, 900);
        this.musicTone(at, 'sawtooth', semitone(note) * 1.004, 1.9, 0.04 * gain, 700);
      }
    }
    if (s.bass && inBar % 4 === 0) {
      const accent = inBar === 0 ? 1 : 0.7;
      this.musicTone(at, 'sawtooth', semitone(root - 12), 0.34, 0.16 * gain * accent, 320);
    }
    if (s.arp && inBar % 2 === 0) {
      const note = chord[(inBar / 2) % chord.length] ?? root;
      const octave = inBar % 8 === 0 ? 12 : 0;
      this.musicTone(at, 'triangle', semitone(note + 12 + octave), 0.2, 0.09 * gain, 3200);
    }
    if (s.kick && (inBar === 0 || inBar === 8 || (s.snare && inBar === 6))) {
      this.kick(at, 0.5 * gain);
    }
    if (s.snare && (inBar === 4 || inBar === 12)) {
      this.noiseBurst(at, 0.16, 1800, 0.16 * gain, 700, this.musicBus);
    }
    if (s.hat && inBar % 2 === 1) {
      this.noiseBurst(at, 0.035, 8000, 0.05 * gain, 6000, this.musicBus);
    }
  }

  private kick(at: number, gain: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    this.scheduledNotes += 1;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.13);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + 0.24);
  }

  private musicTone(
    at: number,
    type: OscillatorType,
    freq: number,
    dur: number,
    gain: number,
    cutoff: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    this.scheduledNotes += 1;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.45), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + Math.min(0.06, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(filter).connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  /* ---------------------------------------------------------------- */

  play(name: SoundName, intensity: number): void {
    if (!this.sfxEnabled || this.failed) return;
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = Math.max(0.05, Math.min(1, intensity));

    switch (name) {
      case 'flipper':
        this.noiseBurst(t, 0.045, 2600, 0.3 * v, 900, this.sfxBus);
        this.tone(t, 'square', 180, 90, 0.05, 0.12 * v);
        break;
      case 'bumper':
        this.tone(t, 'sine', 720 + v * 380, 200, 0.16, 0.5 * v);
        this.tone(t, 'triangle', 1400, 500, 0.1, 0.22 * v);
        this.noiseBurst(t, 0.06, 3200, 0.18 * v, 1400, this.sfxBus);
        break;
      case 'sling':
        this.tone(t, 'square', 520, 260, 0.09, 0.3 * v);
        this.noiseBurst(t, 0.05, 2400, 0.2 * v, 1200, this.sfxBus);
        break;
      case 'target':
        this.tone(t, 'square', 880, 880, 0.07, 0.26 * v);
        break;
      case 'drop':
        this.tone(t, 'square', 660, 220, 0.16, 0.3 * v);
        break;
      case 'spinner':
        this.tone(t, 'sawtooth', 1200 + v * 900, 400, 0.05, 0.16 * v);
        break;
      case 'rollover':
        this.tone(t, 'sine', 1568, 1568, 0.14, 0.24 * v);
        this.tone(t + 0.04, 'sine', 2093, 2093, 0.12, 0.16 * v);
        break;
      case 'ramp':
        this.tone(t, 'sawtooth', 320, 1400, 0.34, 0.24);
        break;
      case 'saucer':
        this.chord(t, [523, 659, 784], 0.4, 0.16);
        break;
      case 'launch':
        this.noiseBurst(t, 0.32, 700, 0.34 * v, 2600, this.sfxBus);
        this.tone(t, 'sawtooth', 140, 620, 0.3, 0.16 * v);
        break;
      case 'drain':
        this.tone(t, 'sawtooth', 420, 90, 0.55, 0.24);
        break;
      case 'wall':
        this.noiseBurst(t, 0.05, 900, 0.16 * v, 320, this.sfxBus);
        break;
      case 'mission':
        this.chord(t, [392, 523, 659], 0.5, 0.15);
        this.tone(t + 0.18, 'square', 784, 784, 0.3, 0.12);
        break;
      case 'complete':
        [523, 659, 784, 1047].forEach((f, i) => {
          this.tone(t + i * 0.075, 'square', f, f, 0.2, 0.16);
        });
        break;
      case 'tilt':
        this.tone(t, 'sawtooth', 110, 80, 0.7, 0.28);
        this.noiseBurst(t, 0.7, 260, 0.22, 120, this.sfxBus);
        break;
      case 'extraBall':
        [784, 1047, 1319].forEach((f, i) => {
          this.tone(t + i * 0.09, 'sine', f, f, 0.34, 0.2);
        });
        break;
      case 'gameOver':
        [523, 440, 349, 262].forEach((f, i) => {
          this.tone(t + i * 0.18, 'triangle', f, f * 0.98, 0.34, 0.2);
        });
        break;
      // Rising run: the combo climbs in pitch as the chain grows.
      case 'combo':
        this.tone(t, 'square', 600 + v * 900, 900 + v * 1400, 0.16, 0.18);
        break;
      case 'skillShot':
        [880, 1109, 1319, 1760].forEach((f, i) => {
          this.tone(t + i * 0.07, 'square', f, f, 0.24, 0.2);
        });
        break;
      case 'jackpot':
        [659, 880, 1109, 1319, 1760].forEach((f, i) => {
          this.tone(t + i * 0.06, 'sawtooth', f, f, 0.3, 0.16);
        });
        this.noiseBurst(t, 0.5, 4000, 0.14, 800, this.sfxBus);
        break;
      case 'kickback':
        this.tone(t, 'square', 180, 900, 0.22, 0.3);
        this.noiseBurst(t, 0.2, 1400, 0.26, 3000, this.sfxBus);
        break;
      case 'ballSave':
        this.chord(t, [440, 554, 659], 0.36, 0.16);
        this.tone(t + 0.14, 'sine', 880, 880, 0.3, 0.14);
        break;
      case 'frenzy':
        [440, 523, 659, 880, 1047].forEach((f, i) => {
          this.tone(t + i * 0.05, 'sawtooth', f, f * 1.5, 0.3, 0.15);
        });
        break;
      case 'laneChange':
        this.tone(t, 'triangle', 1200, 1600, 0.05, 0.1);
        break;
    }
  }

  private tone(
    at: number,
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    gain: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;
    this.playedEffects += 1;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private chord(at: number, freqs: number[], dur: number, gain: number): void {
    for (const f of freqs) this.tone(at, 'sine', f, f, dur, gain);
  }

  private noiseBurst(
    at: number,
    dur: number,
    filterFrom: number,
    gain: number,
    filterTo: number,
    bus: GainNode | null,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !bus || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFrom, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), at + dur);
    filter.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(bus);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, value ? '1' : '0');
  } catch {
    // Blocked storage just means the preference will not persist.
  }
}
