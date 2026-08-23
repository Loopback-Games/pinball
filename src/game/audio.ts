import type { SoundName } from './game.js';

/**
 * A small synthesiser for the table's sound effects.
 *
 * Everything is generated from oscillators and a single noise buffer, so the
 * game ships no audio files. The context is created on the first user gesture
 * because browsers refuse to start audio before one, and any failure leaves the
 * game silent rather than broken.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private failed = false;

  muted = false;

  /** Call from a user gesture handler. Safe to call repeatedly. */
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
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = makeNoise(this.ctx);
      }
      void this.ctx.resume();
    } catch {
      this.failed = true;
    }
  }

  /** Diagnostic hook: what the browser thinks the audio context is doing. */
  state(): string {
    if (this.failed) return 'failed';
    return this.ctx?.state ?? 'absent';
  }

  play(name: SoundName, intensity: number): void {
    if (this.muted || this.failed) return;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = Math.max(0.05, Math.min(1, intensity));

    switch (name) {
      case 'flipper':
        this.noise(t, 0.045, 2600, 0.3 * v, 900);
        this.tone(t, 'square', 180, 90, 0.05, 0.12 * v);
        break;
      case 'bumper':
        this.tone(t, 'sine', 720 + v * 380, 200, 0.16, 0.5 * v);
        this.tone(t, 'triangle', 1400, 500, 0.1, 0.22 * v);
        this.noise(t, 0.06, 3200, 0.18 * v, 1400);
        break;
      case 'sling':
        this.tone(t, 'square', 520, 260, 0.09, 0.3 * v);
        this.noise(t, 0.05, 2400, 0.2 * v, 1200);
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
        this.noise(t, 0.32, 700, 0.34 * v, 2600);
        this.tone(t, 'sawtooth', 140, 620, 0.3, 0.16 * v);
        break;
      case 'drain':
        this.tone(t, 'sawtooth', 420, 90, 0.55, 0.24);
        break;
      case 'wall':
        this.noise(t, 0.05, 900, 0.16 * v, 320);
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
        this.noise(t, 0.7, 260, 0.22, 120);
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
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private chord(at: number, freqs: number[], dur: number, gain: number): void {
    for (const f of freqs) this.tone(at, 'sine', f, f, dur, gain);
  }

  private noise(
    at: number,
    dur: number,
    filterFrom: number,
    gain: number,
    filterTo: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuffer) return;
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
    src.connect(filter).connect(g).connect(master);
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
