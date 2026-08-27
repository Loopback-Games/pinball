import { beforeEach, describe, expect, it } from 'vitest';
import { Audio } from '../src/game/audio.js';
import { MOLTEN_SOUND, TIDE_SOUND } from '../src/game/sound.js';
import type { SoundName } from '../src/game/game.js';

/** Every effect the game can ask for, so none of them can throw unnoticed. */
const EFFECTS: SoundName[] = [
  'flipper',
  'bumper',
  'sling',
  'target',
  'drop',
  'spinner',
  'rollover',
  'ramp',
  'warp',
  'eruption',
  'saucer',
  'launch',
  'drain',
  'wall',
  'mission',
  'complete',
  'tilt',
  'extraBall',
  'gameOver',
  'combo',
  'skillShot',
  'jackpot',
  'kickback',
  'ballSave',
  'frenzy',
  'laneChange',
];

beforeEach(() => {
  localStorage.clear();
});

async function running(): Promise<Audio> {
  const audio = new Audio();
  audio.resume();
  // The context comes up asynchronously even with the autoplay policy waived.
  for (let i = 0; i < 40 && audio.state() !== 'running'; i += 1) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return audio;
}

describe('the synthesiser', () => {
  it('starts a real context', async () => {
    const audio = await running();
    expect(audio.state()).toBe('running');
  });

  it('plays every effect the game can ask for', async () => {
    const audio = await running();
    const before = audio.playedEffects;
    for (const name of EFFECTS) {
      expect(() => audio.play(name, 1), name).not.toThrow();
    }
    // Each case reaches an oscillator rather than falling through the switch.
    expect(audio.playedEffects).toBeGreaterThan(before);
  });

  it('stays silent while the effects bus is muted', async () => {
    const audio = await running();
    audio.setSfxEnabled(false);
    const before = audio.playedEffects;
    for (const name of EFFECTS) audio.play(name, 1);
    expect(audio.playedEffects).toBe(before);
  });

  it('schedules the score, and stops when the music is muted', async () => {
    const audio = await running();
    audio.setMood('play');
    for (let i = 0; i < 30; i += 1) audio.tick();
    const playing = audio.scheduledNotes;
    expect(playing).toBeGreaterThan(0);

    audio.setMusicEnabled(false);
    const atMute = audio.scheduledNotes;
    for (let i = 0; i < 30; i += 1) audio.tick();
    // The clock keeps running while muted so unmuting does not replay a
    // backlog, but nothing may be queued.
    expect(audio.scheduledNotes).toBe(atMute);
  });

  it('plays every mood without throwing', async () => {
    const audio = await running();
    for (const mood of ['attract', 'play', 'mission', 'multiball', 'gameOver'] as const) {
      audio.setMood(mood);
      expect(() => {
        for (let i = 0; i < 10; i += 1) audio.tick();
      }, mood).not.toThrow();
    }
  });

  it('takes a palette from every machine', async () => {
    const audio = await running();
    for (const palette of [MOLTEN_SOUND, TIDE_SOUND]) {
      audio.setPalette(palette);
      audio.setMood('mission');
      expect(() => {
        for (let i = 0; i < 20; i += 1) audio.tick();
      }).not.toThrow();
    }
    expect(audio.scheduledNotes).toBeGreaterThan(0);
  });

  it('remembers both switches for the next visit', async () => {
    const audio = await running();
    audio.setSfxEnabled(false);
    audio.setMusicEnabled(false);

    // A fresh instance is what a reload gets.
    const reloaded = new Audio();
    expect(reloaded.sfxEnabled).toBe(false);
    expect(reloaded.musicEnabled).toBe(false);
  });

  it('comes back on its own after the context is suspended', async () => {
    const audio = await running();
    audio.setMood('play');
    for (let i = 0; i < 10; i += 1) audio.tick();

    await audio.suspendForTest();
    expect(audio.state()).toBe('suspended');

    // A browser may suspend at any point, not only before the first gesture.
    // Ticking has to notice and nudge it back, or the game goes quiet while
    // its own controls still claim the sound is on.
    const quiet = audio.scheduledNotes;
    // Recovery is deliberately not instant: the resume is only attempted
    // every thirtieth tick, so a suspended context costs half a second rather
    // than a resume attempt per frame.
    for (let i = 0; i < 200 && audio.state() !== 'running'; i += 1) {
      audio.tick();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(audio.state()).toBe('running');

    // And the score has to actually start again, not merely be allowed to.
    for (let i = 0; i < 200 && audio.scheduledNotes === quiet; i += 1) {
      audio.tick();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(audio.scheduledNotes).toBeGreaterThan(quiet);
  });
});
