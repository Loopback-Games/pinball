import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/input/input.js';
import type { InputOptions } from '../src/input/input.js';

const canvases: HTMLCanvasElement[] = [];

function mount(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.width = '800px';
  canvas.style.height = '1000px';
  document.body.append(canvas);
  canvases.push(canvas);
  return canvas;
}

afterEach(() => {
  for (const c of canvases.splice(0)) c.remove();
});

function build(overrides: Partial<InputOptions> = {}) {
  const canvas = mount();
  const onButton = vi.fn();
  const onGesture = vi.fn();
  const options: InputOptions = {
    isReady: () => false,
    isIdle: () => false,
    onGesture,
    hitButton: () => null,
    onButton,
    ...overrides,
  };
  return { canvas, input: new Input(canvas, options), onButton, onGesture };
}

const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
const release = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));

describe('keyboard', () => {
  it('maps every key each flipper answers to', () => {
    const { input } = build();
    for (const code of ['ArrowLeft', 'KeyZ', 'KeyA', 'ShiftLeft']) {
      press(code);
      expect(input.sample(1 / 60).leftFlipper, code).toBe(true);
      release(code);
      expect(input.sample(1 / 60).leftFlipper, code).toBe(false);
    }
    for (const code of ['ArrowRight', 'Slash', 'KeyL', 'ShiftRight']) {
      press(code);
      expect(input.sample(1 / 60).rightFlipper, code).toBe(true);
      release(code);
    }
  });

  it('holds the plunger while the key is down', () => {
    const { input } = build();
    press('Space');
    expect(input.sample(1 / 60).plunger).toBe(true);
    release('Space');
    expect(input.sample(1 / 60).plunger).toBe(false);
  });

  it('nudges from either side', () => {
    const { input } = build();
    press('KeyX');
    expect(input.sample(1 / 60).nudgeLeft).toBe(true);
    release('KeyX');
    press('Period');
    expect(input.sample(1 / 60).nudgeRight).toBe(true);
    release('Period');
  });

  it('asks to start exactly once per press', () => {
    const { input } = build();
    press('Enter');
    expect(input.sample(1 / 60).start).toBe(true);
    // Held down, it must not restart the game every frame.
    expect(input.sample(1 / 60).start).toBe(false);
    release('Enter');
  });

  it('lets go of everything when the page loses focus', () => {
    // A key held when the page stops being the thing the player is looking at
    // never sends its keyup, and the flipper it was holding used to stay up
    // for the rest of the game. Alt-tabbing mid-ball was enough to do it.
    const { input } = build();
    press('KeyZ');
    expect(input.sample(1 / 60).leftFlipper).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(input.sample(1 / 60).leftFlipper).toBe(false);
    release('KeyZ');
  });
});

describe('touch', () => {
  const point = (canvas: HTMLCanvasElement, x: number, y: number, id = 1) =>
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y, bubbles: true }),
    );

  it('reads the half of the screen, not where the flipper is drawn', () => {
    // Aiming at a small on-screen target is exactly what a pinball player
    // should not have to do.
    const { canvas, input } = build();
    const box = canvas.getBoundingClientRect();
    point(canvas, box.left + box.width * 0.1, box.top + box.height * 0.8);
    expect(input.sample(1 / 60).leftFlipper).toBe(true);

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    point(canvas, box.left + box.width * 0.9, box.top + box.height * 0.8, 2);
    expect(input.sample(1 / 60).rightFlipper).toBe(true);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
  });

  it('makes every touch the plunger while the ball waits in the lane', () => {
    const { canvas, input } = build({ isReady: () => true });
    const box = canvas.getBoundingClientRect();
    point(canvas, box.left + box.width * 0.1, box.top + box.height * 0.8);
    const intents = input.sample(1 / 60);
    expect(intents.plunger).toBe(true);
    expect(intents.leftFlipper).toBe(false);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  });

  it('sends a touch on a button to the button and nowhere else', () => {
    const { canvas, input, onButton } = build({ hitButton: () => 'sfx' });
    const box = canvas.getBoundingClientRect();
    point(canvas, box.left + 10, box.top + 10);
    expect(onButton).toHaveBeenCalledWith('sfx');
    // It must not also flip: the audio controls sit above every play zone.
    expect(input.sample(1 / 60).leftFlipper).toBe(false);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  });

  it('releases a pointer whose capture is taken away', () => {
    const { canvas, input } = build();
    const box = canvas.getBoundingClientRect();
    point(canvas, box.left + box.width * 0.1, box.top + box.height * 0.8);
    expect(input.sample(1 / 60).leftFlipper).toBe(true);
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    expect(input.sample(1 / 60).leftFlipper).toBe(false);
  });

  it('stops the browser turning a double tap into a zoom', () => {
    const { canvas } = build();
    expect(canvas.style.touchAction).toBe('none');
    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
});
