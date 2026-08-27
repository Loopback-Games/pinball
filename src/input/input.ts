import type { Intents } from '../game/game.js';
import { noIntents } from '../game/game.js';

/** Which part of the screen a touch landed in. */
type Zone = 'left' | 'right' | 'nudge-left' | 'nudge-right' | 'plunger';

export interface InputOptions {
  /** True while the ball is sitting in the shooter lane. */
  isReady: () => boolean;
  /** True while the game is waiting to be started. */
  isIdle: () => boolean;
  /**
   * Called on every interaction, so audio can keep trying to start. Trying
   * only once leaves the game silent whenever the first attempt is refused.
   */
  onGesture: () => void;
  /** Which on-screen button, if any, sits at these canvas coordinates. */
  hitButton: (x: number, y: number) => string | null;
  /** A button was pressed. */
  onButton: (id: string) => void;
}

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyZ', 'KeyA', 'ShiftLeft']);
const RIGHT_KEYS = new Set(['ArrowRight', 'Slash', 'KeyL', 'ShiftRight']);
const PLUNGER_KEYS = new Set(['Space', 'ArrowDown']);
const SFX_KEYS = new Set(['KeyS']);
const MUSIC_KEYS = new Set(['KeyM']);
const NUDGE_LEFT_KEYS = new Set(['KeyX', 'Comma']);
const NUDGE_RIGHT_KEYS = new Set(['Period', 'KeyC']);
const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Digit1', 'KeyN']);

/**
 * Collects every input device into one set of intents.
 *
 * The touch mapping deliberately ignores where the flippers are drawn: the left
 * half of the screen is the left flipper wherever the player's thumb lands.
 * Aiming at a small on-screen button is exactly what a pinball player should
 * not have to do.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pointers = new Map<number, Zone>();
  private startRequested = false;
  private shake: 'left' | 'right' | null = null;
  private shakeTimer = 0;
  private lastShakeAt = 0;
  private gestureSeen = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: InputOptions,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    // Stop the browser turning a double tap into a zoom during play.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari only counts click and touchend as the gesture that may start
    // audio, so listen for those too rather than relying on pointerdown.
    canvas.addEventListener('click', () => this.options.onGesture());
    canvas.addEventListener('touchend', () => this.options.onGesture());
    // A key held when the page loses focus never sends its keyup, so the
    // flipper it was holding stays up for the rest of the game and the player
    // has to press and release it again to get it back. Alt-tabbing mid-ball
    // is enough to do it. The same goes for a pointer whose capture is taken
    // away without a pointerup.
    window.addEventListener('blur', this.releaseEverything);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseEverything();
    });
    canvas.addEventListener('lostpointercapture', this.onPointerUp);
    canvas.style.touchAction = 'none';
  }

  /** Intents for this frame. */
  sample(dt: number): Intents {
    const intents = noIntents();
    for (const code of this.held) {
      if (LEFT_KEYS.has(code)) intents.leftFlipper = true;
      if (RIGHT_KEYS.has(code)) intents.rightFlipper = true;
      if (PLUNGER_KEYS.has(code)) intents.plunger = true;
      if (NUDGE_LEFT_KEYS.has(code)) intents.nudgeLeft = true;
      if (NUDGE_RIGHT_KEYS.has(code)) intents.nudgeRight = true;
    }
    for (const zone of this.pointers.values()) {
      if (zone === 'left') intents.leftFlipper = true;
      if (zone === 'right') intents.rightFlipper = true;
      if (zone === 'plunger') intents.plunger = true;
      if (zone === 'nudge-left') intents.nudgeLeft = true;
      if (zone === 'nudge-right') intents.nudgeRight = true;
    }

    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    if (this.shakeTimer > 0 && this.shake) {
      if (this.shake === 'left') intents.nudgeLeft = true;
      else intents.nudgeRight = true;
    }

    if (this.startRequested) {
      intents.start = true;
      this.startRequested = false;
    }
    return intents;
  }

  /** Ask for motion access, which iOS only grants from a user gesture. */
  requestMotionAccess(): void {
    const ctor = globalThis.DeviceMotionEvent as
      (typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }) | undefined;
    if (!ctor) return;
    if (typeof ctor.requestPermission === 'function') {
      ctor
        .requestPermission()
        .then((state) => {
          if (state === 'granted') this.listenForShake();
        })
        .catch(() => {
          // Declined, so the player simply nudges with the on-screen zones.
        });
      return;
    }
    this.listenForShake();
  }

  private listenForShake(): void {
    window.addEventListener('devicemotion', (e) => {
      const x = e.accelerationIncludingGravity?.x;
      if (typeof x !== 'number') return;
      const now = performance.now();
      if (Math.abs(x) < 12 || now - this.lastShakeAt < 400) return;
      this.lastShakeAt = now;
      this.shake = x > 0 ? 'left' : 'right';
      this.shakeTimer = 0.08;
    });
  }

  private gesture(): void {
    this.options.onGesture();
    // Asking for motion access is genuinely once-only: repeating the prompt
    // after the player has answered it would be obnoxious.
    if (this.gestureSeen) return;
    this.gestureSeen = true;
    this.requestMotionAccess();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.gesture();
    if (PLUNGER_KEYS.has(e.code) || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault(); // stop the page scrolling under the table
    }
    if (START_KEYS.has(e.code) || (e.code === 'Space' && this.options.isIdle())) {
      this.startRequested = true;
    }
    if (SFX_KEYS.has(e.code)) this.options.onButton('sfx');
    if (MUSIC_KEYS.has(e.code)) this.options.onButton('music');
    this.held.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  /** Let go of every key and every touch, whatever state they were left in. */
  private readonly releaseEverything = (): void => {
    this.held.clear();
    this.pointers.clear();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.gesture();
    // Capture keeps the pointer reporting to the canvas once a thumb slides
    // off it, which is most of what makes a flipper hold. It is also the
    // least important thing this handler does: it throws if the pointer is
    // already gone, and losing the flip because the capture failed is worse
    // than not capturing.
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Nothing to do about it, and nothing that depends on it.
    }
    // Buttons win over every play zone, so a thumb reaching for the mute
    // control never nudges the table instead.
    const rect = this.canvas.getBoundingClientRect();
    const button = this.options.hitButton(e.clientX - rect.left, e.clientY - rect.top);
    if (button) {
      this.options.onButton(button);
      return;
    }
    if (this.options.isIdle()) {
      this.startRequested = true;
      return;
    }
    this.pointers.set(e.pointerId, this.zoneFor(e));
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  private zoneFor(e: PointerEvent): Zone {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // While the ball waits in the lane, every touch draws the plunger.
    if (this.options.isReady()) return 'plunger';
    // A narrow strip along the very top is the nudge control, so it can never
    // be hit by a thumb reaching for a flipper.
    if (y < 0.12) return x < 0.5 ? 'nudge-left' : 'nudge-right';
    return x < 0.5 ? 'left' : 'right';
  }
}
