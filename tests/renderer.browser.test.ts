import { afterEach, describe, expect, it } from 'vitest';
import { Game } from '../src/game/game.js';
import { MACHINES, machineById } from '../src/game/machines/index.js';
import { Renderer } from '../src/render/renderer.js';
import type { AudioSettings } from '../src/render/renderer.js';

const AUDIO: AudioSettings = { sfx: true, music: true, running: true };

const canvases: HTMLCanvasElement[] = [];

/** A canvas in the document, sized like a real viewport. */
function mount(width = 900, height = 1200): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.append(canvas);
  canvases.push(canvas);
  return canvas;
}

afterEach(() => {
  for (const c of canvases.splice(0)) c.remove();
});

function started(machineId: string): Game {
  const game = new Game(0x5eed, machineById(machineId));
  game.startGame();
  game.phase = 'playing';
  return game;
}

/** Every distinct pixel value in the frame. One means nothing was drawn. */
function distinctPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('the canvas lost its context');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const seen = new Set<number>();
  // Every 401st pixel: enough to tell a painted frame from a blank one
  // without walking two million of them.
  for (let i = 0; i < data.length; i += 4 * 401) {
    seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
  }
  return seen.size;
}

describe('the renderer', () => {
  it('sizes the backing store to the capped device ratio', () => {
    const canvas = mount(900, 1200);
    const game = started('orbit-cadet');
    const renderer = new Renderer(canvas);
    renderer.resize(game.table);

    // The cap is the single biggest thing standing between a phone and a
    // playable frame rate, and nothing checked it was applied.
    const expected = Math.min(globalThis.devicePixelRatio || 1, 2);
    expect(canvas.width).toBe(Math.round(900 * expected));
    expect(canvas.height).toBe(Math.round(1200 * expected));
  });

  for (const machine of MACHINES) {
    it(`draws ${machine.name} without throwing, in every phase`, () => {
      const canvas = mount();
      const game = new Game(0x5eed, machine);
      const renderer = new Renderer(canvas);
      renderer.resize(game.table);

      game.startGame();
      for (const phase of ['attract', 'ready', 'playing', 'ballOver', 'gameOver'] as const) {
        game.phase = phase;
        expect(() => renderer.draw(game, 1.25, AUDIO)).not.toThrow();
      }

      // With a mission running, multiball up, and tilted — the branches the
      // HUD and the inserts only take some of the time.
      game.phase = 'playing';
      game.activeMission = 0;
      game.missionTimer = 20;
      game.multiballActive = true;
      game.multiballLit = true;
      game.tilted = true;
      game.frenzyTimer = 5;
      game.ballSaveTimer = 5;
      game.comboCount = 3;
      expect(() => renderer.draw(game, 2.5, AUDIO)).not.toThrow();
    });

    it(`actually puts ${machine.name} on the canvas`, () => {
      const canvas = mount();
      const game = started(machine.id);
      const renderer = new Renderer(canvas);
      renderer.resize(game.table);
      renderer.draw(game, 1, AUDIO);

      // "It did not throw" and "it drew something" are different claims, and
      // the one that matters is the second: a blank screen with every test
      // passing is the exact failure the smoke test was added for.
      expect(distinctPixels(canvas)).toBeGreaterThan(8);
    });
  }

  it('repaints the cached layer when the machine changes', () => {
    // The static layer is built once and reused. It used to keep the previous
    // machine's playfield under the new one's; the renderer notices the swap
    // itself, and this is the only thing that checks it still does.
    const canvas = mount();
    const renderer = new Renderer(canvas);

    const orbit = started('orbit-cadet');
    renderer.resize(orbit.table);
    renderer.draw(orbit, 1, AUDIO);
    const before = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height)
      .data.join();

    const molten = started('molten-core');
    renderer.draw(molten, 1, AUDIO);
    const after = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height)
      .data.join();

    expect(after).not.toBe(before);
  });

  it('survives every viewport the smoke test screenshots', () => {
    const game = started('tidewreck');
    for (const [w, h] of [
      [1440, 900],
      [1180, 760],
      [390, 844],
      [820, 1180],
    ] as const) {
      const canvas = mount(w, h);
      const renderer = new Renderer(canvas);
      renderer.resize(game.table);
      expect(() => renderer.draw(game, 1, AUDIO)).not.toThrow();
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
      expect(distinctPixels(canvas)).toBeGreaterThan(4);
    }
  });

  describe('hit testing', () => {
    it('finds the audio buttons where they are drawn', () => {
      const canvas = mount();
      const game = started('orbit-cadet');
      const renderer = new Renderer(canvas);
      renderer.resize(game.table);
      renderer.draw(game, 1, AUDIO);

      // Top-right corner, where drawAudioButtons puts them.
      const ids = new Set<string>();
      for (let x = 800; x < 900; x += 4) {
        for (let y = 8; y < 60; y += 4) {
          const hit = renderer.hitButton(x, y);
          if (hit) ids.add(hit);
        }
      }
      expect(ids).toEqual(new Set(['sfx', 'music']));
    });

    it('offers the machine picker only while the attract card is up', () => {
      const canvas = mount();
      const game = new Game(0x5eed, machineById('orbit-cadet'));
      const renderer = new Renderer(canvas);
      renderer.resize(game.table);

      const sweep = (): Set<string> => {
        const ids = new Set<string>();
        for (let x = 0; x < 900; x += 6) {
          for (let y = 0; y < 1200; y += 6) {
            const hit = renderer.hitButton(x, y);
            if (hit) ids.add(hit);
          }
        }
        return ids;
      };

      game.phase = 'attract';
      renderer.draw(game, 1, AUDIO);
      expect(sweep()).toEqual(new Set(['sfx', 'music', 'machine-prev', 'machine-next']));

      // Mid-ball the arrows are not on screen, so they must not be clickable
      // either — a hit target that outlives its drawing is how a tap during
      // play changes the table.
      game.startGame();
      game.phase = 'playing';
      renderer.draw(game, 1, AUDIO);
      expect(sweep()).toEqual(new Set(['sfx', 'music']));
    });

    it('finds nothing in the middle of the playfield', () => {
      const canvas = mount();
      const game = started('orbit-cadet');
      const renderer = new Renderer(canvas);
      renderer.resize(game.table);
      renderer.draw(game, 1, AUDIO);
      expect(renderer.hitButton(450, 700)).toBeNull();
    });
  });
});
