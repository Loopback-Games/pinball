import { Audio } from './game/audio.js';
import { Game } from './game/game.js';
import type { Machine } from './game/machine.js';
import { MACHINES, machineById } from './game/machines/index.js';
import { Input } from './input/input.js';
import { Renderer } from './render/renderer.js';

/** Where the chosen machine is remembered between visits. */
const MACHINE_KEY = 'loopback-pinball-machine';

/**
 * Which machine to start on.
 *
 * A `?machine=` parameter wins, so a particular table can be linked to;
 * otherwise the one last played. An unknown id falls back to the default
 * rather than failing, because the id can come from a URL anyone can type.
 */
function initialMachine(): Machine {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get('machine');
  } catch {
    // A URL the browser will not parse is not worth failing to boot over.
  }
  if (fromUrl) return machineById(fromUrl);
  try {
    return machineById(globalThis.localStorage?.getItem(MACHINE_KEY));
  } catch {
    // Private browsing, or storage switched off.
    return machineById(null);
  }
}

const element = document.getElementById('table');
if (!(element instanceof HTMLCanvasElement)) {
  throw new Error('The page is missing its canvas element.');
}
const canvas: HTMLCanvasElement = element;

// The table only rolls dice to shake a wedged ball loose, but a real session
// should not repeat the same nudge every game. Tests take the default seed and
// replay exactly; a player gets a different one every time the page loads.
let machine = initialMachine();
let game = new Game(Date.now() & 0xffffffff, machine);
const renderer = new Renderer(canvas);
const audio = new Audio();

function wire(g: Game): void {
  g.onSound = (name, intensity) => audio.play(name, intensity);
  audio.setPalette(g.machine.sound);
}
wire(game);

/**
 * Match the page itself to the machine.
 *
 * The canvas never fills the window, so whatever is behind it shows as a
 * border. Left hardcoded to the space void, a forge table sat in a deep blue
 * frame, and the browser's own chrome was tinted to match the wrong table.
 */
function dressPage(m: Machine): void {
  document.body.style.background = m.theme.voidBottom;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta instanceof HTMLMetaElement) meta.content = m.theme.voidTop;
}
dressPage(machine);

/**
 * Swap the machine, which means a whole new game on a whole new playfield.
 *
 * Only ever reached from the attract screen, so no game is interrupted. The
 * renderer notices the change itself and repaints its cached static layer.
 */
function selectMachine(next: Machine): void {
  if (next.id === machine.id) return;
  machine = next;
  try {
    globalThis.localStorage?.setItem(MACHINE_KEY, machine.id);
  } catch {
    // The choice simply will not persist.
  }
  game = new Game(Date.now() & 0xffffffff, machine);
  wire(game);
  dressPage(machine);
  renderer.resize(game.table);
  audio.play('laneChange', 0.6);
}

/** Step `delta` machines along the list, wrapping at both ends. */
function cycleMachine(delta: number): void {
  const at = MACHINES.findIndex((m) => m.id === machine.id);
  const next = MACHINES[(at + delta + MACHINES.length) % MACHINES.length];
  if (next) selectMachine(next);
}

/** True while the player is on the attract card and free to change machine. */
const canSwitch = (): boolean => game.phase === 'attract' || game.phase === 'gameOver';

function setAudio(id: string, on: boolean): void {
  audio.resume();
  if (id === 'sfx') audio.setSfxEnabled(on);
  if (id === 'music') audio.setMusicEnabled(on);
}

function toggle(id: string): void {
  if (id === 'sfx') setAudio('sfx', !audio.sfxEnabled);
  if (id === 'music') setAudio('music', !audio.musicEnabled);
  if (id === 'machine-prev' && canSwitch()) cycleMachine(-1);
  if (id === 'machine-next' && canSwitch()) cycleMachine(1);
}

// Number keys pick a machine directly. They are deliberately not the flipper
// or plunger keys: a control that both changes the table and plays it would
// eventually do the wrong one.
window.addEventListener('keydown', (event) => {
  if (!canSwitch() || event.metaKey || event.ctrlKey || event.altKey) return;
  const index = Number.parseInt(event.key, 10) - 1;
  const picked = MACHINES[index];
  if (Number.isFinite(index) && picked) {
    event.preventDefault();
    selectMachine(picked);
  }
});

const input = new Input(canvas, {
  isReady: () => game.phase === 'ready',
  isIdle: () => game.phase === 'attract' || game.phase === 'gameOver',
  onGesture: () => audio.resume(),
  hitButton: (x, y) => renderer.hitButton(x, y),
  onButton: toggle,
});

function fit(): void {
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  renderer.resize(game.table);
}

fit();
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 120));

let last = performance.now();
let elapsed = 0;

function frame(now: number): void {
  // A backgrounded tab can hand back an enormous delta; cap it so the table
  // does not fast-forward when the player comes back.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  game.update(dt, input.sample(dt));
  audio.setMood(game.musicMood);
  audio.tick();
  renderer.draw(game, elapsed, {
    sfx: audio.sfxEnabled,
    music: audio.musicEnabled,
    running: audio.state() === 'running',
  });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Expose the game for debugging without pulling in a dev-only bundle.
//
// A getter rather than a value: picking a different machine builds a new Game,
// and a handle captured at boot would quietly go on describing the table the
// player has already left.
const controls = {
  audioContextState: () => audio.state(),
  audioSettings: () => ({ sfx: audio.sfxEnabled, music: audio.musicEnabled }),
  musicNotes: () => audio.scheduledNotes,
  sfxVoices: () => audio.playedEffects,
  suspendAudio: () => audio.suspendForTest(),
  setAudio,
  toggleAudio: toggle,
  machines: () => MACHINES.map((m) => m.id),
  selectMachine: (id: string) => selectMachine(machineById(id)),
};

Object.defineProperty(globalThis, 'pinball', {
  configurable: true,
  get: () => Object.assign(game, controls),
});
